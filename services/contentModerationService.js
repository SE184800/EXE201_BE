/**
 * Service Kiểm Duyệt Tự Động Nội Dung Sản Phẩm Sỉ & Bài Đăng Khuyến Mãi (AI Auto-Moderation)
 * 3 Mức Độ:
 * - AUTO_APPROVED: Hợp lệ (0 lỗi, sạch)
 * - NEEDS_REVIEW: Cảnh báo nhẹ (chỉ 1 lỗi nhẹ: thuốc lá/xì gà hợp pháp, giá lệch nhẹ -> Tạm ẩn, chờ Admin duyệt)
 * - AUTO_REJECTED: Vi phạm nghiêm trọng (từ cấm nặng, ma túy, vũ khí, spam, giá phi lý, HOẶC >= 2 lỗi -> AI tự cấm thẳng)
 * 
 * Hỗ trợ nạp cấu hình động từ Admin: từ cấm tùy chỉnh, từ khóa hạn chế, ngưỡng giá & MOQ, bật/tắt AI.
 */

const systemConfigService = require('./systemConfigService');

const DEFAULT_CRITICAL_FORBIDDEN_KEYWORDS = [
  'chất cấm', 'ma túy', 'bóng cười', 'vũ khí', 'súng', 'đạn', 'đao kiếm',
  'cờ bạc', 'lừa đảo', 'hàng giả', 'hàng nhái', 'kích dục', 'độc hại',
  'rượu lậu', 'tiền giả', 'pháo nổ', 'pháo hoa nổ', 'ngà voi', 'sừng tê giác',
  'cỏ mỹ', 'tê tê'
];

const DEFAULT_RESTRICTED_KEYWORDS = [
  'thuốc lá', 'xì gà', 'rượu mạnh'
];

const SPAM_PATTERNS = [
  /zalo\s*:\s*0\d{9}/i,
  /liên\s*hệ\s*chuyển\s*khoản\s*trực\s*tiếp/i,
  /cần\s*gấp\s*tiền\s*xả\s*lỗ/i,
  /bán\s*chui/i
];

/**
 * Đánh giá an toàn và kiểm duyệt nội dung sản phẩm sỉ / bài đăng
 * @param {Object} item Thông tin sản phẩm { name, category, packaging, wholesalePrice, moq, description }
 * @param {Object} options Cấu hình AI { apiKey, model, provider, fetcher }
 * @returns {Promise<{ status: 'AUTO_APPROVED'|'NEEDS_REVIEW'|'AUTO_REJECTED', riskScore: number, reasons: string[], criticalReasons: string[], isClean: boolean }>}
 */
async function moderateContent(item = {}, options = {}) {
  const sysConfig = systemConfigService.getConfig();
  const aiConfig = sysConfig?.aiModeration || {};

  // Nếu Admin tắt tính năng AI duyệt bài tự động
  if (aiConfig.autoModerationEnabled === false) {
    return {
      status: 'AUTO_APPROVED',
      riskScore: 0,
      reasons: [],
      criticalReasons: [],
      isClean: true,
      disabled: true,
    };
  }

  const forbiddenWords = Array.isArray(aiConfig.criticalForbiddenKeywords) && aiConfig.criticalForbiddenKeywords.length > 0
    ? aiConfig.criticalForbiddenKeywords
    : DEFAULT_CRITICAL_FORBIDDEN_KEYWORDS;

  const restrictedWords = Array.isArray(aiConfig.restrictedKeywords) && aiConfig.restrictedKeywords.length > 0
    ? aiConfig.restrictedKeywords
    : DEFAULT_RESTRICTED_KEYWORDS;

  const minPrice = typeof aiConfig.minSuspiciousPrice === 'number' ? aiConfig.minSuspiciousPrice : 500;
  const warningLowPrice = typeof aiConfig.warningLowPrice === 'number' ? aiConfig.warningLowPrice : 2000;
  const maxPrice = typeof aiConfig.maxSuspiciousPrice === 'number' ? aiConfig.maxSuspiciousPrice : 500000000;
  const maxMoq = typeof aiConfig.maxMoq === 'number' ? aiConfig.maxMoq : 50000;
  const warningMoq = typeof aiConfig.warningMoq === 'number' ? aiConfig.warningMoq : 5000;
  const strictness = aiConfig.strictness || 'STANDARD';

  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const category = typeof item.category === 'string' ? item.category.trim() : '';
  const packaging = typeof item.packaging === 'string' ? item.packaging.trim() : '';
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  const price = typeof item.wholesalePrice === 'number' ? item.wholesalePrice : Number(item.wholesalePrice) || 0;
  const moq = typeof item.moq === 'number' ? item.moq : Number(item.moq) || 1;

  const reasons = [];
  const criticalReasons = [];
  let riskScore = 0;

  const fullText = `${name} ${category} ${packaging} ${description}`.toLowerCase();

  // 1. Tầng 1: Quét Từ Khóa Cấm Nặng (Critical Forbidden Keywords do Admin cấu hình) -> Lỗi nặng
  for (const word of forbiddenWords) {
    if (word && fullText.includes(word.toLowerCase())) {
      const reason = `Chứa từ cấm nghiêm trọng: "${word}"`;
      reasons.push(reason);
      criticalReasons.push(reason);
      riskScore += 60;
    }
  }

  // Quét pattern gian lận / spam Zalo cá nhân / gạ giao dịch ngoài sàn -> Lỗi nặng
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(fullText)) {
      const reason = 'Có dấu hiệu gạ giao dịch ngoài sàn / SPAM lừa đảo';
      reasons.push(reason);
      criticalReasons.push(reason);
      riskScore += 50;
    }
  }

  // Quét từ khóa hàng hóa hạn chế / có điều kiện (do Admin cấu hình) -> Lỗi nhẹ
  for (const word of restrictedWords) {
    if (word && fullText.includes(word.toLowerCase())) {
      reasons.push(`Mặt hàng hạn chế kinh doanh: "${word}" (cần Admin duyệt giấy phép)`);
      riskScore += 30;
    }
  }

  // 2. Tầng 2: Quét Giá Bất Thường & Số Lượng Phi Lý (theo cấu hình Admin)
  if (price > 0 && price < minPrice) {
    const reason = `Giá sỉ phi lý quá rẻ (${price.toLocaleString('vi-VN')}đ) - dưới ngưỡng tối thiểu sàn (${minPrice.toLocaleString('vi-VN')}đ)`;
    reasons.push(reason);
    criticalReasons.push(reason);
    riskScore += 50;
  } else if (price >= minPrice && price < warningLowPrice) {
    reasons.push(`Giá sỉ thấp bất thường (${price.toLocaleString('vi-VN')}đ) - cần Admin kiểm tra`);
    riskScore += 25;
  }

  if (price > maxPrice) {
    const reason = `Giá sỉ bất thường quá cao (${price.toLocaleString('vi-VN')}đ) - vượt mức trần tối đa sàn (${maxPrice.toLocaleString('vi-VN')}đ)`;
    reasons.push(reason);
    criticalReasons.push(reason);
    riskScore += 50;
  }

  // MOQ bất thường
  if (moq <= 0 || moq > maxMoq) {
    const reason = `Số lượng tối thiểu MOQ (${moq}) phi thực tế (vượt mức ${maxMoq})`;
    reasons.push(reason);
    criticalReasons.push(reason);
    riskScore += 30;
  } else if (moq > warningMoq) {
    reasons.push(`Số lượng tối thiểu MOQ (${moq}) quá lớn - cần Admin xác minh`);
    riskScore += 20;
  }

  // 3. Tầng 3: Đánh giá bằng Gemini / OpenAI AI API nếu được cấu hình
  const { apiKey, model, provider = 'GEMINI', fetcher = fetch } = options;
  if (apiKey && model && reasons.length === 0) {
    try {
      if (provider === 'GEMINI') {
        const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: 'Bạn là hệ thống AI kiểm duyệt bài đăng sản phẩm sỉ B2B. Hãy kiểm tra xem sản phẩm có vi phạm pháp luật, hàng giả, hoặc thông tin quảng cáo nhảm nhí hay không. Trả về JSON duy nhất theo dạng: {"isSafe": true|false, "isCritical": true|false, "riskScore": 0-100, "reason": "Lý do nếu vi phạm"}'
              }]
            },
            contents: [
              { role: 'user', parts: [{ text: JSON.stringify({ name, category, packaging, price, moq, description }) }] }
            ],
            generationConfig: { responseMimeType: 'application/json' }
          })
        });

        if (res.ok) {
          const data = await res.json();
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const aiRes = JSON.parse(rawText);
            if (aiRes.isSafe === false) {
              const reason = aiRes.reason || 'AI đánh giá có rủi ro về chất lượng bài đăng';
              reasons.push(reason);
              if (aiRes.isCritical) criticalReasons.push(reason);
              riskScore = Math.max(riskScore, aiRes.riskScore || 50);
            }
          }
        }
      }
    } catch (e) {
      // Nếu API lỗi -> giữ nguyên kết quả quét quy tắc tầng 1 & 2
    }
  }

  // Điều chỉnh mức độ nghiêm ngặt (Strictness Level)
  if (strictness === 'STRICT') {
    riskScore = Math.round(riskScore * 1.25);
  } else if (strictness === 'LENIENT') {
    riskScore = Math.round(riskScore * 0.8);
  }

  riskScore = Math.min(100, riskScore);
  const cleanThreshold = strictness === 'STRICT' ? 10 : 20;
  const isClean = riskScore < cleanThreshold && reasons.length === 0;

  let status = 'AUTO_APPROVED';
  if (!isClean) {
    const rejectThreshold = strictness === 'STRICT' ? 1 : 2;
    // Mức 3: Nếu có ít nhất 1 lỗi nặng HOẶC đạt ngưỡng lỗi vi phạm
    if (criticalReasons.length > 0 || reasons.length >= rejectThreshold) {
      status = 'AUTO_REJECTED';
    } else {
      // Mức 2: Chỉ có 1 lỗi nhẹ
      status = 'NEEDS_REVIEW';
    }
  }

  return {
    status,
    riskScore,
    reasons,
    criticalReasons,
    isClean,
  };
}

module.exports = {
  moderateContent,
  CRITICAL_FORBIDDEN_KEYWORDS: DEFAULT_CRITICAL_FORBIDDEN_KEYWORDS,
  RESTRICTED_KEYWORDS: DEFAULT_RESTRICTED_KEYWORDS,
};

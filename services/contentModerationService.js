/**
 * Service Kiểm Duyệt Tự Động Nội Dung Sản Phẩm Sỉ & Bài Đăng Khuyến Mãi (AI Auto-Moderation)
 * 3 Mức Độ:
 * - AUTO_APPROVED: Hợp lệ (0 lỗi, sạch)
 * - NEEDS_REVIEW: Cảnh báo nhẹ (chỉ 1 lỗi nhẹ: thuốc lá/xì gà hợp pháp, giá lệch nhẹ -> Tạm ẩn, chờ Admin duyệt)
 * - AUTO_REJECTED: Vi phạm nghiêm trọng (từ cấm nặng, ma túy, vũ khí, spam, giá phi lý, HOẶC >= 2 lỗi -> AI tự cấm thẳng)
 */

const CRITICAL_FORBIDDEN_KEYWORDS = [
  'chất cấm', 'ma túy', 'bóng cười', 'vũ khí', 'súng', 'đạn', 'đao kiếm',
  'cờ bạc', 'lừa đảo', 'hàng giả', 'hàng nhái', 'kích dục', 'độc hại',
  'rượu lậu', 'tiền giả', 'pháo nổ', 'pháo hoa nổ', 'ngà voi', 'sừng tê giác',
  'cỏ mỹ', 'tê tê'
];

const RESTRICTED_KEYWORDS = [
  'thuốc lá', 'xì gà'
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

  // 1. Tầng 1: Quét Từ Khóa Cấm Nặng (Critical Forbidden Keywords) -> Lỗi nặng
  for (const word of CRITICAL_FORBIDDEN_KEYWORDS) {
    if (fullText.includes(word)) {
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

  // Quét từ khóa hàng hóa hạn chế / có điều kiện (Thuốc lá, xì gà) -> Lỗi nhẹ
  for (const word of RESTRICTED_KEYWORDS) {
    if (fullText.includes(word)) {
      reasons.push(`Mặt hàng hạn chế kinh doanh: "${word}" (cần Admin duyệt giấy phép)`);
      riskScore += 30;
    }
  }

  // 2. Tầng 2: Quét Giá Bất Thường & Số Lượng Phi Lý
  // Giá cực đoan phi thực tế (< 500đ hoặc > 500 triệu) -> Lỗi nặng
  if (price > 0 && price < 500) {
    const reason = `Giá sỉ phi lý quá rẻ (${price.toLocaleString('vi-VN')}đ) - nghi vấn giá ảo / phá giá`;
    reasons.push(reason);
    criticalReasons.push(reason);
    riskScore += 50;
  } else if (price >= 500 && price < 2000) {
    // Giá rẻ bất thường nhẹ -> Lỗi nhẹ
    reasons.push(`Giá sỉ thấp bất thường (${price.toLocaleString('vi-VN')}đ) - cần Admin kiểm tra`);
    riskScore += 25;
  }

  if (price > 500000000) {
    const reason = `Giá sỉ bất thường quá cao (${price.toLocaleString('vi-VN')}đ)`;
    reasons.push(reason);
    criticalReasons.push(reason);
    riskScore += 50;
  }

  // MOQ bất thường
  if (moq <= 0 || moq > 50000) {
    const reason = `Số lượng tối thiểu MOQ (${moq}) phi thực tế`;
    reasons.push(reason);
    criticalReasons.push(reason);
    riskScore += 30;
  } else if (moq > 5000) {
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

  riskScore = Math.min(100, riskScore);
  const isClean = riskScore < 20 && reasons.length === 0;

  let status = 'AUTO_APPROVED';
  if (!isClean) {
    // Mức 3: Nếu có ít nhất 1 lỗi nặng HOẶC từ 2 lỗi vi phạm trở lên
    if (criticalReasons.length > 0 || reasons.length >= 2) {
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
  CRITICAL_FORBIDDEN_KEYWORDS,
  RESTRICTED_KEYWORDS,
};

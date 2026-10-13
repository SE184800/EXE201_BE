/**
 * Service Kiểm Duyệt Tự Động Nội Dung Sản Phẩm Sỉ & Bài Đăng Khuyến Mãi (AI Auto-Moderation)
 */

const FORBIDDEN_KEYWORDS = [
  'thuốc lá', 'xì gà', 'chất cấm', 'ma túy', 'bóng cười', 'vũ khí',
  'súng', 'đạn', 'đao kiếm', 'cờ bạc', 'lừa đảo', 'hàng giả', 'hàng nhái',
  'kích dục', 'độc hại', 'rượu lậu', 'tiền giả'
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
 * @returns {Promise<{ status: 'AUTO_APPROVED'|'FLAGGED', riskScore: number, reasons: string[], isClean: boolean }>}
 */
async function moderateContent(item = {}, options = {}) {
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const category = typeof item.category === 'string' ? item.category.trim() : '';
  const packaging = typeof item.packaging === 'string' ? item.packaging.trim() : '';
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  const price = typeof item.wholesalePrice === 'number' ? item.wholesalePrice : Number(item.wholesalePrice) || 0;
  const moq = typeof item.moq === 'number' ? item.moq : Number(item.moq) || 1;

  const reasons = [];
  let riskScore = 0;

  const fullText = `${name} ${category} ${packaging} ${description}`.toLowerCase();

  // 1. Tầng 1: Quét Từ Khóa Cấm (Forbidden Keywords)
  for (const word of FORBIDDEN_KEYWORDS) {
    if (fullText.includes(word)) {
      reasons.push(`Nội dung chứa từ khóa bị cấm: "${word}"`);
      riskScore += 45;
    }
  }

  // Quét pattern gian lận / spam Zalo cá nhân / gạ giao dịch ngoài sàn
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(fullText)) {
      reasons.push('Nội dung có dấu hiệu gạ giao dịch ngoài sàn / SPAM');
      riskScore += 35;
    }
  }

  // 2. Tầng 2: Quét Giá Bất Thường / Giá Ảo (Anti-Price Gouging & Anti-Fraud)
  // Giá quá rẻ (dưới 1.000đ cho 1 quy cách sỉ như thùng/bao/lốc) -> Nghi vấn phá giá hoặc giá ảo
  if (price > 0 && price < 1000) {
    reasons.push(`Giá sỉ quá thấp (${price.toLocaleString('vi-VN')}đ) - nghi vấn giá ảo / câu view`);
    riskScore += 40;
  }

  // Giá quá đắt bất thường (trên 500.000.000đ)
  if (price > 500000000) {
    reasons.push(`Giá sỉ bất thường quá cao (${price.toLocaleString('vi-VN')}đ)`);
    riskScore += 40;
  }

  // MOQ bất thường
  if (moq <= 0 || moq > 10000) {
    reasons.push(`Số lượng tối thiểu MOQ (${moq}) không hợp lệ`);
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
                text: 'Bạn là hệ thống AI kiểm duyệt bài đăng sản phẩm sỉ B2B. Hãy kiểm tra xem sản phẩm có vi phạm pháp luật, hàng giả, hoặc thông tin quảng cáo nhảm nhí hay không. Trả về JSON duy nhất theo dạng: {"isSafe": true|false, "riskScore": 0-100, "reason": "Lý do nếu vi phạm"}'
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
              reasons.push(aiRes.reason || 'AI đánh giá có rủi ro về chất lượng bài đăng');
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
  const isClean = riskScore < 30 && reasons.length === 0;

  return {
    status: isClean ? 'AUTO_APPROVED' : 'FLAGGED',
    riskScore,
    reasons,
    isClean,
  };
}

module.exports = {
  moderateContent,
  FORBIDDEN_KEYWORDS,
};

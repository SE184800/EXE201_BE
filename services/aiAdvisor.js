const { answerInventory } = require('./inventoryChat');

function basicAnswer(message, calendar) {
  const query = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  
  if (/le|tet|ngay le|30\/4|1\/5|2\/9|trung thu|giang sinh/.test(query)) {
    const holidays = calendar.upcomingHolidays || [];
    if (holidays.length) {
      const hList = holidays.map(h => `- ${h.name} (${h.isCurrent ? 'Đang diễn ra' : `còn ${h.daysUntil} ngày`}): Tăng nhu cầu nhóm ${h.categories.join(', ')} (Hệ số x${h.multiplier}). ${h.description}`).join('\n');
      return `Thông tin Lịch Ngày Lễ sắp tới:\n${hList}\n\nXem màn hình Đề xuất nhập hàng để biết số lượng gợi ý cụ thể đã được điều chỉnh tăng.`;
    }
    return 'Hiện chưa phát hiện ngày lễ lớn trong 14 ngày tới. Hệ thống tự động tính toán nhu cầu theo lịch sử bán bình thường.';
  }

  if (/cuoi tuan|thu bay|chu nhat/.test(query)) {
    const rows = calendar.items.filter(i => i.method === 'WEEKDAY' && i.weekendRatio > 1.2);
    return rows.length ? 'Ước tính sơ bộ từ lịch sử theo thứ:\n' + rows.slice(0, 10).map(i => `${i.name}: mức bán/ngày cuối tuần ≈ ${i.weekendRatio} lần ngày thường.${i.isDemo ? ' Dữ liệu mẫu, không phải xu hướng thực.' : ''}`).join('\n') : 'Chưa có bằng chứng đủ rõ về mặt hàng bán mạnh cuối tuần. Cần ít nhất 4 tuần theo dõi đầy đủ; không mặc định bia sẽ bán nhiều hơn.';
  }
  
  if (/nhap|ngay nao|du bao/.test(query)) {
    const rows = calendar.items.filter(i => i.recommendation).sort((a, b) => a.recommendation.orderDate.localeCompare(b.recommendation.orderDate));
    return rows.length ? `Dự kiến trong 14 ngày, giả định giao hàng ${calendar.leadDays} ngày (Đã tính tác động Lịch Ngày Lễ nếu có):\n` + rows.slice(0, 10).map(i => `${i.name}: đặt ${i.recommendation.orderDate}, cần hàng ${i.recommendation.arrivalDate}; gợi ý ${i.recommendation.quantity ?? 'kiểm tra lại số lượng'} ${i.unit}.${i.recommendation.urgent ? ' Cần giao sớm hơn thời gian thông thường.' : ''}${i.isDemo ? ' [Dữ liệu mẫu]' : ''}`).join('\n') + '\nXem Lịch nhập dự kiến để xem đầy đủ.' : 'Chưa xác định mặt hàng cần nhập trong 14 ngày. Có thể kho đủ dùng hoặc lịch sử bán chưa đủ; xem chi tiết trong Lịch nhập dự kiến.';
  }

  return answerInventory(message, calendar.items).answer;
}

async function answerWithAI({ message, history = [], calendar, apiKey, model, provider = 'OPENAI', fetcher = fetch }) {
  if (!apiKey || !model) return { mode: 'RULES', answer: 'Chưa bật AI · Trả lời theo quy tắc và số liệu hệ thống.\n\n' + basicAnswer(message, calendar) };
  
  const rows = calendar.items.slice(0, 100).map(({ itemId, name, unit, quantity, lowThreshold, purchasePrice, expiryDate, averageDailySales, method, recommendation, weekendRatio, holidayMultiplier, holidayName, isDemo, calendarNote }) => ({
    itemId, name, unit, quantity, lowThreshold, purchasePrice, expiryDate, averageDailySales, method, recommendation, weekendRatio, holidayMultiplier, holidayName, isDemo, calendarNote
  }));

  const upcomingHolidays = calendar.upcomingHolidays || [];

  try {
    if (provider === 'GEMINI') {
      const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: 'Bạn là trợ lý kho tạp hóa thông minh, trả lời bằng tiếng Việt thân thiện, rõ ràng. Bạn có dữ liệu Lịch Ngày Lễ tại Việt Nam. Khi người dùng hỏi về kế hoạch nhập hàng hoặc ngày lễ, hãy phân tích tác động của các dịp lễ sắp tới lên nhu cầu tiêu dùng của các nhóm hàng tương ứng (như nước giải khát, bia, bánh kẹo). Chỉ dùng dữ liệu được cung cấp. Trả lời văn bản thuần, không HTML.'
            }]
          },
          contents: [
            { role: 'user', parts: [{ text: JSON.stringify({ items: rows, upcomingHolidays, truncated: calendar.items.length > 100, assumptions: calendar.assumptions }) }] },
            ...history.map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })),
            { role: 'user', parts: [{ text: message }] }
          ],
          generationConfig: { maxOutputTokens: 1800 },
        }),
      });
      if (!response.ok) throw new Error('AI provider unavailable');
      const data = await response.json(), candidate = data.candidates?.[0];
      const answer = (candidate?.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('\n').trim();
      if (candidate?.finishReason !== 'STOP' || !answer) throw new Error('Incomplete AI answer');
      return { mode: 'AI', answer, usage: { inputTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount } };
    }

    const response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model, store: false, max_output_tokens: 1800,
        instructions: 'Bạn là trợ lý kho tạp hóa thông minh, trả lời tiếng Việt ngắn gọn. Bạn có dữ liệu Lịch Ngày Lễ tại Việt Nam. Chỉ dùng dữ liệu kho, ngày lễ và dự báo được cung cấp. Phân tích ảnh hưởng của ngày lễ lên lượng gợi ý nhập hàng khi được hỏi. Trả lời văn bản thuần, không HTML.',
        input: [
          { role: 'user', content: JSON.stringify({ type: 'CURRENT_STORE_DATA', items: rows, upcomingHolidays, truncated: calendar.items.length > 100, generatedAt: calendar.generatedAt, assumptions: calendar.assumptions }) },
          ...history.map(h => ({ role: h, content: h.content })),
          { role: 'user', content: message }
        ]
      })
    });
    if (!response.ok) throw new Error('AI provider unavailable');
    const data = await response.json();
    const answer = (data.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n').trim();
    if (data.status !== 'completed' || !answer) throw new Error('Incomplete AI answer');
    return { mode: 'AI', answer, usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
  } catch {
    return { mode: 'UNAVAILABLE', answer: 'AI đang không phản hồi hoặc cấu hình chưa hợp lệ. Bạn vẫn có thể xem lịch nhập và tra cứu kho.\n\n' + basicAnswer(message, calendar) };
  }
}

module.exports = { answerWithAI, basicAnswer };

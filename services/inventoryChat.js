const { expiryInfo } = require('./inventoryExpiry');
function normalize(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function answerInventory(message, items, now = new Date()) {
  const text = normalize(message);
  const readOnly = 'Mình chỉ tra cứu tồn kho. Hãy cập nhật số lượng trong bảng kho hàng.';
  if (/\b(them|xoa|cap nhat|tru|cong|dat hang)\b/.test(text) || /^sua (so luong|ton kho|san pham|ten|don vi)\b/.test(text)) return { answer: readOnly, items: [] };
  if (!items.length) return { answer: 'Kho của bạn chưa có sản phẩm. Hãy thêm hàng vào kho trước nhé.', items: [] };
  let matches;
  let intro;
  const expiryQuestion = /\b(han|hsd)\b/.test(text);
  if (expiryQuestion && /\b(hang nao|san pham nao|mat hang nao|danh sach)\b/.test(text)) {
    const soon = /\b(sap|gan)\b/.test(text);
    matches = items.filter((item) => {
      const days = expiryInfo(item.expiryDate, now).daysUntilExpiry;
      return item.quantity > 0 && days !== null && (soon ? days >= 0 && days <= 7 : days < 0);
    });
    intro = soon ? 'Hàng còn tồn sẽ hết hạn trong 7 ngày tới (gồm hôm nay):' : 'Hàng còn tồn đã quá hạn:';
    if (!matches.length) intro = 'Không có hàng còn tồn phù hợp. Sản phẩm chưa nhập hạn sử dụng không được tính.';
  } else if (!expiryQuestion && /\b(sap het|gan het|duoi nguong|can nhap)\b/.test(text)) {
    matches = items.filter((item) => item.quantity <= item.lowThreshold);
    intro = matches.length ? 'Các mặt hàng bằng hoặc dưới ngưỡng cảnh báo:' : 'Chưa có mặt hàng nào bằng hoặc dưới ngưỡng cảnh báo.';
  } else if (/\b(het hang|hang nao het|hang da het)\b/.test(text)) {
    matches = items.filter((item) => item.quantity === 0);
    intro = matches.length ? 'Các mặt hàng đã hết:' : 'Không có mặt hàng nào đã hết.';
  } else if (/^(kho|ton kho|xem kho|xem ton kho|danh sach|tat ca|tat ca san pham|kho con gi|hang con bao nhieu)$/.test(text)) {
    matches = items;
    intro = 'Tồn kho hiện tại của bạn:';
  } else {
    const query = text.replace(/\b(bao lau|bao gio|khi nao|han su dung|han dung|het han|hsd|han|ngay|nua|thi|da|chua)\b/g, ' ').replace(/\b(con lai|bao nhieu|trong kho|ton kho|cua hang|cho toi|cho minh|kiem tra|so luong|san pham|mat hang|hien tai|co khong)\b/g, ' ')
      .replace(/\b(con|co|khong|la|may|toi|minh|hoi|xem|nhe|a|voi|duoc|hang)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = query.split(' ').filter(Boolean);
    matches = tokens.length ? items.filter((item) => tokens.every((token) => normalize(item.name).split(' ').some((word) => word.includes(token)))) : [];
    intro = matches.length > 1 ? 'Có nhiều sản phẩm phù hợp. Bạn có thể hỏi lại bằng tên đầy đủ:' : matches.length ? 'Mình tìm thấy:' : 'Chưa tìm thấy sản phẩm phù hợp. Thử nhập tên hàng, “Coca còn bao nhiêu?”, “Hàng nào sắp hết?” hoặc “Xem kho”.';
  }
  const visible = matches.slice(0, 20);
  return {
    answer: [intro, ...visible.map((item) => {
      const date = item.expiryDate ? new Date(item.expiryDate).toISOString().slice(0, 10).split('-').reverse().join('/') : '';
      return `${item.name}: ${item.quantity} ${item.unit}. ${date ? `HSD ${date} — ` : ''}${expiryInfo(item.expiryDate, now).expiryLabel}.`;
    }), ...(matches.length > 20 ? [`Đang hiển thị 20/${matches.length} sản phẩm; hãy hỏi tên cụ thể để thu hẹp.`] : [])].join('\n'),
    items: visible,
  };
}
module.exports = { answerInventory };

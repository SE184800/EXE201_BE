const problem = message => Object.assign(new Error(message), { status: 400 });
function validateDeliveryTime(value, now = new Date()) {
  const match = typeof value === 'string' && value.match(/^(\d{2}):(\d{2}) ngày (\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw problem('Chọn ngày và giờ nhận hàng hợp lệ.');
  const [, hour, minute, day, month, year] = match.map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day, hour - 7, minute));
  const local = new Date(instant.getTime() + 7 * 3600000);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day ||
      hour < 8 || hour > 17 || minute < 0 || minute > 59 || (hour === 17 && minute > 0)) throw problem('Giờ nhận hàng từ 08:00 đến 17:00.');
  if (instant.getTime() < now.getTime() + 3600000) throw problem('Chọn giờ nhận hàng cách hiện tại ít nhất 1 giờ.');
  if (instant.getTime() > now.getTime() + 90 * 86400000) throw problem('Chỉ hẹn giao trong 90 ngày tới.');
  return value;
}
function pendingRequest(order, info) {
  if (info?.rescheduleRequest) return info.rescheduleRequest.status === 'PENDING' ? info.rescheduleRequest : null;
  const note = order.note || '';
  const index = note.lastIndexOf('[YÊU CẦU DỜI LỊCH GIAO');
  if (index < 0) return null;
  const tail = note.slice(index);
  if (/\[VỰA (ĐÃ ĐỒNG Ý|TỪ CHỐI)/.test(tail)) return null;
  const match = tail.match(/Hẹn lúc (\d{2}:\d{2} ngày \d{2}\/\d{2}\/\d{4})/);
  return match ? { requestedTime: match[1], status: 'PENDING' } : null;
}
module.exports = { validateDeliveryTime, pendingRequest };

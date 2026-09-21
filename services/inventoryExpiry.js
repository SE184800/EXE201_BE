function expiryInfo(expiryDate, now = new Date()) {
  if (!expiryDate) return { daysUntilExpiry: null, expiryLabel: 'Chưa nhập hạn sử dụng' };
  const date = new Date(expiryDate).toISOString().slice(0, 10);
  // Calendar days in Vietnam, independent of the server's timezone.
  const today = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  const label = days < 0 ? `Đã hết hạn ${-days} ngày` : days === 0 ? 'Hết hạn hôm nay' : `Còn ${days} ngày`;
  return { daysUntilExpiry: days, expiryLabel: label };
}
module.exports = { expiryInfo };

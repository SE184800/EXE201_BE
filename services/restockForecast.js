const { expiryInfo } = require('./inventoryExpiry');
const DAY = 86400000;
const VN_OFFSET = 7 * 3600000;
function dayStart(value) { return Math.floor((new Date(value).getTime() + VN_OFFSET) / DAY) * DAY - VN_OFFSET; }

function forecastItem(item, movements, horizonDays = 7, safetyDays = 2, now = new Date()) {
  const today = dayStart(now);
  const first = item.movements?.[0]?.createdAt;
  // The first tracking day and today's incomplete day are excluded.
  let start = first ? Math.max(today - 30 * DAY, dayStart(first) + DAY) : today;
  const relevant = movements.filter((row) => row.itemId === item.id && new Date(row.createdAt).getTime() < today);
  // Never mix sales measured in a previous unit (e.g. boxes vs cans).
  for (const row of relevant) if (row.unit !== item.unit) start = Math.max(start, dayStart(row.createdAt) + DAY);
  const observedDays = Math.max(0, Math.round((today - start) / DAY));
  const sales = relevant.filter((row) => row.type === 'SALE' && row.quantityChange < 0 && row.unit === item.unit && new Date(row.createdAt).getTime() >= start);
  const soldQuantity = sales.reduce((sum, row) => sum - row.quantityChange, 0);
  const salesDays = new Set(sales.map((row) => dayStart(row.createdAt))).size;
  const expiry = expiryInfo(item.expiryDate, now);
  const enough = observedDays >= 3 && soldQuantity > 0;
  const rate = enough ? soldQuantity / observedDays : null;
  const usableStock = expiry.daysUntilExpiry !== null && expiry.daysUntilExpiry < 0 ? 0 : rate !== null && expiry.daysUntilExpiry !== null
    ? Math.min(item.quantity, Math.floor(rate * (expiry.daysUntilExpiry + 1))) : item.quantity;
  const suggested = rate === null ? null : Math.max(0, Math.ceil(rate * (horizonDays + safetyDays) - usableStock));
  const confidence = !enough ? 'INSUFFICIENT' : observedDays < 14 || salesDays < 3 ? 'PRELIMINARY' : 'ESTIMATE';
  const notes = [];
  if (!enough) notes.push(observedDays < 3 ? 'Cần ít nhất 3 ngày trọn vẹn theo dõi kho và có ghi nhận bán hàng.' : 'Chưa ghi nhận bán hàng trong kỳ; chưa thể ước tính tốc độ bán.');
  else notes.push(`Đã bán ${soldQuantity} ${item.unit} trong ${observedDays} ngày trọn vẹn (kể cả ngày không ghi nhận bán).`);
  if (confidence === 'PRELIMINARY') notes.push('Ước tính sơ bộ vì lịch sử còn ngắn hoặc số ngày có bán còn ít.');
  if (item.quantity === 0) notes.push('Kho hiện đã hết hàng; tốc độ bán có thể thấp hơn nhu cầu thực do thiếu hàng.');
  if (expiry.daysUntilExpiry !== null && expiry.daysUntilExpiry < 0) notes.push('Tồn đã quá hạn không được tính là hàng có thể sử dụng.');
  else if (rate !== null && usableStock < item.quantity) notes.push('Hạn gần nhất có thể khiến một phần tồn không bán kịp; ưu tiên xử lý hàng cũ, nhập từng đợt.');
  if (!item.expiryDate) notes.push('Chưa nhập hạn dùng; tạm tính toàn bộ tồn là có thể sử dụng.');
  return { purchasePrice: item.purchasePrice ?? null, itemId: item.id, name: item.name, unit: item.unit, quantity: item.quantity, usableStock, expiryDate: item.expiryDate,
    observedDays, soldQuantity, salesDays, averageDailySales: rate === null ? null : Number(rate.toFixed(4)),
    forecastDemand: rate === null ? null : Math.ceil(rate * horizonDays),
    daysUntilStockout: usableStock === 0 ? 0 : rate === null ? null : Number((usableStock / rate).toFixed(1)),
    suggestedQuantity: suggested !== null && suggested <= 2147483647 ? suggested : null,
    confidence, notes, windowStart: observedDays ? new Date(start).toISOString() : null, windowEnd: new Date(today).toISOString() };
}
async function getForecast(prisma, ownerId, horizonDays, safetyDays, now = new Date()) {
  const items = await prisma.inventoryItem.findMany({ where: { ownerId }, orderBy: { name: 'asc' }, include: { movements: { orderBy: { createdAt: 'asc' }, take: 1, select: { createdAt: true } } } });
  const movements = await prisma.stockMovement.findMany({ where: { item: { ownerId }, createdAt: { gte: new Date(dayStart(now) - 30 * DAY), lt: new Date(dayStart(now)) } } });
  return { generatedAt: now.toISOString(), horizonDays, safetyDays, items: items.map((item) => forecastItem(item, movements, horizonDays, safetyDays, now)) };
}
module.exports = { forecastItem, getForecast, dayStart };


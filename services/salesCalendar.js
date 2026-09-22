const { getForecast, dayStart } = require('./restockForecast');
const DAY = 86400000, OFFSET = 7 * 3600000;
const dateKey = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);
const weekday = (ms) => new Date(ms + OFFSET).getUTCDay();
function calendarItem(item, movements, leadDays, now = new Date()) {
  const today = dayStart(now), start = item.windowStart ? new Date(item.windowStart).getTime() : today;
  const buckets = Array.from({ length: 7 }, () => ({ days: 0, sold: 0 }));
  for (let day = start; day < today; day += DAY) buckets[weekday(day)].days++;
  for (const row of movements) {
    const day = dayStart(row.createdAt);
    if (row.itemId === item.itemId && row.type === 'SALE' && row.unit === item.unit && row.quantityChange < 0 && day >= start && day < today) buckets[weekday(day)].sold -= row.quantityChange;
  }
  const weekly = item.averageDailySales !== null && buckets.every(b => b.days >= 4);
  const rates = buckets.map(b => weekly ? b.sold / b.days : item.averageDailySales);
  const daily = Array.from({ length: 14 }, (_, offset) => ({ date: dateKey(today + offset * DAY), weekday: weekday(today + offset * DAY), expectedSales: rates[weekday(today + offset * DAY)] === null ? null : Number(rates[weekday(today + offset * DAY)].toFixed(2)) }));
  let stock = item.quantity, recommendation = null;
  for (let i = 0; i < daily.length && item.averageDailySales !== null; i++) {
    if (item.expiryDate && daily[i].date > new Date(item.expiryDate).toISOString().slice(0, 10)) stock = 0;
    const demand = rates[daily[i].weekday];
    if (stock + 1e-8 < demand) {
      const needDay = today + i * DAY;
      const quantity = Math.ceil(Array.from({length:7}, (_, n) => rates[weekday(needDay+n*DAY)]).reduce((a,b)=>a+b,0) + item.averageDailySales * 2 - stock);
      recommendation = { arrivalDate: dateKey(needDay), orderDate: dateKey(Math.max(today, needDay-leadDays*DAY)), urgent: needDay-leadDays*DAY < today, quantity: quantity <= 2147483647 ? quantity : null };
      break;
    }
    stock -= demand;
  }
  const weekend = weekly ? (rates[0]+rates[6])/2 : null;
  const weekdays = weekly ? rates.slice(1,6).reduce((a,b)=>a+b,0)/5 : null;
  return { ...item, method: weekly ? 'WEEKDAY' : item.averageDailySales === null ? 'INSUFFICIENT' : 'AVERAGE', daily, recommendation,
    weekendRatio: weekly && weekdays > 0 ? Number((weekend/weekdays).toFixed(2)) : null,
    isDemo: item.name.startsWith('[Mẫu]'),
    calendarNote: weekly ? 'Sơ bộ theo từng thứ: ít nhất 4 lần quan sát mỗi thứ, gồm ngày không ghi nhận bán.' : 'Chưa đủ 4 tuần đầy đủ để kết luận xu hướng cuối tuần; dùng trung bình nếu đủ dữ liệu.',
  };
}
async function getSalesCalendar(prisma, ownerId, leadDays = 2, now = new Date()) {
  const forecast = await getForecast(prisma, ownerId, 14, 2, now);
  const movements = await prisma.stockMovement.findMany({ where: { item: { ownerId }, type: 'SALE', createdAt: { gte: new Date(dayStart(now)-30*DAY), lt: new Date(dayStart(now)) } }, select: { itemId:true,unit:true,type:true,quantityChange:true,createdAt:true } });
  return { generatedAt: now.toISOString(), leadDays, days:14, items: forecast.items.map(item=>calendarItem(item,movements,leadDays,now)), assumptions: 'Giả định chưa có đơn đang giao, chưa tính bán hôm nay; ước tính từ đầu ngày với tồn hiện tại nên có thể đặt sớm. Mỗi đề xuất đủ bán 7 ngày + dự phòng 2 ngày. Chưa học tác động thời tiết, ngày lễ hay khuyến mãi.' };
}
module.exports={calendarItem,getSalesCalendar};

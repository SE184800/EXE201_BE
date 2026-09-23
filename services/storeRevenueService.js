const { Prisma } = require('@prisma/client');
const { problem } = require('./platformPolicy');
const DAY = 86400000;
const PAGE_SIZE = 20;
const vnDay = date => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const amount = value => value == null ? '0' : value.toFixed(0);

function reportPeriod(query, now = new Date()) {
  const today = vnDay(now);
  const from = query.from === undefined ? today.slice(0, 8) + '01' : query.from;
  const to = query.to === undefined ? today : query.to;
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '9999-12-30' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) throw problem(400, 'Chọn ngày hợp lệ; ngày bắt đầu không được sau ngày kết thúc.');
  const start = new Date(from + 'T00:00:00+07:00');
  const end = new Date(new Date(to + 'T00:00:00+07:00').getTime() + DAY);
  if (end - start > 366 * DAY) throw problem(400, 'Mỗi báo cáo tối đa 366 ngày.');
  return { from, to, start, end };
}

function createStoreRevenueService(prisma) {
  async function report(ownerId, query) {
    const dates = reportPeriod(query);
    const pageText = query.page === undefined ? '1' : query.page;
    if (typeof pageText !== 'string' || !/^[1-9]\d*$/.test(pageText) || Number(pageText) > 100000) throw problem(400, 'Trang không hợp lệ.');
    const page = Number(pageText);
    const where = { item: { ownerId }, type: 'SALE', quantityChange: { lt: 0 }, createdAt: { gte: dates.start, lt: dates.end } };
    // Cast before multiplication and sum in SQL so large VND totals stay exact.
    const totalSql = Prisma.sql`SUM(-CAST(m.quantityChange AS DECIMAL(38,0)) * m.unitSalePrice)`;
    const scope = Prisma.sql`FROM dbo.stock_movements m JOIN dbo.inventory_items i ON i.id = m.itemId
      WHERE i.ownerId = ${ownerId} AND m.type = 'SALE' AND m.quantityChange < 0
      AND m.createdAt >= ${dates.start} AND m.createdAt < ${dates.end}`;
    const result = await prisma.$transaction(async tx => {
      const [summary] = await tx.$queryRaw(Prisma.sql`SELECT ${totalSql} AS revenue, COUNT(*) AS salesCount,
        COUNT(m.unitSalePrice) AS pricedSalesCount, COUNT(DISTINCT m.itemId) AS productCount ${scope}`);
      const daily = await tx.$queryRaw(Prisma.sql`SELECT CONVERT(VARCHAR(10), DATEADD(HOUR, 7, m.createdAt), 23) AS day,
        ${totalSql} AS revenue, COUNT(*) AS salesCount, COUNT(*) - COUNT(m.unitSalePrice) AS unpricedSalesCount
        ${scope} GROUP BY CONVERT(VARCHAR(10), DATEADD(HOUR, 7, m.createdAt), 23) ORDER BY day`);
      const products = await tx.$queryRaw(Prisma.sql`SELECT TOP (10) m.itemId, m.productName, m.unit,
        ${totalSql} AS revenue, SUM(-CAST(m.quantityChange AS BIGINT)) AS quantity,
        COUNT(*) - COUNT(m.unitSalePrice) AS unpricedSalesCount
        ${scope} GROUP BY m.itemId, m.productName, m.unit ORDER BY revenue DESC, m.itemId, m.productName, m.unit`);
      const rows = await tx.stockMovement.findMany({ where, select: { id: true, itemId: true, productName: true, unit: true, quantityChange: true, unitSalePrice: true, note: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 });
      return { summary, daily, products, rows };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const days = new Map(result.daily.map(row => [row.day, row]));
    const daily = [];
    for (let time = dates.start.getTime(); time < dates.end.getTime(); time += DAY) {
      const day = vnDay(new Date(time)), row = days.get(day);
      daily.push({ day, revenue: amount(row?.revenue), salesCount: row?.salesCount || 0, unpricedSalesCount: row?.unpricedSalesCount || 0 });
    }
    return {
      from: dates.from, to: dates.to, timezone: 'Asia/Ho_Chi_Minh',
      summary: { ...result.summary, revenue: amount(result.summary.revenue), unpricedSalesCount: result.summary.salesCount - result.summary.pricedSalesCount },
      daily,
      topProducts: result.products.map(row => ({ ...row, revenue: amount(row.revenue), quantity: row.quantity.toString() })),
      sales: result.rows.slice(0, PAGE_SIZE).map(row => ({ ...row, quantity: -row.quantityChange, revenue: row.unitSalePrice == null ? null : (BigInt(-row.quantityChange) * BigInt(row.unitSalePrice)).toString() })),
      page, hasMore: result.rows.length > PAGE_SIZE,
    };
  }
  return { report };
}
module.exports = { createStoreRevenueService, reportPeriod };

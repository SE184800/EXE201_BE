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
    const where = { item: { ownerId }, type: 'SALE', quantityChange: { lt: 0 }, createdAt: { gte: dates.start, lt: dates.end } };
    // Cast before multiplication and sum in SQL so large VND totals stay exact.
    const totalSql = Prisma.sql`SUM(-CAST(m.quantityChange AS DECIMAL(38,0)) * COALESCE(m.unitSalePrice, i.sellingPrice, 0))`;
    const scope = Prisma.sql`FROM dbo.stock_movements m JOIN dbo.inventory_items i ON i.id = m.itemId
      WHERE i.ownerId = ${ownerId} AND m.type = 'SALE' AND m.quantityChange < 0
      AND m.createdAt >= ${dates.start} AND m.createdAt < ${dates.end}`;
    const result = await prisma.$transaction(async tx => {
      const [summary] = await tx.$queryRaw(Prisma.sql`SELECT ${totalSql} AS revenue, COUNT(*) AS salesCount,
        COUNT(COALESCE(m.unitSalePrice, i.sellingPrice)) AS pricedSalesCount, COUNT(DISTINCT m.itemId) AS productCount ${scope}`);
      const daily = await tx.$queryRaw(Prisma.sql`SELECT CONVERT(VARCHAR(10), DATEADD(HOUR, 7, m.createdAt), 23) AS day,
        ${totalSql} AS revenue, COUNT(*) AS salesCount, COUNT(*) - COUNT(COALESCE(m.unitSalePrice, i.sellingPrice)) AS unpricedSalesCount
        ${scope} GROUP BY CONVERT(VARCHAR(10), DATEADD(HOUR, 7, m.createdAt), 23) ORDER BY day`);
      const products = await tx.$queryRaw(Prisma.sql`SELECT TOP (10) m.itemId, m.productName, m.unit,
        ${totalSql} AS revenue, SUM(-CAST(m.quantityChange AS BIGINT)) AS quantity,
        COUNT(*) - COUNT(COALESCE(m.unitSalePrice, i.sellingPrice)) AS unpricedSalesCount
        ${scope} GROUP BY m.itemId, m.productName, m.unit ORDER BY revenue DESC, m.itemId, m.productName, m.unit`);
      
      // Chi phí nhập hàng từ đơn sỉ wholesale_orders
      const wholesalePurchases = await tx.$queryRaw(Prisma.sql`SELECT 
        CONVERT(VARCHAR(10), DATEADD(HOUR, 7, COALESCE(deliveredAt, createdAt)), 23) AS day,
        SUM(CAST(total AS DECIMAL(38,0))) AS purchaseCost
        FROM dbo.wholesale_orders
        WHERE buyerId = ${ownerId} 
          AND status NOT IN ('REJECTED', 'CANCELLED', 'CANCELED')
          AND COALESCE(deliveredAt, createdAt) >= ${dates.start}
          AND COALESCE(deliveredAt, createdAt) < ${dates.end}
        GROUP BY CONVERT(VARCHAR(10), DATEADD(HOUR, 7, COALESCE(deliveredAt, createdAt)), 23)`);

      // Chi phí nhập hàng từ lô lẻ nếu nhập thủ công (không qua đơn sỉ)
      const manualPurchases = await tx.$queryRaw(Prisma.sql`SELECT 
        CONVERT(VARCHAR(10), DATEADD(HOUR, 7, l.receivedAt), 23) AS day,
        SUM(CAST(l.quantity AS DECIMAL(38,0)) * COALESCE(l.purchasePrice, 0)) AS purchaseCost
        FROM dbo.inventory_lots l
        JOIN dbo.inventory_items i ON i.id = l.itemId
        WHERE i.ownerId = ${ownerId} AND l.sourceOrderId IS NULL
          AND l.receivedAt >= ${dates.start} AND l.receivedAt < ${dates.end}
        GROUP BY CONVERT(VARCHAR(10), DATEADD(HOUR, 7, l.receivedAt), 23)`);

      const rows = await tx.stockMovement.findMany({ 
        where, 
        select: { 
          id: true, 
          itemId: true, 
          productName: true, 
          unit: true, 
          quantityChange: true, 
          unitSalePrice: true, 
          note: true, 
          createdAt: true,
          item: { select: { sellingPrice: true, purchasePrice: true } }
        }, 
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], 
        take: 1000 
      });

      return { summary, daily, products, wholesalePurchases, manualPurchases, rows };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const purchaseByDay = new Map();
    let totalPurchaseCost = 0n;
    for (const row of [...(result.wholesalePurchases || []), ...(result.manualPurchases || [])]) {
      if (!row.day) continue;
      const current = purchaseByDay.get(row.day) || 0n;
      const val = BigInt(Math.round(Number(row.purchaseCost || 0)));
      purchaseByDay.set(row.day, current + val);
      totalPurchaseCost += val;
    }

    const days = new Map(result.daily.map(row => [row.day, row]));
    const daily = [];
    for (let time = dates.start.getTime(); time < dates.end.getTime(); time += DAY) {
      const day = vnDay(new Date(time)), row = days.get(day);
      const rev = BigInt(amount(row?.revenue));
      const cost = purchaseByDay.get(day) || 0n;
      const profit = rev - cost;
      daily.push({ 
        day, 
        revenue: rev.toString(), 
        purchaseCost: cost.toString(),
        profit: profit.toString(),
        salesCount: row?.salesCount || 0, 
        unpricedSalesCount: row?.unpricedSalesCount || 0 
      });
    }

    const totalRevenue = BigInt(amount(result.summary.revenue));
    const netProfit = totalRevenue - totalPurchaseCost;

    return {
      from: dates.from, to: dates.to, timezone: 'Asia/Ho_Chi_Minh',
      summary: { 
        ...result.summary, 
        revenue: totalRevenue.toString(), 
        purchaseCost: totalPurchaseCost.toString(),
        netProfit: netProfit.toString(),
        unpricedSalesCount: result.summary.salesCount - result.summary.pricedSalesCount 
      },
      daily,
      topProducts: result.products.map(row => ({ ...row, revenue: amount(row.revenue), quantity: row.quantity.toString() })),
      sales: result.rows.map(row => {
        const qty = -row.quantityChange;
        const price = row.unitSalePrice != null ? row.unitSalePrice : (row.item?.sellingPrice != null ? row.item.sellingPrice : null);
        const revenue = price == null ? null : (BigInt(qty) * BigInt(price)).toString();
        return {
          id: row.id,
          itemId: row.itemId,
          productName: row.productName,
          unit: row.unit,
          note: row.note,
          createdAt: row.createdAt,
          quantity: qty,
          unitSalePrice: price,
          isEstimatedPrice: row.unitSalePrice == null && row.item?.sellingPrice != null,
          revenue,
        };
      }),
      page: 1, 
      hasMore: false,
    };
  }
  return { report };
}
module.exports = { createStoreRevenueService, reportPeriod };

const { randomUUID } = require('node:crypto');
const INT_MAX = 2147483647;
const problem = message => Object.assign(new Error(message), { status: 409 });
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim().replace(/\s+/g, ' ');

function parsePackaging(value) {
  const packaging = String(value || '').trim();
  const containers = 'thùng|két|hộp|lốc|khay|kiện|bịch|lô|bao';
  let match = packaging.match(new RegExp(`^(${containers})\\s+(\\d+)\\s*([\\p{L}]+)$`, 'iu'));
  if (match) return { container: match[1], multiplier: Number(match[2]), retailUnit: match[3] };
  match = packaging.match(new RegExp(`^(\\d+)\\s*([\\p{L}]+)\\s*/\\s*(${containers})$`, 'iu'));
  if (match) return { container: match[3], multiplier: Number(match[1]), retailUnit: match[2] };
  return { container: packaging || 'cái', multiplier: 1, retailUnit: packaging || 'cái' };
}
function importBlockReason(order, driverInfo) {
  if (order.inventoryImportedAt) return null;
  if (order.complaint && ['OPEN', 'IN_REVIEW', 'ESCALATED'].includes(order.complaint.status)) {
    return 'Cần xử lý xong khiếu nại trước khi thêm vào kho.';
  }
  if (order.status !== 'COMPLETED') {
    return 'Cần hoàn tất thanh toán và xác nhận đơn thành công trước khi nhập kho.';
  }
  if (driverInfo?.incidentReport?.damagedItems?.length) {
    return 'Đơn có báo cáo hàng hỏng. Cần nhập theo số lượng thực nhận để tránh cộng cả hàng hỏng.';
  }
  return null;
}
// Call inside a Serializable transaction. Marker, stock, lots and history
// must commit or roll back together; the UI is never the duplicate guard.
async function syncOrderToStoreInventory(tx, buyerId, order) {
  if (!order.items.length) throw problem('Đơn hàng không có mặt hàng để nhập kho.');
  if (order.inventoryImportedAt) return { alreadyImported: true, count: 0 };
  const orderTag = `[ĐƠN SỈ #${order.id}]`, oldPrefix = `đơn sỉ #${order.id} [`;
  // SQL Server LIKE treats square brackets as pattern syntax. CHARINDEX must
  // be used here so a different order's receipt never matches this token.
  const legacyRows = await tx.$queryRaw`SELECT TOP (1) movement.[createdAt]
    FROM [dbo].[stock_movements] AS movement
    INNER JOIN [dbo].[inventory_items] AS item ON item.[id] = movement.[itemId]
    WHERE item.[ownerId] = ${buyerId} AND movement.[type] IN ('IMPORT', 'RECEIPT')
      AND (CHARINDEX(${orderTag}, movement.[note]) > 0 OR CHARINDEX(${oldPrefix}, movement.[note]) > 0)
    ORDER BY movement.[createdAt] ASC`;
  const legacy = legacyRows[0];
  if (legacy) {
    await tx.wholesaleOrder.update({ where: { id: order.id }, data: { inventoryImportedAt: legacy.createdAt } });
    return { alreadyImported: true, count: 0 };
  }
  const importedAt = new Date();
  const claimed = await tx.wholesaleOrder.updateMany({ where: { id: order.id, buyerId, status: 'COMPLETED', inventoryImportedAt: null }, data: { inventoryImportedAt: importedAt } });
  if (!claimed.count) {
    const saved = await tx.wholesaleOrder.findFirst({ where: { id: order.id, buyerId } });
    if (saved?.inventoryImportedAt) return { alreadyImported: true, count: 0 };
    throw problem('Trạng thái đơn vừa thay đổi. Vui lòng tải lại.');
  }
  const existing = await tx.inventoryItem.findMany({ where: { ownerId: buyerId } });
  const matchedIds = new Set();
  const supplierUpdates = [];
  const supplierName = order.supplier?.businessName || 'Chủ vựa';
  for (const line of order.items) {
    const name = line.productName.trim(), packaging = parsePackaging(line.packaging);
    if (!name || name.length > 100) throw problem('Tên mặt hàng nhập kho cần từ 1 đến 100 ký tự.');
    if (!Number.isSafeInteger(packaging.multiplier) || packaging.multiplier < 1 || !Number.isSafeInteger(line.quantity) || line.quantity < 1) throw problem(`Quy cách hoặc số lượng của ${name} không hợp lệ.`);
    const matches = existing.filter(item => normalize(item.name) === normalize(name));
    if (matches.length > 1) throw problem(`Có nhiều mặt hàng cùng tên ${name}. Hãy đối chiếu lại tên trước khi nhập.`);
    let item = matches[0], multiplier = packaging.multiplier;
    if (item && normalize(item.unit) !== normalize(packaging.retailUnit)) {
      if ([normalize(packaging.container), normalize(line.packaging)].includes(normalize(item.unit))) multiplier = 1;
      else throw problem(`Đơn vị của ${name} trong kho (${item.unit}) khác quy cách mua (${line.packaging}). Vui lòng đối chiếu trước khi nhập.`);
    }
    const quantity = line.quantity * multiplier, purchasePrice = Math.round(Number(line.unitPrice) / multiplier);
    if (!Number.isSafeInteger(quantity) || quantity > INT_MAX || !Number.isSafeInteger(purchasePrice) || purchasePrice < 0 || purchasePrice > INT_MAX) throw problem(`Số lượng hoặc giá nhập của ${name} vượt giới hạn kho.`);
    if (!item) {
      item = await tx.inventoryItem.create({ data: { ownerId: buyerId, name, unit: packaging.retailUnit, quantity: 0, purchasePrice, sellingPrice: null } });
      existing.push(item);
    }
    const before = item.quantity;
    if (before + quantity > INT_MAX) throw problem(`Tổng tồn kho của ${name} vượt giới hạn.`);
    const total = await tx.inventoryLot.aggregate({ where: { itemId: item.id }, _sum: { quantity: true } });
    const tracked = total._sum.quantity || 0;
    if (tracked > before) throw problem(`Tổng số lượng các lô của ${name} chưa khớp tồn kho. Vui lòng đối chiếu trước khi nhập.`);
    if (tracked < before) await tx.inventoryLot.create({ data: { itemId: item.id, quantity: before - tracked, receivedAt: item.createdAt, expiryDate: item.expiryDate, purchasePrice: item.purchasePrice } });
    const saved = await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { increment: quantity }, purchasePrice } });
    // Preserve all earlier lots; each new receipt has its own source order.
    await tx.inventoryLot.create({ data: { itemId: item.id, quantity, purchasePrice, receivedAt: importedAt, sourceOrderId: order.id } });
    const note = `[ĐƠN SỈ #${order.id}] Nhập ${line.quantity} × ${line.packaging || 'cái'} → ${quantity} ${item.unit}. NCC: ${supplierName}`;
    await tx.stockMovement.create({ data: { id: randomUUID(), itemId: item.id, type: 'RECEIPT', quantityChange: quantity, quantityBefore: before, quantityAfter: saved.quantity, productName: saved.name, unit: saved.unit, note: note.slice(0, 250), createdAt: importedAt } });
    Object.assign(item, saved);
    supplierUpdates.push({ itemId: item.id, supplierName });
    matchedIds.add(item.id);
  }
  return { alreadyImported: false, count: matchedIds.size, inventoryImportedAt: importedAt, supplierUpdates };
}
module.exports = { syncOrderToStoreInventory, importBlockReason, parsePackaging };

const { randomUUID } = require('node:crypto');
const INT_MAX = 2147483647;
const { normalize, parsePackaging, isBulkUnit, looseUnits } = require('./inventoryUnits');
const problem = message => Object.assign(new Error(message), { status: 409 });
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
function importLinePlan(line, existing, conversion) {
  const matches = existing.filter(item => normalize(item.name) === normalize(line.productName));
  if (matches.length > 1) throw problem('Có nhiều mặt hàng cùng tên ' + line.productName + '.');
  const item = matches[0];
  const packaging = parsePackaging(line.packaging);
  const legacyBulk = Boolean(item && isBulkUnit(item.unit));
  const canConvert = isBulkUnit(packaging.retailUnit) && !legacyBulk;
  if (conversion) {
    if (!canConvert || typeof conversion.unit !== 'string' ||
        !looseUnits.some(unit => normalize(unit) === normalize(conversion.unit)) ||
        !Number.isInteger(conversion.unitsPerPack) || conversion.unitsPerPack < 1 ||
        conversion.unitsPerPack > INT_MAX ||
        (item && normalize(item.unit) !== normalize(conversion.unit))) {
      throw problem('Quy đổi không phù hợp với đơn vị trong kho của ' + line.productName + '.');
    }
    packaging.retailUnit = conversion.unit;
    packaging.multiplier = conversion.unitsPerPack;
  }
  const { multiplier } = packaging;
  const unit = item?.unit ?? (canConvert && !conversion ? '' : packaging.retailUnit);
  const needsConversion = canConvert && !conversion;
  const incompatible = legacyBulk || (!needsConversion && normalize(unit) !== normalize(packaging.retailUnit));
  return { item, canConvert, needsConversion, incompatible, unit, multiplier, quantity: line.quantity * multiplier };
}

async function syncOrderToStoreInventory(tx, buyerId, order, consignmentPrice, conversions = new Map(), expected = new Map()) {
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
    const name = line.productName.trim();
    if (!name || name.length > 100) throw problem('Tên mặt hàng nhập kho cần từ 1 đến 100 ký tự.');
    const plan = importLinePlan(line, existing, conversions.get(line.id));
    let { item } = plan;
    const { unit, multiplier, quantity } = plan;
    if (plan.needsConversion) throw problem('Hãy chọn đơn vị lẻ và nhập số lượng trong mỗi ' + line.packaging + ' của ' + name + '.');
    if (plan.incompatible) throw problem('Đơn vị trong kho khác quy cách mua của ' + name + '.');
    const preview = expected.get(line.id);
    if (expected.size && (!preview || preview.unit !== unit || preview.quantity !== quantity)) {
      throw problem('Quy cách trong kho vừa thay đổi. Hãy mở lại bước xem trước.');
    }
    const purchasePrice = Math.round(Number(line.unitPrice) / multiplier);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > INT_MAX || !Number.isSafeInteger(purchasePrice) || purchasePrice < 0 || purchasePrice > INT_MAX) throw problem(`Số lượng hoặc giá nhập của ${name} vượt giới hạn kho.`);
    if (!item) {
      item = await tx.inventoryItem.create({ data: { ownerId: buyerId, name, unit, quantity: 0, purchasePrice, sellingPrice: null } });
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
    await tx.inventoryLot.create({ data: {
      itemId: item.id, quantity, purchasePrice, receivedAt: importedAt, sourceOrderId: order.id,
      ...(consignmentPrice != null ? {
        consignmentSupplierId: order.supplierId,
        consignmentPackPrice: consignmentPrice,
        consignmentPackSize: multiplier,
      } : {}),
    } });
    const note = `[ĐƠN SỈ #${order.id}] Nhập ${line.quantity} × ${line.packaging || 'cái'} → ${quantity} ${item.unit}. NCC: ${supplierName}`;
    await tx.stockMovement.create({ data: { id: randomUUID(), itemId: item.id, type: 'RECEIPT', quantityChange: quantity, quantityBefore: before, quantityAfter: saved.quantity, productName: saved.name, unit: saved.unit, note: note.slice(0, 250), createdAt: importedAt } });
    Object.assign(item, saved);
    supplierUpdates.push({ itemId: item.id, supplierName });
    matchedIds.add(item.id);
  }
  return { alreadyImported: false, count: matchedIds.size, inventoryImportedAt: importedAt, supplierUpdates };
}
module.exports = { syncOrderToStoreInventory, importBlockReason, parsePackaging, importLinePlan, looseUnits };

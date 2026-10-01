const { randomUUID } = require('node:crypto');
const { expiryInfo } = require('./inventoryExpiry');
const { audit } = require('./platformPolicy');
function problem(status, message) { return Object.assign(new Error(message), { status }); }
async function record(tx, item, before, type, note, id = randomUUID(), unitSalePrice = null, occurredAt = null) {
  return tx.stockMovement.create({ data: { id, itemId: item.id, type, quantityChange: item.quantity - before, quantityBefore: before, quantityAfter: item.quantity, productName: item.name, unit: item.unit, note, unitSalePrice, ...(occurredAt ? { createdAt: occurredAt } : {}) } });
}
function createStockService(prisma) {
  async function create(ownerId, data) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryItem.findFirst({ where: { ownerId, name: data.name } });
      if (existing) {
        const quantity = existing.quantity + data.quantity;
        const item = await tx.inventoryItem.update({ where: { id: existing.id }, data: { quantity, unit: data.unit, purchasePrice: data.purchasePrice, sellingPrice: data.sellingPrice, expiryDate: data.expiryDate } });
        if (data.quantity > 0 && tx.inventoryLot) await tx.inventoryLot.create({ data: { itemId: item.id, quantity: data.quantity, receivedAt: new Date(), expiryDate: data.expiryDate, purchasePrice: data.purchasePrice } });
        await record(tx, item, existing.quantity, 'RECEIPT', 'Nhập thêm từ form Thêm sản phẩm');
        await audit(tx, ownerId, 'INVENTORY_RECEIVED', 'INVENTORY', item.id, { quantity: data.quantity, total: quantity });
        return item;
      }
      const item = await tx.inventoryItem.create({ data: { ...data, ownerId } });
      if (item.quantity > 0 && tx.inventoryLot) await tx.inventoryLot.create({ data: { itemId: item.id, quantity: item.quantity, expiryDate: item.expiryDate, purchasePrice: item.purchasePrice } });
      await record(tx, item, 0, 'OPENING', 'Tồn ban đầu khi tạo sản phẩm');
      await audit(tx, ownerId, 'INVENTORY_CREATED', 'INVENTORY', item.id, { name: item.name, quantity: item.quantity, purchasePrice: item.purchasePrice, sellingPrice: item.sellingPrice });
      return item;
    });
  }
  async function edit(ownerId, id, data, expectedUpdatedAt) {
    return prisma.$transaction(async (tx) => {
      const old = await tx.inventoryItem.findFirst({ where: { id, ownerId } });
      if (!old) throw problem(404, 'Không tìm thấy sản phẩm trong kho của bạn.');
      if (expectedUpdatedAt && old.updatedAt.toISOString() !== expectedUpdatedAt) throw problem(409, 'Kho đã thay đổi. Tải lại kho và chọn Sửa lại để tránh ghi đè số lượng mới.');
      if (old.unit !== data.unit && old.quantity > 0) throw problem(400, 'Chỉ đổi đơn vị khi tồn kho bằng 0 để tránh sai số lượng.');
      const changed = await tx.inventoryItem.updateMany({ where: { id, ownerId, quantity: old.quantity, updatedAt: old.updatedAt }, data });
      if (!changed.count) throw problem(409, 'Kho vừa thay đổi. Vui lòng tải lại và thử lại.');
      if (data.quantity !== old.quantity) await record(tx, { ...old, ...data }, old.quantity, 'ADJUSTMENT', 'Điều chỉnh số tồn thủ công');
      await audit(tx, ownerId, 'INVENTORY_UPDATED', 'INVENTORY', id, { before: { quantity: old.quantity, unit: old.unit, purchasePrice: old.purchasePrice, sellingPrice: old.sellingPrice }, after: data });
      return { success: true };
    });
  }
  async function move(ownerId, id, input) {
    async function existing() {
      const previous = await prisma.stockMovement.findUnique({ where: { id: input.requestId }, include: { item: true } });
      if (!previous) return null;
      const delta = input.type === 'SALE' ? -input.quantity : input.quantity;
      if (previous.item.ownerId !== ownerId || previous.itemId !== id || previous.type !== input.type || previous.quantityChange !== delta || previous.note !== input.note || (input.unitSalePrice !== undefined && previous.unitSalePrice !== input.unitSalePrice)) throw problem(409, 'Mã thao tác đã được dùng. Hãy tạo thao tác mới.');
      return previous;
    }
    const previous = await existing();
    if (previous) return previous;
    try {
      return await prisma.$transaction(async (tx) => {
        const item = await tx.inventoryItem.findFirst({ where: { id, ownerId } });
        if (!item) throw problem(404, 'Không tìm thấy sản phẩm trong kho của bạn.');
        if (input.type === 'SALE' && expiryInfo(item.expiryDate).daysUntilExpiry < 0 && !input.allowExpiredSale) throw problem(409, 'Mặt hàng đã hết hạn. Kiểm tra lại lô hàng và xác nhận cảnh báo trước khi ghi nhận bán.');
        const after = item.quantity + (input.type === 'SALE' ? -input.quantity : input.quantity);
        if (after < 0) throw problem(409, `Kho chỉ còn ${item.quantity} ${item.unit}, không đủ để bán.`);
        if (after > 2147483647) throw problem(400, 'Số lượng vượt giới hạn lưu trữ.');
        const result = await tx.inventoryItem.updateMany({ where: { id, ownerId, quantity: item.quantity, updatedAt: item.updatedAt }, data: { quantity: after } });
        if (!result.count) throw problem(409, 'Kho vừa thay đổi. Vui lòng thử lại.');
        const unitSalePrice = input.type === 'SALE' ? (input.unitSalePrice ?? item.sellingPrice ?? null) : null;
        await audit(tx, ownerId, 'STOCK_MOVEMENT', 'INVENTORY', id, { type: input.type, before: item.quantity, after, unitSalePrice, expiredSaleAcknowledged: Boolean(input.allowExpiredSale) });
        if (input.type === 'RECEIPT' && tx.inventoryLot) {
          await tx.inventoryLot.create({ data: { itemId: item.id, quantity: input.quantity, receivedAt: input.occurredAt || new Date(), expiryDate: input.lotExpiryDate || item.expiryDate, purchasePrice: item.purchasePrice } });
        } else if (input.type === 'SALE' && tx.inventoryLot) {
          let remaining = input.quantity;
          const lots = await tx.inventoryLot.findMany({ where: { itemId: item.id, quantity: { gt: 0 } }, orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }, { id: 'asc' }] });
          for (const lot of lots) {
            if (!remaining) break;
            const used = Math.min(remaining, lot.quantity);
            await tx.inventoryLot.update({ where: { id: lot.id }, data: { quantity: { decrement: used } } });
            remaining -= used;
          }
        }
        return record(tx, { ...item, quantity: after }, item.quantity, input.type, input.note, input.requestId, unitSalePrice, input.occurredAt);
      });
    } catch (error) {
      // A concurrent retry may have committed the same request. Never apply twice.
      const saved = await existing();
      if (saved) return saved;
      if (error.code === 'P2034') throw problem(409, 'Kho đang có thao tác khác. Vui lòng thử lại.');
      throw error;
    }
  }
  return { create, edit, move };
}
module.exports = { createStockService };

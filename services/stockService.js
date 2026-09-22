const { randomUUID } = require('node:crypto');
const { expiryInfo } = require('./inventoryExpiry');
const { audit } = require('./platformPolicy');
function problem(status, message) { return Object.assign(new Error(message), { status }); }
async function record(tx, item, before, type, note, id = randomUUID()) {
  return tx.stockMovement.create({ data: { id, itemId: item.id, type, quantityChange: item.quantity - before, quantityBefore: before, quantityAfter: item.quantity, productName: item.name, unit: item.unit, note } });
}
function createStockService(prisma) {
  async function create(ownerId, data) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({ data: { ...data, ownerId } });
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
      if (previous.item.ownerId !== ownerId || previous.itemId !== id || previous.type !== input.type || previous.quantityChange !== delta || previous.note !== input.note) throw problem(409, 'Mã thao tác đã được dùng. Hãy tạo thao tác mới.');
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
        await audit(tx, ownerId, 'STOCK_MOVEMENT', 'INVENTORY', id, { type: input.type, before: item.quantity, after, expiredSaleAcknowledged: Boolean(input.allowExpiredSale) });
        return record(tx, { ...item, quantity: after }, item.quantity, input.type, input.note, input.requestId);
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

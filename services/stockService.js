const { randomUUID } = require('node:crypto');
const { expiryInfo } = require('./inventoryExpiry');
const { audit } = require('./platformPolicy');
const inventorySupplierService = require('./inventorySupplierService');
const consignmentService = require('./consignmentService');
function problem(status, message) { return Object.assign(new Error(message), { status }); }
async function record(tx, item, before, type, note, id = randomUUID(), unitSalePrice = null, occurredAt = null) {
  return tx.stockMovement.create({ data: { id, itemId: item.id, type, quantityChange: item.quantity - before, quantityBefore: before, quantityAfter: item.quantity, productName: item.name, unit: item.unit, note, unitSalePrice, ...(occurredAt ? { createdAt: occurredAt } : {}) } });
}
function createStockService(prisma) {
  async function create(ownerId, data) {
    const {
      supplierName,
      isConsignment,
      settlementPrice,
      autoRestock,
      autoExchangeExpiry,
      termsNote,
      ...itemData
    } = data;
    return prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryItem.findFirst({ where: { ownerId, name: itemData.name } });
      if (existing) {
        if (existing.unit.trim().toLocaleLowerCase('vi') !== itemData.unit.trim().toLocaleLowerCase('vi')) {
          throw problem(409, `“${existing.name}” đang dùng đơn vị ${existing.unit}. Hãy giữ đúng đơn vị khi tạo lô mới.`);
        }
        const quantity = existing.quantity + itemData.quantity;
        if (quantity > 2147483647) throw problem(400, 'Số lượng sau khi nhập vượt giới hạn lưu trữ.');
        const nearestExpiry = itemData.expiryDate && (!existing.expiryDate || itemData.expiryDate < existing.expiryDate)
          ? itemData.expiryDate
          : existing.expiryDate;
        const changed = await tx.inventoryItem.updateMany({
          where: { id: existing.id, ownerId, quantity: existing.quantity, updatedAt: existing.updatedAt },
          data: {
            quantity,
            unit: existing.unit,
            purchasePrice: itemData.purchasePrice,
            sellingPrice: itemData.sellingPrice,
            expiryDate: nearestExpiry,
          },
        });
        if (!changed.count) throw problem(409, 'Kho vừa thay đổi. Tải lại rồi tạo lô mới.');
        const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: existing.id } });
        if (itemData.quantity > 0 && tx.inventoryLot) await tx.inventoryLot.create({
          data: {
            itemId: item.id,
            quantity: itemData.quantity,
            receivedAt: new Date(),
            expiryDate: itemData.expiryDate || null,
            purchasePrice: itemData.purchasePrice,
          },
        });
        if (supplierName !== undefined && supplierName !== null) {
          inventorySupplierService.setSupplier(item.id, supplierName);
        }
        if (isConsignment !== undefined) {
          if (isConsignment) {
            consignmentService.setItemConsignment(item.id, {
              isConsignment: true,
              settlementPrice,
              autoRestock,
              autoExchangeExpiry,
              termsNote,
              supplierName: supplierName || inventorySupplierService.getSupplier(item.id),
            });
          } else {
            consignmentService.deleteItemConsignment(item.id);
          }
        }
        const consignment = consignmentService.getItemConsignment(item.id);
        await record(tx, item, existing.quantity, 'RECEIPT', `Nhập thêm từ form Thêm sản phẩm${consignment?.isConsignment ? ' [Ký gửi tiếp thị 0đ]' : ''}${supplierName ? ` [NCC: ${supplierName}]` : ''}`);
        await audit(tx, ownerId, 'INVENTORY_RECEIVED', 'INVENTORY', item.id, { quantity: itemData.quantity, total: quantity, supplierName, isConsignment });
        return {
          ...item,
          supplierName: inventorySupplierService.getSupplier(item.id),
          isConsignment: Boolean(consignment?.isConsignment),
          settlementPrice: consignment?.settlementPrice || 0,
          autoRestock: consignment?.autoRestock !== false,
          autoExchangeExpiry: consignment?.autoExchangeExpiry !== false,
        };
      }
      const item = await tx.inventoryItem.create({ data: { ...itemData, ownerId } });
      if (item.quantity > 0 && tx.inventoryLot) await tx.inventoryLot.create({ data: { itemId: item.id, quantity: item.quantity, expiryDate: item.expiryDate, purchasePrice: item.purchasePrice } });
      if (supplierName !== undefined && supplierName !== null) {
        inventorySupplierService.setSupplier(item.id, supplierName);
      }
      if (isConsignment !== undefined) {
        if (isConsignment) {
          consignmentService.setItemConsignment(item.id, {
            isConsignment: true,
            settlementPrice,
            autoRestock,
            autoExchangeExpiry,
            termsNote,
            supplierName,
          });
        } else {
          consignmentService.deleteItemConsignment(item.id);
        }
      }
      const consignment = consignmentService.getItemConsignment(item.id);
      await record(tx, item, 0, 'OPENING', `Tồn ban đầu khi tạo sản phẩm${consignment?.isConsignment ? ' [Ký gửi tiếp thị 0đ]' : ''}${supplierName ? ` [NCC: ${supplierName}]` : ''}`);
      await audit(tx, ownerId, 'INVENTORY_CREATED', 'INVENTORY', item.id, { name: item.name, quantity: item.quantity, purchasePrice: item.purchasePrice, sellingPrice: item.sellingPrice, supplierName, isConsignment });
      return {
        ...item,
        supplierName: inventorySupplierService.getSupplier(item.id),
        isConsignment: Boolean(consignment?.isConsignment),
        settlementPrice: consignment?.settlementPrice || 0,
        autoRestock: consignment?.autoRestock !== false,
        autoExchangeExpiry: consignment?.autoExchangeExpiry !== false,
      };
    }, { isolationLevel: 'Serializable' });
  }
  async function edit(ownerId, id, data, expectedUpdatedAt) {
    const {
      supplierName,
      isConsignment,
      settlementPrice,
      autoRestock,
      autoExchangeExpiry,
      termsNote,
      ...itemData
    } = data;
    return prisma.$transaction(async (tx) => {
      const old = await tx.inventoryItem.findFirst({ where: { id, ownerId } });
      if (!old) throw problem(404, 'Không tìm thấy sản phẩm trong kho của bạn.');
      if (expectedUpdatedAt && old.updatedAt.toISOString() !== expectedUpdatedAt) throw problem(409, 'Kho đã thay đổi. Tải lại kho và chọn Sửa lại để tránh ghi đè số lượng mới.');
      if (old.unit !== itemData.unit && old.quantity > 0) throw problem(400, 'Chỉ đổi đơn vị khi tồn kho bằng 0 để tránh sai số lượng.');
      const changed = await tx.inventoryItem.updateMany({ where: { id, ownerId, quantity: old.quantity, updatedAt: old.updatedAt }, data: itemData });
      if (!changed.count) throw problem(409, 'Kho vừa thay đổi. Vui lòng tải lại và thử lại.');
      if (supplierName !== undefined) {
        inventorySupplierService.setSupplier(id, supplierName);
      }
      if (isConsignment !== undefined) {
        if (isConsignment) {
          consignmentService.setItemConsignment(id, {
            isConsignment: true,
            settlementPrice,
            autoRestock,
            autoExchangeExpiry,
            termsNote,
            supplierName: supplierName || inventorySupplierService.getSupplier(id),
          });
        } else {
          consignmentService.deleteItemConsignment(id);
        }
      }
      if (itemData.quantity !== old.quantity) await record(tx, { ...old, ...itemData }, old.quantity, 'ADJUSTMENT', 'Điều chỉnh số tồn thủ công');
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
  async function importRows(ownerId, rows) {
    return prisma.$transaction(async (tx) => {
      let createdCount = 0;
      let updatedCount = 0;
      let importedQuantity = 0;
      for (const row of rows) {
        const existing = await tx.inventoryItem.findFirst({
          where: { ownerId, name: row.name },
        });
        if (existing && existing.unit.trim().toLocaleLowerCase('vi') !== row.unit.trim().toLocaleLowerCase('vi')) {
          throw problem(
            409,
            `Dòng ${row.rowNumber}: sản phẩm “${row.name}” đang dùng đơn vị “${existing.unit}”.`,
          );
        }
        if (existing) {
          const quantity = existing.quantity + row.quantity;
          if (quantity > 2147483647) {
            throw problem(400, `Dòng ${row.rowNumber}: số lượng tồn vượt giới hạn lưu trữ.`);
          }
          const nearestExpiry =
            row.expiryDate === undefined
              ? existing.expiryDate
              : !existing.expiryDate || row.expiryDate < existing.expiryDate
                ? row.expiryDate
                : existing.expiryDate;
          const update = {
            quantity,
            ...(row.purchasePrice !== undefined ? { purchasePrice: row.purchasePrice } : {}),
            ...(row.sellingPrice !== undefined ? { sellingPrice: row.sellingPrice } : {}),
            ...(row.expiryDate !== undefined ? { expiryDate: nearestExpiry } : {}),
          };
          const item = await tx.inventoryItem.update({
            where: { id: existing.id },
            data: update,
          });
          await tx.inventoryLot.create({
            data: {
              itemId: item.id,
              quantity: row.quantity,
              receivedAt: row.receivedAt,
              expiryDate: row.expiryDate ?? null,
              purchasePrice: row.purchasePrice ?? existing.purchasePrice,
            },
          });
          if (row.supplierName) {
            inventorySupplierService.setSupplier(item.id, row.supplierName);
          }
          const note = `Nhập kho từ Excel${row.supplierName ? ` [NCC: ${row.supplierName}]` : ''}${row.note ? ` · ${row.note}` : ''}`.slice(0, 250);
          await record(tx, item, existing.quantity, 'RECEIPT', note, undefined, null, row.receivedAt);
          await audit(tx, ownerId, 'INVENTORY_IMPORTED', 'INVENTORY', item.id, {
            rowNumber: row.rowNumber,
            quantity: row.quantity,
            before: existing.quantity,
            after: quantity,
            supplierName: row.supplierName || null,
          });
          updatedCount += 1;
        } else {
          const item = await tx.inventoryItem.create({
            data: {
              ownerId,
              name: row.name,
              unit: row.unit,
              quantity: row.quantity,
              purchasePrice: row.purchasePrice ?? null,
              sellingPrice: row.sellingPrice ?? null,
              expiryDate: row.expiryDate ?? null,
            },
          });
          if (row.supplierName) {
            inventorySupplierService.setSupplier(item.id, row.supplierName);
          }
          await tx.inventoryLot.create({
            data: {
              itemId: item.id,
              quantity: row.quantity,
              receivedAt: row.receivedAt,
              expiryDate: row.expiryDate ?? null,
              purchasePrice: row.purchasePrice ?? null,
            },
          });
          const note = `Tạo sản phẩm từ Excel${row.supplierName ? ` [NCC: ${row.supplierName}]` : ''}${row.note ? ` · ${row.note}` : ''}`.slice(0, 250);
          await record(tx, item, 0, 'OPENING', note, undefined, null, row.receivedAt);
          await audit(tx, ownerId, 'INVENTORY_IMPORTED', 'INVENTORY', item.id, {
            rowNumber: row.rowNumber,
            quantity: row.quantity,
            created: true,
            supplierName: row.supplierName || null,
          });
          createdCount += 1;
        }
        importedQuantity += row.quantity;
      }
      return { createdCount, updatedCount, importedQuantity, rowCount: rows.length };
    }, { maxWait: 5000, timeout: 30000 });
  }
  return { create, edit, move, importRows };
}
module.exports = { createStockService };

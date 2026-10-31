const { randomUUID } = require('node:crypto');
const inventorySupplierService = require('./inventorySupplierService');

function numberValue(val) {
  if (typeof val === 'object' && val !== null && typeof val.toNumber === 'function') {
    return val.toNumber();
  }
  return Number(val) || 0;
}

/**
 * Automatically syncs completed wholesale order items into store owner's inventory.
 * Idempotent: won't duplicate items if called multiple times for the same order.
 */
async function syncOrderToStoreInventory(tx, buyerId, order) {
  if (!order || !order.id || !order.items || order.items.length === 0) return;

  // Check idempotency: if stock movement already recorded for this order, skip
  const orderTag = `[ĐƠN SỈ #${order.id}]`;
  const existingMovement = await tx.stockMovement.findFirst({
    where: {
      note: { contains: orderTag },
    },
  });
  if (existingMovement) {
    return { skipped: true, reason: 'Already synced' };
  }

  const supplierName = order.supplier?.businessName || 'Chủ vựa';
  const syncedItems = [];

  for (const line of order.items) {
    const productName = line.productName.trim();
    const unit = line.packaging ? line.packaging.trim() : 'Cái';
    const quantity = Number(line.quantity) || 1;
    const unitPriceNum = Math.round(numberValue(line.unitPrice || 0));

    // Look for existing inventory item for this store owner
    const existing = await tx.inventoryItem.findFirst({
      where: { ownerId: buyerId, name: productName },
    });

    if (existing) {
      const nextQuantity = existing.quantity + quantity;
      const updated = await tx.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantity: nextQuantity,
          purchasePrice: unitPriceNum > 0 ? unitPriceNum : existing.purchasePrice,
        },
      });

      // Create lot if model exists
      if (tx.inventoryLot) {
        await tx.inventoryLot.create({
          data: {
            itemId: existing.id,
            quantity,
            receivedAt: new Date(),
            purchasePrice: unitPriceNum > 0 ? unitPriceNum : existing.purchasePrice,
          },
        });
      }

      // Record stock movement
      const note = `Tự động nhập kho từ đơn sỉ #${order.id} [NCC: ${supplierName}] ${orderTag}`;
      await tx.stockMovement.create({
        data: {
          id: randomUUID(),
          itemId: existing.id,
          type: 'IMPORT',
          quantityChange: quantity,
          quantityBefore: existing.quantity,
          quantityAfter: nextQuantity,
          productName,
          unit: existing.unit,
          note: note.slice(0, 250),
          createdAt: new Date(),
        },
      });

      inventorySupplierService.setSupplier(existing.id, supplierName);
      syncedItems.push(updated);
    } else {
      // Create new inventory item
      const newItem = await tx.inventoryItem.create({
        data: {
          ownerId: buyerId,
          name: productName,
          unit,
          quantity,
          purchasePrice: unitPriceNum > 0 ? unitPriceNum : null,
          sellingPrice: unitPriceNum > 0 ? Math.round(unitPriceNum * 1.15) : null,
          lowThreshold: 5,
        },
      });

      // Create lot if model exists
      if (tx.inventoryLot) {
        await tx.inventoryLot.create({
          data: {
            itemId: newItem.id,
            quantity,
            receivedAt: new Date(),
            purchasePrice: unitPriceNum > 0 ? unitPriceNum : null,
          },
        });
      }

      // Record stock movement
      const note = `Tự động tạo mới & nhập kho từ đơn sỉ #${order.id} [NCC: ${supplierName}] ${orderTag}`;
      await tx.stockMovement.create({
        data: {
          id: randomUUID(),
          itemId: newItem.id,
          type: 'IMPORT',
          quantityChange: quantity,
          quantityBefore: 0,
          quantityAfter: quantity,
          productName,
          unit,
          note: note.slice(0, 250),
          createdAt: new Date(),
        },
      });

      inventorySupplierService.setSupplier(newItem.id, supplierName);
      syncedItems.push(newItem);
    }
  }

  return { success: true, count: syncedItems.length };
}

module.exports = {
  syncOrderToStoreInventory,
};

const { randomUUID } = require('node:crypto');
const inventorySupplierService = require('./inventorySupplierService');

function numberValue(val) {
  if (typeof val === 'object' && val !== null && typeof val.toNumber === 'function') {
    return val.toNumber();
  }
  return Number(val) || 0;
}

function parsePackaging(packagingStr) {
  if (!packagingStr || typeof packagingStr !== 'string') {
    return { multiplier: 1, retailUnit: 'Cái' };
  }
  const clean = packagingStr.trim();
  // Match "Thùng 24 lon", "Thùng 24 gói", "Két 24 chai", "Lốc 6 lon", "Hộp 10 vỉ", "Khay 30 trứng", "Thùng 30 lon"
  const m1 = clean.match(/(?:thùng|két|hộp|lốc|khay|kiện|bịch|lô)\s+(\d+)\s*([a-zA-ZÀ-ỹ]+)/i);
  if (m1) {
    const count = parseInt(m1[1], 10);
    const unitRaw = m1[2].trim();
    if (count > 0) {
      const u = unitRaw.charAt(0).toUpperCase() + unitRaw.slice(1).toLowerCase();
      return { multiplier: count, retailUnit: u };
    }
  }
  // Match "24 lon / thùng" or "24 gói/thùng"
  const m2 = clean.match(/(\d+)\s*([a-zA-ZÀ-ỹ]+)\s*\/\s*(?:thùng|két|hộp|lốc|khay|kiện)/i);
  if (m2) {
    const count = parseInt(m2[1], 10);
    const unitRaw = m2[2].trim();
    if (count > 0) {
      const u = unitRaw.charAt(0).toUpperCase() + unitRaw.slice(1).toLowerCase();
      return { multiplier: count, retailUnit: u };
    }
  }
  return { multiplier: 1, retailUnit: clean };
}

function normalizeCoreTokens(name) {
  if (!name || typeof name !== 'string') return [];
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\b(nuoc loc|nuoc|loc|banh|keo|sua|thung|ket|hop|loc|lon|chai|goi|loai|vi)\b/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function areProductsMatching(name1, name2) {
  if (!name1 || !name2) return false;
  const n1 = name1.trim().toLowerCase();
  const n2 = name2.trim().toLowerCase();
  if (n1 === n2) return true;

  const tokens1 = normalizeCoreTokens(name1);
  const tokens2 = normalizeCoreTokens(name2);
  if (tokens1.length === 0 || tokens2.length === 0) return false;

  const match1in2 = tokens1.every((t) => tokens2.includes(t));
  const match2in1 = tokens2.every((t) => tokens1.includes(t));
  if (match1in2 || match2in1) return true;

  const common = tokens1.filter((t) => tokens2.includes(t));
  if (common.length >= 2 && common.length / Math.min(tokens1.length, tokens2.length) >= 0.7) {
    return true;
  }
  return false;
}

/**
 * Automatically syncs completed wholesale order items into store owner's inventory.
 * Idempotent: won't duplicate items if called multiple times for the same order.
 * Multiplies wholesale cartons by packaging count to retail units (e.g. 2 thùng 24 lon -> +48 lon).
 * Uses fuzzy core token matching so variations like "Nước Dasani" and "Nước lọc Dasani" sync to same item.
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

  // Load existing inventory items for this store owner to match by core tokens
  const existingStoreItems = await tx.inventoryItem.findMany({
    where: { ownerId: buyerId },
  });

  for (const line of order.items) {
    const productName = line.productName.trim();
    const pkg = line.packaging ? line.packaging.trim() : '';
    const { multiplier, retailUnit } = parsePackaging(pkg);
    const orderedCartons = Number(line.quantity) || 1;
    const totalQuantity = orderedCartons * multiplier;
    const cartonPrice = Math.round(numberValue(line.unitPrice || 0));
    const retailUnitPrice = multiplier > 1 && cartonPrice > 0 ? Math.round(cartonPrice / multiplier) : cartonPrice;

    // Look for existing inventory item for this store owner (exact or fuzzy core name)
    const existing = existingStoreItems.find((it) => areProductsMatching(it.name, productName));

    if (existing) {
      const nextQuantity = existing.quantity + totalQuantity;
      const effectiveUnit = existing.unit || retailUnit;
      const updated = await tx.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantity: nextQuantity,
          purchasePrice: retailUnitPrice > 0 ? retailUnitPrice : existing.purchasePrice,
        },
      });

      // Create lot if model exists
      if (tx.inventoryLot) {
        await tx.inventoryLot.create({
          data: {
            itemId: existing.id,
            quantity: totalQuantity,
            receivedAt: new Date(),
            purchasePrice: retailUnitPrice > 0 ? retailUnitPrice : existing.purchasePrice,
          },
        });
      }

      // Record stock movement
      const note = `Tự động nhập kho từ đơn sỉ #${order.id} [${orderedCartons} x ${pkg || 'thùng'} -> +${totalQuantity} ${effectiveUnit}] [NCC: ${supplierName}] ${orderTag}`;
      await tx.stockMovement.create({
        data: {
          id: randomUUID(),
          itemId: existing.id,
          type: 'IMPORT',
          quantityChange: totalQuantity,
          quantityBefore: existing.quantity,
          quantityAfter: nextQuantity,
          productName: existing.name,
          unit: effectiveUnit,
          note: note.slice(0, 250),
          createdAt: new Date(),
        },
      });

      inventorySupplierService.setSupplier(existing.id, supplierName);
      syncedItems.push(updated);
    } else {
      // Create new inventory item with retail unit and expanded quantity
      const newItem = await tx.inventoryItem.create({
        data: {
          ownerId: buyerId,
          name: productName,
          unit: retailUnit,
          quantity: totalQuantity,
          purchasePrice: retailUnitPrice > 0 ? retailUnitPrice : null,
          sellingPrice: retailUnitPrice > 0 ? Math.round(retailUnitPrice * 1.2) : null,
          lowThreshold: 10,
        },
      });

      // Create lot if model exists
      if (tx.inventoryLot) {
        await tx.inventoryLot.create({
          data: {
            itemId: newItem.id,
            quantity: totalQuantity,
            receivedAt: new Date(),
            purchasePrice: retailUnitPrice > 0 ? retailUnitPrice : null,
          },
        });
      }

      // Record stock movement
      const note = `Tự động tạo mới & nhập kho từ đơn sỉ #${order.id} [${orderedCartons} x ${pkg || 'thùng'} -> +${totalQuantity} ${retailUnit}] [NCC: ${supplierName}] ${orderTag}`;
      await tx.stockMovement.create({
        data: {
          id: randomUUID(),
          itemId: newItem.id,
          type: 'IMPORT',
          quantityChange: totalQuantity,
          quantityBefore: 0,
          quantityAfter: totalQuantity,
          productName,
          unit: retailUnit,
          note: note.slice(0, 250),
          createdAt: new Date(),
        },
      });

      inventorySupplierService.setSupplier(newItem.id, supplierName);
      existingStoreItems.push(newItem);
      syncedItems.push(newItem);
    }
  }

  return { success: true, count: syncedItems.length };
}

module.exports = {
  syncOrderToStoreInventory,
};

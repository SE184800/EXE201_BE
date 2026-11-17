function expiryInfo(expiryDate, now = new Date()) {
  if (!expiryDate) return { daysUntilExpiry: null, expiryLabel: 'Chưa nhập hạn sử dụng' };
  const date = new Date(expiryDate).toISOString().slice(0, 10);
  // Calendar days in Vietnam, independent of the server's timezone.
  const today = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
  const label = days < 0 ? `Đã hết hạn ${-days} ngày` : days === 0 ? 'Hết hạn hôm nay' : `Còn ${days} ngày`;
  return { daysUntilExpiry: days, expiryLabel: label };
}

async function purgeExpiredItems(prisma, ownerId, now = new Date()) {
  try {
    if (!prisma?.inventoryItem || typeof prisma.inventoryItem.findMany !== 'function' || typeof prisma.inventoryItem.update !== 'function') {
      return false;
    }
    const today = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayDate = new Date(`${today}T00:00:00.000Z`);

    // 1. Quét và xử lý các lô hàng (inventoryLot) đã hết hạn
    if (prisma.inventoryLot && typeof prisma.inventoryLot.findMany === 'function' && typeof prisma.inventoryLot.deleteMany === 'function') {
      const expiredLots = await prisma.inventoryLot.findMany({
        where: {
          item: { ownerId },
          expiryDate: { lt: todayDate },
        },
        include: { item: true },
      });

      if (expiredLots && expiredLots.length > 0) {
        const lotsByItem = new Map();
        for (const lot of expiredLots) {
          if (!lotsByItem.has(lot.itemId)) lotsByItem.set(lot.itemId, []);
          lotsByItem.get(lot.itemId).push(lot);
        }

        const expiredLotIds = expiredLots.map((l) => l.id);
        await prisma.inventoryLot.deleteMany({
          where: { id: { in: expiredLotIds } },
        });

        for (const [itemId, purgedLots] of lotsByItem.entries()) {
          const purgedQty = purgedLots.reduce((sum, l) => sum + (l.quantity || 0), 0);
          const remainingLots = await prisma.inventoryLot.findMany({
            where: { itemId },
            orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
          });

          const item = purgedLots[0].item;
          const newQty = remainingLots.reduce((sum, l) => sum + (l.quantity || 0), 0);
          const nearestExpiry = remainingLots.length > 0 ? remainingLots[0].expiryDate : null;

          await prisma.inventoryItem.update({
            where: { id: itemId },
            data: {
              quantity: newQty,
              expiryDate: nearestExpiry,
            },
          });

          if (prisma.stockMovement && typeof prisma.stockMovement.create === 'function' && purgedQty > 0) {
            await prisma.stockMovement.create({
              data: {
                itemId,
                type: 'ADJUSTMENT',
                quantityChange: -purgedQty,
                quantityBefore: item.quantity,
                quantityAfter: newQty,
                productName: item.name,
                unit: item.unit,
                note: `Tự động xuất hủy ${purgedQty} ${item.unit} do hết hạn sử dụng để đảm bảo an toàn`,
              },
            }).catch(() => {});
          }

          console.log(`[FoodSafety] Đã xuất hủy ${purgedLots.length} lô quá hạn của "${item.name}". Tồn kho còn: ${newQty} ${item.unit} (${remainingLots.length} lô).`);
        }
      }
    }

    // 2. Với các mặt hàng có expiryDate trực tiếp trên InventoryItem và quantity > 0
    const expiredDirectItems = await prisma.inventoryItem.findMany({
      where: {
        ownerId,
        expiryDate: { lt: todayDate },
        quantity: { gt: 0 },
      },
      include: { lots: true },
    });

    for (const item of expiredDirectItems) {
      if (!item.lots || item.lots.length === 0) {
        const oldQty = item.quantity;
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: {
            quantity: 0,
            expiryDate: null,
          },
        });

        if (prisma.stockMovement && typeof prisma.stockMovement.create === 'function' && oldQty > 0) {
          await prisma.stockMovement.create({
            data: {
              itemId: item.id,
              type: 'ADJUSTMENT',
              quantityChange: -oldQty,
              quantityBefore: oldQty,
              quantityAfter: 0,
              productName: item.name,
              unit: item.unit,
              note: `Tự động xuất hủy toàn bộ ${oldQty} ${item.unit} do quá hạn sử dụng để đảm bảo an toàn`,
            },
          }).catch(() => {});
        }

        console.log(`[FoodSafety] Đã xóa số lượng quá hạn của "${item.name}". Tồn kho về 0 ${item.unit}, vẫn giữ nguyên tên mặt hàng.`);
      }
    }

    return true;
  } catch (error) {
    console.error('[FoodSafety] Lỗi khi tự động dọn dẹp hàng quá hạn:', error);
    return false;
  }
}

module.exports = { expiryInfo, purgeExpiredItems };

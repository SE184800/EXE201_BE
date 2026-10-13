const express = require('express');
const { requireRole } = require('../middlewares/authMiddleware');
const { ROLES } = require('../config/roles');
const { visibleSupplierWhere } = require('../services/platformPolicy');
const { getUpcomingHolidays } = require('../services/holidayService');

// Publish business details only, never the supplier's login or personal profile.
const supplierSelect = { id: true, businessName: true, warehouseAddress: true, deliveryRadiusKm: true, deliveryFee: true, user: { select: { phone: true } } };
const serializeSupplier = (supplier) => ({ id: supplier.id, businessName: supplier.businessName, warehouseAddress: supplier.warehouseAddress, deliveryRadiusKm: Number(supplier.deliveryRadiusKm), deliveryFee: Number(supplier.deliveryFee), phone: supplier.user?.phone || null });

function createCatalogRoutes(prisma, requireAuth) {
  const router = express.Router();
  router.use(requireAuth, requireRole(ROLES.STORE_OWNER));

  router.get('/suppliers', async (req, res, next) => {
    try {
      const suppliers = await prisma.supplierProfile.findMany({
        where: { ...visibleSupplierWhere(), products: { some: { isActive: true } } },
        select: supplierSelect,
        orderBy: [{ businessName: 'asc' }, { id: 'asc' }],
      });
      res.json({ suppliers: suppliers.map(serializeSupplier) });
    } catch (error) { next(error); }
  });

  router.get('/products', async (req, res, next) => {
    const { q = '', supplierId, page = '1' } = req.query;
    const { category = '', inStock = '', minPrice = '', maxPrice = '' } = req.query;
    const categories = ['Đồ uống', 'Thực phẩm', 'Gia vị', 'Hóa phẩm', 'Chăm sóc cá nhân', 'Khác'];
    const validPrice = value => typeof value === 'string' && (value === '' || (/^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= 1000000000));
    if (typeof category !== 'string' || (category && !categories.includes(category)) || !['', 'true', 'false'].includes(inStock) || !validPrice(minPrice) || !validPrice(maxPrice) || (minPrice !== '' && maxPrice !== '' && Number(minPrice) > Number(maxPrice)))
      return res.status(400).json({ message: 'Danh mục hoặc khoảng giá không hợp lệ.' });
    if (typeof q !== 'string' || q.length > 150 || typeof page !== 'string' || !/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 100000 ||
      (supplierId !== undefined && (typeof supplierId !== 'string' || !/^\d+$/.test(supplierId) || Number(supplierId) < 1 || Number(supplierId) > 2147483647))) {
      return res.status(400).json({ message: 'Bộ lọc sản phẩm không hợp lệ.' });
    }
    try {
      const search = q.trim();
      const [products, activeHolidays] = await Promise.all([prisma.supplierProduct.findMany({
        where: {
          isActive: true, supplier: visibleSupplierWhere(),
          ...(category ? { category } : {}),
          ...(inStock === 'true' ? { stockQty: { gt: 0 } } : {}),
          ...(minPrice !== '' || maxPrice !== '' ? { wholesalePrice: { ...(minPrice !== '' ? { gte: Number(minPrice) } : {}), ...(maxPrice !== '' ? { lte: Number(maxPrice) } : {}) } } : {}),
          ...(supplierId ? { supplierId: Number(supplierId) } : {}),
          ...(search ? { OR: [{ name: { contains: search } }, { supplier: { businessName: { contains: search } } }] } : {}),
        },
        select: {
          id: true, name: true, packaging: true, category: true, imageUrl: true,
          wholesalePrice: true, stockQty: true, moq: true, updatedAt: true,
          priceHistory: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { oldPrice: true, changePercent: true, reason: true, createdAt: true },
          },
          supplier: { select: supplierSelect },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (Number(page) - 1) * 24, take: 25,
      }), getUpcomingHolidays(prisma, 60, new Date())]);
      res.json({
        products: products.slice(0, 24).map((product) => {
          const latestPrice = product.priceHistory[0] || null;
          const changePercent = latestPrice ? Number(latestPrice.changePercent) : null;
          const normalizedName = product.name.toLocaleLowerCase('vi-VN');
          const matchedHoliday = changePercent !== null && changePercent > 0
            ? activeHolidays.find(holiday => {
              const preparationStart = new Date(holiday.startDate + 'T00:00:00.000Z').getTime() - holiday.preparationDays * 86400000;
              return latestPrice.createdAt.getTime() >= preparationStart
                && holiday.categories.some(keyword => normalizedName.includes(keyword.toLocaleLowerCase('vi-VN')));
            })
            : null;
          const { priceHistory: _priceHistory, ...publicProduct } = product;
          return {
            ...publicProduct,
            wholesalePrice: Number(product.wholesalePrice),
            previousPrice: latestPrice ? Number(latestPrice.oldPrice) : null,
            priceChangePercent: changePercent,
            priceChangedAt: latestPrice?.createdAt || null,
            priceChangeReason: latestPrice?.reason || null,
            priceWarning: (changePercent !== null && changePercent >= 20) || Boolean(matchedHoliday),
            holidayPriceContext: matchedHoliday ? {
              name: matchedHoliday.name,
              startDate: matchedHoliday.startDate,
              daysUntil: matchedHoliday.daysUntil,
            } : null,
            supplier: serializeSupplier(product.supplier),
          };
        }),
        page: Number(page), hasMore: products.length > 24,
      });
    } catch (error) { next(error); }
  });
  return router;
}
module.exports = { createCatalogRoutes };

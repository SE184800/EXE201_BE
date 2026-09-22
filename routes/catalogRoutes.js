const express = require('express');
const { requireRole } = require('../middlewares/authMiddleware');
const { ROLES } = require('../config/roles');
const { visibleSupplierWhere } = require('../services/platformPolicy');

// Publish business details only, never the supplier's login or personal profile.
const supplierSelect = { id: true, businessName: true, warehouseAddress: true, deliveryRadiusKm: true, deliveryFee: true };
const serializeSupplier = (supplier) => ({ ...supplier, deliveryRadiusKm: Number(supplier.deliveryRadiusKm), deliveryFee: Number(supplier.deliveryFee) });

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
      const products = await prisma.supplierProduct.findMany({
        where: {
          isActive: true, supplier: visibleSupplierWhere(),
          ...(category ? { category } : {}),
          ...(inStock === 'true' ? { stockQty: { gt: 0 } } : {}),
          ...(minPrice !== '' || maxPrice !== '' ? { wholesalePrice: { ...(minPrice !== '' ? { gte: Number(minPrice) } : {}), ...(maxPrice !== '' ? { lte: Number(maxPrice) } : {}) } } : {}),
          ...(supplierId ? { supplierId: Number(supplierId) } : {}),
          ...(search ? { OR: [{ name: { contains: search } }, { supplier: { businessName: { contains: search } } }] } : {}),
        },
        select: { id: true, name: true, packaging: true, category: true, imageUrl: true, wholesalePrice: true, stockQty: true, moq: true, updatedAt: true, supplier: { select: supplierSelect } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (Number(page) - 1) * 24, take: 25,
      });
      res.json({
        products: products.slice(0, 24).map((product) => ({ ...product, wholesalePrice: Number(product.wholesalePrice), supplier: serializeSupplier(product.supplier) })),
        page: Number(page), hasMore: products.length > 24,
      });
    } catch (error) { next(error); }
  });
  return router;
}
module.exports = { createCatalogRoutes };

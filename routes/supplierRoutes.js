const express = require('express');
const { requireRole } = require('../middlewares/authMiddleware');
const { ROLES } = require('../config/roles');
const { createSupplierService } = require('../services/supplierService');
const { createSupplierController } = require('../controllers/supplierController');

function createSupplierRoutes(prisma, requireAuth) {
  const router = express.Router();
  const controller = createSupplierController(createSupplierService(prisma));
  router.use(requireAuth, requireRole(ROLES.SUPPLIER));
  router.get('/dashboard', controller.dashboard);
  router.route('/profile').get(controller.getProfile).put(controller.saveProfile);
  router.route('/products').get(controller.listProducts).post(controller.createProduct);
  router.route('/products/:productId').put(controller.updateProduct).delete(controller.deactivateProduct);
  router.get('/orders', controller.listOrders);
  router.patch('/orders/:orderId/status', controller.updateOrderStatus);
  router.use((error, req, res, next) => {
    if (error.code === 'SUPPLIER_PROFILE_REQUIRED') return res.status(409).json({ message: error.message });
    if (error.code === 'STALE_PRODUCT') return res.status(409).json({ message: 'Sản phẩm vừa thay đổi. Tải lại sản phẩm rồi bấm Sửa sản phẩm để lấy tồn kho mới.' });
    if (error.code === 'P2034') return res.status(409).json({ message: 'Dữ liệu vừa thay đổi. Vui lòng tải lại và thử lại.' });
    next(error);
  });
  return router;
}

module.exports = { createSupplierRoutes };

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { requireRole } = require('../middlewares/authMiddleware');
const { ROLES } = require('../config/roles');
const { createSupplierService } = require('../services/supplierService');
const { createSupplierController } = require('../controllers/supplierController');

const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.png';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `product-${uniqueSuffix}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file ảnh (JPG, PNG, WEBP, GIF).'));
    }
  },
});

function createSupplierRoutes(prisma, requireAuth) {
  const router = express.Router();
  const controller = createSupplierController(createSupplierService(prisma));
  router.use(requireAuth, requireRole(ROLES.SUPPLIER));
  router.get('/dashboard', controller.dashboard);
  router.route('/profile').get(controller.getProfile).put(controller.saveProfile);
  router.post('/verification', controller.submitVerification);
  router.post('/upload-image', (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: 'Kích thước ảnh không được vượt quá 5MB.' });
        }
        return res.status(400).json({ success: false, message: err.message });
      } else if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      next();
    });
  }, controller.uploadImage);
  router.route('/products').get(controller.listProducts).post(controller.createProduct);
  router.route('/products/:productId').put(controller.updateProduct).delete(controller.deactivateProduct);
  router.get('/orders', controller.listOrders);
  router.patch('/orders/:orderId/status', controller.updateOrderStatus);
  router.use((error, req, res, next) => {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'SUPPLIER_PROFILE_REQUIRED') return res.status(409).json({ message: error.message });
    if (error.code === 'STALE_PRODUCT') return res.status(409).json({ message: 'Sản phẩm vừa thay đổi. Tải lại sản phẩm rồi bấm Sửa sản phẩm để lấy tồn kho mới.' });
    if (error.code === 'P2034') return res.status(409).json({ message: 'Dữ liệu vừa thay đổi. Vui lòng tải lại và thử lại.' });
    next(error);
  });
  return router;
}

module.exports = { createSupplierRoutes };

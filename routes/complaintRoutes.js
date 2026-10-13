const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { requireRole } = require('../middlewares/authMiddleware');

const COMPLAINT_REASONS = new Set([
  'DAMAGED',
  'SHORTAGE',
  'WRONG_ITEM',
  'EXPIRED',
  'QUALITY',
  'LATE',
  'OTHER',
]);

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
    cb(null, `complaint-${uniqueSuffix}${safeExt}`);
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

function createComplaintRoutes(prisma, requireAuth) {
  const r = express.Router();
  r.use(requireAuth);

  r.post('/upload-image', (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: 'Kích thước ảnh không được vượt quá 5MB.' });
        }
        return res.status(400).json({ success: false, message: err.message });
      } else if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn file ảnh để tải lên.' });
      }
      const imageUrl = `/uploads/${req.file.filename}`;
      return res.json({ success: true, imageUrl });
    });
  });

  r.get('/', async (req, res, next) => {
    try {
      const where = req.auth.user.role.code === 'STORE_OWNER'
        ? { buyerId: req.auth.user.id }
        : { supplier: { userId: req.auth.user.id } };
      res.json({ complaints: await prisma.orderComplaint.findMany({ where, orderBy: { createdAt: 'desc' } }) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/', requireRole('STORE_OWNER'), async (req, res, next) => {
    try {
      const { orderId, reason, description, imageUrl } = req.body || {};
      const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
      const normalizedDescription = typeof description === 'string' ? description.trim() : '';
      if (
        !Number.isInteger(orderId) ||
        !COMPLAINT_REASONS.has(normalizedReason) ||
        normalizedDescription.length < 3 ||
        normalizedDescription.length > 1000
      ) {
        return res.status(400).json({ message: 'Thông tin khiếu nại chưa hợp lệ.' });
      }

      const order = await prisma.wholesaleOrder.findFirst({
        where: {
          id: orderId,
          buyerId: req.auth.user.id,
          status: { in: ['ISSUE_HANDLING', 'DELIVERED'] },
        },
      });
      if (!order) {
        return res.status(404).json({ message: 'Chỉ được báo cáo đơn hàng đang ở bước tiếp nhận xử lý hoặc đã giao.' });
      }

      const existing = await prisma.orderComplaint.findUnique({ where: { orderId } });
      if (existing) {
        return res.status(409).json({ message: 'Đơn hàng này đã có báo cáo khiếu nại.' });
      }

      const normalizedImageUrl = typeof imageUrl === 'string' && imageUrl.trim().length > 0 && imageUrl.trim().length <= 1000
        ? imageUrl.trim()
        : null;

      const c = await prisma.orderComplaint.create({
        data: {
          orderId,
          buyerId: req.auth.user.id,
          supplierId: order.supplierId,
          reason: normalizedReason,
          description: normalizedDescription,
          imageUrl: normalizedImageUrl,
        },
      });
      res.status(201).json({ complaint: c });
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ message: 'Đơn hàng này đã có báo cáo khiếu nại.' });
      if (e.code === 'P2000') return res.status(400).json({ message: 'Nội dung báo cáo vượt quá giới hạn cho phép.' });
      next(e);
    }
  });

  r.patch('/:id', requireRole('SUPPLIER'), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
        return res.status(400).json({ message: 'Mã báo cáo không hợp lệ.' });
      }
      const p = await prisma.supplierProfile.findUnique({ where: { userId: req.auth.user.id } });
      if (!p) return res.status(404).json({ message: 'Không tìm thấy hồ sơ nhà cung cấp.' });

      const c = await prisma.orderComplaint.findFirst({ where: { id, supplierId: p.id } });
      if (!c) return res.status(404).json({ message: 'Không tìm thấy khiếu nại.' });

      const status = ['IN_REVIEW', 'RESOLVED', 'REJECTED'].includes(req.body?.status) ? req.body.status : null;
      if (!status) return res.status(400).json({ message: 'Trạng thái không hợp lệ.' });
      const response = typeof req.body.response === 'string' ? req.body.response.trim() : '';
      if (response.length > 1000 || (['RESOLVED', 'REJECTED'].includes(status) && response.length < 3)) {
        return res.status(400).json({ message: 'Nhập phản hồi từ 3 đến 1.000 ký tự khi kết thúc báo cáo.' });
      }

      const saved = await prisma.orderComplaint.update({
        where: { id },
        data: {
          status,
          response: response || null,
        },
      });
      res.json({ complaint: saved });
    } catch (e) {
      if (e.code === 'P2000') return res.status(400).json({ message: 'Phản hồi vượt quá giới hạn cho phép.' });
      next(e);
    }
  });

  return r;
}

module.exports = { createComplaintRoutes };



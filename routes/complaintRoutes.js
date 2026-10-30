const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { requireRole } = require('../middlewares/authMiddleware');
const { walletService } = require('../services/walletService');
const { sendComplaintNoticeEmail } = require('../services/complaintMailService');

const COMPLAINT_REASONS = new Set([
  'DAMAGED',
  'SHORTAGE',
  'WRONG_ITEM',
  'EXPIRED',
  'QUALITY',
  'LATE',
  'OTHER',
]);

const REASON_LABELS = {
  DAMAGED: 'Hàng bị bể vỡ / hư hỏng lúc giao',
  SHORTAGE: 'Giao thiếu số lượng so với đơn đặt',
  WRONG_ITEM: 'Giao sai sản phẩm / sai quy cách',
  EXPIRED: 'Hàng cận date / hết hạn',
  QUALITY: 'Lỗi chất lượng sản phẩm',
  LATE: 'Giao trễ / sai hẹn',
  OTHER: 'Khác',
};

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
      let normalizedDescription = typeof description === 'string' ? description.trim() : '';

      if (!Number.isInteger(orderId) || !COMPLAINT_REASONS.has(normalizedReason)) {
        return res.status(400).json({ message: 'Lý do báo sự cố chưa hợp lệ.' });
      }

      // Default description if omitted or short (tạp hóa friendly)
      if (normalizedDescription.length < 3) {
        normalizedDescription = REASON_LABELS[normalizedReason] || 'Báo sự cố đơn hàng khi nhận';
      }

      const order = await prisma.wholesaleOrder.findFirst({
        where: {
          id: orderId,
          buyerId: req.auth.user.id,
          status: { in: ['SHIPPING', 'ISSUE_HANDLING', 'DELIVERED'] },
        },
      });
      if (!order) {
        return res.status(404).json({ message: 'Chỉ được báo cáo đơn hàng đang vận chuyển, tiếp nhận xử lý hoặc đã giao.' });
      }

      const existing = await prisma.orderComplaint.findUnique({ where: { orderId } });
      if (existing) {
        return res.status(409).json({ message: 'Đơn hàng này đã có báo cáo khiếu nại trước đó.' });
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

      // If order is currently SHIPPING, update status to ISSUE_HANDLING
      if (order.status === 'SHIPPING') {
        await prisma.wholesaleOrder.update({
          where: { id: orderId },
          data: { status: 'ISSUE_HANDLING' },
        });
      }

      // Send email notification to supplier
      try {
        const supplier = await prisma.supplierProfile.findUnique({
          where: { id: order.supplierId },
          include: { user: true },
        });
        const supplierEmail = supplier?.user?.email || 'supplier@supplymind.vn';
        const storeName = req.auth.user.name || req.auth.user.username || 'Tiệm Tạp Hóa';
        const match = normalizedDescription.match(
          /^\[Sự cố:\s*([^|\]]+)(?:\s*\|\s*Bồi hoàn ước tính:\s*([^|\]]+))?(?:\s*\|\s*Đề xuất:\s*([^|\]]+))?\]\s*\n?([\s\S]*)$/
        );
        const itemSummaries = match ? match[1]?.trim() : '';
        const claimValue = match ? match[2]?.trim() : '';
        const resolutionProposal = match ? match[3]?.trim() : '';
        const details = match ? match[4]?.trim() : normalizedDescription;
        const images = normalizedImageUrl
          ? (normalizedImageUrl.includes('|||') ? normalizedImageUrl.split('|||') : [normalizedImageUrl])
          : [];

        sendComplaintNoticeEmail({
          to: supplierEmail,
          supplierName: supplier?.businessName || supplier?.user?.name || 'Quý Chủ Vựa',
          storeName,
          orderId,
          reasonLabel: REASON_LABELS[normalizedReason] || normalizedReason,
          description: details,
          itemSummaries,
          claimValue,
          resolutionProposal,
          evidenceImages: images,
        }).catch((err) => console.error('Lỗi gửi email sự cố:', err.message));
      } catch (err) {
        console.error('Lỗi tra cứu thông tin gửi email:', err.message);
      }

      res.status(201).json({ complaint: c });
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ message: 'Đơn hàng này đã có báo cáo khiếu nại.' });
      if (e.code === 'P2000') return res.status(400).json({ message: 'Nội dung báo cáo vượt quá giới hạn cho phép.' });
      next(e);
    }
  });

  // Action resolver for Supplier
  r.post('/:id/resolve', requireRole('SUPPLIER'), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Mã khiếu nại không hợp lệ.' });

      const profile = await prisma.supplierProfile.findUnique({ where: { userId: req.auth.user.id } });
      if (!profile) return res.status(404).json({ message: 'Không tìm thấy hồ sơ chủ vựa.' });

      const complaint = await prisma.orderComplaint.findFirst({
        where: { id, supplierId: profile.id },
        include: { order: { include: { items: true, buyer: true } } },
      });
      if (!complaint) return res.status(404).json({ message: 'Không tìm thấy khiếu nại của đơn hàng.' });

      const { resolutionType, deductAmount, note, items } = req.body || {};
      const order = complaint.order;
      const depositAmt = Number(order.depositAmount) || 0;
      const orderTotal = Number(order.total) || 0;
      const remainingCOD = Math.max(0, orderTotal - depositAmt);

      if (resolutionType === 'AGREE_REPLACE_0VND' || resolutionType === 'REPLACE' || resolutionType === 'AGREE_REPLACE') {
        const itemsToReplace = Array.isArray(items) && items.length > 0
          ? items
          : order.items.map((it) => ({
              productId: it.productId,
              productName: it.productName,
              packaging: it.packaging,
              quantity: it.quantity,
            }));

        const newOrder = await prisma.wholesaleOrder.create({
          data: {
            buyerId: order.buyerId,
            supplierId: order.supplierId,
            status: 'PREPARING',
            subtotal: 0,
            deliveryFee: 0,
            total: 0,
            depositRate: 0,
            depositAmount: 0,
            depositStatus: 'NONE',
            recipientName: order.recipientName,
            recipientPhone: order.recipientPhone,
            deliveryAddress: order.deliveryAddress,
            note: `Đơn giao bổ sung 0đ bù hàng sự cố cho đơn #${order.id}`,
            items: {
              create: itemsToReplace.map((it) => ({
                productId: it.productId,
                productName: it.productName,
                packaging: it.packaging || 'Phần',
                quantity: it.quantity || 1,
                unitPrice: 0,
                lineTotal: 0,
              })),
            },
          },
          include: { items: true },
        });

        const resolveMsg = note && note.trim().length >= 3
          ? note.trim()
          : `Chủ vựa đã đồng ý giao bù hàng mới và tự động khởi tạo đơn giao bù 0đ #${newOrder.id} cho cửa hàng.`;

        const updatedComplaint = await prisma.orderComplaint.update({
          where: { id },
          data: {
            status: 'RESOLVED',
            response: resolveMsg,
          },
        });

        return res.json({
          success: true,
          complaint: updatedComplaint,
          supplementaryOrder: newOrder,
          message: resolveMsg,
        });
      }

      if (resolutionType === 'DEDUCT_COD') {
        const numDeduct = Math.max(0, Number(deductAmount) || 0);
        if (numDeduct <= 0 || numDeduct > remainingCOD) {
          return res.status(400).json({
            message: `Số tiền giảm trừ COD phải lớn hơn 0 và tối đa ${remainingCOD.toLocaleString('vi-VN')} ₫.`,
          });
        }
        const resolveMsg = note && note.trim().length >= 3
          ? note.trim()
          : `Đồng ý giảm trừ ${numDeduct.toLocaleString('vi-VN')} ₫ vào tiền COD. Shipper chỉ thu số tiền còn lại: ${(remainingCOD - numDeduct).toLocaleString('vi-VN')} ₫.`;

        const updatedComplaint = await prisma.orderComplaint.update({
          where: { id },
          data: {
            status: 'RESOLVED',
            response: resolveMsg,
          },
        });

        const newNote = order.note
          ? `${order.note} | [ĐÃ GIẢM TRỪ COD]: -${numDeduct.toLocaleString('vi-VN')} ₫ (Thực thu: ${(remainingCOD - numDeduct).toLocaleString('vi-VN')} ₫)`
          : `[ĐÃ GIẢM TRỪ COD]: -${numDeduct.toLocaleString('vi-VN')} ₫ (Thực thu: ${(remainingCOD - numDeduct).toLocaleString('vi-VN')} ₫)`;

        await prisma.wholesaleOrder.update({
          where: { id: order.id },
          data: { note: newNote },
        });

        return res.json({ success: true, complaint: updatedComplaint, message: resolveMsg });
      }

      if (resolutionType === 'RETURN_REFUND') {
        const resolveMsg = note && note.trim().length >= 3
          ? note.trim()
          : 'Chủ vựa đồng ý nhận lại hàng và hoàn trả 100% tiền cọc về Ví của tiệm.';

        const updatedComplaint = await prisma.orderComplaint.update({
          where: { id },
          data: {
            status: 'RESOLVED',
            response: resolveMsg,
          },
        });

        await prisma.wholesaleOrder.update({
          where: { id: order.id },
          data: {
            status: 'REJECTED',
            depositStatus: 'REFUNDED',
            rejectReason: 'Hàng sự cố - Chủ vựa đồng ý nhận lại hàng và hoàn cọc',
          },
        });

        // Restock inventory
        for (const item of order.items) {
          await prisma.supplierProduct.updateMany({
            where: { id: item.productId, supplierId: profile.id },
            data: { stockQty: { increment: item.quantity } },
          });
        }

        // Refund escrow to buyer's wallet
        if (depositAmt > 0 && order.depositStatus === 'PAID') {
          walletService.refundEscrow(order.buyerId, order.id, depositAmt, `Hoàn cọc đơn #${order.id} do chủ vựa nhận lại hàng`);
        }

        return res.json({ success: true, complaint: updatedComplaint, message: resolveMsg });
      }

      if (resolutionType === 'REJECT_REFUSAL_CLAIM_DEPOSIT') {
        const resolveMsg = note && note.trim().length >= 3
          ? note.trim()
          : 'Bác bỏ khiếu nại: Khách từ chối nhận hàng vô cớ. Tiền cọc được bù đắp chi phí vận chuyển của chủ vựa.';

        const updatedComplaint = await prisma.orderComplaint.update({
          where: { id },
          data: {
            status: 'REJECTED',
            response: resolveMsg,
          },
        });

        await prisma.wholesaleOrder.update({
          where: { id: order.id },
          data: {
            status: 'REJECTED',
            depositStatus: 'PAID',
            rejectReason: 'Khách từ chối nhận hàng vô cớ (Bùng đơn)',
          },
        });

        // Restock inventory since shipper brought goods back
        for (const item of order.items) {
          await prisma.supplierProduct.updateMany({
            where: { id: item.productId, supplierId: profile.id },
            data: { stockQty: { increment: item.quantity } },
          });
        }

        // Confiscate escrow to supplier's wallet
        if (depositAmt > 0 && order.depositStatus === 'PAID') {
          walletService.confiscateEscrow(order.buyerId, req.auth.user.id, order.id, depositAmt, `Bồi thường tiền cọc đơn hàng #${order.id} do khách từ chối nhận vô cớ`);
        }

        return res.json({ success: true, complaint: updatedComplaint, message: resolveMsg });
      }

      return res.status(400).json({ message: 'Phương án xử lý không hợp lệ.' });
    } catch (e) {
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

      const c = await prisma.orderComplaint.findFirst({
        where: { id, supplierId: p.id },
        include: { order: { include: { items: true } } },
      });
      if (!c) return res.status(404).json({ message: 'Không tìm thấy khiếu nại.' });

      const status = ['IN_REVIEW', 'RESOLVED', 'REJECTED'].includes(req.body?.status) ? req.body.status : null;
      if (!status) return res.status(400).json({ message: 'Trạng thái không hợp lệ.' });
      const response = typeof req.body.response === 'string' ? req.body.response.trim() : '';
      if (response.length > 1000 || (['RESOLVED', 'REJECTED'].includes(status) && response.length < 3)) {
        return res.status(400).json({ message: 'Nhập phản hồi từ 3 đến 1.000 ký tự khi kết thúc báo cáo.' });
      }

      let supplementaryOrder = null;
      if (status === 'RESOLVED' && (response.includes('AGREE_REPLACE') || response.includes('giao bù') || response.includes('Giao bù')) && c.order) {
        try {
          supplementaryOrder = await prisma.wholesaleOrder.create({
            data: {
              buyerId: c.order.buyerId,
              supplierId: c.order.supplierId,
              status: 'PREPARING',
              subtotal: 0,
              deliveryFee: 0,
              total: 0,
              depositRate: 0,
              depositAmount: 0,
              depositStatus: 'NONE',
              recipientName: c.order.recipientName,
              recipientPhone: c.order.recipientPhone,
              deliveryAddress: c.order.deliveryAddress,
              note: `Đơn giao bổ sung 0đ bù hàng theo khiếu nại đơn #${c.order.id}`,
              items: {
                create: c.order.items.map((it) => ({
                  productId: it.productId,
                  productName: it.productName,
                  packaging: it.packaging || 'Phần',
                  quantity: it.quantity || 1,
                  unitPrice: 0,
                  lineTotal: 0,
                })),
              },
            },
            include: { items: true },
          });
        } catch (err) {
          console.error('Không thể tự động tạo đơn bù 0đ:', err.message);
        }
      }

      const saved = await prisma.orderComplaint.update({
        where: { id },
        data: {
          status,
          response: response || null,
        },
      });
      res.json({ complaint: saved, supplementaryOrder });
    } catch (e) {
      if (e.code === 'P2000') return res.status(400).json({ message: 'Phản hồi vượt quá giới hạn cho phép.' });
      next(e);
    }
  });

  return r;
}

module.exports = { createComplaintRoutes };

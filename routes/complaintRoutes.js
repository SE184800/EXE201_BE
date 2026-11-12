const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { Prisma } = require('@prisma/client');
const notificationService = require('../services/notificationService');
const { sqlEnabled, sqlUploadStorage } = require('../services/uploadStorage');
const { requireRole } = require('../middlewares/authMiddleware');
const { sendComplaintNoticeEmail, sendComplaintResponseEmail } = require('../services/complaintMailService');
const systemConfigService = require('../services/systemConfigService');
const deliveryService = require('../services/deliveryService');
const { paymentDue, fullyPaidByWallet } = require('../services/orderPaymentPolicy');
const { audit } = require('../services/platformPolicy');
const {
  CLOSED_COMPLAINT_STATUSES,
  SUPPLIER_ACTION_LABELS,
  getComplaintWorkflow,
  initComplaintWorkflow,
  recordSupplierProposal,
  recordBuyerCounter,
  recordFinalResolution,
  executeReturnRefundSettlement,
  executeReplaceOrderSettlement,
  evaluateAndApplyExpiredTimeouts,
} = require('../services/complaintWorkflowService');

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

const VALID_SUPPLIER_ACTIONS = new Set([
  'AGREE_REPLACE_0VND',
  'DEDUCT_COD',
  'RETURN_REFUND',
  'DISCUSS',
  'REJECT',
]);

function extractComplaintMeta(description, items = []) {
  const raw = String(description || '');
  const match = raw.match(
    /^\[Sự cố:\s*([^|\]]+)(?:\s*\|\s*Bồi hoàn ước tính:\s*([^|\]]+))?(?:\s*\|\s*Đề xuất:\s*([^|\]]+))?\]\s*\n?([\s\S]*)$/
  );
  const fallbackItems = Array.isArray(items) && items.length
    ? items.map((it) => `${it.productName} x${it.quantity}`).join(', ')
    : '';
  return {
    itemSummaries: (match && match[1]?.trim()) || fallbackItems,
    claimValue: match ? (match[2]?.trim() || '') : '',
    resolutionProposal: match ? (match[3]?.trim() || '') : '',
    details: match ? (match[4]?.trim() || '') : raw,
  };
}

const uploadsDir = path.join(__dirname, '../public/uploads');
if (!sqlEnabled() && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = sqlEnabled()
  ? sqlUploadStorage('complaint')
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.png';
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `complaint-${uniqueSuffix}${safeExt}`);
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Chỉ chấp nhận file ảnh (JPG, PNG, WEBP, GIF).'));
  },
});

function parseIdParam(rawId) {
  const id = Number(rawId);
  return Number.isInteger(id) && id >= 1 && id <= 2147483647 ? id : null;
}

function formatComplaint(c) {
  return { ...c, workflow: getComplaintWorkflow(c) };
}

function appendSafeText(base, addition, maxLength = 1000) {
  const cleanBase = String(base || '').trim();
  const cleanAdd = String(addition || '').trim();
  if (!cleanBase) return cleanAdd.slice(0, maxLength);
  const combined = `${cleanBase}\n${cleanAdd}`;
  if (combined.length <= maxLength) return combined;
  const keepBase = Math.max(0, maxLength - cleanAdd.length - 5);
  return `${cleanBase.slice(0, keepBase)}...\n${cleanAdd}`.slice(0, maxLength);
}

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
      }
      if (err) return res.status(400).json({ success: false, message: err.message });
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn file ảnh để tải lên.' });
      }
      return res.json({ success: true, imageUrl: `/uploads/${req.file.filename}` });
    });
  });

  r.get('/', async (req, res, next) => {
    try {
      const where = req.auth.user.role === 'STORE_OWNER'
        ? { buyerId: req.auth.user.id }
        : { supplier: { userId: req.auth.user.id } };
      await evaluateAndApplyExpiredTimeouts(prisma, where);
      const list = await prisma.orderComplaint.findMany({ where, orderBy: { createdAt: 'desc' } });
      res.json({ complaints: list.map(formatComplaint) });
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
      if (normalizedDescription.length < 3) {
        normalizedDescription = REASON_LABELS[normalizedReason] || 'Báo sự cố đơn hàng khi nhận';
      }

      const order = await prisma.wholesaleOrder.findFirst({
        where: {
          id: orderId,
          buyerId: req.auth.user.id,
          status: { in: ['SHIPPING', 'ISSUE_HANDLING', 'DELIVERED'] },
        },
        include: { items: true },
      });
      if (!order) {
        return res.status(404).json({ message: 'Chỉ được báo cáo đơn hàng đang vận chuyển, tiếp nhận xử lý hoặc đã giao.' });
      }

      if (order.status === 'DELIVERED' && order.deliveredAt) {
        const sysConfig = systemConfigService.getConfig();
        const maxComplaintHours = sysConfig.orderAndDelivery?.complaintWindowHours ?? 24;
        const diffHours = (Date.now() - new Date(order.deliveredAt).getTime()) / (1000 * 60 * 60);
        if (diffHours > maxComplaintHours) {
          return res.status(400).json({
            message: `Đơn hàng đã quá thời hạn cho phép khiếu nại (${maxComplaintHours} giờ kể từ khi nhận hàng).`,
          });
        }
      }

      const existing = await prisma.orderComplaint.findUnique({ where: { orderId } });
      if (existing) {
        return res.status(409).json({ message: 'Đơn hàng này đã có báo cáo khiếu nại trước đó.' });
      }

      const normalizedImageUrl =
        typeof imageUrl === 'string' && imageUrl.trim().length > 0 && imageUrl.trim().length <= 1000
          ? imageUrl.trim()
          : null;

      const c = await prisma.orderComplaint.create({
        data: {
          orderId,
          buyerId: req.auth.user.id,
          supplierId: order.supplierId,
          reason: normalizedReason,
          description: normalizedDescription.slice(0, 1000),
          imageUrl: normalizedImageUrl,
        },
      });

      if (order.status === 'SHIPPING') {
        await prisma.wholesaleOrder.update({
          where: { id: orderId },
          data: { status: 'ISSUE_HANDLING' },
        });
      }

      const storeName = req.auth.user.name || req.auth.user.username || 'Tiệm Tạp Hóa';
      const workflow = initComplaintWorkflow(c, storeName);

      try {
        const supplier = await prisma.supplierProfile.findUnique({
          where: { id: order.supplierId },
          include: { user: true },
        });
        const supplierEmail = supplier?.user?.email || 'supplier@supplymind.vn';
        const {
          itemSummaries,
          claimValue,
          resolutionProposal,
          details,
        } = extractComplaintMeta(normalizedDescription, order.items);
        const images = normalizedImageUrl
          ? normalizedImageUrl.includes('|||') ? normalizedImageUrl.split('|||') : [normalizedImageUrl]
          : [];

        if (supplier?.userId) {
          notificationService.createNotification({
            userId: supplier.userId,
            title: `Khiếu nại mới đơn #${orderId}`,
            message: `Cửa hàng ${storeName} vừa gửi khiếu nại (${REASON_LABELS[normalizedReason] || normalizedReason}). Vui lòng kiểm tra và phản hồi phương án xử lý.`,
            type: 'COMPLAINT_CREATED',
            orderId: Number(orderId),
            link: '/supplier/orders',
          }).catch(() => {});
        }

        sendComplaintNoticeEmail({
          to: supplierEmail,
          supplierName: supplier?.businessName || supplier?.user?.name || 'Quý Chủ Vựa',
          storeName,
          orderId,
          orderTotal: Number(order.total || 0),
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

      return res.status(201).json({ complaint: { ...c, workflow } });
    } catch (e) {
      if (e.code === 'P2002') return res.status(409).json({ message: 'Đơn hàng này đã có báo cáo khiếu nại.' });
      if (e.code === 'P2000') return res.status(400).json({ message: 'Nội dung báo cáo vượt quá giới hạn cho phép.' });
      return next(e);
    }
  });

  async function applySupplierProposal(req, res, { complaintId, action, deductAmount, note }) {
    await evaluateAndApplyExpiredTimeouts(prisma, { id: complaintId });

    const profile = await prisma.supplierProfile.findUnique({ where: { userId: req.auth.user.id } });
    if (!profile) return res.status(404).json({ message: 'Không tìm thấy hồ sơ nhà cung cấp.' });

    const c = await prisma.orderComplaint.findFirst({
      where: { id: complaintId, supplierId: profile.id },
      include: {
        buyer: { select: { id: true, name: true, username: true, email: true } },
        order: { include: { items: true, orderPayment: { include: { refund: true } } } },
      },
    });
    if (!c) return res.status(404).json({ message: 'Không tìm thấy khiếu nại.' });

    if (CLOSED_COMPLAINT_STATUSES.includes(c.status)) {
      return res.status(400).json({ message: 'Khiếu nại này đã kết thúc, không thể cập nhật thêm.' });
    }
    if (c.status === 'ESCALATED') {
      return res.status(400).json({ message: 'Khiếu nại này đang ở trạng thái tranh chấp cũ, không thể cập nhật thêm.' });
    }

    const wf = getComplaintWorkflow(c);
    if (wf?.pendingParty && wf.pendingParty !== 'SUPPLIER') {
      return res.status(409).json({ message: 'Bạn đã gửi phương án ở lượt này. Vui lòng chờ Cửa hàng tạp hóa xác nhận hoặc phản hồi.' });
    }

    if (!VALID_SUPPLIER_ACTIONS.has(action)) {
      return res.status(400).json({ message: 'Phương án đề xuất không hợp lệ.' });
    }
    const cleanNote = typeof note === 'string' ? note.trim() : '';
    if (cleanNote.length < 3 || cleanNote.length > 1000) {
      return res.status(400).json({ message: 'Vui lòng nhập phản hồi chi tiết từ 3 đến 1.000 ký tự.' });
    }

    let numericDeduct = null;
    if (action === 'DEDUCT_COD') {
      const driverInfo = deliveryService.getDriverInfo(c.orderId);
      if (fullyPaidByWallet(c.order, driverInfo) || driverInfo?.paymentInfo?.status === 'CONFIRMED') {
        return res.status(400).json({ message: 'Đơn hàng đã thanh toán đủ nên không thể giảm trừ COD. Hãy chọn phương án Hoàn tiền/cọc hoặc Giao bù 0đ.' });
      }
      const remainingDue = paymentDue(c.order, driverInfo);
      numericDeduct = Math.round(Number(deductAmount) || 0);
      if (!Number.isFinite(numericDeduct) || numericDeduct <= 0 || numericDeduct > remainingDue) {
        return res.status(400).json({
          message: `Số tiền giảm trừ COD phải lớn hơn 0 và tối đa ${remainingDue.toLocaleString('vi-VN')} ₫.`,
        });
      }
    }

    const actionLabel = SUPPLIER_ACTION_LABELS[action] || action;
    const deductSuffix = action === 'DEDUCT_COD' && numericDeduct ? ` (-${numericDeduct.toLocaleString('vi-VN')} ₫)` : '';
    const formattedResponse = `[${actionLabel}${deductSuffix}]: ${cleanNote}`.slice(0, 1000);

    const saved = await prisma.orderComplaint.update({
      where: { id: c.id },
      data: {
        status: 'IN_REVIEW',
        response: formattedResponse,
      },
    });

    const updatedWorkflow = recordSupplierProposal(saved, {
      supplierName: profile.businessName || req.auth.user.name || 'Chủ vựa',
      action,
      deductAmount: numericDeduct,
      note: cleanNote,
    });

    try {
      await notificationService.createNotification({
        userId: c.buyerId,
        title: `Chủ vựa phản hồi khiếu nại đơn #${c.orderId}`,
        message: `${profile.businessName} đề xuất: ${actionLabel}${deductSuffix}. Vui lòng kiểm tra và xác nhận phương án.`,
        type: 'COMPLAINT_RESPONDED',
        orderId: c.orderId,
        link: '/orders',
      });
    } catch {}

    const buyerEmail = c.buyer?.email;
    if (buyerEmail) {
      const { itemSummaries } = extractComplaintMeta(c.description, c.order?.items);
      sendComplaintResponseEmail({
        to: buyerEmail,
        storeName: c.buyer?.name || c.buyer?.username || 'Quý Tiệm Tạp Hóa',
        supplierName: profile.businessName || req.auth.user.name || 'Chủ vựa',
        orderId: c.orderId,
        orderTotal: Number(c.order?.total || 0),
        reasonLabel: REASON_LABELS[c.reason] || c.reason,
        itemSummaries,
        actionLabel,
        deductAmount: numericDeduct,
        supplierNote: cleanNote,
      }).catch((err) => console.error('Lỗi gửi email phản hồi khiếu nại:', err.message));
    }

    return res.json({
      success: true,
      complaint: { ...saved, workflow: updatedWorkflow },
      message: 'Đã gửi phương án xử lý tới Cửa hàng tạp hóa để xác nhận đồng thuận.',
    });
  }

  r.post('/:id/respond', requireRole('SUPPLIER'), async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id);
      if (!id) return res.status(400).json({ message: 'Mã báo cáo không hợp lệ.' });
      const { action = 'DISCUSS', deductAmount, note, response } = req.body || {};
      return await applySupplierProposal(req, res, {
        complaintId: id,
        action: String(action || 'DISCUSS').trim(),
        deductAmount,
        note: note ?? response,
      });
    } catch (e) {
      if (e.code === 'P2000') return res.status(400).json({ message: 'Phản hồi vượt quá giới hạn cho phép.' });
      return next(e);
    }
  });

  r.post('/:id/buyer-decision', requireRole('STORE_OWNER'), async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id);
      if (!id) return res.status(400).json({ message: 'Mã khiếu nại không hợp lệ.' });

      await evaluateAndApplyExpiredTimeouts(prisma, { id });

      const decision = String(req.body?.decision || '').trim().toUpperCase();
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      if (!['ACCEPT', 'COUNTER', 'CLOSE_UNRESOLVED', 'WITHDRAW'].includes(decision)) {
        return res.status(400).json({ message: 'Hành động xác nhận không hợp lệ.' });
      }

      const complaint = await prisma.orderComplaint.findUnique({
        where: { id },
        include: {
          order: { include: { items: true, orderPayment: { include: { refund: true } } } },
          supplier: { include: { user: true } },
        },
      });
      if (!complaint || complaint.buyerId !== req.auth.user.id) {
        return res.status(404).json({ message: 'Không tìm thấy khiếu nại này.' });
      }
      if (CLOSED_COMPLAINT_STATUSES.includes(complaint.status)) {
        return res.status(400).json({ message: 'Khiếu nại này đã được giải quyết hoặc tự đóng trước đó.' });
      }

      const wf = getComplaintWorkflow(complaint);
      const buyerName = req.auth.user.name || req.auth.user.username || 'Tiệm tạp hóa';

      if (decision === 'WITHDRAW') {
        const withdrawNote = note.length >= 3 ? note.slice(0, 500) : 'Cửa hàng tạp hóa chủ động rút khiếu nại / đã tự dàn xếp xong.';
        const saved = await prisma.$transaction(async (tx) => {
          const updated = await tx.orderComplaint.update({
            where: { id },
            data: { status: 'RESOLVED' },
          });
          await audit(tx, req.auth.user.id, 'COMPLAINT_WITHDRAWN', 'COMPLAINT', id, { orderId: complaint.orderId, withdrawNote });
          return updated;
        });
        const updatedWf = recordFinalResolution(saved, {
          actorRole: 'STORE_OWNER',
          actorName: buyerName,
          action: 'WITHDRAW',
          label: 'Tiệm rút khiếu nại — Hoàn thành',
          finalOutcome: 'STORE_WITHDRAWN',
          finalSummary: 'Cửa hàng chủ động rút khiếu nại (Hai bên đã xong)',
          closedReason: withdrawNote,
        });
        if (complaint.supplier?.userId) {
          notificationService.createNotification({
            userId: complaint.supplier.userId,
            title: `Khiếu nại đơn #${complaint.orderId} đã hoàn thành`,
            message: `${buyerName} đã rút khiếu nại / xác nhận kết thúc đơn #${complaint.orderId}.`,
            type: 'COMPLAINT_RESOLVED',
            orderId: complaint.orderId,
            link: '/supplier/orders',
          }).catch(() => {});
        }
        return res.json({ success: true, complaint: { ...saved, workflow: updatedWf }, message: 'Đã rút khiếu nại và mở khóa đơn hàng.' });
      }

      if (wf?.pendingParty !== 'STORE_OWNER' && complaint.status !== 'REJECTED') {
        return res.status(409).json({ message: 'Đang chờ Chủ vựa phản hồi ở lượt hiện tại.' });
      }

      if (decision === 'COUNTER') {
        if (note.length < 3 || note.length > 500) {
          return res.status(400).json({ message: 'Vui lòng nhập nội dung đề xuất lại từ 3 đến 500 ký tự.' });
        }

        const updated = await prisma.orderComplaint.update({
          where: { id },
          data: {
            status: 'IN_REVIEW',
            description: appendSafeText(complaint.description, `[Phản hồi của Tiệm]: ${note}`, 1000),
          },
        });
        const updatedWf = recordBuyerCounter(updated, { buyerName, note });

        if (complaint.supplier?.userId) {
          notificationService.createNotification({
            userId: complaint.supplier.userId,
            title: `Tiệm đề xuất lại khiếu nại đơn #${complaint.orderId}`,
            message: `${buyerName} chưa đồng ý phương án hiện tại và gửi phản hồi trao đổi thêm. Vui lòng xem và đề xuất lại phương án.`,
            type: 'COMPLAINT_COUNTERED',
            orderId: complaint.orderId,
            link: '/supplier/orders',
          }).catch(() => {});
        }

        return res.json({
          success: true,
          complaint: { ...updated, workflow: updatedWf },
          message: 'Đã gửi đề xuất lại tới Chủ vựa.',
        });
      }

      if (decision === 'CLOSE_UNRESOLVED') {
        return res.status(410).json({
          message: 'Luồng tự đóng khiếu nại hết lượt hiện đang tạm ngưng; hai bên vui lòng tiếp tục trao đổi để thống nhất phương án hoặc rút khiếu nại.',
        });
      }

      // decision === 'ACCEPT': Execute supplier's proposed plan atomically
      const proposedAction = wf?.proposedAction || 'DISCUSS';
      const deductAmt = Number(wf?.proposedDeductAmount || 0);

      const txResult = await prisma.$transaction(async (tx) => {
        const fresh = await tx.orderComplaint.findUnique({
          where: { id },
          include: {
            order: { include: { items: true, orderPayment: { include: { refund: true } } } },
          },
        });
        if (!fresh || CLOSED_COMPLAINT_STATUSES.includes(fresh.status)) {
          throw Object.assign(new Error('Khiếu nại này đã kết thúc trước đó.'), { status: 409 });
        }

        let supplementaryOrder = null;
        let finalOutcome = 'STORE_ACCEPTED';
        let finalSummary = 'Hai bên đã thống nhất phương án giải quyết';
        let agreedDeductAmount = null;
        const order = fresh.order;

        if (proposedAction === 'AGREE_REPLACE_0VND') {
          supplementaryOrder = await executeReplaceOrderSettlement(tx, {
            order,
            note: `Đơn giao bổ sung 0đ bù hàng theo thỏa thuận khiếu nại #${id} (Đơn gốc #${order.id})`,
          });
          finalOutcome = 'AGREED_REPLACE_0VND';
          finalSummary = `Hai bên thống nhất giao bù hàng mới (Đơn bổ sung 0đ #${supplementaryOrder.id})`;
        } else if (proposedAction === 'DEDUCT_COD' && deductAmt > 0) {
          const driverInfo = deliveryService.getDriverInfo(order.id);
          const remainingDue = paymentDue(order, driverInfo);
          const appliedDeduct = Math.min(deductAmt, Math.max(0, remainingDue));
          if (appliedDeduct <= 0) {
            throw Object.assign(new Error('Đơn hàng không còn số dư COD để giảm trừ.'), { status: 409 });
          }
          agreedDeductAmount = appliedDeduct;
          const afterDeduct = Math.max(0, remainingDue - appliedDeduct);
          const deductNote = `[ĐÃ THỐNG NHẤT GIẢM TRỪ COD KHIẾU NẠI #${id}]: -${appliedDeduct.toLocaleString('vi-VN')} ₫ (Còn phải trả: ${afterDeduct.toLocaleString('vi-VN')} ₫)`;
          await tx.wholesaleOrder.update({
            where: { id: order.id },
            data: {
              note: order.note ? `${order.note} | ${deductNote}`.slice(0, 500) : deductNote.slice(0, 500),
            },
          });
          finalOutcome = 'AGREED_DEDUCT_COD';
          finalSummary = `Hai bên thống nhất giảm trừ ${appliedDeduct.toLocaleString('vi-VN')} ₫ vào tiền COD`;
        } else if (proposedAction === 'RETURN_REFUND') {
          const refundReason = `Hai bên thống nhất trả hàng & hoàn tiền/cọc theo khiếu nại #${id} đơn #${order.id}`;
          await executeReturnRefundSettlement(tx, {
            order,
            supplierId: order.supplierId,
            actorId: req.auth.user.id,
            reason: refundReason,
            rejectReason: refundReason,
          });
          finalOutcome = 'AGREED_RETURN_REFUND';
          finalSummary = 'Hai bên thống nhất trả hàng & hoàn 100% tiền cọc / tiền ví';
        } else if (proposedAction === 'REJECT') {
          finalOutcome = 'STORE_ACCEPTED';
          finalSummary = 'Cửa hàng chấp nhận giải trình từ chối của Chủ vựa & đóng khiếu nại';
        }

        const updatedComplaint = await tx.orderComplaint.update({
          where: { id },
          data: { status: 'RESOLVED' },
        });

        await audit(tx, req.auth.user.id, 'COMPLAINT_RESOLVED_CONSENSUS', 'COMPLAINT', id, {
          orderId: order.id,
          proposedAction,
          finalOutcome,
          agreedDeductAmount,
          supplementaryOrderId: supplementaryOrder?.id || null,
        });

        return { updatedComplaint, supplementaryOrder, finalOutcome, finalSummary, agreedDeductAmount };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      const updatedWf = recordFinalResolution(txResult.updatedComplaint, {
        actorRole: 'STORE_OWNER',
        actorName: buyerName,
        action: 'ACCEPT_PROPOSAL',
        label: 'Tiệm đồng ý phương án — Hoàn thành',
        finalOutcome: txResult.finalOutcome,
        finalSummary: txResult.finalSummary,
        closedReason: note || null,
        agreedDeductAmount: txResult.agreedDeductAmount,
        supplementaryOrderId: txResult.supplementaryOrder?.id || null,
      });

      if (complaint.supplier?.userId) {
        notificationService.createNotification({
          userId: complaint.supplier.userId,
          title: `Khiếu nại đơn #${complaint.orderId} đã thống nhất Hoàn thành`,
          message: txResult.finalSummary,
          type: 'COMPLAINT_RESOLVED',
          orderId: complaint.orderId,
          link: '/supplier/orders',
        }).catch(() => {});
      }

      return res.json({
        success: true,
        complaint: { ...txResult.updatedComplaint, workflow: updatedWf },
        supplementaryOrder: txResult.supplementaryOrder,
        message: txResult.finalSummary,
      });
    } catch (e) {
      return next(e);
    }
  });

  // Backward-compatible PATCH endpoint (used by existing supplier PATCH tests)
  r.patch('/:id', requireRole('SUPPLIER'), async (req, res, next) => {
    try {
      const id = parseIdParam(req.params.id);
      if (!id) return res.status(400).json({ message: 'Mã báo cáo không hợp lệ.' });

      await evaluateAndApplyExpiredTimeouts(prisma, { id });

      const p = await prisma.supplierProfile.findUnique({ where: { userId: req.auth.user.id } });
      if (!p) return res.status(404).json({ message: 'Không tìm thấy hồ sơ nhà cung cấp.' });

      const c = await prisma.orderComplaint.findFirst({
        where: { id, supplierId: p.id },
        include: { order: { include: { items: true } } },
      });
      if (!c) return res.status(404).json({ message: 'Không tìm thấy khiếu nại.' });

      if (CLOSED_COMPLAINT_STATUSES.includes(c.status)) {
        return res.status(400).json({ message: 'Khiếu nại này đã được xử lý hoàn tất.' });
      }
      if (c.status === 'ESCALATED') {
        return res.status(400).json({ message: 'Khiếu nại đang ở trạng thái tranh chấp cũ, không thể thay đổi.' });
      }

      const status = ['IN_REVIEW', 'RESOLVED', 'REJECTED'].includes(req.body?.status) ? req.body.status : null;
      if (!status) return res.status(400).json({ message: 'Trạng thái không hợp lệ.' });
      const response = typeof req.body.response === 'string' ? req.body.response.trim() : '';
      if (response.length > 1000 || response.length < 3) {
        return res.status(400).json({ message: 'Nhập phản hồi từ 3 đến 1.000 ký tự.' });
      }

      if (status === 'RESOLVED') {
        return res.status(400).json({
          message: 'Theo quy trình mới, Chủ vựa chỉ đề xuất phương án để Cửa hàng tạp hóa xác nhận đồng thuận trước khi Hoàn thành.',
        });
      }

      const action = status === 'REJECTED' ? 'REJECT' : 'DISCUSS';
      const saved = await prisma.orderComplaint.update({
        where: { id },
        data: { status: 'IN_REVIEW', response },
      });

      const wf = getComplaintWorkflow(c);
      if (wf?.pendingParty === 'SUPPLIER') {
        recordSupplierProposal(saved, {
          supplierName: p.businessName || req.auth.user.name || 'Chủ vựa',
          action,
          note: response,
        });
      }

      return res.json({ complaint: formatComplaint(saved) });
    } catch (e) {
      if (e.code === 'P2000') return res.status(400).json({ message: 'Phản hồi vượt quá giới hạn cho phép.' });
      return next(e);
    }
  });

  // Retired legacy endpoints (replaced by 2-round consensual negotiation + automatic contract closure)
  r.post('/:id/resolve', requireRole('SUPPLIER'), (req, res) => {
    return res.status(410).json({
      message: 'Quy trình mới yêu cầu sự đồng thuận của hai bên. Vui lòng dùng tính năng Đề xuất phương án xử lý để cửa hàng xác nhận.',
    });
  });

  r.post('/:id/escalate', requireRole('STORE_OWNER'), (req, res) => {
    return res.status(410).json({
      message: 'Sàn hiện áp dụng cơ chế hai bên tự trao đổi thống nhất phương án và hệ thống ghi nhận kết quả; Admin không trực tiếp phân xử thắng/thua.',
    });
  });

  return r;
}

module.exports = { createComplaintRoutes };

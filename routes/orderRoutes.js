const express = require('express');
const { createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { requireRole } = require('../middlewares/authMiddleware');
const { normalizePhone } = require('../services/registrationValidation');
const { serializeOrder } = require('../services/supplierService');
const { walletService } = require('../services/walletService');
const { orderQuery } = require('../services/orderQuery');
const { visibleSupplierWhere, audit } = require('../services/platformPolicy');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const problem = (status, message) => Object.assign(new Error(message), { status });
const include = { buyer: true, items: true, supplier: { include: { user: true } }, complaint: true };
const serialize = order => ({
  ...serializeOrder(order),
  supplier: order.supplier ? {
    id: order.supplier.id,
    businessName: order.supplier.businessName,
    warehouseAddress: order.supplier.warehouseAddress || null,
    deliveryRadiusKm: order.supplier.deliveryRadiusKm ? Number(order.supplier.deliveryRadiusKm) : 10,
    phone: order.supplier.user?.phone || '0908 123 789',
  } : null,
});

function createOrderRoutes(prisma, requireAuth) {
  const router = express.Router();
  async function submitDeposit(buyerId, id, reference, auditEvent) {
    return prisma.$transaction(async tx => {
      const current = await tx.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');
      if (['SUBMITTED', 'PAID'].includes(current.depositStatus)) return current;
      if (current.depositAmount.lessThanOrEqualTo(0) || current.depositStatus !== 'PENDING' || current.status !== 'PENDING') throw problem(409, 'Đơn này không cần cọc hoặc không còn ở trạng thái có thể đặt cọc.');
      const changed = await tx.wholesaleOrder.updateMany({
        where: { id, buyerId, status: 'PENDING', depositStatus: 'PENDING' },
        data: {
          depositStatus: 'SUBMITTED',
          depositReference: reference,
          depositSubmittedAt: new Date(),
          depositPaidAt: null,
          depositReviewedAt: null,
          depositRejectionReason: null,
        },
      });
      if (!changed.count) throw problem(409, 'Khoản cọc vừa được xử lý. Tải lại đơn hàng.');
      const saved = await tx.wholesaleOrder.findUniqueOrThrow({ where: { id }, include });
      await audit(tx, buyerId, auditEvent, 'ORDER', id, { amount: saved.depositAmount.toString(), reference });
      return saved;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  router.use(requireAuth);
  router.get('/', requireRole('STORE_OWNER'), async (req, res, next) => {
    try {
      const { page, status } = orderQuery(req.query);
      const where = { buyerId: req.auth.user.id, ...(status ? { status } : {}) };
      const [orders, total] = await Promise.all([
        prisma.wholesaleOrder.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21, skip: (page - 1) * 20 }),
        prisma.wholesaleOrder.count({ where }),
      ]);
      res.json({ orders: orders.slice(0, 20).map(serialize), total, page, hasMore: orders.length > 20 });
    } catch (error) { next(error); }
  });
  router.post('/', requireRole('STORE_OWNER'), async (req, res, next) => {
    const body = req.body || {};
    const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim() : '';
    const recipientPhone = normalizePhone(body.recipientPhone);
    const deliveryAddress = typeof body.deliveryAddress === 'string' ? body.deliveryAddress.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const { requestId, lines, expectedDeliveryFee } = body;
    const depositRate = body.depositRate === undefined ? 0 : body.depositRate;
    if (typeof requestId !== 'string' || !uuid.test(requestId) || recipientName.length < 2 || recipientName.length > 100 || !/^0\d{9}$/.test(recipientPhone) || deliveryAddress.length < 10 || deliveryAddress.length > 500 || note.length > 500 ||
      typeof expectedDeliveryFee !== 'number' || !Number.isFinite(expectedDeliveryFee) || expectedDeliveryFee < 0 || expectedDeliveryFee > 1000000000 ||
      typeof depositRate !== 'number' || !Number.isFinite(depositRate) || depositRate < 0 || depositRate > 100 || Math.abs(depositRate * 100 - Math.round(depositRate * 100)) > 0.000001 ||
      !Array.isArray(lines) || lines.length < 1 || lines.length > 100 || lines.some(line => !line || !Number.isInteger(line.productId) || line.productId < 1 || line.productId > 2147483647 || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 2147483647 || typeof line.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(line.expectedUpdatedAt))) || new Set(lines.map(line => line.productId)).size !== lines.length)
      return res.status(400).json({ message: 'Kiểm tra người nhận, số điện thoại, địa chỉ (10–500 ký tự) và 1–100 mặt hàng với số lượng nguyên dương.' });
    const buyerId = req.auth.user.id;
    const requestHash = createHash('sha256').update(JSON.stringify({ recipientName, recipientPhone, deliveryAddress, note, expectedDeliveryFee, depositRate, lines: lines.map(({ productId, quantity, expectedUpdatedAt }) => ({ productId, quantity, expectedUpdatedAt })).sort((a,b) => a.productId-b.productId) })).digest('hex');
    async function previous() {
      const order = await prisma.wholesaleOrder.findFirst({ where: { requestId }, include });
      if (order && (order.buyerId !== buyerId || order.requestHash !== requestHash)) throw problem(409, 'Mã đặt hàng đã được dùng với nội dung khác. Hãy mở lại form đặt hàng.');
      return order;
    }
    try {
      const old = await previous();
      if (old) return res.json({ order: serialize(old) });
      const order = await prisma.$transaction(async tx => {
        const products = await tx.supplierProduct.findMany({ where: { id: { in: lines.map(line => line.productId) }, isActive: true, supplier: visibleSupplierWhere() }, include: { supplier: true } });
        if (products.length !== lines.length) throw problem(409, 'Có sản phẩm đã ngừng bán. Tải lại nguồn hàng trước khi đặt.');
        const supplier = products[0].supplier;
        if (products.some(product => product.supplierId !== supplier.id)) throw problem(400, 'Mỗi đơn chỉ đặt hàng từ một chủ vựa.');
        if (!supplier.deliveryFee.equals(expectedDeliveryFee)) throw problem(409, 'Phí giao hàng vừa thay đổi. Tải lại nguồn hàng để xem tổng tiền mới.');
        const snapshots = lines.map(line => {
          const product = products.find(product => product.id === line.productId);
          if (product.updatedAt.toISOString() !== new Date(line.expectedUpdatedAt).toISOString()) throw problem(409, 'Thông tin sản phẩm vừa thay đổi. Tải lại nguồn hàng trước khi đặt.');
          if (line.quantity < product.moq || line.quantity > product.stockQty) throw problem(409, `${product.name}: đặt ít nhất ${product.moq}, tối đa ${product.stockQty} × ${product.packaging}.`);
          return { productId: product.id, productName: product.name, packaging: product.packaging, quantity: line.quantity, unitPrice: product.wholesalePrice, lineTotal: product.wholesalePrice.mul(line.quantity) };
        });
        const subtotal = snapshots.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0));
        const total = subtotal.add(supplier.deliveryFee);
        const depositAmount = total.mul(depositRate).div(100).toDecimalPlaces(2);
        const numDeposit = depositAmount.toNumber();
        let useWalletEscrow = false;
        if (numDeposit > 0) {
          const buyerWallet = walletService.getWallet(buyerId);
          if (buyerWallet.availableBalance >= numDeposit) {
            useWalletEscrow = true;
          } else if (!supplier.bankName || !supplier.bankAccountNumber || !supplier.bankAccountHolder) {
            throw problem(400, `Số dư ví khả dụng không đủ để cọc (${buyerWallet.availableBalance.toLocaleString('vi-VN')} ₫ / cần ${numDeposit.toLocaleString('vi-VN')} ₫). Vui lòng thêm số dư thử nghiệm.`);
          }
        }
        if (total.greaterThan('1000000000000')) throw problem(400, 'Giá trị đơn vượt giới hạn 1.000 tỷ đồng. Vui lòng chia thành đơn nhỏ hơn.');
        const settings = await tx.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
        const created = await tx.wholesaleOrder.create({
          data: {
            requestId,
            requestHash,
            buyerId,
            supplierId: supplier.id,
            supplierRegion: supplier.region,
            commissionRate: settings.commissionRate,
            recipientName,
            recipientPhone,
            deliveryAddress,
            note: note || null,
            status: 'PENDING',
            subtotal,
            deliveryFee: supplier.deliveryFee,
            total,
            depositRate,
            depositAmount,
            depositStatus: numDeposit > 0 ? (useWalletEscrow ? 'PAID' : 'PENDING') : 'NONE',
            depositReference: useWalletEscrow ? 'VÍ_HỆ_THỐNG' : null,
            depositPaidAt: useWalletEscrow ? new Date() : null,
            depositBankName: numDeposit > 0 ? (supplier.bankName || 'Hệ thống SupplyMind') : null,
            depositBankAccountNumber: numDeposit > 0 ? (supplier.bankAccountNumber || 'ESCROW') : null,
            depositBankAccountHolder: numDeposit > 0 ? (supplier.bankAccountHolder || 'SUPPLYMIND ESCROW') : null,
            items: { create: snapshots },
          },
          include,
        });
        if (useWalletEscrow) {
          walletService.lockEscrow(buyerId, created.id, numDeposit, `Tạm khóa ${depositRate}% tiền cọc đơn hàng #${created.id} (Ví hệ thống)`);
        }
        await audit(tx, buyerId, 'ORDER_CREATED', 'ORDER', created.id, { supplierId: supplier.id, subtotal: subtotal.toString(), commissionRate: settings.commissionRate.toString(), depositRate: String(depositRate), depositAmount: depositAmount.toString() });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      res.status(201).json({ order: serialize(order) });
    } catch (error) {
      if (error.code === 'P2002' || error.code === 'P2034') {
        try { const old = await previous(); if (old) return res.json({ order: serialize(old) }); } catch (lookupError) { return next(lookupError); }
        return res.status(409).json({ message: 'Nguồn hàng đang thay đổi. Vui lòng thử lại.' });
      }
      next(error);
    }
  });
  router.post('/:id/deposit', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id);
    const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim() : '';
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    if (reference.length < 3 || reference.length > 100) return res.status(400).json({ message: 'Nhập mã giao dịch hoặc nội dung chuyển khoản từ 3 đến 100 ký tự.' });
    try {
      const order = await submitDeposit(req.auth.user.id, id, reference, 'DEPOSIT_SUBMITTED');
      res.json({ order: serialize(order) });
    } catch (error) { next(error); }
  });
  router.post('/:id/deposit/wallet', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    try {
      const buyerId = req.auth.user.id;
      const current = await prisma.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');
      if (current.depositStatus === 'PAID') return res.json({ order: serialize(current) });
      const depositNum = current.depositAmount.toNumber();
      if (depositNum <= 0) throw problem(400, 'Đơn này không yêu cầu cọc.');
      const buyerWallet = walletService.getWallet(buyerId);
      if (buyerWallet.availableBalance < depositNum) {
        throw problem(400, `Số dư ví khả dụng không đủ (${buyerWallet.availableBalance.toLocaleString('vi-VN')} ₫). Cần ${depositNum.toLocaleString('vi-VN')} ₫ để cọc.`);
      }
      walletService.lockEscrow(buyerId, id, depositNum, `Tạm khóa tiền cọc đơn hàng #${id} qua Ví hệ thống`);
      const updated = await prisma.wholesaleOrder.update({
        where: { id },
        data: {
          depositStatus: 'PAID',
          depositReference: 'VÍ_HỆ_THỐNG',
          depositPaidAt: new Date(),
          depositReviewedAt: new Date(),
          depositRejectionReason: null,
        },
        include,
      });
      res.json({ order: serialize(updated) });
    } catch (error) { next(error); }
  });
  router.post('/:id/deposit/sandbox', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    try {
      const reference = `SANDBOX-${id}-${Date.now()}`;
      const order = await submitDeposit(req.auth.user.id, id, reference, 'DEPOSIT_SANDBOX_SUBMITTED');
      res.json({ order: serialize(order) });
    } catch (error) { next(error); }
  });
  router.post('/:id/reschedule', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    const { rescheduleTime, reason } = req.body || {};
    if (!rescheduleTime || typeof rescheduleTime !== 'string') {
      return res.status(400).json({ message: 'Vui lòng chọn thời gian hẹn dời giao hàng.' });
    }
    try {
      const buyerId = req.auth.user.id;
      const current = await prisma.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');
      if (!['PREPARING', 'SHIPPING', 'ISSUE_HANDLING'].includes(current.status)) {
        throw problem(400, 'Chỉ có thể hẹn dời lịch khi đơn hàng đang chuẩn bị, trên đường vận chuyển hoặc tiếp nhận xử lý.');
      }
      const count = (current.note?.match(/\[YÊU CẦU DỜI LỊCH GIAO/g) || []).length;
      if (count >= 2) {
        throw problem(400, 'Đơn hàng đã được hẹn dời 2 lần (mức tối đa). Vui lòng liên hệ trực tiếp với chủ vựa để thỏa thuận giao nhận.');
      }
      const tag = `[YÊU CẦU DỜI LỊCH GIAO #${count + 1}]: Hẹn lúc ${rescheduleTime.trim()}${reason && reason.trim() ? ` (Lý do: ${reason.trim()})` : ''} - [CHỜ_VỰA_XÁC_NHẬN]`;
      const updatedNote = current.note ? `${current.note} | ${tag}` : tag;
      const updated = await prisma.wholesaleOrder.update({
        where: { id },
        data: { note: updatedNote },
        include,
      });
      res.json({ order: serialize(updated) });
    } catch (error) { next(error); }
  });

  router.post('/:id/reschedule-response', requireRole('SUPPLIER'), async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    const { action, note } = req.body || {};
    if (!['ACCEPT', 'REJECT'].includes(action)) {
      return res.status(400).json({ message: 'Hành động không hợp lệ (ACCEPT hoặc REJECT).' });
    }
    try {
      const profile = await prisma.supplierProfile.findUnique({ where: { userId: req.auth.user.id } });
      if (!profile) throw problem(404, 'Không tìm thấy hồ sơ chủ vựa.');
      const current = await prisma.wholesaleOrder.findFirst({ where: { id, supplierId: profile.id }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');

      let updatedTag = '';
      if (action === 'ACCEPT') {
        updatedTag = `[VỰA ĐÃ ĐỒNG Ý DỜI LỊCH GIAO]${note && note.trim() ? `: ${note.trim()}` : ''}`;
      } else {
        const rejectReason = note && note.trim().length >= 3 ? note.trim() : 'Vựa không thể dời giờ do xe đã kín tuyến hoặc hàng cần bảo quản';
        updatedTag = `[VỰA TỪ CHỐI DỜI LỊCH GIAO]: ${rejectReason}. Vui lòng sắp xếp người nhận hoặc liên hệ vựa.`;
      }

      const updatedNote = current.note ? `${current.note} | ${updatedTag}` : updatedTag;
      const updated = await prisma.wholesaleOrder.update({
        where: { id },
        data: { note: updatedNote },
        include,
      });
      res.json({ order: serialize(updated), message: action === 'ACCEPT' ? 'Đã chấp nhận dời lịch giao hàng.' : 'Đã phản hồi không thể dời lịch.' });
    } catch (error) { next(error); }
  });
  router.use((error, req, res, next) => error.status ? res.status(error.status).json({ message: error.message }) : next(error));
  return router;
}
module.exports = { createOrderRoutes };

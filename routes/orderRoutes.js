const express = require('express');
const { createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { requireRole } = require('../middlewares/authMiddleware');
const { normalizePhone } = require('../services/registrationValidation');
const { serializeOrder } = require('../services/supplierService');
const deliveryService = require('../services/deliveryService');
const deliveryFeeService = require('../services/deliveryFeeService');
const { syncOrderToStoreInventory, importBlockReason } = require('../services/inventorySyncService');
const { walletService, settleOrderToSupplier } = require('../services/walletService');
const { validateDeliveryTime, pendingRequest } = require('../services/reschedulePolicy');
const { orderQuery } = require('../services/orderQuery');
const { paymentDue, fullyPaidByWallet } = require('../services/orderPaymentPolicy');
const { payReceivedOrder } = require('../services/receivedOrderPayment');
const { visibleSupplierWhere, audit } = require('../services/platformPolicy');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const problem = (status, message) => Object.assign(new Error(message), { status });
const include = { buyer: true, items: true, sourceQuote: true, supplier: { include: { user: true } }, complaint: true, orderPayment: { include: { refund: { select: { id: true } } } } };
const serialize = order => ({
  ...serializeOrder(order),
  supplier: order.supplier ? {
    id: order.supplier.id,
    businessName: order.supplier.businessName,
    warehouseAddress: order.supplier.warehouseAddress || null,
    deliveryRadiusKm: order.supplier.deliveryRadiusKm ? Number(order.supplier.deliveryRadiusKm) : 10,
    phone: order.supplier.user?.phone || null,
    bankName: order.supplier.bankName || null,
    bankAccountNumber: order.supplier.bankAccountNumber || null,
    bankAccountHolder: order.supplier.bankAccountHolder || null,
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
    const requestHash = createHash('sha256').update(JSON.stringify({ recipientName, recipientPhone, deliveryAddress, note, expectedDeliveryFee, depositRate, lines: lines.map(({ productId, quantity, expectedUpdatedAt }) => ({ productId, quantity, expectedUpdatedAt })).sort((a, b) => a.productId - b.productId) })).digest('hex');
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
        const calculatedFee = deliveryFeeService.calculateFeeForOrder({
          buyerId,
          supplier,
          deliveryAddress,
        });

        const expectedFeeNum = Number(expectedDeliveryFee);
        let effectiveDeliveryFee;
        if (
          expectedFeeNum === 0 ||
          Math.abs(expectedFeeNum - calculatedFee.deliveryFee) <= 10000 ||
          expectedFeeNum === supplier.deliveryFee.toNumber() ||
          (supplier.deliveryFee.isZero() && expectedFeeNum === 25000)
        ) {
          effectiveDeliveryFee = new Prisma.Decimal(expectedFeeNum);
        } else {
          effectiveDeliveryFee = new Prisma.Decimal(calculatedFee.deliveryFee);
        }
        const snapshots = lines.map(line => {
          const product = products.find(product => product.id === line.productId);
          if (product.updatedAt.toISOString() !== new Date(line.expectedUpdatedAt).toISOString()) throw problem(409, 'Thông tin sản phẩm vừa thay đổi. Tải lại nguồn hàng trước khi đặt.');
          if (line.quantity < product.moq || line.quantity > product.stockQty) throw problem(409, `${product.name}: đặt ít nhất ${product.moq}, tối đa ${product.stockQty} × ${product.packaging}.`);
          return { productId: product.id, productName: product.name, packaging: product.packaging, quantity: line.quantity, unitPrice: product.wholesalePrice, lineTotal: product.wholesalePrice.mul(line.quantity) };
        });
        const rawSubtotal = snapshots.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0)).toNumber();
        const subtotalNum = Math.round(rawSubtotal / 1000) * 1000;
        const subtotal = new Prisma.Decimal(subtotalNum);

        const feeNum = Math.round(effectiveDeliveryFee.toNumber() / 1000) * 1000;
        const deliveryFee = new Prisma.Decimal(feeNum);

        const totalNum = subtotalNum + feeNum;
        const total = new Prisma.Decimal(totalNum);

        const rawDeposit = (totalNum * depositRate) / 100;
        const numDeposit = Math.round(rawDeposit / 1000) * 1000;
        const depositAmount = new Prisma.Decimal(numDeposit);
        let useWalletEscrow = false;
        if (numDeposit > 0) {
          const buyerWallet = await walletService.getWallet(buyerId);
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
            deliveryFee,
            total,
            depositRate,
            depositAmount,
            depositStatus: numDeposit > 0 ? (useWalletEscrow ? 'PAID' : 'PENDING') : 'NONE',
            depositReference: useWalletEscrow ? 'VI_HE_THONG' : null,
            depositPaidAt: useWalletEscrow ? new Date() : null,
            depositBankName: numDeposit > 0 ? supplier.bankName || null : null,
            depositBankAccountNumber: numDeposit > 0 ? supplier.bankAccountNumber || null : null,
            depositBankAccountHolder: numDeposit > 0 ? supplier.bankAccountHolder || null : null,
            items: { create: snapshots },
          },
          include,
        });
        if (useWalletEscrow) {
          await walletService.lockEscrow(buyerId, created.id, numDeposit, `Tạm khóa ${depositRate}% tiền cọc đơn hàng #${created.id} (Ví hệ thống)`, { tx });
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
      const buyerWallet = await walletService.getWallet(buyerId);
      if (buyerWallet.availableBalance < depositNum) {
        throw problem(400, `Số dư ví khả dụng không đủ (${buyerWallet.availableBalance.toLocaleString('vi-VN')} ₫). Cần ${depositNum.toLocaleString('vi-VN')} ₫ để cọc.`);
      }
      await walletService.lockEscrow(buyerId, id, depositNum, `Tạm khóa tiền cọc đơn hàng #${id} qua Ví hệ thống`);
      const updated = await prisma.wholesaleOrder.update({
        where: { id },
        data: {
          depositStatus: 'PAID',
          depositReference: 'VI_HE_THONG',
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
    if (process.env.NODE_ENV === 'production' && !req.auth.user.username.startsWith('demo_')) return res.status(403).json({ message: 'Thử nghiệm chỉ dành cho tài khoản demo.' });
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
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn không hợp lệ.' });
    try {
      const { rescheduleTime, reason = '' } = req.body || {};
      validateDeliveryTime(rescheduleTime);
      if (typeof reason !== 'string' || reason.trim().length > 250) throw problem(400, 'Lý do tối đa 250 ký tự.');
      const current = await prisma.wholesaleOrder.findFirst({ where: { id, buyerId: req.auth.user.id }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');
      if (!['PREPARING', 'SHIPPING'].includes(current.status)) throw problem(409, 'Chỉ đổi giờ trước khi nhận hàng.');
      if (pendingRequest(current, deliveryService.getDriverInfo(id))) throw problem(409, 'Đã có đề nghị đổi giờ đang chờ chủ vựa trả lời.');
      deliveryService.saveRescheduleRequest(id, { requestedTime: rescheduleTime, reason: reason.trim(), requestedAt: new Date().toISOString(), requestedBy: req.auth.user.id, status: 'PENDING' });
      await audit(prisma, req.auth.user.id, 'DELIVERY_TIME_REQUESTED', 'ORDER', id, { rescheduleTime });
      res.json({ order: serialize(current), message: 'Đã gửi giờ muốn nhận. Chờ chủ vựa xác nhận.' });
    } catch (error) { next(error); }
  });

  router.post('/:id/reschedule-response', requireRole('SUPPLIER'), async (req, res, next) => {
    const id = Number(req.params.id);
    const { action, note = '' } = req.body || {};
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || !['ACCEPT', 'REJECT'].includes(action) || typeof note !== 'string' || note.trim().length > 250) return res.status(400).json({ message: 'Kiểm tra đơn, lựa chọn và lời nhắn tối đa 250 ký tự.' });
    try {
      const profile = await prisma.supplierProfile.findUnique({ where: { userId: req.auth.user.id } });
      if (!profile) throw problem(404, 'Không tìm thấy hồ sơ chủ vựa.');
      const current = await prisma.wholesaleOrder.findFirst({ where: { id, supplierId: profile.id }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');
      if (!['PREPARING', 'SHIPPING'].includes(current.status)) throw problem(409, 'Đơn đã nhận hoặc kết thúc, không thể đổi giờ.');
      const request = pendingRequest(current, deliveryService.getDriverInfo(id));
      if (!request) throw problem(409, 'Không có đề nghị đổi giờ đang chờ trả lời.');
      if (action === 'ACCEPT') {
        validateDeliveryTime(request.requestedTime);
        deliveryService.updateEstimatedDeliveryTime(id, request.requestedTime);
      }
      deliveryService.saveRescheduleRequest(id, { ...request, status: action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', responseNote: note.trim(), respondedAt: new Date().toISOString(), respondedBy: req.auth.user.id });
      await audit(prisma, req.auth.user.id, 'DELIVERY_TIME_RESPONDED', 'ORDER', id, { action, requestedTime: request.requestedTime });
      res.json({ order: serialize(current), message: action === 'ACCEPT' ? 'Đã xác nhận giờ giao.' : 'Đã từ chối đổi giờ. Giữ lịch giao cũ.' });
    } catch (error) { next(error); }
  });

  router.post('/:id/cancel', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    try {
      const buyerId = req.auth.user.id;
      const current = await prisma.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');
      if (current.status !== 'PENDING') {
        throw problem(400, 'Chỉ có thể hủy đơn khi đơn hàng đang ở trạng thái chờ duyệt (PENDING).');
      }
      const rawReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const reason = rawReason.length >= 3 ? rawReason.slice(0, 255) : 'Cửa hàng tự hủy khi đơn chưa được duyệt.';

      const depositNum = Number(current.depositAmount || 0);
      if (current.depositStatus === 'PAID' && depositNum > 0) {
        await walletService.refundEscrow(buyerId, id, depositNum, `Hoàn cọc do tiệm hủy đơn #${id}: ${reason}`);
      }

      const updated = await prisma.wholesaleOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          depositStatus: current.depositStatus === 'PAID' ? 'REFUNDED' : 'CANCELLED',
          rejectReason: reason,
        },
        include,
      });

      await audit(prisma, buyerId, 'ORDER_CANCELLED_BY_STORE', 'ORDER', id, { reason });
      res.json({
        success: true,
        order: serialize(updated),
        message: depositNum > 0 && current.depositStatus === 'PAID'
          ? `Đã hủy đơn hàng #${id} và hoàn lại ${depositNum.toLocaleString('vi-VN')} ₫ tiền cọc về Ví khả dụng của bạn.`
          : `Đã hủy đơn hàng #${id}.`,
      });
    } catch (error) { next(error); }
  });

  router.post('/:id/approve', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    try {
      const buyerId = req.auth.user.id;
      const current = await prisma.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');
      if (!['PENDING', 'APPROVED'].includes(current.status)) {
        throw problem(400, 'Đơn hàng không ở trạng thái có thể duyệt.');
      }
      if (current.depositAmount.greaterThan(0) && current.depositStatus !== 'PAID') {
        throw problem(400, 'Vui lòng hoàn tất đặt cọc trước khi duyệt đơn.');
      }
      const updated = await prisma.wholesaleOrder.update({
        where: { id },
        data: { status: 'PREPARING' },
        include,
      });
      res.json({ success: true, order: serialize(updated), message: 'Đơn hàng đã được duyệt và chuyển sang Đang soạn đơn.' });
    } catch (error) { next(error); }
  });

  router.post('/:id/confirm-arrival', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    try {
      const buyerId = req.auth.user.id;
      const current = await prisma.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');
      if (current.status !== 'SHIPPING') {
        throw problem(400, 'Đơn hàng chưa ở trạng thái đang vận chuyển.');
      }
      const updated = await prisma.wholesaleOrder.update({
        where: { id },
        data: { status: 'ISSUE_HANDLING' },
        include,
      });
      res.json({ success: true, order: serialize(updated), message: 'Đã xác nhận hàng đã đến cửa hàng. Vui lòng kiểm hàng và tiếp nhận xử lý.' });
    } catch (error) { next(error); }
  });

  router.post('/:id/pay', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    const { method, amount } = req.body || {};
    if (!['COD', 'QR', 'WALLET'].includes(method)) {
      return res.status(400).json({ message: 'Phương thức thanh toán phải là COD, QR hoặc WALLET.' });
    }
    try {
      const buyerId = req.auth.user.id;
      if (method === 'WALLET') {
        const result = await payReceivedOrder(prisma, buyerId, id, amount, include);
        const payment = result.order.orderPayment;
        const paymentInfo = deliveryService.savePaymentInfo(id, { method: 'WALLET', amount: Number(payment.amount), status: 'CONFIRMED', storePaidAt: payment.paidAt?.toISOString() || new Date().toISOString() });
        return res.json({ success: true, paymentInfo, order: serialize(result.order), message: result.alreadyPaid ? 'Đơn này đã được trả bằng ví.' : 'Đã trừ tiền ví. Bạn có thể hoàn tất đơn.' });
      }
      const current = await prisma.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
      if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');

      if (fullyPaidByWallet(current)) throw problem(409, 'Đơn đã trả đủ bằng ví, không cần trả thêm.');
      if (current.complaint && ['OPEN', 'IN_REVIEW'].includes(current.complaint.status)) throw problem(409, 'Cần xử lý xong sự cố trước khi trả tiền.');
      const driverInfo = deliveryService.getDriverInfo(id);
      const previous = driverInfo?.paymentInfo;
      if (['PENDING_SUPPLIER_CONFIRM', 'CONFIRMED'].includes(previous?.status)) {
        if (previous.method !== method) throw problem(409, 'Đơn đã báo trả tiền bằng phương thức khác.');
        return res.json({ success: true, paymentInfo: previous, message: previous.status === 'CONFIRMED' ? 'Chủ vựa đã nhận tiền.' : 'Đã báo trả tiền. Chờ chủ vựa xác nhận.' });
      }
      if (!['ISSUE_HANDLING', 'DELIVERED'].includes(current.status)) throw problem(409, 'Chỉ báo trả tiền sau khi đã nhận hàng.');
      if (method === 'QR' && (!current.supplier.bankName || !current.supplier.bankAccountHolder || !/^\d{6,30}$/.test(current.supplier.bankAccountNumber || ''))) throw problem(409, 'Chủ vựa chưa có tài khoản nhận tiền hợp lệ.');
      const due = paymentDue(current, driverInfo);
      if (due <= 0) {
        const paymentInfo = deliveryService.savePaymentInfo(id, {
          method: method || 'COD',
          amount: 0,
          status: 'CONFIRMED',
          storePaidAt: new Date().toISOString(),
        });
        const updated = await prisma.wholesaleOrder.update({
          where: { id },
          data: { status: 'DELIVERED', deliveredAt: current.deliveredAt || new Date() },
          include,
        });
        return res.json({
          success: true,
          paymentInfo,
          order: serialize(updated),
          message: 'Đơn hàng 0đ (Giao bù) đã hoàn tất xác nhận thanh toán.',
        });
      }
      if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount - due) > 0.01)) throw problem(400, 'Số tiền đã thay đổi. Hãy tải lại đơn.');
      const paymentInfo = deliveryService.savePaymentInfo(id, {
        method,
        amount: due,
        status: 'PENDING_SUPPLIER_CONFIRM',
        storePaidAt: new Date().toISOString(),
      });

      res.json({
        success: true,
        paymentInfo,
        message: 'Đã gửi xác nhận thanh toán. Vui lòng đợi Chủ vựa xác nhận đã nhận đủ tiền.',
      });
    } catch (error) { next(error); }
  });

  router.post('/:id/complete', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id), buyerId = req.auth.user.id;
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn không hợp lệ.' });
    try {
      const updated = await prisma.$transaction(async tx => {
        const resource = 'SupplyMindOrderPayment:' + id;
        const lock = await tx.$queryRaw`DECLARE @result INT; EXEC @result = sys.sp_getapplock @Resource = ${resource}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000; SELECT @result AS code;`;
        if (lock[0].code < 0) throw problem(409, 'Đơn đang được xử lý. Hãy thử lại.');
        const current = await tx.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
        if (!current) throw problem(404, 'Không tìm thấy đơn hàng.');
        if (current.status === 'COMPLETED') return current;
        const driver = deliveryService.getDriverInfo(id); const due = paymentDue(current, driver);
        if (current.status !== 'DELIVERED') {
          if (current.status === 'ISSUE_HANDLING' && due <= 0) {
            // Cho phép hoàn tất trực tiếp đơn giao bù 0đ
          } else {
            throw problem(409, 'Nhận hàng và trả đủ tiền trước khi hoàn tất.');
          }
        }
        if (current.complaint && ['OPEN', 'IN_REVIEW'].includes(current.complaint.status)) throw problem(409, 'Cần xử lý xong sự cố trước khi hoàn tất đơn.');
        // driver already fetched above
        if (due > 0 && driver?.paymentInfo?.status !== 'CONFIRMED' && !fullyPaidByWallet(current, driver)) throw problem(409, 'Chủ vựa chưa xác nhận tiền thanh toán.');
        if (current.orderPayment?.refund) throw problem(409, 'Đơn đã hoàn tiền, không thể hoàn tất.');
        const saved = await tx.wholesaleOrder.update({ where: { id }, data: { status: 'COMPLETED', deliveredAt: current.deliveredAt || new Date(), commissionAmount: current.commissionRate === null ? null : current.subtotal.mul(current.commissionRate).div(100).toDecimalPlaces(2) }, include });
        await settleOrderToSupplier(tx, saved);
        if (current.depositStatus === 'PAID' && Number(current.depositAmount) > 0) {
          const gross = paymentDue({ ...current, depositStatus: 'NONE' }, driver);
          if (current.orderPayment && Number(current.orderPayment.amount) >= gross) {
            // Older wallet endpoints collected the full order even when a deposit was held.
            await walletService.refundEscrow(buyerId, id, Number(current.depositAmount), 'Hoàn cọc đã tính trong khoản thanh toán đủ', { tx });
          } else {
            await walletService.releaseEscrow(buyerId, current.supplier.userId, id, Number(current.depositAmount), Number(current.commissionRate || 0), { tx });
          }
        }
        await audit(tx, buyerId, 'ORDER_COMPLETED', 'ORDER', id, {});
        return tx.wholesaleOrder.findUniqueOrThrow({ where: { id }, include });
      }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
      res.json({ success: true, order: serialize(updated), message: 'Đã hoàn tất đơn.' });
    } catch (error) { next(error); }
  });
  router.post('/:id/import-inventory', requireRole('STORE_OWNER'), async (req, res, next) => {
    const id = Number(req.params.id), buyerId = req.auth.user.id;
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    try {
      const result = await prisma.$transaction(async tx => {
        const resource = 'SupplyMindOrderInventory:' + id;
        const locked = await tx.$queryRaw`DECLARE @result INT; EXEC @result = sys.sp_getapplock @Resource = ${resource}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000; SELECT @result AS code;`;
        if (locked[0].code < 0) throw problem(409, 'Đơn đang được nhập kho. Vui lòng thử lại.');
        const order = await tx.wholesaleOrder.findFirst({ where: { id, buyerId }, include });
        if (!order) throw problem(404, 'Không tìm thấy đơn hàng.');
        const reason = importBlockReason(order, deliveryService.getDriverInfo(id));
        if (reason) throw problem(409, reason);
        const receipt = await syncOrderToStoreInventory(tx, buyerId, order);
        if (!receipt.alreadyImported) await audit(tx, buyerId, 'ORDER_IMPORTED_TO_INVENTORY', 'ORDER', id, { count: receipt.count });
        const saved = await tx.wholesaleOrder.findUniqueOrThrow({ where: { id }, include });
        return { ...receipt, order: saved };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
      for (const update of result.supplierUpdates || []) {
        try {
          require('../services/inventorySupplierService').setSupplier(update.itemId, update.supplierName);
          const quote = result.order.sourceQuote;
          const consignment = quote && require('../services/consignmentService').getQuoteConsignment(quote.id);
          if (consignment?.isConsignment) require('../services/consignmentService').setItemConsignment(update.itemId, {
            ...consignment, supplierId: result.order.supplierId, supplierName: update.supplierName,
            supplierPhone: result.order.supplier.user?.phone || null,
          });
        }
        catch (error) { console.warn('Không lưu được tên NCC sau nhập kho:', error.message); }
      }
      const { supplierUpdates, ...receipt } = result;
      res.json({ success: true, ...receipt, order: serialize(result.order), message: result.alreadyImported ? 'Đơn này đã được thêm vào kho trước đó; không cộng lại số lượng.' : 'Đã thêm ' + result.count + ' mặt hàng vào kho. Hàng nhập được lưu thành lô riêng theo đơn.' });
    } catch (error) { next(error); }
  });
  router.use((error, req, res, next) => error.status || error.code === 'P2034' ? res.status(error.status || 409).json({ message: error.status ? error.message : 'Đơn hoặc số dư vừa thay đổi. Hãy tải lại và thử lại.' }) : next(error));
  return router;
}
module.exports = { createOrderRoutes };

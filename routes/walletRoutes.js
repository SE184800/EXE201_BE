const express = require('express');
const { requireRole } = require('../middlewares/authMiddleware');
const { ROLES } = require('../config/roles');
const { createWalletService } = require('../services/walletService');

function idParam(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

/**
 * Routes for the signed-in user (store owner or wholesale supplier).
 * Every handler resolves the acting user from the session, never from the body.
 */
function createWalletRoutes(prisma, requireAuth, config = {}) {
  const router = express.Router();
  const service = createWalletService(prisma, config.qrBank);

  router.use(requireAuth, requireRole(ROLES.STORE_OWNER, ROLES.SUPPLIER));

  const run = handler => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };

  router.get('/', run(async (req, res) => {
    res.json(await service.getWallet(req.auth.user.id));
  }));

  // Bank account that receives the VietQR deposits, so the UI can show the QR
  // details without hardcoding them on the frontend.
  router.get('/qr-config', run(async (req, res) => {
    res.json({
      enabled: Boolean(config.qrEnabled && config.qrBank),
      bankCode: config.qrBank?.code || '',
      bankName: config.qrBank?.name || '',
      accountNumber: config.qrBank?.accountNumber || '',
      accountHolder: config.qrBank?.accountHolder || '',
    });
  }));

  router.get('/transactions', run(async (req, res) => {
    res.json(await service.listTransactions(req.auth.user.id, req.query));
  }));

  router.get('/payments', run(async (req, res) => {
    res.json(await service.listOrderPayments(req.auth.user.id, req.query));
  }));

  router.post('/payments/:orderId', run(async (req, res) => {
    const orderId = idParam(req.params.orderId);
    if (!orderId) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    res.status(201).json({ payment: await service.payOrder(req.auth.user.id, orderId) });
  }));

  router.get('/deposits', run(async (req, res) => {
    res.json(await service.listDepositRequests(req.auth.user.id, req.query));
  }));

  router.post('/deposits', run(async (req, res) => {
    res.status(201).json({ request: await service.createDepositRequest(req.auth.user.id, req.body || {}) });
  }));

  // Sandbox deposit: simulated money, credited instantly without admin review.
  router.post('/deposits/sandbox', run(async (req, res) => {
    res.status(201).json({ request: await service.createSandboxDepositRequest(req.auth.user.id, req.body || {}) });
  }));

  // VietQR deposit: returns the QR payload for a freshly created ticket.
  router.post('/deposits/qr', run(async (req, res) => {
    if (!config.qrEnabled) {
      return res.status(503).json({ message: 'Tính năng nạp tiền qua QR chưa được bật.' });
    }
    res.status(201).json(await service.createQrDepositRequest(req.auth.user.id, req.body || {}));
  }));

  // Confirms the user already transferred the money for a QR ticket.
  router.post('/deposits/qr/:id/confirm', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã phiếu không hợp lệ.' });
    res.json({ request: await service.confirmQrDeposit(req.auth.user.id, id, req.body || {}) });
  }));

  router.get('/withdrawals', run(async (req, res) => {
    res.json(await service.listWithdrawalRequests(req.auth.user.id, req.query));
  }));

  router.post('/withdrawals', run(async (req, res) => {
    res.status(201).json({ request: await service.createWithdrawalRequest(req.auth.user.id, req.body || {}) });
  }));

  // Sandbox withdrawal: simulated money, paid out instantly without admin review.
  router.post('/withdrawals/sandbox', run(async (req, res) => {
    res.status(201).json({ request: await service.createSandboxWithdrawalRequest(req.auth.user.id, req.body || {}) });
  }));

  router.use((error, req, res, next) => {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2034') {
      return res.status(409).json({ message: 'Giao dịch đang được xử lý. Vui lòng tải lại và thử lại.' });
    }
    next(error);
  });

  return router;
}

/**
 * Admin routes to review deposit and withdrawal requests.
 * Every money movement is guarded by a status check so it can happen once.
 */
function createAdminWalletRoutes(prisma, requireAuth) {
  const router = express.Router();
  const service = createWalletService(prisma);

  router.use(requireAuth, requireRole(ROLES.ADMIN));

  const run = handler => async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };

  router.get('/deposits', run(async (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (!Number.isInteger(page) || page < 1 || page > 100000) {
      return res.status(400).json({ message: 'Trang không hợp lệ.' });
    }
    if (status && !['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái yêu cầu nạp tiền không hợp lệ.' });
    }
    const where = status ? { status } : {};
    const [rows, total] = await Promise.all([
      prisma.depositRequest.findMany({
        where,
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.depositRequest.count({ where }),
    ]);
    res.json({
      requests: rows.map(row => require('../services/walletService').serializeDeposit(row)),
      total,
      page,
      hasMore: page * 20 < total,
    });
  }));

  router.get('/deposits/:id', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã yêu cầu không hợp lệ.' });
    const row = await prisma.depositRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, username: true } } },
    });
    if (!row) return res.status(404).json({ message: 'Không tìm thấy yêu cầu nạp tiền.' });
    res.json({ request: require('../services/walletService').serializeDeposit(row) });
  }));

  router.post('/deposits/:id/approve', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã yêu cầu không hợp lệ.' });
    res.json({ request: await service.approveDeposit(req.auth.user.id, id, req.body || {}) });
  }));

  router.post('/deposits/:id/reject', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã yêu cầu không hợp lệ.' });
    res.json({ request: await service.rejectDeposit(req.auth.user.id, id, req.body || {}) });
  }));

  router.get('/withdrawals', run(async (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (!Number.isInteger(page) || page < 1 || page > 100000) {
      return res.status(400).json({ message: 'Trang không hợp lệ.' });
    }
    if (status && !['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'FAILED'].includes(status)) {
      return res.status(400).json({ message: 'Trạng thái yêu cầu rút tiền không hợp lệ.' });
    }
    const where = status ? { status } : {};
    const [rows, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where,
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.withdrawalRequest.count({ where }),
    ]);
    res.json({
      requests: rows.map(row => require('../services/walletService').serializeWithdrawal(row)),
      total,
      page,
      hasMore: page * 20 < total,
    });
  }));

  router.get('/withdrawals/:id', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã yêu cầu không hợp lệ.' });
    const row = await prisma.withdrawalRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, username: true } } },
    });
    if (!row) return res.status(404).json({ message: 'Không tìm thấy yêu cầu rút tiền.' });
    res.json({ request: require('../services/walletService').serializeWithdrawal(row) });
  }));

  router.post('/withdrawals/:id/approve', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã yêu cầu không hợp lệ.' });
    res.json({ request: await service.approveWithdrawal(req.auth.user.id, id, req.body || {}) });
  }));

  router.post('/withdrawals/:id/reject', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã yêu cầu không hợp lệ.' });
    res.json({ request: await service.rejectWithdrawal(req.auth.user.id, id, req.body || {}) });
  }));

  router.post('/withdrawals/:id/complete', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã yêu cầu không hợp lệ.' });
    res.json({ request: await service.completeWithdrawal(req.auth.user.id, id, req.body || {}) });
  }));

  router.post('/withdrawals/:id/fail', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã yêu cầu không hợp lệ.' });
    res.json({ request: await service.failWithdrawal(req.auth.user.id, id, req.body || {}) });
  }));

  router.get('/payments', run(async (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isInteger(page) || page < 1 || page > 100000) {
      return res.status(400).json({ message: 'Trang không hợp lệ.' });
    }
    const [rows, total] = await Promise.all([
      prisma.orderPayment.findMany({
        include: {
          buyer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          refund: { select: { id: true, status: true, amount: true, reason: true } },
        },
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      prisma.orderPayment.count(),
    ]);
    res.json({
      payments: rows.map(row => require('../services/walletService').serializeOrderPayment(row)),
      total,
      page,
      hasMore: page * 20 < total,
    });
  }));

  router.post('/orders/:id/refund', run(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ.' });
    res.json({ refund: await service.refundOrder(req.auth.user.id, id, req.body || {}) });
  }));

  router.use((error, req, res, next) => {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2034') {
      return res.status(409).json({ message: 'Giao dịch đang được xử lý. Vui lòng tải lại và thử lại.' });
    }
    next(error);
  });

  return router;
}

module.exports = { createWalletRoutes, createAdminWalletRoutes };

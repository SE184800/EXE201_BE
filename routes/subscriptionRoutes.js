const express = require('express');
const { createSubscriptionService } = require('../services/subscriptionService');

function createSubscriptionRoutes(prisma, requireAuth, authService) {
  const router = express.Router();
  const service = createSubscriptionService(prisma);
  router.post('/top-up-public', async (req, res, next) => {
    try {
      const userId = authService.verifyRenewalToken(req.body?.renewalToken);
      if (!userId) return res.status(401).json({ message: 'Phiên thanh toán đã hết hạn. Vui lòng nhập lại mật khẩu.' });
      res.json({ subscription: await service.topUpByUserId(userId, req.body?.requestId) });
    } catch (error) { next(error); }
  });
  router.post('/renew-public', async (req, res, next) => {
    try {
      const userId = authService.verifyRenewalToken(req.body?.renewalToken);
      if (!userId) return res.status(401).json({ message: 'Phiên thanh toán đã hết hạn. Vui lòng nhập lại mật khẩu.' });
      if (req.body?.paymentSource !== 'WALLET') return res.status(409).json({ message: 'Thanh toán gói đã chuyển sang số dư ví. Vui lòng tải lại ứng dụng để xác nhận trước khi mua.' });
      res.json({ subscription: await service.renewByUserId(userId, req.body?.requestId) });
    } catch (error) { next(error); }
  });
  router.use(requireAuth);
  router.get('/', async (req, res, next) => {
    try { res.json({ subscription: await service.get(req.auth.user) }); }
    catch (error) { next(error); }
  });
  router.post('/renew', async (req, res, next) => {
    if (req.body?.paymentSource !== 'WALLET') return res.status(409).json({ message: 'Thanh toán gói đã chuyển sang số dư ví. Vui lòng tải lại ứng dụng để xác nhận trước khi mua.' });
    try { res.json({ subscription: await service.renew(req.auth.user, req.body?.requestId) }); }
    catch (error) { next(error); }
  });
  router.use((error, req, res, next) => {
    if (error.status) return res.status(error.status).json({
      message: error.message,
      ...(error.code === 'INSUFFICIENT_WALLET_BALANCE' ? {
        code: error.code, walletBalance: error.walletBalance, requiredAmount: error.requiredAmount,
      } : {}),
    });
    if (['P2034', 'P2002'].includes(error.code)) return res.status(409).json({ message: 'Giao dịch đang được cập nhật. Vui lòng thử lại để kiểm tra kết quả.' });
    next(error);
  });
  return router;
}

module.exports = { createSubscriptionRoutes };

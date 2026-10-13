const express = require('express');
const { createSubscriptionService } = require('../services/subscriptionService');

function createSubscriptionRoutes(prisma, requireAuth, authService) {
  const router = express.Router();
  const service = createSubscriptionService(prisma);
  router.post('/renew-public', async (req, res, next) => {
    try {
      const userId = authService.verifyRenewalToken(req.body?.renewalToken);
      if (!userId) return res.status(401).json({ message: 'Phiên thanh toán đã hết hạn. Vui lòng nhập lại mật khẩu.' });
      res.json({ subscription: await service.renewByUserId(userId, req.body?.requestId) });
    } catch (error) { next(error); }
  });
  router.use(requireAuth);
  router.get('/', async (req, res, next) => {
    try { res.json({ subscription: await service.get(req.auth.user) }); }
    catch (error) { next(error); }
  });
  router.post('/renew', async (req, res, next) => {
    try { res.json({ subscription: await service.renew(req.auth.user, req.body?.requestId) }); }
    catch (error) { next(error); }
  });
  router.use((error, req, res, next) => {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2034') return res.status(409).json({ message: 'Gói sử dụng đang được cập nhật. Vui lòng thử lại.' });
    next(error);
  });
  return router;
}

module.exports = { createSubscriptionRoutes };

const { createSubscriptionService } = require('../services/subscriptionService');

function createSubscriptionGate(prisma) {
  const service = createSubscriptionService(prisma);
  return async (req, res, next) => {
    try {
      const result = await service.access(req.auth.user);
      if (!result.hasAccess) {
        await prisma.authSession.deleteMany({ where: { userId: req.auth.user.id } });
        return res.status(402).json({
          success: false,
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'Tháng dùng thử đã hết. Gia hạn gói SupplyMind 19.000đ/tháng để tiếp tục sử dụng.',
          subscription: result.subscription,
        });
      }
      req.subscription = result.subscription;
      next();
    } catch (error) { next(error); }
  };
}

module.exports = { createSubscriptionGate };

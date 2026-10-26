const express = require('express');
const { walletService } = require('../services/walletService');

function createWalletRoutes(prisma, requireAuth) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/me', (req, res, next) => {
    try {
      const wallet = walletService.getWallet(req.auth.user.id);
      res.json({ success: true, wallet });
    } catch (error) {
      next(error);
    }
  });

  router.get('/transactions', (req, res, next) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const result = walletService.getTransactions(req.auth.user.id, { page, limit });
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/mock-add', (req, res, next) => {
    try {
      const amount = req.body?.amount !== undefined ? Number(req.body.amount) : 5000000;
      if (amount <= 0 || amount > 100000000) {
        return res.status(400).json({ success: false, message: 'Số tiền nạp thử nghiệm từ 1.000 đến 100.000.000 ₫.' });
      }
      const wallet = walletService.addMockFunds(req.auth.user.id, amount);
      res.json({
        success: true,
        message: `Đã cộng thêm ${amount.toLocaleString('vi-VN')} ₫ số dư thử nghiệm thành công.`,
        wallet,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/mock-reset', (req, res, next) => {
    try {
      const wallet = walletService.resetMockBalance(req.auth.user.id);
      res.json({
        success: true,
        message: 'Đã đặt lại số dư thử nghiệm về 10.000.000 ₫.',
        wallet,
      });
    } catch (error) {
      next(error);
    }
  });

  router.use((error, req, res, next) => {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    next(error);
  });

  return router;
}

module.exports = { createWalletRoutes };

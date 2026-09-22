const express = require('express');
const { requireRole } = require('../middlewares/authMiddleware');
const { createAdminService, idParam } = require('../services/adminService');
function createAdminRoutes(prisma, requireAuth, config) {
  const router = express.Router(), service = createAdminService(prisma, config);
  router.use(requireAuth, requireRole('ADMIN'));
  const run = handler => async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };
  router.get('/users', run(async (req, res) => res.json(await service.listUsers(req.query))));
  router.patch('/users/:id/status', run(async (req, res) => res.json({ user: await service.changeAccount(req.auth.user.id, idParam(req.params.id), req.body || {}) })));
  router.get('/verifications', run(async (req, res) => res.json(await service.verifications(req.query))));
  router.patch('/verifications/:id', run(async (req, res) => res.json(await service.review(req.auth.user.id, idParam(req.params.id), req.body || {}))));
  router.get('/settings', run(async (req, res) => res.json(await service.settings())));
  router.put('/settings', run(async (req, res) => res.json(await service.changeRate(req.auth.user.id, req.body || {}))));
  router.get('/settlements', run(async (req, res) => res.json(await service.settlements(req.query))));
  router.get('/settlements/export', run(async (req, res) => {
    const report = await service.settlements(req.query, true);
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="supplymind-commission-${report.from}-${report.to}.csv"`).send(report.csv);
  }));
  router.post('/settlements/:id/receive', run(async (req, res) => res.json({ order: await service.markPaid(req.auth.user.id, idParam(req.params.id), req.body || {}) })));
  router.get('/analytics', run(async (req, res) => res.json(await service.analytics(req.query))));
  router.get('/ai', run(async (req, res) => res.json(await service.aiMetrics(req.query))));
  router.get('/audit-logs', run(async (req, res) => res.json(await service.logs(req.query))));
  router.use((error, req, res, next) => {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2034') return res.status(409).json({ message: 'Dữ liệu đang được xử lý đồng thời. Tải lại và thử lại.' });
    next(error);
  });
  return router;
}
module.exports = { createAdminRoutes };

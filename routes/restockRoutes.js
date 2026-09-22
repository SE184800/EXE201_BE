const express = require('express');
const { createHash } = require('node:crypto');
const { requireRole } = require('../middlewares/authMiddleware');
const { getForecast } = require('../services/restockForecast');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDays = (h, s) => [7, 14, 30].includes(h) && Number.isInteger(s) && s >= 0 && s <= 7;
function createRestockRoutes(prisma, requireAuth) {
  const router = express.Router();
  router.use(requireAuth, requireRole('STORE_OWNER'));
  router.get('/forecast', async (req, res, next) => {
    const h = Number(req.query.horizonDays || 7), s = Number(req.query.safetyDays ?? 2);
    if (!validDays(h, s)) return res.status(400).json({ message: 'Chọn kỳ 7, 14 hoặc 30 ngày; dự phòng 0–7 ngày.' });
    try { res.json(await getForecast(prisma, req.auth.user.id, h, s)); } catch (error) { next(error); }
  });
  router.get('/plans', async (req, res, next) => {
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 100000) return res.status(400).json({ message: 'Trang không hợp lệ.' });
    try {
      const plans = await prisma.restockPlan.findMany({ where: { ownerId: req.auth.user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 10, take: 11, include: { lines: true } });
      res.json({ plans: plans.slice(0, 10), hasMore: plans.length > 10 });
    } catch (error) { next(error); }
  });
  async function save(req, res, next) {
    const body = req.body || {};
    const { horizonDays, safetyDays, lines } = body;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const id = req.method === 'POST' ? body.requestId : req.params.id;
    if (!uuid.test(String(id)) || !name || name.length > 100 || note.length > 500 || !validDays(horizonDays, safetyDays) || !Array.isArray(lines) || !lines.length || lines.length > 100 || lines.some((line) => !line || !Number.isInteger(line.itemId) || line.itemId < 1 || line.itemId > 2147483647 || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 2147483647) || new Set(lines.map((line) => line.itemId)).size !== lines.length) return res.status(400).json({ message: 'Nhập tên kế hoạch, chọn 1–100 mặt hàng khác nhau với số lượng nguyên dương hợp lệ.' });
    const ownerId = req.auth.user.id;
    const hash = createHash('sha256').update(JSON.stringify({ name, note, horizonDays, safetyDays, lines: lines.map(({ itemId, quantity }) => ({ itemId, quantity })).sort((a,b) => a.itemId-b.itemId) })).digest('hex');
    try {
      if (req.method === 'POST') {
        const existing = await prisma.restockPlan.findUnique({ where: { id }, include: { lines: true } });
        if (existing) return existing.ownerId === ownerId && existing.requestHash === hash ? res.json({ plan: existing }) : res.status(409).json({ message: 'Mã kế hoạch đã được dùng; hãy tạo kế hoạch mới.' });
      } else if (!body.expectedUpdatedAt || Number.isNaN(Date.parse(body.expectedUpdatedAt))) return res.status(400).json({ message: 'Tải lại kế hoạch trước khi sửa.' });
      const forecast = await getForecast(prisma, ownerId, horizonDays, safetyDays);
      const byId = new Map(forecast.items.map((item) => [item.itemId, item]));
      if (lines.some((line) => !byId.has(line.itemId))) return res.status(404).json({ message: 'Một mặt hàng không còn thuộc kho của bạn. Tải lại danh sách.' });
      const snapshots = lines.map((line) => {
        const item = byId.get(line.itemId);
        return { purchasePrice: item.purchasePrice, sourceItemId: item.itemId, productName: item.name, unit: item.unit, quantity: line.quantity, stockSnapshot: item.quantity, suggestedQuantity: item.suggestedQuantity, averageDailySales: item.averageDailySales, observedDays: item.observedDays };
      });
      const data = { name, note, horizonDays, safetyDays, requestHash: hash };
      const plan = await prisma.$transaction(async (tx) => {
        if (req.method === 'POST') return tx.restockPlan.create({ data: { id, ownerId, ...data, lines: { create: snapshots } }, include: { lines: true } });
        const updated = await tx.restockPlan.updateMany({ where: { id, ownerId, updatedAt: new Date(body.expectedUpdatedAt) }, data });
        if (!updated.count) throw Object.assign(new Error('Kế hoạch không tồn tại hoặc đã thay đổi. Tải lại trước khi sửa.'), { status: 409 });
        await tx.restockPlanLine.deleteMany({ where: { planId: id } });
        await tx.restockPlanLine.createMany({ data: snapshots.map((line) => ({ ...line, planId: id })) });
        return tx.restockPlan.findUnique({ where: { id }, include: { lines: true } });
      });
      res.status(req.method === 'POST' ? 201 : 200).json({ plan });
    } catch (error) {
      if (error.code === 'P2002' && req.method === 'POST') {
        try {
          const existing = await prisma.restockPlan.findUnique({ where: { id }, include: { lines: true } });
          if (existing?.ownerId === ownerId && existing.requestHash === hash) return res.json({ plan: existing });
        } catch (lookupError) { return next(lookupError); }
      }
      if (error.status || error.code === 'P2034') return res.status(error.status || 409).json({ message: error.status ? error.message : 'Kế hoạch đang thay đổi. Vui lòng thử lại.' });
      next(error);
    }
  }
  router.post('/plans', save);
  router.put('/plans/:id', save);
  return router;
}
module.exports = { createRestockRoutes };


const express = require('express');
const { requireRole } = require('../middlewares/authMiddleware');
const { ROLES } = require('../config/roles');
const { answerInventory } = require('../services/inventoryChat');
const { expiryInfo } = require('../services/inventoryExpiry');
const { createStockService } = require('../services/stockService');
const { createStoreRevenueService } = require('../services/storeRevenueService');

function validateItem(body) {
  if (!body || typeof body !== 'object') return null;
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
  if (!name || name.length > 100 || !unit || unit.length > 20 ||
    ![body.quantity, ...(body.lowThreshold === undefined ? [] : [body.lowThreshold])].every((value) => Number.isInteger(value) && value >= 0 && value <= 2147483647)) return null;
  const data = { name, unit, quantity: body.quantity };
  for (const key of ['purchasePrice', 'sellingPrice']) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && (!Number.isInteger(body[key]) || body[key] < 0 || body[key] > 2147483647)) return null;
    data[key] = body[key];
  }
  if (body.lowThreshold !== undefined) data.lowThreshold = body.lowThreshold;
  // Missing field preserves the existing date for older clients; empty clears it.
  if (body.expiryDate !== undefined) {
    if (body.expiryDate === null || body.expiryDate === '') data.expiryDate = null;
    else {
      if (typeof body.expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.expiryDate) || body.expiryDate < '0001-01-01') return null;
      const date = new Date(`${body.expiryDate}T00:00:00.000Z`);
      if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== body.expiryDate) return null;
      data.expiryDate = date;
    }
  }
  return data;
}

function createInventoryRoutes(prisma, requireAuth) {
  const router = express.Router();
  const stock = createStockService(prisma);
  const revenue = createStoreRevenueService(prisma);
  router.use(requireAuth, requireRole(ROLES.STORE_OWNER));
  router.get('/revenue', async (req, res, next) => {
    try { res.json(await revenue.report(req.auth.user.id, req.query)); }
    catch (error) { if (error.status) return res.status(error.status).json({ message: error.message }); next(error); }
  });
  router.get('/history', async (req, res, next) => {
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 100000) return res.status(400).json({ message: 'Trang không hợp lệ.' });
    const { itemId, type, from, to } = req.query;
    const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if ((itemId !== undefined && (typeof itemId !== 'string' || !/^\d+$/.test(itemId) || Number(itemId) < 1 || Number(itemId) > 2147483647)) ||
      (type !== undefined && !['OPENING', 'SALE', 'RECEIPT', 'ADJUSTMENT'].includes(type)) ||
      (from !== undefined && !validDate(from)) || (to !== undefined && !validDate(to)) || (from && to && from > to)) return res.status(400).json({ message: 'Bộ lọc lịch sử hoặc khoảng ngày không hợp lệ.' });
    const where = { item: { ownerId: req.auth.user.id }, ...(itemId ? { itemId: Number(itemId) } : {}), ...(type ? { type } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00+07:00`) } : {}), ...(to ? { lt: new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400000) } : {}) } } : {}) };
    try {
      const rows = await prisma.stockMovement.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 });
      res.json({ movements: rows.slice(0, 20), hasMore: rows.length > 20 });
    } catch (error) { next(error); }
  });
  router.post('/:id/movements', async (req, res, next) => {
    const id = Number(req.params.id);
    const { type, quantity, requestId, note = '' } = req.body || {};
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || !['SALE', 'RECEIPT'].includes(type) || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647 || typeof note !== 'string' || note.length > 250 || typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return res.status(400).json({ message: 'Chọn nhập/bán hàng, số lượng nguyên dương và ghi chú tối đa 250 ký tự.' });
    const unitSalePrice = req.body.unitSalePrice;
    if (unitSalePrice !== undefined && (type !== 'SALE' || !Number.isInteger(unitSalePrice) || unitSalePrice < 0 || unitSalePrice > 2147483647)) return res.status(400).json({ message: 'Giá bán phải là số nguyên từ 0 đến 2.147.483.647 VNĐ và chỉ áp dụng khi bán hàng.' });
    try { res.json({ movement: await stock.move(req.auth.user.id, id, { type, quantity, requestId, note: note.trim(), unitSalePrice, allowExpiredSale: req.body.allowExpiredSale === true }) }); }
    catch (error) { if (error.status) return res.status(error.status).json({ message: error.message }); next(error); }
  });
  const list = (ownerId) => prisma.inventoryItem.findMany({ where: { ownerId }, orderBy: { name: 'asc' } });
  router.get('/', async (req, res, next) => {
    try { res.json({ items: (await list(req.auth.user.id)).map((item) => ({ ...item, ...expiryInfo(item.expiryDate) })) }); } catch (error) { next(error); }
  });
  router.post('/chat', async (req, res, next) => {
    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > 300) return res.status(400).json({ message: 'Câu hỏi cần từ 1 đến 300 ký tự.' });
    try {
      res.json({ ...answerInventory(message, await list(req.auth.user.id)), checkedAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });
  async function save(req, res, next) {
    const data = validateItem(req.body);
    if (!data) return res.status(400).json({ message: 'Kiểm tra tên hàng, đơn vị, số lượng và giá tiền nguyên không âm (tối đa 2.147.483.647), hạn dùng hợp lệ (YYYY-MM-DD).' });
    const ownerId = req.auth.user.id;
    try {
      if (req.method === 'POST') {
        const item = await stock.create(ownerId, data);
        return res.status(201).json({ item });
      }
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return res.status(400).json({ message: 'Mã sản phẩm không hợp lệ.' });
      return res.json(await stock.edit(ownerId, id, data, req.body.expectedUpdatedAt));
    } catch (error) {
      if (error.status) return res.status(error.status).json({ message: error.message });
      if (error.code === 'P2034') return res.status(409).json({ message: 'Kho đang thay đổi. Hãy tải lại và thử lại.' });
      if (error.code === 'P2002') return res.status(409).json({ message: 'Tên sản phẩm đã có trong kho của bạn. Hãy dùng tên phân biệt quy cách.' });
      next(error);
    }
  }
  router.post('/', save);
  router.put('/:id', save);
  return router;
}
module.exports = { createInventoryRoutes, validateItem };

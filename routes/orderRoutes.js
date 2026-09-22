const express = require('express');
const { createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { requireRole } = require('../middlewares/authMiddleware');
const { normalizePhone } = require('../services/registrationValidation');
const { serializeOrder } = require('../services/supplierService');
const { orderQuery } = require('../services/orderQuery');
const { visibleSupplierWhere, audit } = require('../services/platformPolicy');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const problem = (status, message) => Object.assign(new Error(message), { status });
const include = { buyer: true, items: true, supplier: true };
const serialize = order => ({ ...serializeOrder(order), supplier: { id: order.supplier.id, businessName: order.supplier.businessName } });

function createOrderRoutes(prisma, requireAuth) {
  const router = express.Router();
  router.use(requireAuth, requireRole('STORE_OWNER'));
  router.get('/', async (req, res, next) => {
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
  router.post('/', async (req, res, next) => {
    const body = req.body || {};
    const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim() : '';
    const recipientPhone = normalizePhone(body.recipientPhone);
    const deliveryAddress = typeof body.deliveryAddress === 'string' ? body.deliveryAddress.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const { requestId, lines, expectedDeliveryFee } = body;
    if (typeof requestId !== 'string' || !uuid.test(requestId) || recipientName.length < 2 || recipientName.length > 100 || !/^0\d{9}$/.test(recipientPhone) || deliveryAddress.length < 10 || deliveryAddress.length > 500 || note.length > 500 ||
      typeof expectedDeliveryFee !== 'number' || !Number.isFinite(expectedDeliveryFee) || expectedDeliveryFee < 0 || expectedDeliveryFee > 1000000000 ||
      !Array.isArray(lines) || lines.length < 1 || lines.length > 100 || lines.some(line => !line || !Number.isInteger(line.productId) || line.productId < 1 || line.productId > 2147483647 || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 2147483647 || typeof line.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(line.expectedUpdatedAt))) || new Set(lines.map(line => line.productId)).size !== lines.length)
      return res.status(400).json({ message: 'Kiểm tra người nhận, số điện thoại, địa chỉ (10–500 ký tự) và 1–100 mặt hàng với số lượng nguyên dương.' });
    const buyerId = req.auth.user.id;
    const requestHash = createHash('sha256').update(JSON.stringify({ recipientName, recipientPhone, deliveryAddress, note, expectedDeliveryFee, lines: lines.map(({ productId, quantity, expectedUpdatedAt }) => ({ productId, quantity, expectedUpdatedAt })).sort((a,b) => a.productId-b.productId) })).digest('hex');
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
        if (total.greaterThan('1000000000000')) throw problem(400, 'Giá trị đơn vượt giới hạn 1.000 tỷ đồng. Vui lòng chia thành đơn nhỏ hơn.');
        const settings = await tx.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
        const created = await tx.wholesaleOrder.create({ data: { requestId, requestHash, buyerId, supplierId: supplier.id, supplierRegion: supplier.region, commissionRate: settings.commissionRate, recipientName, recipientPhone, deliveryAddress, note: note || null, status: 'PENDING', subtotal, deliveryFee: supplier.deliveryFee, total, items: { create: snapshots } }, include });
        await audit(tx, buyerId, 'ORDER_CREATED', 'ORDER', created.id, { supplierId: supplier.id, subtotal: subtotal.toString(), commissionRate: settings.commissionRate.toString() });
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
  router.use((error, req, res, next) => error.status ? res.status(error.status).json({ message: error.message }) : next(error));
  return router;
}
module.exports = { createOrderRoutes };

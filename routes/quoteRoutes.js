const express = require('express');
const { createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { requireRole } = require('../middlewares/authMiddleware');
const { normalizePhone } = require('../services/registrationValidation');
const { serializeOrder } = require('../services/supplierService');
const { activeAccountWhere, accountAvailable, audit } = require('../services/platformPolicy');

const DAY = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const problem = (status, message) => Object.assign(new Error(message), { status });
const number = value => Number(value || 0);
const idParam = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647 ? Number(value) : null;
const hasTwoDecimals = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const vnDate = date => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);

function quoteStatus(quote) {
  return quote.status === 'SENT' && quote.validUntil.toISOString().slice(0, 10) < vnDate(new Date())
    ? 'EXPIRED'
    : quote.status;
}

function serializeQuote(quote) {
  return {
    id: quote.id,
    title: quote.title,
    status: quoteStatus(quote),
    validUntil: quote.validUntil.toISOString().slice(0, 10),
    subtotal: number(quote.subtotal),
    deliveryFee: number(quote.deliveryFee),
    total: number(quote.total),
    depositRate: number(quote.depositRate),
    depositAmount: Number(quote.total.mul(quote.depositRate).div(100).toDecimalPlaces(2)),
    note: quote.note,
    responseNote: quote.responseNote,
    respondedAt: quote.respondedAt,
    orderId: quote.orderId,
    version: quote.version,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
    supplier: quote.supplier ? {
      id: quote.supplier.id,
      businessName: quote.supplier.businessName,
      phone: quote.supplier.user?.phone || null,
      bankName: quote.supplier.bankName || null,
      bankAccountNumber: quote.supplier.bankAccountNumber || null,
      bankAccountHolder: quote.supplier.bankAccountHolder || null,
    } : undefined,
    buyer: quote.buyer ? {
      id: quote.buyer.id,
      name: quote.buyer.name,
      username: quote.buyer.username,
      phone: quote.buyer.phone,
    } : undefined,
    lines: quote.lines.map(line => ({
      id: line.id,
      productId: line.productId,
      productName: line.productName,
      packaging: line.packaging,
      quantity: line.quantity,
      unitPrice: number(line.unitPrice),
      lineTotal: number(line.lineTotal),
    })),
  };
}

const quoteInclude = {
  lines: true,
  buyer: { select: { id: true, name: true, username: true, phone: true } },
  supplier: { include: { user: { select: { phone: true } } } },
};

function createSupplierQuoteRoutes(prisma, requireAuth) {
  const router = express.Router();
  router.use(requireAuth, requireRole('SUPPLIER'));

  router.get('/prospects', async (req, res, next) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length > 100) return res.status(400).json({ message: 'Từ khóa tìm cửa hàng quá dài.' });
    try {
      const stores = await prisma.user.findMany({
        where: {
          role: { code: 'STORE_OWNER' },
          ...activeAccountWhere(),
          ...(q ? { OR: [{ name: { contains: q } }, { username: { contains: q } }, { phone: { contains: q } }] } : {}),
        },
        select: { id: true, name: true, username: true, phone: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 20,
      });
      res.json({ stores });
    } catch (error) { next(error); }
  });

  router.get('/', async (req, res, next) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !['', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED'].includes(status)) return res.status(400).json({ message: 'Bộ lọc báo giá không hợp lệ.' });
    try {
      const profile = await prisma.supplierProfile.findUnique({ where: { userId: req.auth.user.id } });
      if (!profile) return res.json({ quotes: [], total: 0, page, hasMore: false });
      const where = { supplierId: profile.id, ...(status ? { status } : {}) };
      const [rows, total] = await Promise.all([
        prisma.supplierQuote.findMany({ where, include: quoteInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 }),
        prisma.supplierQuote.count({ where }),
      ]);
      res.json({ quotes: rows.slice(0, 20).map(serializeQuote), total, page, hasMore: rows.length > 20 });
    } catch (error) { next(error); }
  });

  router.post('/', async (req, res, next) => {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const { buyerId, validUntil, deliveryFee, depositRate, lines } = body;
    const today = vnDate(new Date());
    if (!Number.isInteger(buyerId) || buyerId < 1 || buyerId > 2147483647 || title.length < 2 || title.length > 150 ||
      !dateOnly(validUntil) || validUntil < today || new Date(validUntil) - new Date(today) > 90 * DAY ||
      !hasTwoDecimals(deliveryFee) || deliveryFee < 0 || deliveryFee > 1000000000 ||
      !hasTwoDecimals(depositRate) || depositRate < 0 || depositRate > 100 || note.length > 500 ||
      !Array.isArray(lines) || lines.length < 1 || lines.length > 50 ||
      lines.some(line => !line || !Number.isInteger(line.productId) || line.productId < 1 || line.productId > 2147483647 ||
        !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 2147483647 ||
        !hasTwoDecimals(line.unitPrice) || line.unitPrice < 0.01 || line.unitPrice > 1000000000 ||
        typeof line.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(line.expectedUpdatedAt))) ||
      new Set(lines.map(line => line.productId)).size !== lines.length) {
      return res.status(400).json({ message: 'Kiểm tra cửa hàng, hạn báo giá, phí giao, tỷ lệ cọc và 1–50 mặt hàng.' });
    }
    try {
      const quote = await prisma.$transaction(async tx => {
        const [profile, buyer, products] = await Promise.all([
          tx.supplierProfile.findUnique({ where: { userId: req.auth.user.id } }),
          tx.user.findFirst({ where: { id: buyerId, role: { code: 'STORE_OWNER' }, ...activeAccountWhere() } }),
          tx.supplierProduct.findMany({ where: { id: { in: lines.map(line => line.productId) }, isActive: true } }),
        ]);
        if (!profile || profile.verificationStatus !== 'APPROVED') throw problem(403, 'Gian hàng cần được xác minh trước khi gửi báo giá.');
        if (depositRate > 0 && (!profile.bankName || !profile.bankAccountNumber || !profile.bankAccountHolder)) {
          throw problem(409, 'Hãy cấu hình đầy đủ ngân hàng, số tài khoản và chủ tài khoản trước khi gửi báo giá có cọc.');
        }
        if (!buyer) throw problem(404, 'Không tìm thấy cửa hàng đang hoạt động.');
        if (products.length !== lines.length || products.some(product => product.supplierId !== profile.id)) throw problem(409, 'Có sản phẩm không thuộc gian hàng hoặc đã ngừng bán.');
        const snapshots = lines.map(line => {
          const product = products.find(item => item.id === line.productId);
          if (product.updatedAt.toISOString() !== new Date(line.expectedUpdatedAt).toISOString()) throw problem(409, `${product.name} vừa thay đổi. Tải lại sản phẩm trước khi báo giá.`);
          if (line.quantity > product.stockQty) throw problem(409, `${product.name} hiện chỉ còn ${product.stockQty} × ${product.packaging}.`);
          const unitPrice = new Prisma.Decimal(line.unitPrice);
          return { productId: product.id, productName: product.name, packaging: product.packaging, quantity: line.quantity, unitPrice, lineTotal: unitPrice.mul(line.quantity) };
        });
        const subtotal = snapshots.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0));
        const total = subtotal.add(deliveryFee);
        if (total.greaterThan('1000000000000')) throw problem(400, 'Giá trị báo giá vượt giới hạn 1.000 tỷ đồng.');
        const created = await tx.supplierQuote.create({
          data: {
            supplierId: profile.id, buyerId, title, status: 'SENT',
            validUntil: new Date(validUntil + 'T00:00:00.000Z'), subtotal,
            deliveryFee, total, depositRate, note: note || null,
            lines: { create: snapshots },
          },
          include: quoteInclude,
        });
        await audit(tx, req.auth.user.id, 'QUOTE_SENT', 'QUOTE', created.id, { buyerId, total: total.toString(), depositRate: String(depositRate), lines: snapshots.length });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      res.status(201).json({ quote: serializeQuote(quote) });
    } catch (error) { next(error); }
  });

  router.post('/:id/cancel', async (req, res, next) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(400).json({ message: 'Mã báo giá không hợp lệ.' });
    try {
      const profile = await prisma.supplierProfile.findUnique({ where: { userId: req.auth.user.id } });
      if (!profile) throw problem(404, 'Chưa có gian hàng.');
      const quote = await prisma.$transaction(async tx => {
        const changed = await tx.supplierQuote.updateMany({ where: { id, supplierId: profile.id, status: 'SENT' }, data: { status: 'CANCELLED', version: { increment: 1 } } });
        if (!changed.count) throw problem(409, 'Chỉ hủy được báo giá đang chờ cửa hàng phản hồi.');
        const saved = await tx.supplierQuote.findUniqueOrThrow({ where: { id }, include: quoteInclude });
        await audit(tx, req.auth.user.id, 'QUOTE_CANCELLED', 'QUOTE', id);
        return saved;
      });
      res.json({ quote: serializeQuote(quote) });
    } catch (error) { next(error); }
  });

  router.use((error, req, res, next) => {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2034') return res.status(409).json({ message: 'Báo giá đang được xử lý. Tải lại và thử lại.' });
    next(error);
  });
  return router;
}

function createStoreQuoteRoutes(prisma, requireAuth) {
  const router = express.Router();
  router.use(requireAuth, requireRole('STORE_OWNER'));

  router.get('/', async (req, res, next) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !['', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED'].includes(status)) return res.status(400).json({ message: 'Bộ lọc báo giá không hợp lệ.' });
    try {
      const where = { buyerId: req.auth.user.id, ...(status ? { status } : {}) };
      const [rows, total] = await Promise.all([
        prisma.supplierQuote.findMany({ where, include: quoteInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 }),
        prisma.supplierQuote.count({ where }),
      ]);
      res.json({ quotes: rows.slice(0, 20).map(serializeQuote), total, page, hasMore: rows.length > 20 });
    } catch (error) { next(error); }
  });

  router.post('/:id/accept', async (req, res, next) => {
    const id = idParam(req.params.id);
    const body = req.body || {};
    const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim() : '';
    const recipientPhone = normalizePhone(body.recipientPhone);
    const deliveryAddress = typeof body.deliveryAddress === 'string' ? body.deliveryAddress.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!id || typeof body.requestId !== 'string' || !UUID.test(body.requestId) ||
      recipientName.length < 2 || recipientName.length > 100 || !/^0\d{9}$/.test(recipientPhone) ||
      deliveryAddress.length < 10 || deliveryAddress.length > 500 || note.length > 500) {
      return res.status(400).json({ message: 'Kiểm tra người nhận, số điện thoại, địa chỉ và ghi chú.' });
    }
    try {
      const order = await prisma.$transaction(async tx => {
        const quote = await tx.supplierQuote.findFirst({
          where: { id, buyerId: req.auth.user.id },
          include: {
            ...quoteInclude,
            supplier: { include: { user: { include: { role: true } } } },
            order: { include: { buyer: true, items: true, supplier: true, complaint: true } },
          },
        });
        if (!quote) throw problem(404, 'Không tìm thấy báo giá.');
        if (quote.status === 'ACCEPTED' && quote.order) return quote.order;
        if (quote.status !== 'SENT' || quote.validUntil.toISOString().slice(0, 10) < vnDate(new Date())) throw problem(409, 'Báo giá đã hết hạn hoặc không còn chờ phản hồi.');
        if (quote.supplier.verificationStatus !== 'APPROVED' || quote.supplier.user.role.code !== 'SUPPLIER' || !accountAvailable(quote.supplier.user)) throw problem(409, 'Gian hàng hiện không còn khả dụng.');
        const products = await tx.supplierProduct.findMany({ where: { id: { in: quote.lines.map(line => line.productId) }, supplierId: quote.supplierId, isActive: true } });
        if (products.length !== quote.lines.length) throw problem(409, 'Có mặt hàng trong báo giá đã ngừng bán.');
        for (const line of quote.lines) {
          const product = products.find(item => item.id === line.productId);
          if (product.stockQty < line.quantity) throw problem(409, `${line.productName} không còn đủ số lượng theo báo giá.`);
        }
        const existingRequest = await tx.wholesaleOrder.findFirst({ where: { requestId: body.requestId } });
        if (existingRequest) throw problem(409, 'Mã xác nhận đã được sử dụng.');
        const settings = await tx.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
        const depositAmount = quote.total.mul(quote.depositRate).div(100).toDecimalPlaces(2);
        if (depositAmount.greaterThan(0) && (!quote.supplier.bankName || !quote.supplier.bankAccountNumber || !quote.supplier.bankAccountHolder)) {
          throw problem(409, 'Chủ vựa chưa cấu hình tài khoản nhận cọc. Vui lòng liên hệ chủ vựa trước khi chấp nhận báo giá.');
        }
        const requestHash = createHash('sha256').update(JSON.stringify({ quoteId: quote.id, recipientName, recipientPhone, deliveryAddress, note })).digest('hex');
        const created = await tx.wholesaleOrder.create({
          data: {
            requestId: body.requestId, requestHash, buyerId: req.auth.user.id,
            supplierId: quote.supplierId, supplierRegion: quote.supplier.region,
            commissionRate: settings.commissionRate, recipientName, recipientPhone,
            deliveryAddress, note: [quote.note, note].filter(Boolean).join(' · ') || null,
            status: 'PENDING', subtotal: quote.subtotal, deliveryFee: quote.deliveryFee,
            total: quote.total, depositRate: quote.depositRate, depositAmount,
            depositStatus: depositAmount.greaterThan(0) ? 'PENDING' : 'NONE',
            depositBankName: depositAmount.greaterThan(0) ? quote.supplier.bankName : null,
            depositBankAccountNumber: depositAmount.greaterThan(0) ? quote.supplier.bankAccountNumber : null,
            depositBankAccountHolder: depositAmount.greaterThan(0) ? quote.supplier.bankAccountHolder : null,
            items: { create: quote.lines.map(line => ({
              productId: line.productId, productName: line.productName, packaging: line.packaging,
              quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal,
            })) },
          },
          include: { buyer: true, items: true, supplier: true, complaint: true },
        });
        const changed = await tx.supplierQuote.updateMany({ where: { id: quote.id, status: 'SENT', version: quote.version }, data: { status: 'ACCEPTED', respondedAt: new Date(), orderId: created.id, version: { increment: 1 } } });
        if (!changed.count) throw problem(409, 'Báo giá vừa được xử lý. Tải lại danh sách.');
        await audit(tx, req.auth.user.id, 'QUOTE_ACCEPTED', 'QUOTE', quote.id, { orderId: created.id, depositAmount: depositAmount.toString() });
        await audit(tx, req.auth.user.id, 'ORDER_CREATED_FROM_QUOTE', 'ORDER', created.id, { quoteId: quote.id, supplierId: quote.supplierId });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      res.status(201).json({
        order: {
          ...serializeOrder(order),
          supplier: {
            id: order.supplier.id,
            businessName: order.supplier.businessName,
          },
        },
      });
    } catch (error) { next(error); }
  });

  router.post('/:id/reject', async (req, res, next) => {
    const id = idParam(req.params.id);
    const responseNote = typeof req.body?.responseNote === 'string' ? req.body.responseNote.trim() : '';
    if (!id || responseNote.length > 500) return res.status(400).json({ message: 'Phản hồi tối đa 500 ký tự.' });
    try {
      const quote = await prisma.$transaction(async tx => {
        const changed = await tx.supplierQuote.updateMany({ where: { id, buyerId: req.auth.user.id, status: 'SENT' }, data: { status: 'REJECTED', responseNote: responseNote || null, respondedAt: new Date(), version: { increment: 1 } } });
        if (!changed.count) throw problem(409, 'Báo giá đã được xử lý hoặc không thuộc cửa hàng của bạn.');
        const saved = await tx.supplierQuote.findUniqueOrThrow({ where: { id }, include: quoteInclude });
        await audit(tx, req.auth.user.id, 'QUOTE_REJECTED', 'QUOTE', id, { responseNote: responseNote || null });
        return saved;
      });
      res.json({ quote: serializeQuote(quote) });
    } catch (error) { next(error); }
  });

  router.use((error, req, res, next) => {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2034') return res.status(409).json({ message: 'Báo giá đang được xử lý. Tải lại và thử lại.' });
    next(error);
  });
  return router;
}

module.exports = { createSupplierQuoteRoutes, createStoreQuoteRoutes, serializeQuote };

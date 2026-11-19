const express = require('express');
const path = require('node:path');
const multer = require('multer');
const { requireRole } = require('../middlewares/authMiddleware');
const { ROLES } = require('../config/roles');
const { answerInventory } = require('../services/inventoryChat');
const { expiryInfo, purgeExpiredItems } = require('../services/inventoryExpiry');
const {
  annotateInventoryImport,
  parseInventoryWorkbook,
  serializeImportRow,
} = require('../services/inventoryImport');
const { toRetailStock } = require('../services/inventoryUnits');
const { createStockService } = require('../services/stockService');
const { createStoreRevenueService } = require('../services/storeRevenueService');
const inventorySupplierService = require('../services/inventorySupplierService');
const consignmentService = require('../services/consignmentService');

const inventoryWorkbookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (_req, file, callback) => {
    callback(
      path.extname(file.originalname).toLowerCase() === '.xlsx'
        ? null
        : Object.assign(new Error('Chỉ hỗ trợ file Excel .xlsx.'), { status: 400 }),
      path.extname(file.originalname).toLowerCase() === '.xlsx',
    );
  },
});

function receiveInventoryWorkbook(req, res, next) {
  inventoryWorkbookUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File Excel tối đa 3 MB.' });
    }
    return res.status(error.status || 400).json({ message: error.message || 'File Excel không hợp lệ.' });
  });
}

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
  if (body.supplierName !== undefined) {
    data.supplierName = typeof body.supplierName === 'string' ? body.supplierName.trim().slice(0, 150) : null;
  }
  if (body.isConsignment !== undefined) {
    data.isConsignment = Boolean(body.isConsignment);
    if (data.isConsignment) {
      data.purchasePrice = 0; // Ký gửi tiếp thị luôn là vốn 0đ
      data.settlementPrice = typeof body.settlementPrice === 'number' && body.settlementPrice >= 0 ? Math.round(body.settlementPrice) : 0;
      data.autoRestock = body.autoRestock !== false;
      data.autoExchangeExpiry = body.autoExchangeExpiry !== false;
      data.termsNote = typeof body.termsNote === 'string' ? body.termsNote.trim().slice(0, 300) : 'Cam kết đổi trả 100% khi cận date và giao bù hàng khi hết.';
    }
  }
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
    const { itemId, type, direction, from, to, product } = req.query;
    const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if ((itemId !== undefined && (typeof itemId !== 'string' || !/^\d+$/.test(itemId) || Number(itemId) < 1 || Number(itemId) > 2147483647)) ||
      (type !== undefined && !['OPENING', 'SALE', 'RECEIPT', 'ADJUSTMENT'].includes(type)) ||
      (direction !== undefined && !['IN', 'OUT'].includes(direction)) ||
      (product !== undefined && (typeof product !== 'string' || product.length > 100)) || (from !== undefined && !validDate(from)) || (to !== undefined && !validDate(to)) || (from && to && from > to)) return res.status(400).json({ message: 'Bộ lọc lịch sử hoặc khoảng ngày không hợp lệ.' });
    const where = { item: { ownerId: req.auth.user.id }, ...(itemId ? { itemId: Number(itemId) } : {}), ...(type ? { type } : {}),
      ...(direction === 'IN' ? { quantityChange: { gt: 0 } } : direction === 'OUT' ? { quantityChange: { lt: 0 } } : {}),
      ...(product?.trim() ? { productName: { contains: product.trim() } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00+07:00`) } : {}), ...(to ? { lt: new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400000) } : {}) } } : {}) };
    const take = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    try {
      const rows = await prisma.stockMovement.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * take, take: take + 1 });
      res.json({ movements: rows.slice(0, take), hasMore: rows.length > take });
    } catch (error) { next(error); }
  });
  async function readInventoryWorkbook(req) {
    if (!req.file?.buffer) {
      const error = new Error('Hãy chọn file Excel .xlsx.');
      error.status = 400;
      throw error;
    }
    const parsed = await parseInventoryWorkbook(req.file.buffer);
    const existing = await prisma.inventoryItem.findMany({
      where: { ownerId: req.auth.user.id },
      select: { id: true, name: true, unit: true },
    });
    const unitErrors = [];
    const rows = parsed.rows.map(row => {
      try { return toRetailStock(row); }
      catch (error) {
        unitErrors.push({ rowNumber: row.rowNumber, message: error.message });
        return row;
      }
    });
    const annotated = annotateInventoryImport(rows, existing);
    return {
      rows: annotated.rows,
      errors: [...parsed.errors, ...unitErrors, ...annotated.errors],
    };
  }
  router.post('/import/preview', receiveInventoryWorkbook, async (req, res, next) => {
    try {
      const { getStoreProfile } = require('../services/storeService');
      const store = getStoreProfile(req.auth.user.id, req.auth.user.phone);
      if (!store || store.verificationStatus !== 'APPROVED') {
        return res.status(403).json({ message: 'Tài khoản chưa được kích hoạt. Vui lòng đợi admin xác minh.' });
      }
      const result = await readInventoryWorkbook(req);
      const invalidRows = new Set(result.errors.map((error) => error.rowNumber));
      res.json({
        fileName: req.file.originalname,
        rows: result.rows.map(serializeImportRow),
        errors: result.errors,
        summary: {
          rowCount: result.rows.length,
          validCount: result.rows.length - invalidRows.size,
          createdCount: result.rows.filter((row) => row.action === 'CREATE').length,
          updatedCount: result.rows.filter((row) => row.action === 'ADD').length,
          totalQuantity: result.rows.reduce((sum, row) => sum + (row.quantity || 0), 0),
        },
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  });
  router.post('/import/commit', receiveInventoryWorkbook, async (req, res, next) => {
    try {
      const { getStoreProfile } = require('../services/storeService');
      const store = getStoreProfile(req.auth.user.id, req.auth.user.phone);
      if (!store || store.verificationStatus !== 'APPROVED') {
        return res.status(403).json({ message: 'Tài khoản chưa được kích hoạt. Vui lòng đợi admin xác minh.' });
      }
      const result = await readInventoryWorkbook(req);
      if (result.errors.length) {
        return res.status(422).json({
          message: 'File Excel còn dòng chưa hợp lệ. Hãy sửa file và kiểm tra lại.',
          errors: result.errors,
        });
      }
      const imported = await stock.importRows(req.auth.user.id, result.rows);
      res.status(201).json({
        message: `Đã nhập ${imported.rowCount} dòng từ Excel.`,
        result: imported,
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ message: error.message });
      if (error.code === 'P2034') {
        return res.status(409).json({ message: 'Kho đang thay đổi. Hãy tải lại và nhập lại file.' });
      }
      next(error);
    }
  });
  router.post('/sales/batch', async (req, res, next) => {
    const { rows } = req.body || {};
    const validInt = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 50 ||
      rows.some(row => !row || !validInt(row.itemId) || !validInt(row.quantity) ||
        typeof row.requestId !== 'string' || !uuid.test(row.requestId) || !Number.isInteger(row.unitSalePrice) ||
        row.unitSalePrice < 0 || row.unitSalePrice > 2147483647) ||
      new Set(rows.map(row => row.requestId.toLowerCase())).size !== rows.length) {
      return res.status(400).json({ message: 'Kiểm tra số lượng và giá bán của từng mặt hàng.' });
    }
    try {
      const movements = await stock.moveBatch(req.auth.user.id, rows.map(row => ({
        itemId: row.itemId, quantity: row.quantity, requestId: row.requestId,
        unitSalePrice: row.unitSalePrice, type: 'SALE', quickSale: true, expectedUnit: row.unit, note: 'Bán nhanh bằng giọng nói',
      })));
      res.json({ movements });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  });
  router.post('/:id/movements', async (req, res, next) => {
    const id = Number(req.params.id);
    const { type, quantity, requestId, note = '', occurredOn, lotExpiryDate } = req.body || {};
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || !['SALE', 'RECEIPT'].includes(type) || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647 || typeof note !== 'string' || note.length > 250 || typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return res.status(400).json({ message: 'Chọn nhập/bán hàng, số lượng nguyên dương và ghi chú tối đa 250 ký tự.' });
    const unitSalePrice = req.body.unitSalePrice;
    const occurredAt = occurredOn === undefined ? new Date() : (typeof occurredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(occurredOn) ? new Date(`${occurredOn}T12:00:00+07:00`) : null);
    if (!occurredAt || Number.isNaN(occurredAt.valueOf()) || occurredAt > new Date(Date.now() + 86400000) || occurredAt < new Date('1900-01-01T00:00:00Z')) return res.status(400).json({ message: 'Ngày giao dịch không hợp lệ.' });
    const expiryAt = lotExpiryDate === undefined || lotExpiryDate === '' ? null : (typeof lotExpiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lotExpiryDate) ? new Date(`${lotExpiryDate}T00:00:00.000Z`) : null);
    if (lotExpiryDate !== undefined && lotExpiryDate !== '' && (!expiryAt || Number.isNaN(expiryAt.valueOf()))) return res.status(400).json({ message: 'Hạn sử dụng của lô không hợp lệ.' });
    if (unitSalePrice !== undefined && (type !== 'SALE' || !Number.isInteger(unitSalePrice) || unitSalePrice < 0 || unitSalePrice > 2147483647)) return res.status(400).json({ message: 'Giá bán phải là số nguyên từ 0 đến 2.147.483.647 VNĐ và chỉ áp dụng khi bán hàng.' });
    try { res.json({ movement: await stock.move(req.auth.user.id, id, { type, quantity, requestId, note: note.trim(), unitSalePrice, occurredAt, lotExpiryDate: expiryAt, allowExpiredSale: req.body.allowExpiredSale === true }) }); }
    catch (error) { if (error.status) return res.status(error.status).json({ message: error.message }); next(error); }
  });
  const list = (ownerId) => prisma.inventoryItem.findMany({
    where: { ownerId },
    orderBy: { name: 'asc' },
    include: {
      lots: {
        orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
        include: {
          sourceOrder: {
            include: {
              supplier: true,
            },
          },
        },
      },
    },
  });
  router.get('/', async (req, res, next) => {
    try {
      await purgeExpiredItems(prisma, req.auth.user.id);
      res.json({
        items: (await list(req.auth.user.id)).map((item) => {
          const consignment = consignmentService.getItemConsignment(item.id);
          // Ưu tiên chọn ngày hết hạn gần nhất trong các lô còn hàng (quantity > 0)
          const activeLotsWithExpiry = (item.lots || [])
            .filter((l) => l.quantity > 0 && l.expiryDate)
            .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
          const nearestExpiryDate = activeLotsWithExpiry.length > 0
            ? activeLotsWithExpiry[0].expiryDate
            : item.expiryDate;

          const itemSupplierName = inventorySupplierService.getSupplier(item.id);

          return {
            ...item,
            supplierName: itemSupplierName,
            isConsignment: item.lots?.some((lot) => lot.consignmentSupplierId != null) || false,
            settlementPrice: consignment?.settlementPrice || 0,
            autoRestock: consignment?.autoRestock !== false,
            autoExchangeExpiry: consignment?.autoExchangeExpiry !== false,
            termsNote: consignment?.termsNote || null,
            expiryDate: nearestExpiryDate ? (typeof nearestExpiryDate === 'string' ? nearestExpiryDate : nearestExpiryDate.toISOString().slice(0, 10)) : null,
            ...expiryInfo(nearestExpiryDate),
            lots: (item.lots || []).map((lot) => {
              const lotSupplier = lot.sourceOrder?.supplier?.businessName || (lot.sourceOrderId ? 'Chủ vựa' : (itemSupplierName || 'Nhập tay / tồn đầu'));
              return {
                id: lot.id,
                itemId: lot.itemId,
                quantity: lot.quantity,
                receivedAt: lot.receivedAt,
                expiryDate: lot.expiryDate ? (typeof lot.expiryDate === 'string' ? lot.expiryDate.slice(0, 10) : lot.expiryDate.toISOString().slice(0, 10)) : null,
                purchasePrice: lot.purchasePrice,
                sourceOrderId: lot.sourceOrderId,
                supplierName: lotSupplier,
                consignmentSupplierId: lot.consignmentSupplierId,
              };
            }),
          };
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  // Cập nhật hạn sử dụng cho từng lô hàng riêng biệt
  router.patch('/lots/:lotId/expiry', async (req, res, next) => {
    const lotId = Number(req.params.lotId);
    const ownerId = req.auth.user.id;
    if (!Number.isInteger(lotId) || lotId < 1 || lotId > 2147483647) {
      return res.status(400).json({ message: 'Mã lô hàng không hợp lệ.' });
    }
    const { expiryDate } = req.body || {};
    if (!expiryDate || typeof expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      return res.status(400).json({ message: 'Vui lòng chọn ngày hạn sử dụng hợp lệ (YYYY-MM-DD).' });
    }
    const todayStr = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    if (expiryDate <= todayStr) {
      return res.status(400).json({ message: 'Hạn sử dụng phải nằm trong tương lai (từ ngày mai trở đi).' });
    }
    try {
      const lot = await prisma.inventoryLot.findFirst({
        where: { id: lotId, item: { ownerId } },
        include: { item: true },
      });
      if (!lot) return res.status(404).json({ message: 'Không tìm thấy lô hàng này trong kho.' });

      const newExpiry = new Date(`${expiryDate}T00:00:00.000Z`);
      await prisma.inventoryLot.update({
        where: { id: lotId },
        data: { expiryDate: newExpiry },
      });

      // Cập nhật lại item.expiryDate bằng lô có hạn sử dụng gần nhất còn hàng
      const activeLots = await prisma.inventoryLot.findMany({
        where: { itemId: lot.itemId, quantity: { gt: 0 }, expiryDate: { not: null } },
        orderBy: { expiryDate: 'asc' },
      });
      const nearestExpiry = activeLots[0]?.expiryDate || newExpiry;
      await prisma.inventoryItem.update({
        where: { id: lot.itemId },
        data: { expiryDate: nearestExpiry },
      });

      res.json({
        success: true,
        message: `Đã cập nhật hạn sử dụng cho Lô #${lotId} thành công!`,
        expiryDate,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/consignment/settlements', async (req, res, next) => {
    try {
      const settlements = await consignmentService.getConsignmentSettlements({
        storeId: req.auth.user.id,
        prisma,
      });
      res.json({ settlements });
    } catch (error) {
      next(error);
    }
  });

  router.post('/consignment/settlements/:itemId/pay', (_req, res) => {
    res.status(409).json({ message: 'Vui lòng tải lại ứng dụng để quyết toán theo lô ký gửi.' });
  });

  router.post('/consignment/settlements/lots/:lotId/pay', async (req, res, next) => {
    const lotId = Number(req.params.lotId);
    const { qty, expectedSettledQty, method = 'WALLET' } = req.body || {};
    try {
      const result = await consignmentService.settleConsignmentItem({
        storeId: req.auth.user.id,
        lotId,
        qtyToSettle: qty,
        expectedSettledQty,
        method,
        prisma,
      });
      res.json(result);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ message: error.message });
      next(error);
    }
  });

  router.get('/consignment-requests', async (req, res, next) => {
    try {
      const requests = consignmentService.getConsignmentRequests({ storeId: req.auth.user.id });
      res.json({ requests });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/consignment-request', async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Mã sản phẩm không hợp lệ.' });
    const { type, requestedQty, note } = req.body || {};
    try {
      const item = await prisma.inventoryItem.findFirst({ where: { id, ownerId: req.auth.user.id } });
      if (!item) return res.status(404).json({ message: 'Không tìm thấy sản phẩm trong kho.' });
      const consignment = consignmentService.getItemConsignment(item.id);
      const supplierName = inventorySupplierService.getSupplier(item.id) || consignment?.supplierName || 'Nhà cung cấp';

      const request = consignmentService.createConsignmentRequest({
        storeId: req.auth.user.id,
        storeName: req.auth.user.name,
        storePhone: req.auth.user.phone,
        supplierId: consignment?.supplierId || null,
        supplierName,
        itemId: item.id,
        productName: item.name,
        unit: item.unit,
        type: type === 'EXCHANGE_EXPIRY' ? 'EXCHANGE_EXPIRY' : 'RESTOCK',
        currentQty: item.quantity,
        requestedQty: Math.max(1, Number(requestedQty) || (item.lowThreshold ? item.lowThreshold * 2 : 10)),
        expiryDate: item.expiryDate ? item.expiryDate.toISOString().slice(0, 10) : null,
        note,
      });

      res.status(201).json({ request, message: 'Đã gửi yêu cầu đến nhà cung cấp thành công!' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/consignment-requests/:requestId/confirm-receipt', async (req, res, next) => {
    const { requestId } = req.params;
    try {
      const request = consignmentService.getRequestById(requestId);
      if (!request || request.storeId !== req.auth.user.id) {
        return res.status(404).json({ message: 'Không tìm thấy yêu cầu tiếp thị này.' });
      }
      if (request.status !== 'DISPATCHED') {
        return res.status(400).json({ message: 'Yêu cầu chưa được điều xe giao hàng hoặc đã hoàn tất.' });
      }

      // Update inventory item based on restock or expiry exchange
      const item = await prisma.inventoryItem.findFirst({ where: { id: request.itemId, ownerId: req.auth.user.id } });
      if (item) {
        if (request.type === 'RESTOCK') {
          await stock.create(req.auth.user.id, {
            name: item.name,
            unit: item.unit,
            quantity: request.requestedQty,
            purchasePrice: 0,
            sellingPrice: item.sellingPrice,
            isConsignment: true,
            supplierName: request.supplierName,
          });
        } else if (request.type === 'EXCHANGE_EXPIRY' && request.newExpiryDate) {
          await stock.edit(req.auth.user.id, item.id, {
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            purchasePrice: item.purchasePrice,
            sellingPrice: item.sellingPrice,
            expiryDate: request.newExpiryDate,
            isConsignment: true,
            supplierName: request.supplierName,
          });
        }
      }

      const updated = consignmentService.updateRequestStatus(requestId, 'COMPLETED');
      res.json({ message: 'Xác nhận đã nhận hàng bù/đổi thành công!', request: updated });
    } catch (error) {
      next(error);
    }
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
        const { getStoreProfile } = require('../services/storeService');
        const store = getStoreProfile(ownerId, req.auth.user.phone);
        if (!store || store.verificationStatus !== 'APPROVED') {
          return res.status(403).json({ message: 'Tài khoản chưa được kích hoạt. Vui lòng đợi admin xác minh.' });
        }
        const item = await stock.create(ownerId, toRetailStock(data));
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

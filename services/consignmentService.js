const fs = require('node:fs');
const documents = require('./documentStorage');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const dataDir = path.join(__dirname, '../data');
const itemsFile = path.join(dataDir, 'consignment_items.json');
const requestsFile = path.join(dataDir, 'consignment_requests.json');
const quotesFile = path.join(dataDir, 'consignment_quotes.json');

let itemsCache = null;
let requestsCache = null;
let quotesCache = null;

function ensureFiles() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(itemsFile)) {
    fs.writeFileSync(itemsFile, JSON.stringify({}, null, 2), 'utf8');
  }
  if (!fs.existsSync(requestsFile)) {
    fs.writeFileSync(requestsFile, JSON.stringify([], null, 2), 'utf8');
  }
  if (!fs.existsSync(quotesFile)) {
    fs.writeFileSync(quotesFile, JSON.stringify({}, null, 2), 'utf8');
  }
}

function loadItems() {
  if (documents.active()) return documents.readDocument('consignment_items', {});
  ensureFiles();
  if (itemsCache) return itemsCache;
  try {
    itemsCache = JSON.parse(fs.readFileSync(itemsFile, 'utf8'));
  } catch {
    itemsCache = {};
  }
  return itemsCache;
}

function persistItems() {
  if (documents.active()) return documents.writeDocument('consignment_items', documents.readDocument('consignment_items', {}));
  ensureFiles();
  try {
    const tmp = `${itemsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(itemsCache, null, 2), 'utf8');
    fs.renameSync(tmp, itemsFile);
  } catch (err) {
    console.error('Không thể ghi consignment_items.json:', err.message);
  }
}

function loadRequests() {
  if (documents.active()) return documents.readDocument('consignment_requests', []);
  ensureFiles();
  if (requestsCache) return requestsCache;
  try {
    requestsCache = JSON.parse(fs.readFileSync(requestsFile, 'utf8'));
  } catch {
    requestsCache = [];
  }
  return requestsCache;
}

function persistRequests() {
  if (documents.active()) return documents.writeDocument('consignment_requests', documents.readDocument('consignment_requests', []));
  ensureFiles();
  try {
    const tmp = `${requestsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(requestsCache, null, 2), 'utf8');
    fs.renameSync(tmp, requestsFile);
  } catch (err) {
    console.error('Không thể ghi consignment_requests.json:', err.message);
  }
}

function loadQuotes() {
  if (documents.active()) return documents.readDocument('consignment_quotes', {});
  ensureFiles();
  if (quotesCache) return quotesCache;
  try {
    quotesCache = JSON.parse(fs.readFileSync(quotesFile, 'utf8'));
  } catch {
    quotesCache = {};
  }
  return quotesCache;
}

function persistQuotes() {
  if (documents.active()) return documents.writeDocument('consignment_quotes', documents.readDocument('consignment_quotes', {}));
  ensureFiles();
  try {
    const tmp = `${quotesFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(quotesCache, null, 2), 'utf8');
    fs.renameSync(tmp, quotesFile);
  } catch (err) {
    console.error('Không thể ghi consignment_quotes.json:', err.message);
  }
}

function getItemConsignment(itemId) {
  if (!itemId) return null;
  const items = loadItems();
  return items[String(itemId)] || null;
}

function setItemConsignment(itemId, data = {}) {
  if (!itemId) return;
  const items = loadItems();
  const key = String(itemId);
  if (!data || data.isConsignment === false) {
    delete items[key];
  } else {
    items[key] = {
      isConsignment: Boolean(data.isConsignment),
      settlementPrice: typeof data.settlementPrice === 'number' && data.settlementPrice >= 0 ? data.settlementPrice : 0,
      autoRestock: data.autoRestock !== false,
      autoExchangeExpiry: data.autoExchangeExpiry !== false,
      supplierName: typeof data.supplierName === 'string' ? data.supplierName.trim() : null,
      supplierPhone: typeof data.supplierPhone === 'string' ? data.supplierPhone.trim() : null,
      supplierId: typeof data.supplierId === 'number' ? data.supplierId : null,
      termsNote: typeof data.termsNote === 'string' ? data.termsNote.trim() : 'Cam kết đổi trả 100% khi cận date và giao bù hàng khi hết.',
      updatedAt: new Date().toISOString(),
    };
  }
  persistItems();
  return items[key] || null;
}

function deleteItemConsignment(itemId) {
  if (!itemId) return;
  const items = loadItems();
  delete items[String(itemId)];
  persistItems();
}

function getQuoteConsignment(quoteId) {
  if (!quoteId) return null;
  const quotes = loadQuotes();
  return quotes[String(quoteId)] || null;
}

function setQuoteConsignment(quoteId, data = {}) {
  if (!quoteId) return;
  const quotes = loadQuotes();
  const key = String(quoteId);
  quotes[key] = {
    isConsignment: Boolean(data.isConsignment),
    settlementPrice: typeof data.settlementPrice === 'number' && data.settlementPrice >= 0 ? data.settlementPrice : 0,
    autoRestock: data.autoRestock !== false,
    autoExchangeExpiry: data.autoExchangeExpiry !== false,
    termsNote: typeof data.termsNote === 'string' ? data.termsNote.trim() : 'Cam kết đổi trả 100% khi cận date và giao bù hàng khi hết.',
    updatedAt: new Date().toISOString(),
  };
  persistQuotes();
  return quotes[key];
}

function createConsignmentRequest({
  storeId,
  storeName,
  storePhone,
  storeAddress,
  supplierId,
  supplierName,
  itemId,
  productName,
  unit,
  type, // 'RESTOCK' | 'EXCHANGE_EXPIRY'
  currentQty = 0,
  requestedQty = 10,
  expiryDate = null,
  note = '',
}) {
  const requests = loadRequests();
  const now = new Date().toISOString();
  const id = `CRQ-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

  const newRequest = {
    id,
    storeId: Number(storeId),
    storeName: storeName || 'Tiệm tạp hóa',
    storePhone: storePhone || '',
    storeAddress: storeAddress || '',
    supplierId: supplierId ? Number(supplierId) : null,
    supplierName: supplierName || 'Nhà cung cấp',
    itemId: Number(itemId),
    productName: productName || 'Sản phẩm tiếp thị',
    unit: unit || 'cái',
    type: type === 'EXCHANGE_EXPIRY' ? 'EXCHANGE_EXPIRY' : 'RESTOCK',
    currentQty: Number(currentQty) || 0,
    requestedQty: Math.max(1, Number(requestedQty) || 1),
    expiryDate: expiryDate || null,
    status: 'PENDING', // PENDING | DISPATCHED | COMPLETED | REJECTED
    note: typeof note === 'string' ? note.trim().slice(0, 300) : '',
    driverInfo: null,
    newExpiryDate: null,
    supplierNotes: null,
    createdAt: now,
    updatedAt: now,
  };

  requests.unshift(newRequest);
  persistRequests();
  return newRequest;
}

function getConsignmentRequests({ storeId, supplierId, supplierName, status } = {}) {
  const requests = loadRequests();
  return requests.filter((req) => {
    if (storeId && req.storeId !== Number(storeId)) return false;
    if (supplierId && req.supplierId && req.supplierId !== Number(supplierId)) return false;
    if (supplierName && req.supplierName && !req.supplierName.toLowerCase().includes(supplierName.toLowerCase())) return false;
    if (status && req.status !== status) return false;
    return true;
  });
}

function getRequestById(id) {
  const requests = loadRequests();
  return requests.find((r) => r.id === id) || null;
}

function dispatchConsignmentRequest(requestId, { driverInfo, newExpiryDate, supplierNotes }) {
  const requests = loadRequests();
  const item = requests.find((r) => r.id === requestId);
  if (!item) return null;

  item.status = 'DISPATCHED';
  item.driverInfo = driverInfo || null;
  item.newExpiryDate = newExpiryDate || null;
  item.supplierNotes = typeof supplierNotes === 'string' ? supplierNotes.trim() : null;
  item.updatedAt = new Date().toISOString();

  persistRequests();
  return item;
}

function updateRequestStatus(requestId, status, reason = '') {
  const requests = loadRequests();
  const item = requests.find((r) => r.id === requestId);
  if (!item) return null;

  item.status = status;
  if (reason) item.supplierNotes = reason;
  item.updatedAt = new Date().toISOString();

  persistRequests();
  return item;
}

const { Prisma } = require('@prisma/client');
const { ensureWallet, applyBalance } = require('./walletService');

const problem = (status, message) => Object.assign(new Error(message), { status });
const lotValue = (lot, qty) => lot.consignmentPackPrice.mul(qty).div(lot.consignmentPackSize).toDecimalPlaces(2);

async function getConsignmentSettlements({ storeId, supplierId, prisma }) {
  const lots = await prisma.inventoryLot.findMany({
    where: {
      consignmentSupplierId: supplierId ?? { not: null },
      consignmentPackPrice: { not: null },
      ...(storeId ? { item: { ownerId: storeId } } : {}),
    },
    include: { item: true, sourceOrder: { include: { supplier: true, sourceQuote: true } } },
    orderBy: { id: 'desc' },
  });
  return lots.map(lot => ({
    lotId: lot.id,
    itemId: lot.itemId,
    orderId: lot.sourceOrderId,
    productName: lot.item.name,
    unit: lot.item.unit,
    currentStock: lot.quantity,
    sellingPrice: lot.item.sellingPrice,
    settlementPrice: Number(lot.consignmentPackPrice.div(lot.consignmentPackSize)),
    totalSold: lot.consignmentSoldQty,
    settledQty: lot.consignmentSettledQty,
    unsettledQty: lot.consignmentSoldQty - lot.consignmentSettledQty,
    dueAmount: Number(lotValue(lot, lot.consignmentSoldQty).sub(lotValue(lot, lot.consignmentSettledQty))),
    supplierId: lot.consignmentSupplierId,
    supplierName: lot.sourceOrder?.supplier.businessName || 'Chủ vựa',
    termsNote: lot.sourceOrder?.sourceQuote ? getQuoteConsignment(lot.sourceOrder.sourceQuote.id)?.termsNote ?? null : null,
    lastSettledAt: lot.consignmentSettledAt,
  }));
}

async function settleConsignmentItem({ storeId, lotId, qtyToSettle, expectedSettledQty, method = 'WALLET', prisma }) {
  if (method !== 'WALLET') throw problem(400, 'Chỉ hỗ trợ quyết toán qua ví.');
  if (!Number.isInteger(lotId) || lotId < 1 || lotId > 2147483647 ||
      !Number.isInteger(qtyToSettle) || qtyToSettle < 1 || qtyToSettle > 2147483647 ||
      !Number.isInteger(expectedSettledQty) || expectedSettledQty < 0 || expectedSettledQty > 2147483647) {
    throw problem(400, 'Mã lô và số lượng quyết toán không hợp lệ.');
  }
  try {
    return await prisma.$transaction(async tx => {
      const lot = await tx.inventoryLot.findFirst({
        where: { id: lotId, item: { ownerId: storeId }, consignmentSupplierId: { not: null } },
        include: { item: true },
      });
      if (!lot || lot.consignmentPackPrice == null) throw problem(404, 'Không tìm thấy lô ký gửi trong kho.');
      const settledQty = lot.consignmentSettledQty;
      const nextQty = settledQty + qtyToSettle;
      if (settledQty !== expectedSettledQty || nextQty > lot.consignmentSoldQty) {
        throw problem(409, 'Số lượng cần quyết toán đã thay đổi. Vui lòng tải lại.');
      }
      const supplier = await tx.supplierProfile.findUnique({ where: { id: lot.consignmentSupplierId } });
      if (!supplier || supplier.userId === storeId) throw problem(409, 'Không xác định được ví chủ vựa.');

      const amount = lotValue(lot, nextQty).sub(lotValue(lot, settledQty));
      const claimed = await tx.inventoryLot.updateMany({
        where: { id: lotId, consignmentSettledQty: settledQty, consignmentSoldQty: { gte: nextQty } },
        data: { consignmentSettledQty: nextQty, consignmentSettledAt: new Date() },
      });
      if (!claimed.count) throw problem(409, 'Lô vừa được quyết toán. Vui lòng tải lại.');
      if (amount.greaterThan(0)) {
        const buyerWallet = await ensureWallet(tx, storeId);
        const supplierWallet = await ensureWallet(tx, supplier.userId);
        const reference = 'CONSIGN-' + lotId + '-' + nextQty;
        const note = 'Quyết toán lô ký gửi #' + lotId + ': ' + qtyToSettle + ' ' + lot.item.unit;
        await applyBalance(tx, { wallet: buyerWallet, userId: storeId, type: 'ORDER_PAYMENT',
          direction: 'DEBIT', amount, reference: reference + '-PAY', note });
        await applyBalance(tx, { wallet: supplierWallet, userId: supplier.userId, type: 'ORDER_RECEIVE',
          direction: 'CREDIT', amount, reference: reference + '-REC', note });
      }
      return {
        success: true,
        settledQty: qtyToSettle,
        amount: Number(amount),
        remainingUnsettled: lot.consignmentSoldQty - nextQty,
        productName: lot.item.name,
        message: 'Đã quyết toán lô ký gửi #' + lotId + '.',
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error.code === 'P2034') throw problem(409, 'Số dư hoặc lô hàng vừa thay đổi. Vui lòng tải lại.');
    throw error;
  }
}

module.exports = {
  getItemConsignment,
  setItemConsignment,
  deleteItemConsignment,
  getQuoteConsignment,
  setQuoteConsignment,
  createConsignmentRequest,
  getConsignmentRequests,
  getRequestById,
  dispatchConsignmentRequest,
  updateRequestStatus,
  getConsignmentSettlements,
  settleConsignmentItem,
};

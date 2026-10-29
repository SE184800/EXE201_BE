const fs = require('node:fs');
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
};

const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '../data');
const supplierFile = path.join(dataDir, 'inventory_suppliers.json');

let suppliersCache = null;

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(supplierFile)) {
    fs.writeFileSync(supplierFile, JSON.stringify({}, null, 2), 'utf8');
  }
}

function loadSuppliers() {
  ensureDataFile();
  if (suppliersCache) return suppliersCache;
  try {
    const raw = fs.readFileSync(supplierFile, 'utf8');
    suppliersCache = JSON.parse(raw);
  } catch (err) {
    console.error('Không thể đọc inventory_suppliers.json:', err.message);
    suppliersCache = {};
  }
  return suppliersCache;
}

function persistSuppliers() {
  ensureDataFile();
  try {
    const tempFile = `${supplierFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(suppliersCache, null, 2), 'utf8');
    fs.renameSync(tempFile, supplierFile);
  } catch (err) {
    console.error('Không thể lưu inventory_suppliers.json:', err.message);
  }
}

function getSupplier(itemId) {
  if (!itemId) return null;
  const store = loadSuppliers();
  return store[String(itemId)] || null;
}

function setSupplier(itemId, supplierName) {
  if (!itemId) return null;
  const store = loadSuppliers();
  const normalized = typeof supplierName === 'string' ? supplierName.trim().slice(0, 150) : '';
  if (normalized) {
    store[String(itemId)] = normalized;
  } else {
    delete store[String(itemId)];
  }
  persistSuppliers();
  return normalized || null;
}

function deleteSupplier(itemId) {
  if (!itemId) return;
  const store = loadSuppliers();
  if (store[String(itemId)]) {
    delete store[String(itemId)];
    persistSuppliers();
  }
}

module.exports = {
  getSupplier,
  setSupplier,
  deleteSupplier,
  loadSuppliers,
};

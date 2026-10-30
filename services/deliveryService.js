const fs = require('node:fs');
const path = require('node:path');
const { normalizePhone } = require('./registrationValidation');

const dataDir = path.join(__dirname, '../data');
const deliveryFile = path.join(dataDir, 'orders_delivery.json');
const savedDriversFile = path.join(dataDir, 'saved_drivers.json');

let deliveryCache = null;
let savedDriversCache = null;

const DEFAULT_SAVED_DRIVERS = [
  {
    id: 'drv-1',
    driverName: 'Nguyễn Văn Tuấn',
    driverPhone: '0912345678',
    vehicleType: 'Xe ba gác chở hàng',
    licensePlate: '59X1-888.99',
    deliveryNotes: 'Tài xế quen, hỗ trợ khuân vác vào tiệm.',
  },
  {
    id: 'drv-2',
    driverName: 'Trần Quốc Huy',
    driverPhone: '0987654321',
    vehicleType: 'Xe tải nhỏ 500kg',
    licensePlate: '51D-123.45',
    deliveryNotes: 'Chuyên chở hàng cồng kềnh, thùng bia, nước ngọt.',
  },
  {
    id: 'drv-3',
    driverName: 'Lê Hoàng Nam',
    driverPhone: '0903112233',
    vehicleType: 'Xe máy giao hàng',
    licensePlate: '59T2-456.78',
    deliveryNotes: 'Chuyên giao hàng hỏa tốc trong ngày.',
  },
];

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(deliveryFile)) {
    fs.writeFileSync(deliveryFile, JSON.stringify({}, null, 2), 'utf8');
  }
  if (!fs.existsSync(savedDriversFile)) {
    fs.writeFileSync(savedDriversFile, JSON.stringify(DEFAULT_SAVED_DRIVERS, null, 2), 'utf8');
  }
}

function loadDeliveries() {
  ensureDataFile();
  if (deliveryCache) return deliveryCache;
  try {
    const raw = fs.readFileSync(deliveryFile, 'utf8');
    deliveryCache = JSON.parse(raw);
  } catch (err) {
    console.error('Không thể đọc orders_delivery.json:', err.message);
    deliveryCache = {};
  }
  return deliveryCache;
}

function persistDeliveries() {
  ensureDataFile();
  try {
    const tempFile = `${deliveryFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(deliveryCache, null, 2), 'utf8');
    fs.renameSync(tempFile, deliveryFile);
  } catch (err) {
    console.error('Không thể lưu orders_delivery.json:', err.message);
  }
}

function loadSavedDrivers() {
  ensureDataFile();
  if (savedDriversCache) return savedDriversCache;
  try {
    const raw = fs.readFileSync(savedDriversFile, 'utf8');
    savedDriversCache = JSON.parse(raw);
    if (!Array.isArray(savedDriversCache) || savedDriversCache.length === 0) {
      savedDriversCache = [...DEFAULT_SAVED_DRIVERS];
      persistSavedDrivers();
    }
  } catch (err) {
    console.error('Không thể đọc saved_drivers.json:', err.message);
    savedDriversCache = [...DEFAULT_SAVED_DRIVERS];
  }
  return savedDriversCache;
}

function persistSavedDrivers() {
  ensureDataFile();
  try {
    const tempFile = `${savedDriversFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(savedDriversCache, null, 2), 'utf8');
    fs.renameSync(tempFile, savedDriversFile);
  } catch (err) {
    console.error('Không thể lưu saved_drivers.json:', err.message);
  }
}

function normalizeLicensePlate(plate) {
  if (!plate || typeof plate !== 'string') return '';
  return plate.trim().toUpperCase().replace(/\s+/g, ' ');
}

function validateDriverInput(input = {}) {
  const errors = [];
  const driverName = typeof input.driverName === 'string' ? input.driverName.trim() : '';
  const driverPhoneRaw = typeof input.driverPhone === 'string' ? input.driverPhone.trim() : '';
  const vehicleType = typeof input.vehicleType === 'string' ? input.vehicleType.trim() : '';
  const licensePlate = normalizeLicensePlate(input.licensePlate);
  const estimatedDeliveryTime = typeof input.estimatedDeliveryTime === 'string' ? input.estimatedDeliveryTime.trim() : '';
  const deliveryNotes = typeof input.deliveryNotes === 'string' ? input.deliveryNotes.trim() : '';

  if (!driverName || driverName.length < 2 || driverName.length > 70) {
    errors.push('Họ tên tài xế phải từ 2 đến 70 ký tự.');
  }

  const normalizedPhone = normalizePhone(driverPhoneRaw);
  if (!/^0\d{9}$/.test(normalizedPhone)) {
    errors.push('Số điện thoại tài xế không hợp lệ (cần 10 chữ số bắt đầu bằng 0).');
  }

  if (vehicleType && vehicleType.length > 50) {
    errors.push('Loại phương tiện không vượt quá 50 ký tự.');
  }

  if (licensePlate && (licensePlate.length < 3 || licensePlate.length > 20)) {
    errors.push('Biển số xe không hợp lệ (từ 3 đến 20 ký tự).');
  }

  if (estimatedDeliveryTime && estimatedDeliveryTime.length > 100) {
    errors.push('Thời gian dự kiến giao không vượt quá 100 ký tự.');
  }

  if (deliveryNotes && deliveryNotes.length > 300) {
    errors.push('Ghi chú giao hàng không vượt quá 300 ký tự.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      driverName,
      driverPhone: normalizedPhone,
      vehicleType: vehicleType || 'Xe ba gác chở hàng',
      licensePlate: licensePlate || null,
      estimatedDeliveryTime: estimatedDeliveryTime || 'Trong 30 - 45 phút tới',
      deliveryNotes: deliveryNotes || null,
    },
  };
}

function getSavedDrivers(supplierId) {
  const list = loadSavedDrivers();
  if (!supplierId) return list;
  return list.filter((d) => !d.supplierId || d.supplierId === supplierId);
}

function saveDriverToSavedList(driverData, supplierId) {
  if (!driverData || !driverData.driverName || !driverData.driverPhone) return null;
  const list = loadSavedDrivers();
  const phone = normalizePhone(driverData.driverPhone);
  const existingIndex = list.findIndex((d) => d.driverPhone === phone);

  const entry = {
    id: existingIndex >= 0 ? list[existingIndex].id : `drv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    driverName: driverData.driverName.trim(),
    driverPhone: phone,
    vehicleType: driverData.vehicleType || 'Xe ba gác chở hàng',
    licensePlate: normalizeLicensePlate(driverData.licensePlate) || null,
    deliveryNotes: driverData.deliveryNotes || null,
    supplierId: supplierId || null,
    lastUsedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    list[existingIndex] = { ...list[existingIndex], ...entry };
  } else {
    list.unshift(entry);
  }

  savedDriversCache = list.slice(0, 50);
  persistSavedDrivers();
  return entry;
}

function getDriverInfo(orderId) {
  if (!orderId) return null;
  const store = loadDeliveries();
  const found = store[String(orderId)];
  return found || null;
}

function saveDriverInfo(orderId, input, supplierId) {
  if (!orderId) throw new Error('Mã đơn hàng không hợp lệ.');
  const validation = validateDriverInput(input);
  if (!validation.isValid) {
    const err = new Error(validation.errors.join(' '));
    err.status = 400;
    throw err;
  }

  const store = loadDeliveries();
  const existing = store[String(orderId)] || {};
  const now = new Date().toISOString();

  const record = {
    ...existing,
    orderId: Number(orderId),
    ...validation.data,
    assignedAt: existing.assignedAt || now,
    updatedAt: now,
  };

  store[String(orderId)] = record;
  persistDeliveries();

  // Also record in saved drivers list
  try {
    saveDriverToSavedList(validation.data, supplierId);
  } catch {}

  return record;
}

function deleteDriverInfo(orderId) {
  if (!orderId) return;
  const store = loadDeliveries();
  if (store[String(orderId)]) {
    delete store[String(orderId)];
    persistDeliveries();
  }
}

function savePackingChecklist(orderId, checkedItemIds = []) {
  if (!orderId) return null;
  const store = loadDeliveries();
  const existing = store[String(orderId)] || { orderId: Number(orderId) };
  existing.packingChecklist = Array.isArray(checkedItemIds) ? checkedItemIds.map(Number) : [];
  existing.packingUpdatedAt = new Date().toISOString();
  store[String(orderId)] = existing;
  persistDeliveries();
  return existing.packingChecklist;
}

function saveIncidentReport(orderId, incidentData) {
  if (!orderId || !incidentData) return null;
  const store = loadDeliveries();
  const existing = store[String(orderId)] || { orderId: Number(orderId) };
  existing.incidentReport = {
    ...incidentData,
    reportedAt: incidentData.reportedAt || new Date().toISOString(),
  };
  store[String(orderId)] = existing;
  persistDeliveries();
  return existing.incidentReport;
}

function savePaymentInfo(orderId, paymentData) {
  if (!orderId || !paymentData) return null;
  const store = loadDeliveries();
  const existing = store[String(orderId)] || { orderId: Number(orderId) };
  existing.paymentInfo = {
    ...(existing.paymentInfo || {}),
    ...paymentData,
    updatedAt: new Date().toISOString(),
  };
  store[String(orderId)] = existing;
  persistDeliveries();
  return existing.paymentInfo;
}

module.exports = {
  getDriverInfo,
  saveDriverInfo,
  deleteDriverInfo,
  validateDriverInput,
  normalizeLicensePlate,
  getSavedDrivers,
  saveDriverToSavedList,
  savePackingChecklist,
  saveIncidentReport,
  savePaymentInfo,
};

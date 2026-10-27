const fs = require('node:fs');
const path = require('node:path');
const { normalizePhone } = require('./registrationValidation');

const dataDir = path.join(__dirname, '../data');
const deliveryFile = path.join(dataDir, 'orders_delivery.json');

let deliveryCache = null;

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(deliveryFile)) {
    fs.writeFileSync(deliveryFile, JSON.stringify({}, null, 2), 'utf8');
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

function getDriverInfo(orderId) {
  if (!orderId) return null;
  const store = loadDeliveries();
  const found = store[String(orderId)];
  return found || null;
}

function saveDriverInfo(orderId, input) {
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
    orderId: Number(orderId),
    ...validation.data,
    assignedAt: existing.assignedAt || now,
    updatedAt: now,
  };

  store[String(orderId)] = record;
  persistDeliveries();
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

module.exports = {
  getDriverInfo,
  saveDriverInfo,
  deleteDriverInfo,
  validateDriverInput,
  normalizeLicensePlate,
};

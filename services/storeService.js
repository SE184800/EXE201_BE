const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '../data');
const storesFile = path.join(dataDir, 'stores.json');

const DEFAULT_STORE_PROFILES = {
  // Demo store owner account default profile
  default: {
    storeName: 'Tiệm Tạp Hóa An Khang',
    storeAddress: '123 Đường Số 4, Phường Bình Trị Đông B, Quận Bình Tân, TP. Hồ Chí Minh',
    storePhone: '0908123456',
    businessType: 'Tạp hóa tổng hợp',
    isConfigured: true,
  },
};

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(storesFile)) {
    fs.writeFileSync(
      storesFile,
      JSON.stringify(
        {
          stores: {
            // Default store for demo user 1 or general store owners
            '1': {
              userId: 1,
              ...DEFAULT_STORE_PROFILES.default,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );
  }
}

function loadData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(storesFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.stores || typeof parsed.stores !== 'object') parsed.stores = {};
    return parsed;
  } catch {
    return { stores: {} };
  }
}

function saveData(data) {
  ensureDataFile();
  const tempFile = `${storesFile}.tmp.${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, storesFile);
}

function getStoreProfile(userId) {
  const data = loadData();
  const key = String(userId);
  if (!data.stores[key]) {
    // Generate default registered store profile for convenience in testing and demo
    data.stores[key] = {
      userId: Number(userId),
      storeName: 'Tiệm Tạp Hóa An Khang',
      storeAddress: '123 Đường Số 4, Phường Bình Trị Đông B, Quận Bình Tân, TP. Hồ Chí Minh',
      storePhone: '0908123456',
      businessType: 'Tạp hóa gia đình',
      isConfigured: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveData(data);
  }
  return data.stores[key];
}

function validateStoreInput(body = {}) {
  const errors = {};
  const storeName = typeof body.storeName === 'string' ? body.storeName.trim().replace(/\s+/g, ' ') : '';
  const storeAddress = typeof body.storeAddress === 'string' ? body.storeAddress.trim().replace(/\s+/g, ' ') : '';
  const storePhone = typeof body.storePhone === 'string' ? body.storePhone.trim().replace(/\s+/g, '') : '';
  const businessType = typeof body.businessType === 'string' ? body.businessType.trim().replace(/\s+/g, ' ') : 'Tạp hóa tổng hợp';

  if (!storeName || storeName.length < 2 || storeName.length > 100) {
    errors.storeName = 'Tên tiệm tạp hóa cần từ 2 đến 100 ký tự.';
  }

  if (!storeAddress || storeAddress.length < 10 || storeAddress.length > 255) {
    errors.storeAddress = 'Địa chỉ cửa hàng cần chi tiết từ 10 đến 255 ký tự (Số nhà, tên đường, phường/xã, quận/huyện, tỉnh/thành).';
  }

  if (storePhone && !/^0\d{9}$/.test(storePhone)) {
    errors.storePhone = 'Số điện thoại cần 10 số bắt đầu bằng 0.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    data: {
      storeName,
      storeAddress,
      storePhone: storePhone || null,
      businessType: businessType || 'Tạp hóa tổng hợp',
    },
  };
}

function saveStoreProfile(userId, body) {
  const validation = validateStoreInput(body);
  if (validation.errors) {
    const error = new Error('Thông tin cửa hàng không hợp lệ.');
    error.status = 400;
    error.errors = validation.errors;
    throw error;
  }

  const data = loadData();
  const key = String(userId);
  const now = new Date().toISOString();

  data.stores[key] = {
    userId: Number(userId),
    ...validation.data,
    isConfigured: true,
    createdAt: data.stores[key]?.createdAt || now,
    updatedAt: now,
  };

  saveData(data);
  return data.stores[key];
}

module.exports = {
  getStoreProfile,
  saveStoreProfile,
  validateStoreInput,
};

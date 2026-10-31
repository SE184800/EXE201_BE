const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '../data');
const storesFile = path.join(dataDir, 'stores.json');

const DEFAULT_STORE_PROFILES = {
  // Demo store owner account default profile for user 1
  default: {
    storeName: 'Tiệm Tạp Hóa An Khang',
    storeAddress: '123 Đường Số 4, Phường Bình Trị Đông B, Quận Bình Tân, TP. Hồ Chí Minh',
    storePhone: '0908123456',
    taxCode: '0312345678',
    businessType: 'Tạp hóa tổng hợp',
    locationType: 'STREET_FRONT',
    alleyDetail: null,
    latitude: 10.762622,
    longitude: 106.660172,
    isAddressVerified: true,
    isConfigured: true,
    bankName: 'Vietcombank',
    bankAccountNumber: '0071001234567',
    bankAccountHolder: 'TIEM TAP HOA AN KHANG',
    bankQrImageUrl: null,
  },
};

function normalizePhone(val) {
  if (!val) return '';
  const compact = String(val).replace(/[\s().-]/g, '');
  if (compact.startsWith('+84')) return `0${compact.slice(3)}`;
  if (compact.startsWith('84') && compact.length === 11) return `0${compact.slice(2)}`;
  return compact;
}

function normalizeAddress(val) {
  if (!val) return '';
  return String(val)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\b(so nha|so|duong|phuong|xa|thi tran|quan|huyen|thi xa|thanh pho|tp|tinh|viet nam)\b/g, '')
    .replace(/[,\.\-\/]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function isAddressDuplicate(addr1, addr2) {
  const n1 = normalizeAddress(addr1);
  const n2 = normalizeAddress(addr2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  if (n1.length >= 8 && n2.length >= 8) {
    if (n1.startsWith(n2) || n2.startsWith(n1)) return true;
  }
  return false;
}

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

function getStoreProfile(userId, defaultPhone = '') {
  const data = loadData();
  const key = String(userId);
  if (!data.stores[key]) {
    // For demo user 1, keep default configured store
    if (key === '1') {
      data.stores[key] = {
        userId: 1,
        ...DEFAULT_STORE_PROFILES.default,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      saveData(data);
      return data.stores[key];
    }

    // For other users, default to unconfigured so they go through onboarding
    data.stores[key] = {
      userId: Number(userId),
      storeName: '',
      storeAddress: '',
      storePhone: defaultPhone || '',
      taxCode: '',
      businessType: 'Tạp hóa tổng hợp',
      locationType: 'STREET_FRONT',
      alleyDetail: null,
      latitude: null,
      longitude: null,
      isAddressVerified: false,
      isConfigured: false,
      bankName: null,
      bankAccountNumber: null,
      bankAccountHolder: null,
      bankQrImageUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveData(data);
  }
  return data.stores[key];
}

function validateStoreInput(body = {}, currentUserId = null) {
  const errors = {};
  const storeName = typeof body.storeName === 'string' ? body.storeName.trim().replace(/\s+/g, ' ') : '';
  const storeAddress = typeof body.storeAddress === 'string' ? body.storeAddress.trim().replace(/\s+/g, ' ') : '';
  const storePhone = typeof body.storePhone === 'string' ? body.storePhone.trim().replace(/\s+/g, '') : '';
  const taxCode = typeof body.taxCode === 'string' ? body.taxCode.trim().replace(/\s+/g, '') : '';
  const businessType = typeof body.businessType === 'string' ? body.businessType.trim().replace(/\s+/g, ' ') : 'Tạp hóa tổng hợp';
  const locationType = body.locationType === 'ALLEY' ? 'ALLEY' : 'STREET_FRONT';
  const alleyDetail = typeof body.alleyDetail === 'string' ? body.alleyDetail.trim() : null;
  const latitude = typeof body.latitude === 'number' && !Number.isNaN(body.latitude) ? body.latitude : null;
  const longitude = typeof body.longitude === 'number' && !Number.isNaN(body.longitude) ? body.longitude : null;
  const isAddressVerified = Boolean(body.isAddressVerified);

  // Banking info (optional for auto-fill on withdrawals/deposits)
  const bankName = typeof body.bankName === 'string' ? body.bankName.trim().slice(0, 100) : '';
  const bankAccountNumber = typeof body.bankAccountNumber === 'string' ? body.bankAccountNumber.trim().replace(/[\s.-]/g, '').slice(0, 34) : '';
  const bankAccountHolder = typeof body.bankAccountHolder === 'string' ? body.bankAccountHolder.trim().toUpperCase().slice(0, 100) : '';
  let bankQrImageUrl = typeof body.bankQrImageUrl === 'string' ? body.bankQrImageUrl.trim() : '';

  if (bankAccountNumber && !/^[A-Za-z0-9]{4,34}$/.test(bankAccountNumber)) {
    errors.bankAccountNumber = 'Số tài khoản ngân hàng không hợp lệ (gồm 4-34 ký tự số/chữ cái, không dấu).';
  }
  if (bankAccountNumber && !bankName) {
    errors.bankName = 'Vui lòng chọn ngân hàng khi đã nhập số tài khoản.';
  }
  if (bankQrImageUrl && (!bankQrImageUrl.startsWith('/uploads/') && !bankQrImageUrl.startsWith('http'))) {
    bankQrImageUrl = '';
  }

  if (!storeName || storeName.length < 2 || storeName.length > 100) {
    errors.storeName = 'Tên tiệm tạp hóa cần từ 2 đến 100 ký tự.';
  }

  if (!storeAddress || storeAddress.length < 10 || storeAddress.length > 255) {
    errors.storeAddress = 'Địa chỉ cửa hàng cần chi tiết từ 10 đến 255 ký tự (Số nhà, tên đường, phường/xã, quận/huyện, tỉnh/thành).';
  } else {
    // Duyệt sơ bộ cấu trúc địa chỉ: Phải có dấu hiệu phân cấp hành chính
    const hasAdmin =
      /(phường|xã|thị trấn|quận|huyện|thị xã|thành phố|tỉnh|tp\.|q\.|h\.|p\.|x\.)/i.test(storeAddress) ||
      storeAddress.includes(',') ||
      storeAddress.split(/\s+/).length >= 5;
    if (!hasAdmin) {
      errors.storeAddress = 'Địa chỉ cần ghi rõ cấu trúc: Số nhà, tên đường, Phường/Xã, Quận/Huyện, Tỉnh/Thành phố.';
    }
  }

  const normalizedPhone = normalizePhone(storePhone);
  if (!normalizedPhone) {
    errors.storePhone = 'Vui lòng cung cấp số điện thoại nhận hàng tại cửa hàng.';
  } else if (!/^0\d{9}$/.test(normalizedPhone)) {
    errors.storePhone = 'Số điện thoại cần 10 số bắt đầu bằng 0.';
  }

  if (!taxCode) {
    errors.taxCode = 'Vui lòng cung cấp mã số thuế của cơ sở kinh doanh.';
  } else if (!/^[A-Za-z0-9-]{10,14}$/.test(taxCode)) {
    errors.taxCode = 'Mã số thuế gồm 10–14 ký tự (chữ, số hoặc gạch ngang).';
  }

  // So sánh tránh trùng số điện thoại và địa chỉ với các tiệm tạp hóa khác
  if (currentUserId !== null) {
    const data = loadData();
    const currentKey = String(currentUserId);
    const normAddr = normalizeAddress(storeAddress);

    for (const [key, store] of Object.entries(data.stores)) {
      if (key === currentKey || !store.isConfigured) continue;

      if (normalizedPhone && normalizePhone(store.storePhone) === normalizedPhone) {
        errors.storePhone = 'Số điện thoại này đã được sử dụng bởi một tiệm tạp hóa khác.';
      }

      if (isAddressDuplicate(store.storeAddress, storeAddress)) {
        errors.storeAddress = 'Địa chỉ này đã được đăng ký bởi một tiệm tạp hóa khác trong hệ thống. Mỗi địa chỉ chỉ áp dụng cho một cửa hàng duy nhất để tránh trường hợp 2 tiệm cùng 1 địa chỉ.';
      }

      if (taxCode && store.taxCode && store.taxCode.trim().toLowerCase() === taxCode.toLowerCase()) {
        errors.taxCode = 'Mã số thuế này đã được đăng ký bởi một tiệm tạp hóa khác.';
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    data: {
      storeName,
      storeAddress,
      storePhone: normalizedPhone,
      taxCode: taxCode || null,
      businessType: businessType || 'Tạp hóa tổng hợp',
      locationType,
      alleyDetail: locationType === 'ALLEY' ? alleyDetail : null,
      latitude,
      longitude,
      isAddressVerified,
      bankName: bankName || null,
      bankAccountNumber: bankAccountNumber || null,
      bankAccountHolder: bankAccountHolder || null,
      bankQrImageUrl: bankQrImageUrl || null,
    },
  };
}

function saveStoreProfile(userId, body) {
  const validation = validateStoreInput(body, userId);
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
  normalizePhone,
  normalizeAddress,
};

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { audit } = require('../services/platformPolicy');
const { normalizePhone, todayInVietnam, getBirthDateRange } = require('../services/registrationValidation');
const { getStoreProfile, saveStoreProfile } = require('../services/storeService');

const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const qrStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.png';
    const rand = crypto.randomBytes(16).toString('hex');
    cb(null, `bank-qr-${rand}${safeExt}`);
  },
});

const uploadQr = multer({
  storage: qrStorage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB maximum
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file ảnh định dạng JPG, PNG hoặc WEBP (tối đa 3MB). Không hỗ trợ SVG hoặc file thực thi.'));
    }
  },
});

const select = {
  id: true,
  username: true,
  name: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  createdAt: true,
  role: { select: { code: true } },
  supplierProfile: true,
};

const serialize = (user) => {
  const roleCode = user.role?.code || user.role;
  const storeProfile = (roleCode === 'STORE_OWNER' || !roleCode) ? getStoreProfile(user.id, user.phone) : null;
  return {
    ...user,
    role: roleCode,
    storeProfile,
    supplierProfile: user.supplierProfile || null,
  };
};

function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { message: 'Thông tin không hợp lệ.' };
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = normalizePhone(body.phone);
  const birth = typeof body.dateOfBirth === 'string' ? body.dateOfBirth : '';
  const nameWithoutSpaces = name.replace(/\s/g, '');
  if (nameWithoutSpaces.length < 2 || name.length > 100) {
    return { message: 'Họ tên cần 2–100 ký tự (không tính khoảng trắng).' };
  }
  if (body.email !== null && typeof body.email !== 'string') return { message: 'Email không hợp lệ.' };
  if (body.phone !== null && typeof body.phone !== 'string') return { message: 'Số điện thoại không hợp lệ.' };
  if (body.dateOfBirth !== null && typeof body.dateOfBirth !== 'string') return { message: 'Ngày sinh không hợp lệ.' };
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 255 || !/^[\x21-\x7E]+$/.test(email))) {
    return { message: 'Nhập email hợp lệ, không dấu và tối đa 255 ký tự.' };
  }
  if (phone && !/^0\d{9}$/.test(phone)) return { message: 'Số điện thoại cần 10 số bắt đầu bằng 0 hoặc dùng +84.' };
  let dateOfBirth = null;
  if (birth) {
    const { minDate, maxDate, minDateDisplay, maxDateDisplay } = getBirthDateRange();
    dateOfBirth = new Date(`${birth}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || Number.isNaN(dateOfBirth.valueOf()) || birth < minDate || birth > maxDate || dateOfBirth.toISOString().slice(0, 10) !== birth) {
      return { message: `Vui lòng chọn ngày sinh trong khoảng ${minDateDisplay} đến ${maxDateDisplay} (từ 18 đến 100 tuổi).` };
    }
  }
  return { data: { name, email: email || null, phone: phone || null, dateOfBirth } };
}

function createProfileRoutes(prisma, requireAuth) {
  const router = express.Router();
  router.use(requireAuth);

  // Dedicated store profile endpoints
  router.get('/store', (req, res) => {
    const userPhone = req.auth.user?.phone || '';
    const storeProfile = getStoreProfile(req.auth.user.id, userPhone);
    res.json({ storeProfile });
  });

  router.put('/store', (req, res) => {
    try {
      const storeProfile = saveStoreProfile(req.auth.user.id, req.body);
      res.json({ success: true, storeProfile, message: 'Đã cập nhật thông tin tiệm tạp hóa thành công.' });
    } catch (err) {
      res.status(err.status || 400).json({ message: err.message, errors: err.errors });
    }
  });

  // Secure QR code upload endpoint
  router.post('/upload-bank-qr', (req, res, next) => {
    uploadQr.single('qrImage')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, message: 'Dung lượng ảnh mã QR không được vượt quá 3MB.' });
        }
        return res.status(400).json({ success: false, message: `Lỗi tải ảnh: ${err.message}` });
      } else if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn file ảnh mã QR để tải lên.' });
      }
      const imageUrl = `/uploads/${req.file.filename}`;
      return res.json({ success: true, imageUrl, message: 'Tải ảnh mã QR thành công.' });
    });
  });

  router.get('/', async (req, res, next) => {
    try {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.user.id }, select });
      res.json({ profile: serialize(user) });
    } catch (error) {
      next(error);
    }
  });

  router.put('/', async (req, res, next) => {
    const validation = validateProfile(req.body);
    if (!validation.data) return res.status(400).json({ message: validation.message });

    try {
      const contactFilters = ['email', 'phone'].filter((field) => validation.data[field]).map((field) => ({ [field]: validation.data[field] }));
      if (contactFilters.length && await prisma.user.findFirst({ where: { id: { not: req.auth.user.id }, OR: contactFilters }, select: { id: true } })) {
        return res.status(409).json({ message: 'Email hoặc số điện thoại đã được tài khoản khác sử dụng.' });
      }

      // If store info is included in profile update, also save it
      let updatedStoreProfile = null;
      if (req.body.storeName || req.body.storeAddress) {
        updatedStoreProfile = saveStoreProfile(req.auth.user.id, {
          storeName: req.body.storeName,
          storeAddress: req.body.storeAddress,
          storePhone: req.body.storePhone || validation.data.phone,
          taxCode: req.body.taxCode,
          businessType: req.body.businessType,
          locationType: req.body.locationType,
          alleyDetail: req.body.alleyDetail,
          latitude: req.body.latitude,
          longitude: req.body.longitude,
          isAddressVerified: req.body.isAddressVerified,
          bankName: req.body.bankName,
          bankAccountNumber: req.body.bankAccountNumber,
          bankAccountHolder: req.body.bankAccountHolder,
          bankQrImageUrl: req.body.bankQrImageUrl,
        });
      }

      // If supplier info is included in profile update, also save it
      let updatedSupplierProfile = null;
      if (req.body.businessName || req.body.warehouseAddress) {
        const bName = (req.body.businessName || '').trim().replace(/\s+/g, ' ');
        const wAddr = (req.body.warehouseAddress || '').trim().replace(/\s+/g, ' ');
        const tCode = req.body.taxCode ? req.body.taxCode.trim().replace(/\s+/g, '') : null;
        updatedSupplierProfile = await prisma.supplierProfile.upsert({
          where: { userId: req.auth.user.id },
          create: {
            userId: req.auth.user.id,
            businessName: bName || 'Kho Sỉ',
            warehouseAddress: wAddr || '',
            taxCode: tCode,
            deliveryRadiusKm: typeof req.body.deliveryRadiusKm === 'number' ? req.body.deliveryRadiusKm : 10,
            deliveryFee: typeof req.body.deliveryFee === 'number' ? req.body.deliveryFee : 0,
          },
          update: {
            ...(bName ? { businessName: bName } : {}),
            ...(wAddr ? { warehouseAddress: wAddr } : {}),
            ...(tCode !== undefined ? { taxCode: tCode } : {}),
            ...(typeof req.body.deliveryRadiusKm === 'number' ? { deliveryRadiusKm: req.body.deliveryRadiusKm } : {}),
          },
        });
      }

      const profile = await prisma.$transaction(async (tx) => {
        const saved = await tx.user.update({ where: { id: req.auth.user.id }, data: validation.data, select });
        await audit(tx, req.auth.user.id, 'PERSONAL_PROFILE_UPDATED', 'USER', req.auth.user.id, { changedFields: Object.keys(validation.data) });
        return saved;
      });

      const serialized = serialize(profile);
      if (updatedStoreProfile) {
        serialized.storeProfile = updatedStoreProfile;
      }
      if (updatedSupplierProfile) {
        serialized.supplierProfile = updatedSupplierProfile;
      }

      res.json({ profile: serialized, message: 'Đã cập nhật thông tin cá nhân và cơ sở kinh doanh thành công.' });
    } catch (error) {
      if (error.code === 'P2002') return res.status(409).json({ message: 'Email hoặc số điện thoại đã được tài khoản khác sử dụng.' });
      next(error);
    }
  });

  return router;
}

module.exports = { createProfileRoutes, validateProfile };

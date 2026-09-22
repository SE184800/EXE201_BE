const express = require('express');
const { audit } = require('../services/platformPolicy');
const { normalizePhone, todayInVietnam } = require('../services/registrationValidation');
const select = { id: true, username: true, name: true, email: true, phone: true, dateOfBirth: true, createdAt: true, role: { select: { code: true } } };
const serialize = (user) => ({ ...user, role: user.role.code });
function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { message: 'Thông tin không hợp lệ.' };
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = normalizePhone(body.phone);
  const birth = typeof body.dateOfBirth === 'string' ? body.dateOfBirth : '';
  if (!/^[\p{L}\p{M} .'-]{2,100}$/u.test(name) || !/\p{L}/u.test(name)) return { message: 'Họ tên cần 2–100 ký tự chữ cái và dấu phân cách hợp lệ.' };
  if (body.email !== null && typeof body.email !== 'string') return { message: 'Email không hợp lệ.' };
  if (body.phone !== null && typeof body.phone !== 'string') return { message: 'Số điện thoại không hợp lệ.' };
  if (body.dateOfBirth !== null && typeof body.dateOfBirth !== 'string') return { message: 'Ngày sinh không hợp lệ.' };
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 255 || !/^[\x21-\x7E]+$/.test(email))) return { message: 'Nhập email hợp lệ, không dấu và tối đa 255 ký tự.' };
  if (phone && !/^0\d{9}$/.test(phone)) return { message: 'Số điện thoại cần 10 số bắt đầu bằng 0 hoặc dùng +84.' };
  let dateOfBirth = null;
  if (birth) {
    dateOfBirth = new Date(`${birth}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || Number.isNaN(dateOfBirth.valueOf()) || birth < '1900-01-01' || birth > todayInVietnam() || dateOfBirth.toISOString().slice(0, 10) !== birth) return { message: 'Ngày sinh phải có thật, từ 01/01/1900 đến hôm nay.' };
  }
  return { data: { name, email: email || null, phone: phone || null, dateOfBirth } };
}
function createProfileRoutes(prisma, requireAuth) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/', async (req, res, next) => {
    try { res.json({ profile: serialize(await prisma.user.findUniqueOrThrow({ where: { id: req.auth.user.id }, select })) }); }
    catch (error) { next(error); }
  });
  router.put('/', async (req, res, next) => {
    const validation = validateProfile(req.body);
    if (!validation.data) return res.status(400).json({ message: validation.message });
    try {
      const contactFilters = ['email', 'phone'].filter((field) => validation.data[field]).map((field) => ({ [field]: validation.data[field] }));
      if (contactFilters.length && await prisma.user.findFirst({ where: { id: { not: req.auth.user.id }, OR: contactFilters }, select: { id: true } })) return res.status(409).json({ message: 'Email hoặc số điện thoại đã được tài khoản khác sử dụng.' });
      // Only explicitly allowed fields; never accept id, role, username or password.
      const profile = await prisma.$transaction(async tx => {
        const saved = await tx.user.update({ where: { id: req.auth.user.id }, data: validation.data, select });
        await audit(tx, req.auth.user.id, 'PERSONAL_PROFILE_UPDATED', 'USER', req.auth.user.id, { changedFields: Object.keys(validation.data) });
        return saved;
      });
      res.json({ profile: serialize(profile), message: 'Đã cập nhật thông tin cá nhân.' });
    } catch (error) {
      if (error.code === 'P2002') return res.status(409).json({ message: 'Email hoặc số điện thoại đã được tài khoản khác sử dụng.' });
      next(error);
    }
  });
  return router;
}
module.exports = { createProfileRoutes, validateProfile };

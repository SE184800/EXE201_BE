const express = require('express');
const bcrypt = require('bcryptjs');
const { createHash, randomBytes } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { createResetMailer } = require('../services/resetMail');
const { COOKIE_NAME, cookieOptions } = require('../services/authService');
const hash = value => createHash('sha256').update(value).digest('hex');
const invalidToken = () => Object.assign(new Error('Liên kết không hợp lệ, đã dùng hoặc hết hạn. Hãy yêu cầu liên kết mới.'), { status: 400 });
function passwordError(password, confirmPassword) {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72 || password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) return 'Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, chữ thường, số, ký tự đặc biệt; tối đa 72 byte.';
  return password === confirmPassword ? '' : 'Mật khẩu nhập lại không khớp.';
}
function createPasswordRoutes(prisma, requireAuth, config) {
  const router = express.Router();
  const sendMail = createResetMailer(config);
  const limiter = () => rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Bạn đã thử nhiều lần. Hãy thử lại sau 15 phút.' } });
  router.get('/password-options', (req, res) => res.json({ recoveryAvailable: Boolean(config.sendResetMail || config.mailTransport === 'file' || (config.mailTransport === 'smtp' && config.smtp?.host && config.smtp?.from)), localMail: !config.production && config.mailTransport === 'file' }));
  router.post('/forgot-password', limiter(), async (req, res, next) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 255 || !/^[\x21-\x7E]+$/.test(email)) return res.status(400).json({ message: 'Nhập email hợp lệ.' });
    if (!config.sendResetMail && !(config.mailTransport === 'file' && !config.production) && !(config.mailTransport === 'smtp' && config.smtp?.host && config.smtp?.from)) return res.status(503).json({ message: 'Khôi phục mật khẩu chưa sẵn sàng. Vui lòng liên hệ quản trị viên.' });
    try {
      const user = await prisma.user.findFirst({ where: { email, isActive: true } });
      if (user) {
        const token = randomBytes(32).toString('hex');
        const tokenHash = hash(token);
        await prisma.passwordReset.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } });
        await prisma.passwordReset.create({ data: { tokenHash, userId: user.id, passwordSnapshot: user.passwordHash, expiresAt: new Date(Date.now() + 15 * 60000) } });
        try { await sendMail({ to: user.email, url: `${config.origin}/reset-password#token=${token}` }); }
        catch { await prisma.passwordReset.deleteMany({ where: { tokenHash } }); console.error('Password reset mail could not be delivered.'); }
      }
      res.json({ message: 'Nếu email thuộc tài khoản đang hoạt động, bạn sẽ nhận được liên kết đặt lại mật khẩu.' });
    } catch (error) { next(error); }
  });
  router.post('/reset-password', limiter(), async (req, res, next) => {
    const { token, password, confirmPassword } = req.body || {};
    const message = passwordError(password, confirmPassword);
    if (message) return res.status(400).json({ message });
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ message: invalidToken().message });
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.$transaction(async tx => {
        const reset = await tx.passwordReset.findUnique({ where: { tokenHash: hash(token) } });
        if (!reset || reset.expiresAt <= new Date()) throw invalidToken();
        const claim = await tx.passwordReset.deleteMany({ where: { tokenHash: reset.tokenHash, expiresAt: { gt: new Date() } } });
        if (!claim.count) throw invalidToken();
        const updated = await tx.user.updateMany({ where: { id: reset.userId, isActive: true, passwordHash: reset.passwordSnapshot }, data: { passwordHash } });
        if (!updated.count) throw invalidToken();
        await tx.authSession.deleteMany({ where: { userId: reset.userId } });
        await tx.passwordReset.deleteMany({ where: { userId: reset.userId } });
      });
      res.clearCookie(COOKIE_NAME, cookieOptions(config));
      res.json({ message: 'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.' });
    } catch (error) { next(error); }
  });
  router.post('/change-password', requireAuth, limiter(), async (req, res, next) => {
    const { currentPassword, password, confirmPassword } = req.body || {};
    const message = passwordError(password, confirmPassword);
    if (message || typeof currentPassword !== 'string' || !currentPassword || Buffer.byteLength(currentPassword, 'utf8') > 72) return res.status(400).json({ message: message || 'Nhập mật khẩu hiện tại hợp lệ.' });
    try {
      const user = await prisma.user.findUnique({ where: { id: req.auth.user.id } });
      if (!user || !await bcrypt.compare(currentPassword, user.passwordHash)) return res.status(400).json({ message: 'Mật khẩu hiện tại chưa chính xác.' });
      if (await bcrypt.compare(password, user.passwordHash)) return res.status(400).json({ message: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.$transaction(async tx => {
        const updated = await tx.user.updateMany({ where: { id: user.id, isActive: true, passwordHash: user.passwordHash }, data: { passwordHash } });
        if (!updated.count) throw invalidToken();
        await tx.authSession.deleteMany({ where: { userId: user.id } });
        await tx.passwordReset.deleteMany({ where: { userId: user.id } });
      });
      res.clearCookie(COOKIE_NAME, cookieOptions(config));
      res.json({ message: 'Đã đổi mật khẩu và đăng xuất các phiên. Hãy đăng nhập lại.' });
    } catch (error) { next(error); }
  });
  router.use((error, req, res, next) => error.status || error.code === 'P2034' ? res.status(error.status || 409).json({ message: error.status ? error.message : 'Yêu cầu đang được xử lý. Hãy thử lại.' }) : next(error));
  return router;
}
module.exports = { createPasswordRoutes, passwordError };

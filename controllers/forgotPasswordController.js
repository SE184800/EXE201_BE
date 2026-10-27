const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const {
  generateOtp,
  createResetOtpToken,
  verifyResetOtpToken,
  createPasswordResetToken,
  verifyPasswordResetToken,
  sendOtpMail,
} = require('../services/otpService');
const { audit } = require('../services/platformPolicy');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function createForgotPasswordController(config = {}) {
  const jwtSecret = config.jwtSecret || process.env.JWT_SECRET;

  // 1. Request OTP for password reset
  async function requestOtp(req, res, next) {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const localPart = email.split('@')[0] || '';

      if (
        !EMAIL_PATTERN.test(email) ||
        email.length > 255 ||
        !/^[\x21-\x7E]+$/.test(email) ||
        /\s/.test(email) ||
        localPart.replace(/\s/g, '').length < 2
      ) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng nhập địa chỉ email hợp lệ, không chứa khoảng trắng.',
        });
      }

      const user = await prisma.user.findFirst({
        where: { email },
        select: { id: true, name: true, username: true, email: true, isActive: true },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy tài khoản nào liên kết với địa chỉ email này.',
        });
      }

      if (user.isActive === false) {
        return res.status(403).json({
          success: false,
          message: 'Tài khoản này đã bị khóa. Vui lòng liên hệ Quản trị viên để được hỗ trợ.',
        });
      }

      const otp = generateOtp();
      const resetOtpToken = createResetOtpToken(
        { userId: user.id, email: user.email, username: user.username, name: user.name },
        otp,
        jwtSecret
      );

      await sendOtpMail({
        to: user.email,
        name: user.name,
        otp,
        config,
        type: 'forgot_password',
      });

      return res.status(200).json({
        success: true,
        message: `Mã xác thực khôi phục mật khẩu đã được gửi đến email ${user.email}.`,
        email: user.email,
        resetOtpToken,
        expiresIn: 60,
        devOtp: (!config.production && !config.gmail?.user && !config.smtp?.host) ? otp : undefined,
      });
    } catch (err) {
      return next(err);
    }
  }

  // 2. Verify OTP
  async function verifyOtp(req, res, next) {
    try {
      const { resetOtpToken, otp } = req.body || {};
      if (!resetOtpToken || typeof resetOtpToken !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Phiên xác thực không hợp lệ hoặc đã kết thúc. Vui lòng thử lại.',
        });
      }
      if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Mã OTP phải gồm 6 chữ số.',
        });
      }

      const userPayload = verifyResetOtpToken(resetOtpToken, otp.trim(), jwtSecret);
      const resetPassToken = createPasswordResetToken(userPayload, jwtSecret);

      return res.status(200).json({
        success: true,
        message: 'Xác thực OTP thành công! Vui lòng tạo mật khẩu mới.',
        resetPassToken,
        email: userPayload.email,
        username: userPayload.username,
      });
    } catch (err) {
      if (err.code === 'OTP_EXPIRED') {
        return res.status(400).json({
          success: false,
          code: 'OTP_EXPIRED',
          message: err.message,
        });
      }
      if (err.code === 'OTP_MISMATCH') {
        return res.status(400).json({
          success: false,
          code: 'OTP_MISMATCH',
          message: err.message,
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Xác thực mã OTP thất bại.',
      });
    }
  }

  // 3. Resend OTP
  async function resendOtp(req, res, next) {
    return requestOtp(req, res, next);
  }

  // 4. Reset Password
  async function resetPassword(req, res, next) {
    try {
      const { resetPassToken, password, confirmPassword } = req.body || {};
      if (!resetPassToken || typeof resetPassToken !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Phiên đặt lại mật khẩu đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.',
        });
      }

      let userPayload;
      try {
        userPayload = verifyPasswordResetToken(resetPassToken, jwtSecret);
      } catch (tokenErr) {
        return res.status(400).json({
          success: false,
          message: 'Phiên đổi mật khẩu đã hết hạn hoặc không hợp lệ. Vui lòng thực hiện lại từ đầu.',
        });
      }

      const pass = typeof password === 'string' ? password : '';
      const conf = typeof confirmPassword === 'string' ? confirmPassword : '';
      const passWithoutSpaces = pass.replace(/\s/g, '');

      if (new TextEncoder().encode(pass).length > 72) {
        return res.status(400).json({
          success: false,
          message: 'Mật khẩu quá dài. Hãy dùng mật khẩu ngắn hơn (tối đa 72 bytes).',
        });
      }
      if (pass.trim() !== pass) {
        return res.status(400).json({
          success: false,
          message: 'Mật khẩu không được chứa khoảng trắng ở đầu hoặc cuối.',
        });
      }
      if (
        passWithoutSpaces.length < 8 ||
        !/[a-z]/.test(pass) ||
        !/[A-Z]/.test(pass) ||
        !/\d/.test(pass) ||
        !/[^A-Za-z0-9\s]/.test(pass)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Mật khẩu cần ít nhất 8 ký tự (không tính khoảng trắng), gồm chữ hoa, chữ thường, số và ký tự đặc biệt.',
        });
      }

      if (!conf) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng nhập lại mật khẩu xác nhận.',
        });
      }
      if (pass !== conf) {
        return res.status(400).json({
          success: false,
          message: 'Mật khẩu nhập lại không khớp.',
        });
      }

      const passwordHash = await bcrypt.hash(pass, 12);

      await prisma.user.update({
        where: { id: userPayload.userId },
        data: { passwordHash },
      });

      // Invalidate active auth sessions
      try {
        await prisma.authSession.deleteMany({
          where: { userId: userPayload.userId },
        });
      } catch {
        // non-blocking
      }

      // Record audit log
      try {
        await audit(prisma, userPayload.userId, 'USER_PASSWORD_RESET', 'USER', String(userPayload.userId), {
          email: userPayload.email,
          username: userPayload.username,
        });
      } catch {
        // non-blocking
      }

      return res.status(200).json({
        success: true,
        message: 'Đổi mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.',
        username: userPayload.username,
      });
    } catch (err) {
      return next(err);
    }
  }

  return {
    requestOtp,
    verifyOtp,
    resendOtp,
    resetPassword,
  };
}

module.exports = { createForgotPasswordController };

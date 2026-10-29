const { validateRegistrationInput } = require('../services/registrationValidation');
const { getOrCreateUserContract } = require('../services/contractService');
const { sendPrivateKeyEmail } = require('../services/contractMailService');
const {
  generateOtp,
  createOtpToken,
  verifyOtpToken,
  sendOtpMail,
} = require('../services/otpService');

function createRegistrationController(authService, config = {}) {
  // 1. Direct registration (kept for backwards compatibility and automated tests)
  async function register(req, res, next) {
    const validation = validateRegistrationInput(req.body);
    if (!validation.data) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        errors: validation.errors,
      });
    }
    try {
      const user = await authService.register(validation.data);

      // Khoi tao hop dong va gui email chua Khoa bi mat (Private Key)
      let contractNumber = null;
      try {
        const contract = getOrCreateUserContract(user);
        contractNumber = contract.contractNumber;
        const targetEmail = user.email || (typeof registrationData !== 'undefined' ? registrationData.email : validation.data.email);
        if (targetEmail) {
          sendPrivateKeyEmail({
            to: targetEmail,
            user: { ...user, email: targetEmail },
            contract,
            config,
          }).catch((mailErr) => {
            console.warn('[REGISTRATION] Gui email Private Key that bai:', mailErr.message);
          });
        }
      } catch (contractErr) {
        console.warn('[REGISTRATION] Khoi tao hop dong that bai:', contractErr.message);
      }
      return res.status(201).json({
        success: true,
        message: 'Đăng ký thành công. Bạn có thể đăng nhập ngay.',
        user,
      });
    } catch (error) {
      if (error.code === 'DUPLICATE_ACCOUNT_FIELD') {
        return res.status(409).json({
          success: false,
          message: error.message,
          errors: error.errors,
        });
      }
      return next(error);
    }
  }

  // 2. Request OTP for registration
  async function requestOtp(req, res, next) {
    const validation = validateRegistrationInput(req.body);
    if (!validation.data) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        errors: validation.errors,
      });
    }

    try {
      // Check duplicate accounts prior to sending OTP
      if (authService.findRegistrationConflict) {
        const conflict = await authService.findRegistrationConflict(validation.data);
        if (conflict) {
          return res.status(409).json({
            success: false,
            message: conflict.message,
            errors: conflict.errors,
          });
        }
      }

      const otp = generateOtp();
      const jwtSecret = config.jwtSecret || process.env.JWT_SECRET;
      const otpToken = createOtpToken(validation.data, otp, jwtSecret);

      await sendOtpMail({
        to: validation.data.email,
        otp,
        config,
      });

      return res.status(200).json({
        success: true,
        message: `Mã OTP đã được gửi đến email ${validation.data.email}.`,
        email: validation.data.email,
        otpToken,
        expiresIn: 60,
        // In local development or if real mail is not configured, supply devOtp for effortless testing
        devOtp: (!config.production && !config.gmail?.user && !config.smtp?.host) ? otp : undefined,
      });
    } catch (error) {
      if (error.code === 'DUPLICATE_ACCOUNT_FIELD') {
        return res.status(409).json({
          success: false,
          message: error.message,
          errors: error.errors,
        });
      }
      return next(error);
    }
  }

  // 3. Verify OTP and finalize account registration
  async function verifyOtp(req, res, next) {
    const { otpToken, otp } = req.body || {};
    if (!otpToken || typeof otpToken !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Phiên xác thực không hợp lệ hoặc đã kết thúc. Vui lòng thử lại.',
      });
    }

    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập đúng 6 chữ số mã OTP.',
      });
    }

    try {
      const jwtSecret = config.jwtSecret || process.env.JWT_SECRET;
      const registrationData = verifyOtpToken(otpToken, otp.trim(), jwtSecret);

      const user = await authService.register(registrationData);

      // Khoi tao hop dong va gui email chua Khoa bi mat (Private Key)
      let contractNumber = null;
      try {
        const contract = getOrCreateUserContract(user);
        contractNumber = contract.contractNumber;
        const targetEmail = user.email || (typeof registrationData !== 'undefined' ? registrationData.email : validation.data.email);
        if (targetEmail) {
          sendPrivateKeyEmail({
            to: targetEmail,
            user: { ...user, email: targetEmail },
            contract,
            config,
          }).catch((mailErr) => {
            console.warn('[REGISTRATION] Gui email Private Key that bai:', mailErr.message);
          });
        }
      } catch (contractErr) {
        console.warn('[REGISTRATION] Khoi tao hop dong that bai:', contractErr.message);
      }
      return res.status(201).json({
        success: true,
        message: 'Xác thực OTP thành công! Tài khoản của bạn đã được kích hoạt.',
        user,
      });
    } catch (error) {
      if (error.code === 'OTP_EXPIRED') {
        return res.status(400).json({
          success: false,
          code: 'OTP_EXPIRED',
          message: error.message,
        });
      }
      if (error.code === 'OTP_MISMATCH') {
        return res.status(400).json({
          success: false,
          code: 'OTP_MISMATCH',
          message: 'Mã OTP không chính xác. Vui lòng kiểm tra lại.',
        });
      }
      if (error.code === 'DUPLICATE_ACCOUNT_FIELD') {
        return res.status(409).json({
          success: false,
          message: error.message,
          errors: error.errors,
        });
      }
      return next(error);
    }
  }

  // 4. Resend OTP
  async function resendOtp(req, res, next) {
    const validation = validateRegistrationInput(req.body);
    if (!validation.data) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        errors: validation.errors,
      });
    }

    try {
      if (authService.findRegistrationConflict) {
        const conflict = await authService.findRegistrationConflict(validation.data);
        if (conflict) {
          return res.status(409).json({
            success: false,
            message: conflict.message,
            errors: conflict.errors,
          });
        }
      }

      const otp = generateOtp();
      const jwtSecret = config.jwtSecret || process.env.JWT_SECRET;
      const otpToken = createOtpToken(validation.data, otp, jwtSecret);

      await sendOtpMail({
        to: validation.data.email,
        otp,
        config,
      });

      return res.status(200).json({
        success: true,
        message: `Mã OTP mới đã được gửi đến email ${validation.data.email}.`,
        email: validation.data.email,
        otpToken,
        expiresIn: 60,
        devOtp: (!config.production && !config.gmail?.user && !config.smtp?.host) ? otp : undefined,
      });
    } catch (error) {
      return next(error);
    }
  }

  return {
    register,
    requestOtp,
    verifyOtp,
    resendOtp,
  };
}

module.exports = { createRegistrationController };

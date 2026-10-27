const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createAuthController } = require('../controllers/authController');
const { createRegistrationController } = require('../controllers/registrationController');

function createAuthRoutes(authService, requireAuth, config) {
  const router = express.Router();
  const controller = createAuthController(authService, config);
  const registration = createRegistrationController(authService, config);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      success: false,
      message: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.',
    },
  });

  // =========================================================================
  // CƠ CHẾ CHỐNG SPAM ĐĂNG KÝ (REGISTRATION RATE LIMITER)
  // TẠM THỜI TẮT (bypassRegistrationLimiter = true) để thuận tiện test luồng.
  // Khi cần bật lại cho Production, chỉ cần đổi biến này thành false.
  // =========================================================================
  const bypassRegistrationLimiter = true;

  const registrationLimiter = bypassRegistrationLimiter
    ? (req, res, next) => next() // Bỏ qua rate limit để test gửi request liên tục
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 5,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: {
          success: false,
          message: 'Bạn đã gửi yêu cầu đăng ký quá nhiều lần. Vui lòng thử lại sau 15 phút.',
        },
      });

  router.post('/login', loginLimiter, controller.login);
  router.post('/register', registrationLimiter, registration.register);
  router.post('/register-request-otp', registrationLimiter, registration.requestOtp);
  router.post('/register-verify-otp', registration.verifyOtp);
  router.post('/register-resend-otp', registrationLimiter, registration.resendOtp);

  router.get('/me', requireAuth, controller.me);
  router.post('/logout', controller.logout);
  return router;
}

module.exports = { createAuthRoutes };

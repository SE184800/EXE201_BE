const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createAuthController } = require('../controllers/authController');
const { createRegistrationController } = require('../controllers/registrationController');

function createAuthRoutes(authService, requireAuth, config) {
  const router = express.Router();
  const controller = createAuthController(authService, config);
  const register = createRegistrationController(authService);
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
  router.post('/login', loginLimiter, controller.login);
  router.post('/register', rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false }), register);
  router.get('/me', requireAuth, controller.me);
  router.post('/logout', controller.logout);
  return router;
}
module.exports = { createAuthRoutes };

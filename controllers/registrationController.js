const { validateRegistrationInput } = require('../services/registrationValidation');

function createRegistrationController(authService) {
  return async function register(req, res, next) {
    const validation = validateRegistrationInput(req.body);
    if (!validation.data) return res.status(400).json({ success: false, message: validation.message });
    try {
      const user = await authService.register(validation.data);
      return res.status(201).json({ success: true, message: 'Đăng ký thành công. Bạn có thể đăng nhập ngay.', user });
    } catch (error) {
      if (error.code === 'DUPLICATE_ACCOUNT_FIELD') return res.status(409).json({ success: false, message: error.message });
      return next(error);
    }
  };
}

module.exports = { createRegistrationController };

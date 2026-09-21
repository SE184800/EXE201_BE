const { COOKIE_NAME } = require('../services/authService');

function createRequireAuth(authService) {
  return async (req, res, next) => {
    try {
      const auth = await authService.authenticate(req.cookies[COOKIE_NAME]);
      if (!auth)
        return res
          .status(401)
          .json({ success: false, message: 'Vui lòng đăng nhập để tiếp tục.' });
      req.auth = auth;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth.user.role)) {
      return res
        .status(403)
        .json({
          success: false,
          message: 'Bạn không có quyền truy cập chức năng này.',
        });
    }
    next();
  };
}
module.exports = { createRequireAuth, requireRole };

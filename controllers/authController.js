const { COOKIE_NAME, cookieOptions } = require('../services/authService');

function createAuthController(authService, config) {
  return {
    async login(req, res, next) {
      const { username, password } = req.body || {};
      if (
        typeof username !== 'string' ||
        !/^[a-zA-Z0-9._-]{3,50}$/.test(username.trim()) ||
        typeof password !== 'string' ||
        !password ||
        Buffer.byteLength(password, 'utf8') > 72
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message: 'Vui lòng nhập username và mật khẩu hợp lệ.',
          });
      }
      try {
        const result = await authService.login(
          username.trim().toLowerCase(),
          password,
        );
        if (!result)
          return res
            .status(401)
            .json({
              success: false,
              message: 'Username hoặc mật khẩu không chính xác.',
            });
        res.cookie(COOKIE_NAME, result.token, {
          ...cookieOptions(config),
          maxAge: config.sessionSeconds * 1000,
        });
        return res.json({ success: true, user: result.user });
      } catch (error) {
        next(error);
      }
    },
    me(req, res) {
      res.json({ success: true, user: req.auth.user });
    },
    async logout(req, res, next) {
      try {
        const auth = await authService.authenticate(req.cookies[COOKIE_NAME]);
        if (auth) await authService.logout(auth.sessionId);
        res.clearCookie(COOKIE_NAME, cookieOptions(config));
        res.json({ success: true, message: 'Đã đăng xuất.' });
      } catch (error) {
        next(error);
      }
    },
  };
}
module.exports = { createAuthController };

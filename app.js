const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { createAuthService } = require('./services/authService');
const {
  createRequireAuth,
  requireRole,
} = require('./middlewares/authMiddleware');
const { createAuthRoutes } = require('./routes/authRoutes');
const { createUserRoutes } = require('./routes/userRoutes');
const { ROLES } = require('./config/roles');

function createApp(prisma, config) {
  const app = express();
  const authService = createAuthService(prisma, config);
  const requireAuth = createRequireAuth(authService);
  app.disable('x-powered-by');
  app.use(cors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin || config.allowedOrigins.includes(requestOrigin)) return callback(null, requestOrigin || config.origin);
      return callback(null, false);
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (
        req.get('X-CSRF-Protection') !== 'sg-restock-web' ||
        (origin && !config.allowedOrigins.includes(origin))
      ) {
        return res
          .status(403)
          .json({ success: false, message: 'Nguồn gửi yêu cầu không hợp lệ.' });
      }
    }
    next();
  });
  app.get('/', (req, res) =>
    res.json({ name: 'SupplyMind AI API', status: 'running' }),
  );
  app.use('/api/auth', createAuthRoutes(authService, requireAuth, config));
  app.use('/api/users', createUserRoutes(prisma, requireAuth));
  for (const [path, role] of [
    ['store', ROLES.STORE_OWNER],
    ['supplier', ROLES.SUPPLIER],
    ['admin', ROLES.ADMIN],
  ]) {
    app.get(
      `/api/workspaces/${path}`,
      requireAuth,
      requireRole(role),
      (req, res) => {
        res.json({ success: true, user: req.auth.user, workspace: path });
      },
    );
  }
  app.use((req, res) =>
    res.status(404).json({ success: false, message: 'Không tìm thấy API.' }),
  );
  app.use((error, req, res, next) => {
    if (
      error.type === 'entity.parse.failed' ||
      error.type === 'entity.too.large'
    ) {
      return res
        .status(error.status || 400)
        .json({ success: false, message: 'Dữ liệu gửi lên không hợp lệ.' });
    }
    console.error('API error:', error.code || error.name);
    res
      .status(500)
      .json({
        success: false,
        message: 'Máy chủ đang gặp sự cố. Vui lòng thử lại.',
      });
  });
  return app;
}
module.exports = { createApp };

const prisma = require('../config/db');
const { readConfig } = require('../config/env');
const { createApp } = require('../app');

// One Prisma pool per warm function instance; migrations run separately, never per request.
module.exports = createApp(prisma, readConfig({
  ...process.env,
  NODE_ENV: 'production',
  SERVE_WEB: 'true',
  TRUST_PROXY_HOPS: '1',
}));

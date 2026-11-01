require('dotenv').config();
const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
const prisma = require('./config/db');
const { readConfig } = require('./config/env');
const { createApp } = require('./app');

async function start() {
  const config = readConfig();

  // Try connecting to database gracefully without killing the server if offline
  try {
    await prisma.$connect();
    console.log('[DB] Ket noi CSDL SQL Server thanh cong.');
  } catch (dbErr) {
    console.warn('[DB WARN] Chua the ket noi toi SQL Server (localhost:1433):', dbErr.message);
    console.warn(`[DB WARN] Server van se khoi dong tren cong ${config.port} de phuc vu cac dich vu cuc bo.`);
    console.warn('[DB WARN] Khi ban bat dich vu SQL Server trong SSMS/Services, CSDL se tu dong duoc ket noi.');
  }

  const server = createApp(prisma, config).listen(config.port, () => {
    console.log(`SupplyMind AI API dang lang nghe tai: http://localhost:${config.port}`);
  });

  const shutdown = () =>
    server.close(async () => {
      try {
        await prisma.$disconnect();
      } catch {}
      process.exit(0);
    });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Catch unhandled errors gracefully to keep the server alive
  process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
  });
}

start().catch(async (error) => {
  console.error('Loi nghiem trong khoi dong API:', error.message);
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});

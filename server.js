require('dotenv').config();
const prisma = require('./config/db');
const { readConfig } = require('./config/env');
const { createApp } = require('./app');

async function start() {
  const config = readConfig();
  await prisma.$connect();
  const server = createApp(prisma, config).listen(config.port, () => {
    console.log(`SupplyMind AI API: http://localhost:${config.port}`);
  });
  const shutdown = () =>
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch(async (error) => {
  console.error('Không khởi động được API:', error.message);
  await prisma.$disconnect();
  process.exit(1);
});

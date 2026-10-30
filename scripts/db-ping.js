const prisma = require('../config/db');
prisma.$queryRawUnsafe('SELECT 1 AS ok')
  .then((rows) => { console.log('DB OK', JSON.stringify(rows)); process.exit(0); })
  .catch((error) => { console.log('DB FAIL', error.message.split('\n')[0]); process.exit(1); });

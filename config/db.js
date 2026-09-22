const { PrismaClient } = require('@prisma/client');
// Keep one client per warm serverless instance. Requiring this module more than
// once must not create another pool against a small Azure SQL database.
const prisma = globalThis.__supplymindPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
  globalThis.__supplymindPrisma = prisma;
}
module.exports = prisma;

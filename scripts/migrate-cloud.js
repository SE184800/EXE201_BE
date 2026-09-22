// Explicit separate env file prevents accidentally migrating the local database.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const result = require('dotenv').config({ path: path.resolve(__dirname, '../.env.cloud'), override: true });
if (result.error || !process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('.database.windows.net:1433;')) {
  throw new Error('Cần .env.cloud chứa DATABASE_URL Azure SQL. Không dùng database local.');
}
const prisma = require('../config/db');
async function main() {
  await prisma.$connect();
  await prisma.$disconnect();
  const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { stdio: 'inherit', env: process.env });
  if (migration.status !== 0) throw new Error('Migration failed');
  for (const [code, name] of [['STORE_OWNER', 'Chủ tạp hóa'], ['SUPPLIER', 'Chủ vựa'], ['ADMIN', 'Quản trị viên']]) {
    await prisma.role.upsert({ where: { code }, update: {}, create: { code, name } });
  }
  console.log('Đã cập nhật schema Azure và 3 vai trò; không tạo tài khoản hoặc mật khẩu mẫu.');
}
main().catch(() => { console.error('Chưa migrate được Azure SQL. Kiểm tra kết nối, firewall và thông tin đăng nhập.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());

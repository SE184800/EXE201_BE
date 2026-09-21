require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');

async function seed() {
  const password = process.env.SEED_PASSWORD;
  if (
    !password ||
    password.length < 12 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new Error(
      'Đặt SEED_PASSWORD từ 12 ký tự đến 72 byte trong .env trước khi seed.',
    );
  }
  const roles = [
    {
      code: 'STORE_OWNER',
      name: 'Chủ tạp hóa',
      username: 'taphoa',
      displayName: 'Chủ cửa hàng tạp hóa',
    },
    {
      code: 'SUPPLIER',
      name: 'Chủ vựa',
      username: 'chuvua',
      displayName: 'Chủ vựa phân phối',
    },
    {
      code: 'ADMIN',
      name: 'Quản trị viên',
      username: 'admin',
      displayName: 'Quản trị viên nền tảng',
    },
  ];
  const passwordHash = await bcrypt.hash(password, 12);
  for (const item of roles) {
    const role = await prisma.role.upsert({
      where: { code: item.code },
      update: { name: item.name },
      create: { code: item.code, name: item.name },
    });
    // Không ghi đè mật khẩu hoặc role của tài khoản đã có khi chạy lại seed.
    await prisma.user.upsert({
      where: { username: item.username },
      update: {},
      create: {
        username: item.username,
        name: item.displayName,
        passwordHash,
        roleId: role.id,
      },
    });
  }
  console.log(
    'Đã tạo role và tài khoản: taphoa, chuvua, admin. Mật khẩu lấy từ SEED_PASSWORD.',
  );
}
seed()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

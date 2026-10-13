require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');

const USERNAME = 'test_thuphi';
const PASSWORD = process.env.SUBSCRIPTION_TEST_PASSWORD || 'Test@19000Demo';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Không tạo tài khoản test thu phí trong môi trường production.');
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'STORE_OWNER' } });
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { username: USERNAME },
    update: {
      name: 'Tạp hóa test hết dùng thử',
      email: 'test.thuphi@supplymind.local',
      phone: '0900190000',
      passwordHash,
      roleId: role.id,
      isActive: true,
      suspendedUntil: null,
      lockReason: null,
    },
    create: {
      username: USERNAME,
      name: 'Tạp hóa test hết dùng thử',
      email: 'test.thuphi@supplymind.local',
      phone: '0900190000',
      passwordHash,
      roleId: role.id,
    },
  });

  const trialEndsAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const trialStartedAt = new Date(trialEndsAt);
  trialStartedAt.setUTCMonth(trialStartedAt.getUTCMonth() - 1);
  await prisma.subscription.upsert({
    where: { userId: user.id },
    update: {
      status: 'EXPIRED',
      monthlyPrice: 19000,
      trialStartedAt,
      trialEndsAt,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    },
    create: {
      userId: user.id,
      status: 'EXPIRED',
      monthlyPrice: 19000,
      trialStartedAt,
      trialEndsAt,
    },
  });

  await prisma.inventoryItem.upsert({
    where: { ownerId_name: { ownerId: user.id, name: 'Nước suối test 500ml' } },
    update: { unit: 'chai', quantity: 24, lowThreshold: 5, purchasePrice: 3500, sellingPrice: 5000 },
    create: { ownerId: user.id, name: 'Nước suối test 500ml', unit: 'chai', quantity: 24, lowThreshold: 5, purchasePrice: 3500, sellingPrice: 5000 },
  });
  await prisma.authSession.deleteMany({ where: { userId: user.id } });

  console.log('Đã tạo lại tài khoản test thu phí ở trạng thái HẾT HẠN.');
  console.log(`Username: ${USERNAME}`);
  console.log(`Password: ${PASSWORD}`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

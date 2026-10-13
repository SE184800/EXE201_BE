const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(__dirname, '..', process.env.ENV_FILE || '.env'),
});

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const holidays = [
  {
    name: '[TEST] Tuần lễ mua sắm tạp hóa',
    startDate: new Date('2026-10-17T00:00:00.000Z'),
    endDate: new Date('2026-10-19T00:00:00.000Z'),
    preparationDays: 14,
    demandMultiplier: 1.5,
    categoryKeywords:
      'coca, aquafina, sting, 7up, nước ngọt, bánh, kẹo, snack, mì, sữa, nước mắm, dầu ăn, muối',
    description:
      'Cấu hình thử nghiệm để kiểm tra AI tăng gợi ý nhập hàng cho nhiều nhóm hàng.',
    isActive: true,
  },
  {
    name: 'Ngày Phụ nữ Việt Nam 20/10',
    startDate: new Date('2026-10-20T00:00:00.000Z'),
    endDate: new Date('2026-10-20T00:00:00.000Z'),
    preparationDays: 14,
    demandMultiplier: 1.25,
    categoryKeywords: 'bánh, kẹo, sữa, nước ngọt, coca, 7up, sting, quà',
    description: 'Nhu cầu bánh kẹo, đồ uống và quà tặng có thể tăng trước ngày 20/10.',
    isActive: true,
  },
  {
    name: 'Halloween 31/10',
    startDate: new Date('2026-10-31T00:00:00.000Z'),
    endDate: new Date('2026-10-31T00:00:00.000Z'),
    preparationDays: 21,
    demandMultiplier: 1.35,
    categoryKeywords: 'kẹo, bánh, snack, nước ngọt, coca, 7up, sting',
    description: 'Nhu cầu bánh kẹo, snack và nước ngọt có thể tăng cho dịp Halloween.',
    isActive: true,
  },
];

async function main() {
  const saved = [];
  for (const holiday of holidays) {
    const existing = await prisma.holidayConfig.findFirst({
      where: { name: holiday.name },
      select: { id: true },
    });
    const row = existing
      ? await prisma.holidayConfig.update({
          where: { id: existing.id },
          data: holiday,
        })
      : await prisma.holidayConfig.create({ data: holiday });
    saved.push({
      id: row.id,
      name: row.name,
      startDate: row.startDate.toISOString().slice(0, 10),
      preparationDays: row.preparationDays,
      demandMultiplier: Number(row.demandMultiplier),
    });
  }
  console.log(JSON.stringify({ saved }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

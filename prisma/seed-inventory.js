require('dotenv').config();
const prisma = require('../config/db');
async function main() {
  const username = process.argv[2] || 'taphoa';
  const user = await prisma.user.findUnique({ where: { username }, include: { role: true } });
  if (!user || user.role.code !== 'STORE_OWNER') throw new Error(`Cần tài khoản chủ tạp hóa có username: ${username}`);
  const samples = [
    { name: 'Coca lon 330ml', unit: 'lon', quantity: 24, lowThreshold: 6 },
    { name: 'Coca chai 1.5L', unit: 'chai', quantity: 4, lowThreshold: 5 },
    { name: 'Mì Hảo Hảo tôm chua cay', unit: 'gói', quantity: 15, lowThreshold: 10 },
    { name: 'Sữa Vinamilk 180ml', unit: 'hộp', quantity: 3, lowThreshold: 6 },
    { name: 'Nước suối Lavie 500ml', unit: 'chai', quantity: 0, lowThreshold: 6 },
  ];
  await prisma.$transaction(samples.map((item) => prisma.inventoryItem.upsert({
    where: { ownerId_name: { ownerId: user.id, name: item.name } },
    update: {}, create: { ownerId: user.id, ...item, movements: { create: { type: 'OPENING', quantityBefore: 0, quantityAfter: item.quantity, quantityChange: item.quantity, productName: item.name, unit: item.unit, note: 'Tồn ban đầu từ dữ liệu mẫu' } } },
  })));
  console.log(`Đã bổ sung dữ liệu mẫu cho ${username}; giữ nguyên sản phẩm đã có.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());

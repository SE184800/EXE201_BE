require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../config/db');

const products = [
  ['Coca-Cola lon 330ml', 'Đồ uống', 'thùng 24 lon', 185000, 20],
  ['Aquafina 500ml', 'Đồ uống', 'thùng 24 chai', 72000, 30],
  ['Mì Hảo Hảo tôm chua cay', 'Thực phẩm', 'thùng 30 gói', 105000, 25],
  ['Nước mắm Nam Ngư 500ml', 'Gia vị', 'thùng 24 chai', 265000, 10],
  ['Dầu ăn Tường An 1L', 'Gia vị', 'thùng 12 chai', 390000, 8],
  ['Bánh Oreo 133g', 'Thực phẩm', 'thùng 24 gói', 360000, 6],
];

async function main() {
  const username = process.argv[2] || 'chuvua';
  const user = await prisma.user.findUnique({ where: { username }, include: { role: true } });
  if (!user || user.role.code !== 'SUPPLIER') throw new Error(`Không tìm thấy tài khoản SUPPLIER: ${username}`);
  const profile = await prisma.supplierProfile.upsert({
    where: { userId: user.id },
    update: { businessName: 'Vựa Hàng Tiện Lợi SupplyMind', warehouseAddress: 'Quận 9, TP. Hồ Chí Minh', deliveryRadiusKm: 30, deliveryFee: 0, region: 'TP. Hồ Chí Minh', taxCode: 'DEMO20260928', legalRepresentative: user.name, verificationDocumentUrl: 'https://example.com/demo-verification.pdf', verificationStatus: 'APPROVED', verificationVersion: 1, submittedAt: new Date(), reviewedAt: new Date() },
    create: { userId: user.id, businessName: 'Vựa Hàng Tiện Lợi SupplyMind', warehouseAddress: 'Quận 9, TP. Hồ Chí Minh', deliveryRadiusKm: 30, deliveryFee: 0, region: 'TP. Hồ Chí Minh', taxCode: 'DEMO20260928', legalRepresentative: user.name, verificationDocumentUrl: 'https://example.com/demo-verification.pdf', verificationStatus: 'APPROVED', verificationVersion: 1, submittedAt: new Date(), reviewedAt: new Date() },
  });
  let added = 0;
  for (const [name, category, packaging, wholesalePrice, stockQty] of products) {
    const found = await prisma.supplierProduct.findFirst({ where: { supplierId: profile.id, name } });
    if (found) {
      await prisma.supplierProduct.update({ where: { id: found.id }, data: { category, packaging, wholesalePrice, stockQty, moq: 1, isActive: true } });
    } else {
      await prisma.supplierProduct.create({ data: { supplierId: profile.id, name, category, packaging, wholesalePrice, stockQty, moq: 1, isActive: true } });
      added++;
    }
  }
  console.log(`Đã chuẩn bị vựa demo ${username}: ${products.length} sản phẩm, thêm mới ${added}. Tài khoản tạp hóa có thể vào Tìm nguồn sỉ để đặt hàng.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());

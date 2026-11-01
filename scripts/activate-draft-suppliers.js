require('dotenv').config();
const prisma = require('../config/db');

async function main() {
  const result = await prisma.supplierProfile.updateMany({
    where: { verificationStatus: { in: ['DRAFT', 'PENDING'] } },
    data: {
      verificationStatus: 'APPROVED',
      verificationNote: 'Gian hàng đã được kích hoạt mở bán trên Nguồn sỉ.',
      reviewedAt: new Date(),
    },
  });
  console.log(`Đã kích hoạt ${result.count} gian hàng chủ vựa.`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

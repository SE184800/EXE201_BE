require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');

async function main() {
  console.log('🚀 Đang khởi tạo dữ liệu mẫu đầy đủ cho 3 Actor (Store Owner, Supplier, Admin)...');

  const rawPassword = process.env.SEED_PASSWORD && process.env.SEED_PASSWORD.length >= 12
    ? process.env.SEED_PASSWORD
    : 'SupplyMind2026@Pass';

  const passwordHash = await bcrypt.hash(rawPassword, 12);

  // 1. Tạo Roles
  const rolesData = [
    { code: 'STORE_OWNER', name: 'Chủ tạp hóa' },
    { code: 'SUPPLIER', name: 'Chủ vựa' },
    { code: 'ADMIN', name: 'Quản trị viên' },
  ];

  const roles = {};
  for (const r of rolesData) {
    roles[r.code] = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name },
      create: r,
    });
  }

  // 2. Tạo 3 Tài Khoản Actor Chuẩn Demo
  const storeOwner = await prisma.user.upsert({
    where: { username: 'taphoa' },
    update: { passwordHash, isActive: true },
    create: {
      username: 'taphoa',
      name: 'Tạp Hóa Cô Mai (Chủ Cửa Hàng)',
      email: 'comai.taphoa@gmail.com',
      phone: '0908123456',
      passwordHash,
      roleId: roles['STORE_OWNER'].id,
      dateOfBirth: new Date('1985-06-15'),
    },
  });

  const supplierUser = await prisma.user.upsert({
    where: { username: 'chuvua' },
    update: { passwordHash, isActive: true },
    create: {
      username: 'chuvua',
      name: 'Vựa Sỉ Nông Sản & Bách Hóa Tân Bình',
      email: 'chuvua.tanbinh@gmail.com',
      phone: '0918999888',
      passwordHash,
      roleId: roles['SUPPLIER'].id,
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash, isActive: true },
    create: {
      username: 'admin',
      name: 'Quản Trị Hệ Thống (SupplyMind Admin)',
      email: 'admin@supplymind.ai',
      phone: '0900000000',
      passwordHash,
      roleId: roles['ADMIN'].id,
    },
  });

  console.log(`✅ Đã sẵn sàng 3 tài khoản (Mật khẩu: ${rawPassword}):`);
  console.log(`   - Store Owner: taphoa`);
  console.log(`   - Supplier:    chuvua`);
  console.log(`   - Admin:       admin`);

  // 3. Tạo Hồ Sơ Vựa Sỉ (Supplier Profile)
  const supplierProfile = await prisma.supplierProfile.upsert({
    where: { userId: supplierUser.id },
    update: {
      businessName: 'Vựa Bách Hóa Tổng Hợp Tân Bình',
      warehouseAddress: '120 Lý Thường Kiệt, Q. Tân Bình, TP. Hồ Chí Minh',
      deliveryRadiusKm: 35.0,
      deliveryFee: 25000,
      region: 'TP. Hồ Chí Minh',
      taxCode: '0312987654',
      legalRepresentative: supplierUser.name,
      verificationDocumentUrl: 'https://example.com/gpkd-tanbinh.pdf',
      verificationStatus: 'APPROVED',
      verificationVersion: 1,
      submittedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      reviewedAt: new Date(Date.now() - 29 * 24 * 3600 * 1000),
      reviewedBy: adminUser.id,
    },
    create: {
      userId: supplierUser.id,
      businessName: 'Vựa Bách Hóa Tổng Hợp Tân Bình',
      warehouseAddress: '120 Lý Thường Kiệt, Q. Tân Bình, TP. Hồ Chí Minh',
      deliveryRadiusKm: 35.0,
      deliveryFee: 25000,
      region: 'TP. Hồ Chí Minh',
      taxCode: '0312987654',
      legalRepresentative: supplierUser.name,
      verificationDocumentUrl: 'https://example.com/gpkd-tanbinh.pdf',
      verificationStatus: 'APPROVED',
      verificationVersion: 1,
      submittedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      reviewedAt: new Date(Date.now() - 29 * 24 * 3600 * 1000),
      reviewedBy: adminUser.id,
    },
  });

  // 4. Danh Mục Sản Phẩm Sỉ Của Chủ Vựa (Supplier Products)
  const supplierProductsData = [
    { name: 'Coca-Cola lon 330ml', category: 'Đồ uống', packaging: 'thùng 24 lon', wholesalePrice: 185000, stockQty: 150, moq: 2 },
    { name: 'Aquafina 500ml', category: 'Đồ uống', packaging: 'thùng 24 chai', wholesalePrice: 72000, stockQty: 200, moq: 5 },
    { name: 'Mì Hảo Hảo tôm chua cay', category: 'Thực phẩm', packaging: 'thùng 30 gói', wholesalePrice: 105000, stockQty: 300, moq: 3 },
    { name: 'Nước mắm Nam Ngư 500ml', category: 'Gia vị', packaging: 'thùng 24 chai', wholesalePrice: 265000, stockQty: 80, moq: 2 },
    { name: 'Dầu ăn Tường An 1L', category: 'Gia vị', packaging: 'thùng 12 chai', wholesalePrice: 390000, stockQty: 60, moq: 1 },
    { name: 'Bánh Oreo 133g', category: 'Thực phẩm', packaging: 'thùng 24 gói', wholesalePrice: 360000, stockQty: 90, moq: 2 },
    { name: 'Nước giặt OMO Matic 3.6kg', category: 'Hóa phẩm', packaging: 'thùng 4 túi', wholesalePrice: 580000, stockQty: 45, moq: 1 },
  ];

  const supplierProducts = {};
  for (const item of supplierProductsData) {
    const existing = await prisma.supplierProduct.findFirst({
      where: { supplierId: supplierProfile.id, name: item.name },
    });
    if (existing) {
      supplierProducts[item.name] = await prisma.supplierProduct.update({
        where: { id: existing.id },
        data: { ...item, isActive: true },
      });
    } else {
      supplierProducts[item.name] = await prisma.supplierProduct.create({
        data: { supplierId: supplierProfile.id, ...item, isActive: true },
      });
    }
  }
  console.log(`✅ Đã tạo ${Object.keys(supplierProducts).length} sản phẩm sỉ cho Chủ vựa`);

  // 5. Kho Hàng Của Chủ Tạp Hóa (Store Owner Inventory & Lots & Sales History)
  const storeItemsData = [
    { name: 'Coca-Cola lon 330ml', unit: 'thùng', quantity: 8, lowThreshold: 15, purchasePrice: 185000, sellingPrice: 220000, dailySales: 3 },
    { name: 'Mì Hảo Hảo tôm chua cay', unit: 'thùng', quantity: 5, lowThreshold: 20, purchasePrice: 105000, sellingPrice: 125000, dailySales: 4 },
    { name: 'Aquafina 500ml', unit: 'thùng', quantity: 25, lowThreshold: 10, purchasePrice: 72000, sellingPrice: 90000, dailySales: 2 },
    { name: 'Nước mắm Nam Ngư 500ml', unit: 'thùng', quantity: 12, lowThreshold: 8, purchasePrice: 265000, sellingPrice: 300000, dailySales: 1 },
    { name: 'Dầu ăn Tường An 1L', unit: 'thùng', quantity: 4, lowThreshold: 10, purchasePrice: 390000, sellingPrice: 440000, dailySales: 2 },
  ];

  const storeItems = {};
  for (const item of storeItemsData) {
    const existing = await prisma.inventoryItem.findFirst({
      where: { ownerId: storeOwner.id, name: item.name },
    });

    let inv;
    if (existing) {
      inv = await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: {
          unit: item.unit,
          quantity: item.quantity,
          lowThreshold: item.lowThreshold,
          purchasePrice: item.purchasePrice,
          sellingPrice: item.sellingPrice,
        },
      });
    } else {
      inv = await prisma.inventoryItem.create({
        data: {
          ownerId: storeOwner.id,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          lowThreshold: item.lowThreshold,
          purchasePrice: item.purchasePrice,
          sellingPrice: item.sellingPrice,
        },
      });
    }
    storeItems[item.name] = inv;

    // Lô hàng trong kho (nếu bảng inventory_lots đã tồn tại trong DB)
    if (prisma.inventoryLot) {
      try {
        await prisma.inventoryLot.deleteMany({ where: { itemId: inv.id } });
        await prisma.inventoryLot.create({
          data: {
            itemId: inv.id,
            quantity: item.quantity,
            purchasePrice: item.purchasePrice,
            receivedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
            expiryDate: new Date(Date.now() + 180 * 24 * 3600 * 1000),
          },
        });
      } catch (e) {
        // Bảng inventory_lots chưa có trong DB -> Bỏ qua lô lẻ
      }
    }

    // Tạo Lịch Sử Bán Hàng 14 Ngày để AI tính toán Tốc độ bán (Average Daily Sales) & Dự báo nhập
    await prisma.stockMovement.deleteMany({ where: { itemId: inv.id } });
    let currentQty = item.quantity + item.dailySales * 14;

    for (let day = 14; day >= 1; day--) {
      const date = new Date(Date.now() - day * 24 * 3600 * 1000);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const salesToday = isWeekend ? Math.round(item.dailySales * 1.5) : item.dailySales;

      const qtyBefore = currentQty;
      const qtyAfter = currentQty - salesToday;
      currentQty = qtyAfter;

      await prisma.stockMovement.create({
        data: {
          itemId: inv.id,
          type: 'SALE',
          quantityChange: -salesToday,
          quantityBefore: qtyBefore,
          quantityAfter: qtyAfter,
          productName: item.name,
          unit: item.unit,
          note: `Bán lẻ ngày ${date.toLocaleDateString('vi-VN')}`,
          createdAt: date,
        },
      });
    }
  }
  console.log(`✅ Đã tạo kho hàng & Lịch sử bán hàng 14 ngày cho Chủ Tạp Hóa (phục vụ AI Dự báo)`);

  // 6. Kế Hoạch Nhập Hàng Gợi Ý Bởi AI (Restock Plan)
  await prisma.restockPlan.deleteMany({ where: { ownerId: storeOwner.id } });
  const restockPlan = await prisma.restockPlan.create({
    data: {
      ownerId: storeOwner.id,
      name: 'Kế hoạch nhập kho chuẩn bị cho Dịp Lễ & Cuối Tuần',
      note: 'Dự báo AI đề xuất nhập bù sản phẩm sắm Tết / Cuối tuần',
      horizonDays: 7,
      safetyDays: 3,
      requestHash: 'DEMO_HASH_AI_RECOMMENDATION_001',
      lines: {
        create: [
          {
            sourceItemId: storeItems['Coca-Cola lon 330ml'].id,
            productName: 'Coca-Cola lon 330ml',
            unit: 'thùng',
            quantity: 15,
            stockSnapshot: storeItems['Coca-Cola lon 330ml'].quantity,
            suggestedQuantity: 15,
            averageDailySales: 3.5,
            observedDays: 14,
            purchasePrice: 185000,
          },
          {
            sourceItemId: storeItems['Mì Hảo Hảo tôm chua cay'].id,
            productName: 'Mì Hảo Hảo tôm chua cay',
            unit: 'thùng',
            quantity: 20,
            stockSnapshot: storeItems['Mì Hảo Hảo tôm chua cay'].quantity,
            suggestedQuantity: 20,
            averageDailySales: 4.2,
            observedDays: 14,
            purchasePrice: 105000,
          },
        ],
      },
    },
  });
  console.log(`✅ Đã tạo Kế hoạch nhập hàng mẫu (Restock Plan ID: ${restockPlan.id})`);

  // 7. Đơn Đặt Hàng Sỉ (Wholesale Orders between Store Owner & Supplier)
  await prisma.wholesaleOrder.deleteMany({
    where: { buyerId: storeOwner.id, supplierId: supplierProfile.id },
  });

  // Đơn 1: Đã giao (DELIVERED) + Hoa hồng Admin
  await prisma.wholesaleOrder.create({
    data: {
      buyerId: storeOwner.id,
      supplierId: supplierProfile.id,
      status: 'DELIVERED',
      recipientName: 'Cô Mai',
      recipientPhone: '0908123456',
      deliveryAddress: '45 Nguyễn Trãi, Q.5, TP. Hồ Chí Minh',
      subtotal: 555000, // 3 thùng Coca (185k x 3)
      deliveryFee: 25000,
      total: 580000,
      note: 'Giao trong giờ hành chính',
      commissionRate: 2.5,
      commissionAmount: 13875,
      deliveredAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      items: {
        create: [
          {
            productId: supplierProducts['Coca-Cola lon 330ml'].id,
            productName: 'Coca-Cola lon 330ml',
            packaging: 'thùng 24 lon',
            quantity: 3,
            unitPrice: 185000,
            lineTotal: 555000,
          },
        ],
      },
    },
  });

  // Đơn 2: Đang giao (SHIPPING)
  await prisma.wholesaleOrder.create({
    data: {
      buyerId: storeOwner.id,
      supplierId: supplierProfile.id,
      status: 'SHIPPING',
      recipientName: 'Cô Mai',
      recipientPhone: '0908123456',
      deliveryAddress: '45 Nguyễn Trãi, Q.5, TP. Hồ Chí Minh',
      subtotal: 525000, // 5 thùng Mì Hảo Hảo (105k x 5)
      deliveryFee: 25000,
      total: 550000,
      note: 'Giao gấp buổi sáng',
      items: {
        create: [
          {
            productId: supplierProducts['Mì Hảo Hảo tôm chua cay'].id,
            productName: 'Mì Hảo Hảo tôm chua cay',
            packaging: 'thùng 30 gói',
            quantity: 5,
            unitPrice: 105000,
            lineTotal: 525000,
          },
        ],
      },
    },
  });

  // Đơn 3: Chờ duyệt (PENDING)
  await prisma.wholesaleOrder.create({
    data: {
      buyerId: storeOwner.id,
      supplierId: supplierProfile.id,
      status: 'PENDING',
      recipientName: 'Cô Mai',
      recipientPhone: '0908123456',
      deliveryAddress: '45 Nguyễn Trãi, Q.5, TP. Hồ Chí Minh',
      subtotal: 780000, // 2 thùng Dầu ăn (390k x 2)
      deliveryFee: 25000,
      total: 805000,
      note: 'Đơn mới đặt qua gợi ý AI',
      items: {
        create: [
          {
            productId: supplierProducts['Dầu ăn Tường An 1L'].id,
            productName: 'Dầu ăn Tường An 1L',
            packaging: 'thùng 12 chai',
            quantity: 2,
            unitPrice: 390000,
            lineTotal: 780000,
          },
        ],
      },
    },
  });

  console.log(`✅ Đã tạo 3 Đơn hàng sỉ mẫu (PENDING, SHIPPING, DELIVERED)`);

  // 8. Cấu hình Nền tảng Admin & Lịch sử Nhật ký (Platform Settings & Audit Logs)
  await prisma.platformSetting.upsert({
    where: { id: 1 },
    update: { commissionRate: 2.5 },
    create: { id: 1, commissionRate: 2.5 },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actorId: adminUser.id,
        action: 'SUPPLIER_VERIFIED',
        entityType: 'SUPPLIER',
        entityId: String(supplierProfile.id),
        details: JSON.stringify({ note: 'Đã duyệt hồ sơ pháp lý gian hàng Tân Bình' }),
      },
      {
        actorId: storeOwner.id,
        action: 'ORDER_CREATED',
        entityType: 'ORDER',
        entityId: '3',
        details: JSON.stringify({ total: 805000, itemsCount: 1 }),
      },
    ],
  });

  console.log(`✅ Đã cập nhật Cấu hình Admin (Tỷ lệ chiết khấu sàn: 2.5%) & Nhật ký Audit Logs`);

  console.log('\n🎉 ========================================================');
  console.log('🎉 TẠO DỮ LIỆU MẪU DEMO THÀNH CÔNG CHO 3 ACTOR!');
  console.log('🎉 --------------------------------------------------------');
  console.log('👉 1. Store Owner (Chủ Tạp Hóa): username "taphoa", password "' + rawPassword + '"');
  console.log('     -> Đã có kho hàng, lịch sử bán 14 ngày, đề xuất AI, đơn sỉ.');
  console.log('👉 2. Supplier (Chủ Vựa Sỉ):      username "chuvua", password "' + rawPassword + '"');
  console.log('     -> Đã có hồ sơ gian hàng đã duyệt, 7 sản phẩm sỉ, đơn hàng chờ giao.');
  console.log('👉 3. Admin (Quản Trị Viên):     username "admin",  password "' + rawPassword + '"');
  console.log('     -> Đã có cấu hình chiết khấu 2.5%, thống kê giao dịch & nhật ký audit.');
  console.log('========================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi tạo dữ liệu mẫu:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

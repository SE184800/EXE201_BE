require('dotenv').config();
const bcrypt = require('bcryptjs');
const { randomUUID, createHash } = require('node:crypto');
const prisma = require('../config/db');
const DAY = 86400000;
const now = new Date();
const at = days => new Date(now.getTime() + days * DAY);
const tag = '[DEMO]';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo chỉ dành cho local.');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error('Cần SEED_PASSWORD từ 12 ký tự.');
  const hash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async tx => {
    const users = {};
    for (const [username, code, name] of [['taphoa', 'STORE_OWNER', 'Chủ tạp hóa'], ['chuvua', 'SUPPLIER', 'Chủ vựa'], ['admin', 'ADMIN', 'Quản trị viên']]) {
      const role = await tx.role.upsert({ where: { code }, update: {}, create: { code, name } });
      users[username] = await tx.user.upsert({ where: { username }, update: {}, create: { username, name, roleId: role.id, passwordHash: hash } });
    }
    const buyer = users.taphoa, supplier = users.chuvua, admin = users.admin;
    const profile = await tx.supplierProfile.upsert({ where: { userId: supplier.id }, update: {}, create: {
      userId: supplier.id, businessName: '[DEMO] Vựa SupplyMind', warehouseAddress: '120 Lý Thường Kiệt, TP.HCM', deliveryRadiusKm: 30,
      deliveryFee: 25000, region: 'TP. Hồ Chí Minh', verificationStatus: 'APPROVED', verificationVersion: 1,
      taxCode: 'DEMO-NOT-REAL', legalRepresentative: supplier.name, verificationDocumentUrl: 'https://example.com/demo.pdf',
      submittedAt: at(-20), reviewedAt: at(-19), reviewedBy: admin.id,
      bankName: 'NGÂN HÀNG MẪU - KHÔNG CHUYỂN TIỀN', bankAccountNumber: 'DEMO000000', bankAccountHolder: 'TAI KHOAN MO PHONG',
    } });
    const catalog = [
      ['Coca-Cola 330ml', 'Đồ uống', 185000, 220000, 8, 3, 90],
      ['Mì Hảo Hảo', 'Thực phẩm', 105000, 125000, 5, 4, 180],
      ['Aquafina 500ml', 'Đồ uống', 72000, 90000, 30, 2, 120],
      ['Dầu ăn Tường An 1L', 'Gia vị', 390000, 440000, 4, 1, 150],
      ['Bánh Oreo', 'Thực phẩm', 360000, 400000, 6, 2, 3],
      ['Sữa Vinamilk', 'Thực phẩm', 280000, 320000, 0, 2, 60],
      ['Nước mắm Nam Ngư', 'Gia vị', 265000, 300000, 12, 1, 200],
      ['Kẹo trái cây', 'Thực phẩm', 150000, 185000, 3, 1, -2],
    ];
    const products = [], inventory = [];
    for (const [label, category, buy, sell, quantity, daily, expiry] of catalog) {
      const name = `${tag} ${label}`;
      let product = await tx.supplierProduct.findFirst({ where: { supplierId: profile.id, name } });
      if (!product) {
        product = await tx.supplierProduct.create({ data: { supplierId: profile.id, name, category, packaging: 'thùng', wholesalePrice: buy, stockQty: 200, moq: 1 } });
        await tx.supplierProductPriceHistory.create({ data: { productId: product.id, oldPrice: Math.round(buy / 1.05), newPrice: buy, changePercent: 5, changedBy: supplier.id, reason: '[DEMO] Điều chỉnh giá mẫu', createdAt: at(-3) } });
      }
      products.push(product);
      let item = await tx.inventoryItem.findUnique({ where: { ownerId_name: { ownerId: buyer.id, name } } });
      if (!item) {
        item = await tx.inventoryItem.create({ data: { ownerId: buyer.id, name, unit: 'thùng', quantity, lowThreshold: 10, purchasePrice: buy, sellingPrice: sell, expiryDate: at(expiry), createdAt: at(-31) } });
        await tx.inventoryLot.create({ data: { itemId: item.id, quantity, purchasePrice: buy, receivedAt: at(-30), expiryDate: at(expiry) } });
        let stock = quantity + daily * 30;
        const movements = [{ itemId: item.id, type: 'OPENING', quantityChange: stock, quantityBefore: 0, quantityAfter: stock, productName: name, unit: 'thùng', note: '[DEMO] Tồn đầu kỳ', createdAt: at(-31) }];
        for (let d = 30; d >= 1; d--) {
          movements.push({ itemId: item.id, type: 'SALE', quantityChange: -daily, quantityBefore: stock, quantityAfter: stock - daily, unitSalePrice: sell, productName: name, unit: 'thùng', note: '[DEMO] Bán hàng mô phỏng', createdAt: at(-d) });
          stock -= daily;
        }
        await tx.stockMovement.createMany({ data: movements.map(m => ({ id: randomUUID(), ...m })) });
      }
      inventory.push(item);
    }
    const planName = '[DEMO] Kế hoạch nhập hàng tuần';
    if (!await tx.restockPlan.findFirst({ where: { ownerId: buyer.id, name: planName } })) {
      await tx.restockPlan.create({ data: { ownerId: buyer.id, name: planName, note: '[DEMO] Dữ liệu mô phỏng để thử chức năng', horizonDays: 7, safetyDays: 2,
        requestHash: createHash('sha256').update(planName).digest('hex'), lines: { create: inventory.slice(0, 3).map(i => ({ sourceItemId: i.id, productName: i.name, unit: i.unit, quantity: 20, stockSnapshot: i.quantity, suggestedQuantity: 20, averageDailySales: 3, observedDays: 30, purchasePrice: i.purchasePrice })) } } });
    }
    const orders = [];
    const scenarios = [
      ['Chờ duyệt', 'PENDING', 'NONE'], ['Chờ cọc', 'PENDING', 'PENDING'], ['Chờ xác nhận cọc', 'PENDING', 'SUBMITTED'],
      ['Đã duyệt', 'APPROVED', 'PAID'], ['Chuẩn bị', 'PREPARING', 'NONE'], ['Đang giao', 'SHIPPING', 'NONE'],
      ['Đang xử lý', 'ISSUE_HANDLING', 'NONE'], ['Đã giao', 'DELIVERED', 'PAID'], ['Đã đối soát', 'DELIVERED', 'NONE'],
      ['Chờ hoàn cọc', 'REJECTED', 'REFUND_PENDING'], ['Đã hoàn cọc', 'REJECTED', 'REFUNDED'],
    ];
    for (let index = 0; index < scenarios.length; index++) {
      const [label, status, depositStatus] = scenarios[index];
      const note = `${tag} ${label}`;
      let order = await tx.wholesaleOrder.findFirst({ where: { buyerId: buyer.id, supplierId: profile.id, note } });
      if (!order) {
        const product = products[index % products.length], price = Number(product.wholesalePrice), subtotal = price * 3, total = subtotal + 25000;
        const deposit = depositStatus !== 'NONE';
        order = await tx.wholesaleOrder.create({ data: {
          buyerId: buyer.id, supplierId: profile.id, supplierRegion: profile.region, status, note, subtotal, deliveryFee: 25000, total,
          recipientName: 'Khách hàng demo', recipientPhone: '0900000000', deliveryAddress: 'Địa chỉ mẫu, TP.HCM', createdAt: at(-index),
          commissionRate: 2.5, commissionAmount: status === 'DELIVERED' ? subtotal * 0.025 : null, deliveredAt: status === 'DELIVERED' ? at(-2) : null,
          commissionPaidAt: index === 8 ? at(-1) : null, commissionPaidBy: index === 8 ? admin.id : null,
          commissionPaymentReference: index === 8 ? 'DEMO-DOI-SOAT' : null,
          rejectReason: status === 'REJECTED' ? '[DEMO] Không thể giao đúng hẹn' : null,
          depositRate: deposit ? 20 : 0, depositAmount: deposit ? total * 0.2 : 0, depositStatus,
          depositBankName: deposit ? profile.bankName : null, depositBankAccountNumber: deposit ? profile.bankAccountNumber : null, depositBankAccountHolder: deposit ? profile.bankAccountHolder : null,
          depositSubmittedAt: ['SUBMITTED', 'PAID', 'REFUND_PENDING', 'REFUNDED'].includes(depositStatus) ? at(-2) : null,
          depositPaidAt: ['PAID', 'REFUND_PENDING', 'REFUNDED'].includes(depositStatus) ? at(-2) : null,
          depositReviewedAt: ['PAID', 'REFUND_PENDING', 'REFUNDED'].includes(depositStatus) ? at(-2) : null,
          depositReference: deposit ? 'DEMO-NOT-A-REAL-PAYMENT' : null, depositRefundedAt: depositStatus === 'REFUNDED' ? at(-1) : null,
          depositRefundReference: depositStatus === 'REFUNDED' ? 'DEMO-REFUND' : null,
          items: { create: [{ productId: product.id, productName: product.name, packaging: product.packaging, quantity: 3, unitPrice: price, lineTotal: subtotal }] },
        } });
      }
      orders.push(order);
    }
    for (const [index, status] of [[6, 'OPEN'], [7, 'IN_REVIEW'], [8, 'RESOLVED']]) {
      await tx.orderComplaint.upsert({ where: { orderId: orders[index].id }, update: {}, create: { orderId: orders[index].id, buyerId: buyer.id, supplierId: profile.id, reason: '[DEMO] Bao bì bị móp', description: 'Khiếu nại mô phỏng để thử quy trình xử lý.', status, response: status === 'RESOLVED' ? '[DEMO] Đã thống nhất đổi hàng' : null } });
    }
    for (const [index, status] of ['SENT', 'ACCEPTED', 'REJECTED'].entries()) {
      const title = `${tag} Báo giá ${status}`;
      if (!await tx.supplierQuote.findFirst({ where: { supplierId: profile.id, buyerId: buyer.id, title } })) {
        const product = products[0], subtotal = Number(product.wholesalePrice) * 3;
        await tx.supplierQuote.create({ data: { supplierId: profile.id, buyerId: buyer.id, title, status, validUntil: at(14), subtotal, deliveryFee: 25000, total: subtotal + 25000,
          depositRate: 0, note: '[DEMO] Báo giá mô phỏng', orderId: index === 1 ? orders[0].id : null, respondedAt: index ? at(-1) : null,
          lines: { create: [{ productId: product.id, productName: product.name, packaging: product.packaging, quantity: 3, unitPrice: product.wholesalePrice, lineTotal: subtotal }] } } });
      }
    }
    for (const user of [buyer, supplier]) {
      const subscription = await tx.subscription.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, status: 'ACTIVE', monthlyPrice: 19000, trialStartedAt: at(-60), trialEndsAt: at(-30), currentPeriodStart: at(-1), currentPeriodEnd: at(29) } });
      const requestId = `demo-subscription-${user.id}`;
      await tx.subscriptionPayment.upsert({ where: { requestId }, update: {}, create: { subscriptionId: subscription.id, requestId, amount: 19000, method: 'SIMULATED', reference: 'DEMO-NOT-REAL-PAYMENT', periodStart: at(-1), periodEnd: at(29) } });
    }
    const expiredUser = await tx.user.upsert({ where: { username: 'demo_het_han' }, update: {}, create: { username: 'demo_het_han', name: '[DEMO] Thử gia hạn thuê bao', passwordHash: hash, roleId: buyer.roleId } });
    await tx.subscription.upsert({ where: { userId: expiredUser.id }, update: {}, create: { userId: expiredUser.id, status: 'EXPIRED', monthlyPrice: 19000, trialStartedAt: at(-60), trialEndsAt: at(-30) } });
    const holidayName = '[DEMO] Tuần lễ mua sắm sắp tới';
    if (!await tx.holidayConfig.findFirst({ where: { name: holidayName } })) await tx.holidayConfig.create({ data: { name: holidayName, startDate: at(7), endDate: at(10), preparationDays: 14, demandMultiplier: 1.5, categoryKeywords: 'coca, nước, mì, bánh, kẹo, sữa', description: 'Ngày lễ mô phỏng cho gợi ý nhập hàng.' } });
    if (!await tx.auditLog.findFirst({ where: { action: 'DEMO_SEEDED' } })) await tx.auditLog.create({ data: { actorId: admin.id, action: 'DEMO_SEEDED', entityType: 'SYSTEM', entityId: 'demo-safe-v1', details: JSON.stringify({ demo: true, message: 'Dữ liệu mô phỏng, không phải giao dịch thực.' }) } });
  }, { timeout: 120000, maxWait: 10000 });
  const users = await prisma.user.findMany({ where: { username: { in: ['taphoa', 'chuvua', 'admin'] } } });
  for (const user of users) console.log(`${user.username}: ${await bcrypt.compare(password, user.passwordHash) ? password : 'Mật khẩu đã đổi; giữ nguyên mật khẩu hiện tại'}`);
  console.log(JSON.stringify({ inventory: await prisma.inventoryItem.count(), movements: await prisma.stockMovement.count(), products: await prisma.supplierProduct.count(), orders: await prisma.wholesaleOrder.count(), quotes: await prisma.supplierQuote.count(), complaints: await prisma.orderComplaint.count(), subscriptions: await prisma.subscription.count() }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());

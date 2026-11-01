// Explicit, additive demo data for dedicated accounts. Never resets existing users.
require('dotenv').config({ path: process.env.DEMO_ENV_FILE || '.env' });
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { walletService } = require('../services/walletService');
const { getCanonicalContractText, formatRawKey } = require('../services/contractService');
const prisma = new PrismaClient();
const DAY = 86400000;
const now = new Date();
const at = days => new Date(now.getTime() + days * DAY);
const tag = '[DEMO19K]';
const definitions = [
  ['demo_taphoa_19k', 'STORE_OWNER', 'Tạp hóa demo đầy đủ'],
  ['demo_chuvua_19k', 'SUPPLIER', 'Chủ vựa demo đầy đủ'],
  ['demo_admin_19k', 'ADMIN', 'Quản trị demo'],
  ['demo_hethan_19k', 'STORE_OWNER', 'Test hết hạn và mua Basic'],
  ['demo_choduyet_19k', 'SUPPLIER', 'Test duyệt hồ sơ chủ vựa'],
];

async function main() {
  if (process.env.DEMO_ALLOW_ONLINE !== 'yes') throw Error('Đặt DEMO_ALLOW_ONLINE=yes để xác nhận tạo dữ liệu test.');
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12 || Buffer.byteLength(password) > 72) throw Error('Cần DEMO_PASSWORD từ 12 ký tự, tối đa 72 byte.');
  for (const [username] of definitions) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing && (!existing.name.startsWith(tag) || !await bcrypt.compare(password, existing.passwordHash))) throw Error(`Không sửa tài khoản đã có: ${username}`);
  }
  const hash = await bcrypt.hash(password, 12);
  const result = await prisma.$transaction(async tx => {
    const users = {};
    for (const [username, code, label] of definitions) {
      const role = await tx.role.findUniqueOrThrow({ where: { code } });
      users[username] = await tx.user.upsert({ where: { username }, update: {}, create: { username, name: `${tag} ${label}`, email: `${username}@example.invalid`, passwordHash: hash, roleId: role.id } });
    }
    const buyer = users.demo_taphoa_19k, supplier = users.demo_chuvua_19k, admin = users.demo_admin_19k, expired = users.demo_hethan_19k, review = users.demo_choduyet_19k;
    const profileData = user => ({ userId: user.id, businessName: `${tag} ${user.username}`, warehouseAddress: '120 Lý Thường Kiệt, Phường 7, Quận Tân Bình, TP.HCM', deliveryRadiusKm: 30, deliveryFee: 25000, region: 'TP. Hồ Chí Minh', taxCode: `DEMO${String(user.id).padStart(6, '0')}`, legalRepresentative: user.name, verificationDocumentUrl: 'https://example.com/demo-not-a-real-document.pdf', verificationVersion: 1, submittedAt: at(-10), bankName: 'DEMO - KHÔNG CHUYỂN TIỀN', bankAccountNumber: 'DEMO000000', bankAccountHolder: 'TAI KHOAN MO PHONG' });
    const profile = await tx.supplierProfile.upsert({ where: { userId: supplier.id }, update: {}, create: { ...profileData(supplier), verificationStatus: 'APPROVED', reviewedBy: admin.id, reviewedAt: at(-9) } });
    await tx.supplierProfile.upsert({ where: { userId: review.id }, update: {}, create: { ...profileData(review), verificationStatus: 'PENDING' } });
    for (const user of [buyer, supplier, expired, review]) {
      const isExpired = user.id === expired.id;
      const subscription = await tx.subscription.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, status: isExpired ? 'EXPIRED' : 'ACTIVE', monthlyPrice: 19000, trialStartedAt: at(-60), trialEndsAt: at(-30), currentPeriodStart: isExpired ? null : at(-1), currentPeriodEnd: isExpired ? null : at(29) } });
      const balance = user.id === buyer.id ? 5000000 : user.id === supplier.id ? 3000000 : 0;
      const existingWallet = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!existingWallet) {
        const wallet = await tx.wallet.create({ data: { userId: user.id, balance } });
        if (balance) {
          await tx.depositRequest.create({ data: { userId: user.id, amount: balance, method: 'SANDBOX', isSandbox: true, bankName: 'SANDBOX', bankAccountNumber: 'SANDBOX', bankAccountHolder: 'SANDBOX', reference: `DEMO19K-CREDIT-${user.id}`, status: 'APPROVED', note: `${tag} Tiền ảo để test`, reviewedAt: now, reviewedBy: admin.id } });
          await tx.walletTransaction.create({ data: { walletId: wallet.id, userId: user.id, type: 'SANDBOX_DEPOSIT', direction: 'CREDIT', amount: balance, balanceAfter: balance, reference: `DEMO19K-CREDIT-${user.id}`, method: 'SANDBOX', note: `${tag} Tiền ảo, không phải tiền thật` } });
          await tx.subscriptionPayment.create({ data: { subscriptionId: subscription.id, requestId: `demo19k-sub-${user.id}`, amount: 19000, method: 'WALLET', reference: `DEMO19K-SUB-${user.id}`, periodStart: at(-1), periodEnd: at(29) } });
          await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balance - 19000 } });
          await tx.walletTransaction.create({ data: { walletId: wallet.id, userId: user.id, type: 'SUBSCRIPTION_PAYMENT', direction: 'DEBIT', amount: 19000, balanceAfter: balance - 19000, reference: `DEMO19K-SUB-${user.id}`, method: 'WALLET', note: `${tag} Mua Basic bằng tiền mô phỏng` } });
        }
      }
    }
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
        await tx.supplierProductPriceHistory.create({ data: { productId: product.id, oldPrice: Math.round(buy / 1.05), newPrice: buy, changePercent: 5, changedBy: supplier.id, reason: `${tag} Lịch sử giá mô phỏng`, createdAt: at(-3) } });
      }
      products.push(product);
      let item = await tx.inventoryItem.findUnique({ where: { ownerId_name: { ownerId: buyer.id, name } } });
      if (!item) {
        item = await tx.inventoryItem.create({ data: { ownerId: buyer.id, name, unit: 'thùng', quantity, lowThreshold: 10, purchasePrice: buy, sellingPrice: sell, expiryDate: at(expiry), createdAt: at(-31) } });
        await tx.inventoryLot.create({ data: { itemId: item.id, quantity, purchasePrice: buy, receivedAt: at(-30), expiryDate: at(expiry) } });
        let stock = quantity + daily * 30;
        const movements = [{ id: crypto.randomUUID(), itemId: item.id, type: 'OPENING', quantityChange: stock, quantityBefore: 0, quantityAfter: stock, productName: name, unit: 'thùng', note: `${tag} Tồn đầu kỳ mô phỏng`, createdAt: at(-31) }];
        for (let day = 29; day >= 0; day--) {
          movements.push({ id: crypto.randomUUID(), itemId: item.id, type: 'SALE', quantityChange: -daily, quantityBefore: stock, quantityAfter: stock - daily, unitSalePrice: sell, productName: name, unit: 'thùng', note: `${tag} Bán hàng mô phỏng`, createdAt: at(-day) });
          stock -= daily;
        }
        await tx.stockMovement.createMany({ data: movements });
      }
      inventory.push(item);
    }
    const scenarios = [['Chờ duyệt', 'PENDING', 'NONE'], ['Chờ cọc', 'PENDING', 'PENDING'], ['Chờ xác nhận cọc', 'PENDING', 'SUBMITTED'], ['Đã duyệt, giữ cọc ví', 'APPROVED', 'PAID'], ['Soạn hàng', 'PREPARING', 'NONE'], ['Đang giao', 'SHIPPING', 'NONE'], ['Có sự cố', 'ISSUE_HANDLING', 'NONE'], ['Đã giao, cọc ví', 'DELIVERED', 'PAID'], ['Đã thanh toán ví', 'DELIVERED', 'NONE'], ['Chờ hoàn cọc chuyển khoản', 'REJECTED', 'REFUND_PENDING'], ['Đã hoàn cọc chuyển khoản', 'REJECTED', 'REFUNDED']];
    const orders = [];
    for (let index = 0; index < scenarios.length; index++) {
      const [label, status, depositStatus] = scenarios[index], note = `${tag} ${label}`;
      let order = await tx.wholesaleOrder.findFirst({ where: { buyerId: buyer.id, supplierId: profile.id, note }, include: { items: true } });
      if (!order) {
        const product = products[index % products.length], price = Number(product.wholesalePrice), subtotal = price * 3, total = subtotal + 25000;
        const deposit = depositStatus !== 'NONE', amount = deposit ? total * 0.2 : 0;
        order = await tx.wholesaleOrder.create({ data: { buyerId: buyer.id, supplierId: profile.id, supplierRegion: profile.region, status, note, subtotal, deliveryFee: 25000, total,
          recipientName: `${tag} Khách hàng thử nghiệm`, recipientPhone: '0908000000', deliveryAddress: '45 Nguyễn Trãi, Phường Bến Thành, Quận 1, TP.HCM', createdAt: at(-index),
          commissionRate: 2.5, commissionAmount: status === 'DELIVERED' ? subtotal * 0.025 : null, deliveredAt: status === 'DELIVERED' ? index === 8 ? now : at(-2) : null,
          commissionPaidAt: index === 8 ? now : null, commissionPaidBy: index === 8 ? admin.id : null, commissionPaymentReference: index === 8 ? 'DEMO19K-DOI-SOAT' : null,
          rejectReason: status === 'REJECTED' ? `${tag} Không thể giao đúng hẹn` : null, depositRate: deposit ? 20 : 0, depositAmount: amount, depositStatus,
          depositReference: depositStatus === 'PAID' ? 'VI_HE_THONG' : deposit ? 'DEMO19K-NOT-A-REAL-PAYMENT' : null,
          depositBankName: deposit ? profile.bankName : null, depositBankAccountNumber: deposit ? profile.bankAccountNumber : null, depositBankAccountHolder: deposit ? profile.bankAccountHolder : null,
          depositSubmittedAt: ['SUBMITTED', 'PAID', 'REFUND_PENDING', 'REFUNDED'].includes(depositStatus) ? at(-2) : null,
          depositPaidAt: ['PAID', 'REFUND_PENDING', 'REFUNDED'].includes(depositStatus) ? at(-2) : null,
          depositReviewedAt: ['PAID', 'REFUND_PENDING', 'REFUNDED'].includes(depositStatus) ? at(-2) : null,
          depositRefundedAt: depositStatus === 'REFUNDED' ? at(-1) : null, depositRefundReference: depositStatus === 'REFUNDED' ? 'DEMO19K-REFUND' : null,
          items: { create: [{ productId: product.id, productName: product.name, packaging: product.packaging, quantity: 3, unitPrice: price, lineTotal: subtotal }] } }, include: { items: true } });
        if (depositStatus === 'PAID') {
          await walletService.lockEscrow(buyer.id, order.id, amount, `${tag} Giữ cọc mô phỏng`, { tx });
          if (status === 'DELIVERED') await walletService.releaseEscrow(buyer.id, supplier.id, order.id, amount, 2.5, { tx });
        }
        if (index === 8) {
          const bw = await tx.wallet.findUniqueOrThrow({ where: { userId: buyer.id } });
          const sw = await tx.wallet.findUniqueOrThrow({ where: { userId: supplier.id } });
          const commission = subtotal * 0.025, net = total - commission;
          await tx.orderPayment.create({ data: { orderId: order.id, buyerId: buyer.id, supplierUserId: supplier.id, amount: total, commissionAmount: commission, supplierAmount: net, status: 'PAID', reference: `DEMO19K-ORDER-${order.id}` } });
          await tx.wallet.update({ where: { id: bw.id }, data: { balance: { decrement: total } } });
          await tx.wallet.update({ where: { id: sw.id }, data: { balance: { increment: net } } });
          await tx.walletTransaction.createMany({ data: [{ walletId: bw.id, userId: buyer.id, type: 'ORDER_PAYMENT', direction: 'DEBIT', amount: total, balanceAfter: Number(bw.balance) - total, reference: `DEMO19K-PAY-${order.id}`, method: 'WALLET', orderId: order.id, note: `${tag} Thanh toán mô phỏng` }, { walletId: sw.id, userId: supplier.id, type: 'ORDER_RECEIVE', direction: 'CREDIT', amount: net, balanceAfter: Number(sw.balance) + net, reference: `DEMO19K-RECEIVE-${order.id}`, method: 'WALLET', orderId: order.id, note: `${tag} Nhận tiền mô phỏng` }] });
        }
      }
      orders.push(order);
    }
    for (const [index, status] of [[6, 'OPEN'], [7, 'IN_REVIEW'], [8, 'RESOLVED']]) await tx.orderComplaint.upsert({ where: { orderId: orders[index].id }, update: {}, create: { orderId: orders[index].id, buyerId: buyer.id, supplierId: profile.id, reason: 'DAMAGED', description: `${tag} Bao bì móp - tình huống thử nghiệm`, status, response: status === 'RESOLVED' ? `${tag} Đã thống nhất đổi hàng` : null } });
    const quotes = [];
    for (const [index, status] of ['SENT', 'ACCEPTED', 'REJECTED'].entries()) {
      const title = `${tag} Báo giá ${status}`;
      let quote = await tx.supplierQuote.findFirst({ where: { supplierId: profile.id, buyerId: buyer.id, title } });
      if (!quote) {
        const product = products[0], subtotal = Number(product.wholesalePrice) * 3;
        quote = await tx.supplierQuote.create({ data: { supplierId: profile.id, buyerId: buyer.id, title, status, validUntil: at(14), subtotal, deliveryFee: 25000, total: subtotal + 25000, note: `${tag} Báo giá mô phỏng`, orderId: index === 1 ? orders[0].id : null, respondedAt: index ? at(-1) : null, lines: { create: [{ productId: product.id, productName: product.name, packaging: product.packaging, quantity: 3, unitPrice: product.wholesalePrice, lineTotal: subtotal }] } } });
      }
      quotes.push(quote);
    }
    for (const [index, label] of ['Nhập hàng tuần', 'Bổ sung hàng sắp hết'].entries()) {
      const name = `${tag} ${label}`;
      if (!await tx.restockPlan.findFirst({ where: { ownerId: buyer.id, name } })) await tx.restockPlan.create({ data: { ownerId: buyer.id, name, note: `${tag} Kế hoạch thử nghiệm`, horizonDays: 7, safetyDays: 2, requestHash: crypto.createHash('sha256').update(name).digest('hex'), lines: { create: inventory.slice(index, index + 3).map(item => ({ sourceItemId: item.id, productName: item.name, unit: item.unit, quantity: 20, stockSnapshot: item.quantity, suggestedQuantity: 20, averageDailySales: 3, observedDays: 30, purchasePrice: item.purchasePrice })) } } });
    }
    const withdrawalNote = `${tag} Yêu cầu rút tiền mô phỏng chờ duyệt`;
    if (!await tx.withdrawalRequest.findFirst({ where: { userId: supplier.id, note: withdrawalNote } })) {
      const amount = 50000, wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: supplier.id } });
      const withdrawal = await tx.withdrawalRequest.create({ data: { userId: supplier.id, amount, isSandbox: true, bankName: 'SANDBOX', bankAccountNumber: 'DEMO0000', bankAccountHolder: 'DEMO ONLY', note: withdrawalNote } });
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount }, heldBalance: { increment: amount } } });
      await tx.walletTransaction.create({ data: { walletId: wallet.id, userId: supplier.id, type: 'WITHDRAWAL_HOLD', direction: 'DEBIT', amount, balanceAfter: Number(wallet.balance) - amount, reference: `DEMO19K-WITHDRAW-${withdrawal.id}`, method: 'SANDBOX', note: withdrawalNote } });
    }
    const holidayName = `${tag} Lễ mua sắm thử nghiệm (đang tắt)`;
    if (!await tx.holidayConfig.findFirst({ where: { name: holidayName } })) await tx.holidayConfig.create({ data: { name: holidayName, startDate: at(7), endDate: at(10), preparationDays: 14, demandMultiplier: 1.5, categoryKeywords: 'coca, nước, mì, bánh, kẹo, sữa', isActive: false, description: 'Cấu hình demo tắt sẵn để không thay đổi dự báo của tài khoản thật.' } });
    async function document(key, fallback, update) {
      const rows = await tx.$queryRaw`SELECT [payload] FROM [dbo].[application_documents] WITH (UPDLOCK, HOLDLOCK) WHERE [key] = ${key}`;
      const value = rows.length ? JSON.parse(rows[0].payload) : fallback;
      update(value);
      const payload = JSON.stringify(value);
      if (rows.length) await tx.$executeRaw`UPDATE [dbo].[application_documents] SET [payload] = ${payload}, [updatedAt] = SYSUTCDATETIME() WHERE [key] = ${key}`;
      else await tx.$executeRaw`INSERT INTO [dbo].[application_documents] ([key], [payload]) VALUES (${key}, ${payload})`;
    }
    const storeProfile = { userId: buyer.id, storeName: `${tag} Tiệm tạp hóa thử nghiệm`, storeAddress: '45 Nguyễn Trãi, Phường Bến Thành, Quận 1, TP.HCM', storePhone: `0908${String(buyer.id).padStart(6, '0')}`, taxCode: `DEMO${String(buyer.id).padStart(6, '0')}`, businessType: 'Tạp hóa tổng hợp', locationType: 'STREET_FRONT', latitude: 10.762622, longitude: 106.660172, isAddressVerified: true, isConfigured: true, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await document('stores', { stores: {} }, value => { value.stores[String(buyer.id)] ||= storeProfile; value.stores[String(expired.id)] ||= { ...storeProfile, userId: expired.id, storeName: `${tag} Test gia hạn`, storeAddress: '46 Nguyễn Trãi, Phường Bến Thành, Quận 1, TP.HCM', storePhone: `0908${String(expired.id).padStart(6, '0')}`, taxCode: `DEMO${String(expired.id).padStart(6, '0')}` }; });
    await document('contracts', { contracts: {} }, value => {
      for (const user of [buyer, supplier, expired, review]) {
        if (value.contracts[String(user.id)]) continue;
        const keys = crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
        const contract = { userId: user.id, username: user.username, role: user.roleId === buyer.roleId ? 'STORE_OWNER' : 'SUPPLIER', contractNumber: `DEMO19K-${user.id}`, publicKey: keys.publicKey, privateKey: keys.privateKey, rawPrivateKey: formatRawKey(keys.privateKey), rawPublicKey: formatRawKey(keys.publicKey), isSigned: true, createdAt: now.toISOString(), signedAt: now.toISOString(), signerInfo: { name: user.name, email: user.email, phone: user.roleId === buyer.roleId ? `0908${String(user.id).padStart(6, '0')}` : '', businessName: user.roleId === buyer.roleId ? user.id === buyer.id ? storeProfile.storeName : `${tag} Test gia hạn` : profileData(user).businessName, address: user.roleId === buyer.roleId ? user.id === buyer.id ? storeProfile.storeAddress : '46 Nguyễn Trãi, Phường Bến Thành, Quận 1, TP.HCM' : profileData(user).warehouseAddress, taxCode: `DEMO${String(user.id).padStart(6, '0')}`, locationType: 'STREET_FRONT' } };
        const text = Buffer.from(getCanonicalContractText(contract));
        contract.contractHash = crypto.createHash('sha256').update(text).digest('hex');
        contract.signature = crypto.sign(null, text, keys.privateKey).toString('base64');
        contract.stamp = { certificateId: `DEMO19K-${contract.contractHash.slice(0, 12)}`, status: 'VERIFIED_VALID', signedBy: user.name, representative: user.name, signedAt: contract.signedAt };
        value.contracts[String(user.id)] = contract;
      }
    });
    await document('orders_delivery', {}, value => { for (const index of [4, 5, 6, 7, 8]) value[String(orders[index].id)] ||= { orderId: orders[index].id, driverName: `${tag} Tài xế thử nghiệm`, driverPhone: '0908000000', vehicleType: 'Xe máy', licensePlate: 'DEMO-000', assignedAt: now.toISOString(), updatedAt: now.toISOString(), estimatedDeliveryTime: 'Trong 30 - 45 phút tới', packingChecklist: index === 4 ? orders[index].items.map(item => item.id) : [], paymentInfo: index >= 7 ? { status: 'CONFIRMED', method: 'DEMO', confirmedAt: now.toISOString() } : null }; });
    await document('saved_drivers', [], value => { if (!value.some(driver => driver.id === `demo19k-driver-${profile.id}`)) value.push({ id: `demo19k-driver-${profile.id}`, supplierId: profile.id, driverName: `${tag} Tài xế thử nghiệm`, driverPhone: '0908000000', vehicleType: 'Xe máy', licensePlate: 'DEMO-000' }); });
    await document('inventory_suppliers', {}, value => { for (const item of inventory) value[String(item.id)] ||= profile.businessName; });
    await document('consignment_items', {}, value => { for (const item of inventory.slice(4, 6)) value[String(item.id)] ||= { isConsignment: true, settlementPrice: item.purchasePrice, supplierName: profile.businessName, supplierId: profile.id, autoRestock: true, autoExchangeExpiry: true, updatedAt: now.toISOString() }; });
    await document('consignment_quotes', {}, value => { value[String(quotes[0].id)] ||= { isConsignment: true, settlementPrice: Number(products[0].wholesalePrice), autoRestock: true, autoExchangeExpiry: true, termsNote: `${tag} Điều khoản ký gửi mô phỏng`, updatedAt: now.toISOString() }; });
    await document('consignment_requests', [], value => { for (const [index, type] of ['RESTOCK', 'EXCHANGE_EXPIRY'].entries()) { const id = `DEMO19K-${buyer.id}-${type}`; if (!value.some(row => row.id === id)) value.push({ id, storeId: buyer.id, storeName: storeProfile.storeName, storePhone: storeProfile.storePhone, storeAddress: storeProfile.storeAddress, supplierId: profile.id, supplierName: profile.businessName, itemId: inventory[4 + index].id, productName: inventory[4 + index].name, unit: 'thùng', type, currentQty: inventory[4 + index].quantity, requestedQty: 10, expiryDate: inventory[4 + index].expiryDate?.toISOString(), note: `${tag} Yêu cầu thử nghiệm`, status: index ? 'DISPATCHED' : 'PENDING', createdAt: now.toISOString(), updatedAt: now.toISOString() }); } });
    if (!await tx.auditLog.findFirst({ where: { actorId: admin.id, action: 'DEMO_SEEDED' } })) await tx.auditLog.create({ data: { actorId: admin.id, action: 'DEMO_SEEDED', entityType: 'DEMO', entityId: String(buyer.id), details: JSON.stringify({ demo: true, message: 'Tài khoản và dữ liệu mô phỏng theo yêu cầu chủ dự án.' }) } });
    return { accounts: Object.values(users).map(user => ({ username: user.username, id: user.id })), inventory: inventory.length, products: products.length, orders: orders.length, quotes: quotes.length, complaints: 3, plans: 2, salesDays: 30, buyerId: buyer.id, supplierId: profile.id };
  }, { timeout: 180000, maxWait: 20000, isolationLevel: 'Serializable' });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());

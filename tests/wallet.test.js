require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');

const prefix = `wallet_${randomUUID().slice(0, 8)}`;
const password = 'WalletQa@2026';
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
const users = [], cookies = [];
const bank = { bankName: 'Ngân hàng QA', bankAccountNumber: '0123456789', bankAccountHolder: 'CHU TAI KHOAN QA' };
let profile, product, orderId;

const get = (path, who = 0) => request(app).get('/api' + path).set('Cookie', cookies[who]);
const post = (path, body, who = 0) => request(app).post('/api' + path).set(csrf).set('Cookie', cookies[who]).send(body);

async function signIn(user) {
  const result = await request(app).post('/api/auth/login').set(csrf).send({ username: user.username, password }).expect(200);
  cookies.push(result.headers['set-cookie'][0].split(';')[0]);
}

before(async () => {
  const passwordHash = await bcrypt.hash(password, 10);
  // 0 = admin, 1 = store owner, 2 = supplier, 3 = second store owner
  for (const code of ['ADMIN', 'STORE_OWNER', 'SUPPLIER', 'STORE_OWNER']) {
    const user = await prisma.user.create({
      data: { username: `${prefix}_${users.length}`, name: `${prefix} User`, passwordHash, role: { connect: { code } } },
    });
    users.push(user);
    await signIn(user);
  }
  profile = await prisma.supplierProfile.create({
    data: {
      userId: users[2].id,
      businessName: `${prefix} Chủ vựa`,
      warehouseAddress: '12 Đường kho kiểm thử',
      deliveryRadiusKm: 15,
      verificationStatus: 'APPROVED',
      bankName: 'Ngân hàng QA',
      bankAccountNumber: '0123456789',
      bankAccountHolder: 'CHU VUA QA',
    },
  });
  product = await prisma.supplierProduct.create({
    data: { supplierId: profile.id, name: `${prefix} Hàng hóa`, packaging: 'Thùng', wholesalePrice: 200000, stockQty: 50, moq: 1, isActive: true },
  });
});

after(async () => {
  const ids = users.map(user => user.id);
  if (orderId) {
    await prisma.refund.deleteMany({ where: { orderId } });
    await prisma.orderPayment.deleteMany({ where: { orderId } });
    await prisma.walletTransaction.deleteMany({ where: { orderId } });
    await prisma.wholesaleOrder.deleteMany({ where: { id: orderId } });
  }
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
  await prisma.depositRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.withdrawalRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
  await prisma.supplierProduct.deleteMany({ where: { supplierId: profile.id } });
  await prisma.supplierProfile.deleteMany({ where: { id: profile.id } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test('wallet endpoints require authentication and reject other roles', async () => {
  await request(app).get('/api/wallet').expect(401);
  await get('/wallet', 0).expect(403);
  await get('/wallet', 2).expect(200);
  await request(app).get('/api/admin/wallet/deposits').expect(401);
  await get('/admin/wallet/deposits', 1).expect(403);
  await get('/admin/wallet/deposits', 0).expect(200);
});

test('a deposit request is credited to the wallet exactly once after admin approval', async () => {
  const created = await post('/wallet/deposits', { amount: 500000, ...bank, note: 'Nạp tiền kiểm thử' }, 1).expect(201);
  assert.equal(created.body.request.status, 'PENDING');
  assert.equal(created.body.request.amount, 500000);

  // The balance is only visible after the admin confirms the transfer.
  const beforeApproval = await get('/wallet', 1).expect(200);
  assert.equal(beforeApproval.body.wallet.balance, 0);

  await post(`/admin/wallet/deposits/${created.body.request.id}/approve`, { reference: 'NAP-001', adminNote: 'Đã nhận tiền' }, 0).expect(200);
  const afterApproval = await get('/wallet', 1).expect(200);
  assert.equal(afterApproval.body.wallet.balance, 500000);
  assert.equal(afterApproval.body.wallet.heldBalance, 0);

  // A second approval must not credit the money again.
  await post(`/admin/wallet/deposits/${created.body.request.id}/approve`, { reference: 'NAP-002' }, 0).expect(409);
  const afterReplay = await get('/wallet', 1).expect(200);
  assert.equal(afterReplay.body.wallet.balance, 500000);

  const ledger = await get('/wallet/transactions', 1).expect(200);
  const deposits = ledger.body.transactions.filter(row => row.type === 'DEPOSIT');
  assert.equal(deposits.length, 1);
  assert.equal(deposits[0].direction, 'CREDIT');
  assert.equal(deposits[0].balanceAfter, 500000);
});

test('a wallet balance can never go negative', async () => {
  const created = await post('/wallet/deposits', { amount: 100000, ...bank }, 1).expect(201);
  await post(`/admin/wallet/deposits/${created.body.request.id}/approve`, {}, 0).expect(200);
  const balance = (await get('/wallet', 1).expect(200)).body.wallet.balance;
  const tooMuch = await post('/wallet/withdrawals', { amount: balance + 1, ...bank }, 1).expect(409);
  assert.match(tooMuch.body.message, /không đủ/i);
  const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: users[1].id } });
  assert.ok(wallet.balance.greaterThanOrEqualTo(0));
});

test('a withdrawal holds the money and returns it when the request is rejected', async () => {
  const before = (await get('/wallet', 1).expect(200)).body.wallet;
  const created = await post('/wallet/withdrawals', { amount: 200000, ...bank, note: 'Rút tiền kiểm thử' }, 1).expect(201);
  assert.equal(created.body.request.status, 'PENDING');

  const held = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(held.balance, before.balance - 200000);
  assert.equal(held.heldBalance, before.heldBalance + 200000);

  await post(`/admin/wallet/withdrawals/${created.body.request.id}/reject`, { adminNote: 'Tài khoản không khớp' }, 0).expect(200);
  const restored = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(restored.balance, before.balance);
  assert.equal(restored.heldBalance, before.heldBalance);
});

test('an approved withdrawal only pays out once and the transfer can be marked as failed', async () => {
  const before = (await get('/wallet', 1).expect(200)).body.wallet;
  const created = await post('/wallet/withdrawals', { amount: 100000, ...bank }, 1).expect(201);
  const id = created.body.request.id;
  await post(`/admin/wallet/withdrawals/${id}/approve`, { adminNote: 'Đã duyệt' }, 0).expect(200);
  await post(`/admin/wallet/withdrawals/${id}/complete`, { reference: 'CK-001' }, 0).expect(200);

  const paidOut = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(paidOut.balance, before.balance - 100000);
  assert.equal(paidOut.heldBalance, before.heldBalance);

  // Completing or failing twice must not move money again.
  await post(`/admin/wallet/withdrawals/${id}/complete`, { reference: 'CK-002' }, 0).expect(409);
  await post(`/admin/wallet/withdrawals/${id}/fail`, { adminNote: 'Chuyển khoản thất bại' }, 0).expect(409);
  const unchanged = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(unchanged.balance, paidOut.balance);
  assert.equal(unchanged.heldBalance, paidOut.heldBalance);
});

test('a failed transfer returns the held money to the spendable balance', async () => {
  const before = (await get('/wallet', 1).expect(200)).body.wallet;
  const created = await post('/wallet/withdrawals', { amount: 50000, ...bank }, 1).expect(201);
  const id = created.body.request.id;
  await post(`/admin/wallet/withdrawals/${id}/approve`, {}, 0).expect(200);
  await post(`/admin/wallet/withdrawals/${id}/fail`, { adminNote: 'Ngân hàng bảo trả lại' }, 0).expect(200);
  const restored = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(restored.balance, before.balance);
  assert.equal(restored.heldBalance, before.heldBalance);
});

test('the buyer pays the order with the wallet and the amount comes from the backend', async () => {
  const order = await prisma.wholesaleOrder.create({
    data: {
      supplierId: profile.id, buyerId: users[1].id, status: 'PENDING',
      subtotal: 400000, deliveryFee: 20000, total: 420000,
      commissionRate: 5,
      items: { create: [{ productId: product.id, productName: product.name, packaging: product.packaging, quantity: 2, unitPrice: 200000, lineTotal: 400000 }] },
    },
  });
  orderId = order.id;
  const before = (await get('/wallet', 1).expect(200)).body.wallet;

  const payment = await post(`/wallet/payments/${orderId}`, { amount: 1 }, 1).expect(201);
  assert.equal(payment.body.payment.amount, 420000);
  assert.equal(payment.body.payment.status, 'PAID');

  const after = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(after.balance, before.balance - 420000);

  // The order can only be paid once.
  await post(`/wallet/payments/${orderId}`, {}, 1).expect(409);

  // Another store owner can never pay an order they do not own.
  await post(`/wallet/payments/${orderId}`, {}, 3).expect(403);
});

test('the supplier is credited when the order is delivered and can never be credited twice', async () => {
  const supplierBefore = (await get('/wallet', 2).expect(200)).body.wallet;
  await request(app).patch(`/api/supplier/orders/${orderId}/status`).set(csrf).set('Cookie', cookies[2]).send({ status: 'APPROVED' }).expect(200);
  for (const status of ['PREPARING', 'SHIPPING', 'DELIVERED']) {
    await request(app).patch(`/api/supplier/orders/${orderId}/status`).set(csrf).set('Cookie', cookies[2]).send({ status }).expect(200);
  }
  const supplierAfter = (await get('/wallet', 2).expect(200)).body.wallet;
  const commission = 420000 * 5 / 100;
  assert.equal(supplierAfter.balance, supplierBefore.balance + (420000 - commission));

  // Delivering twice must not credit the supplier again.
  await request(app).patch(`/api/supplier/orders/${orderId}/status`).set(csrf).set('Cookie', cookies[2]).send({ status: 'DELIVERED' }).expect(400);
  const supplierUnchanged = (await get('/wallet', 2).expect(200)).body.wallet;
  assert.equal(supplierUnchanged.balance, supplierAfter.balance);
});

test('an admin refund returns the money to the buyer and can only happen once', async () => {
  const buyerBefore = (await get('/wallet', 1).expect(200)).body.wallet;
  const supplierBefore = (await get('/wallet', 2).expect(200)).body.wallet;

  const refunded = await post(`/admin/wallet/orders/${orderId}/refund`, { reason: 'Chủ vựa hủy đơn' }, 0).expect(200);
  assert.equal(refunded.body.refund.amount, 420000);

  const buyerAfter = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(buyerAfter.balance, buyerBefore.balance + 420000);
  // The supplier already received the money, so the refund takes it back.
  const supplierAfter = (await get('/wallet', 2).expect(200)).body.wallet;
  assert.equal(supplierAfter.balance, supplierBefore.balance - 399000);

  // A second refund must not credit the buyer again.
  await post(`/admin/wallet/orders/${orderId}/refund`, { reason: 'Hoàn tiền lần hai' }, 0).expect(409);
  const buyerUnchanged = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(buyerUnchanged.balance, buyerAfter.balance);
});

test('the admin lists every wallet payment and keeps the original ledger rows', async () => {
  const payments = await get('/admin/wallet/payments', 0).expect(200);
  assert.ok(payments.body.payments.some(row => row.orderId === orderId));
  assert.ok(payments.body.payments.find(row => row.orderId === orderId).refunded);

  const ledger = await get('/wallet/transactions', 1).expect(200);
  const types = ledger.body.transactions.map(row => row.type);
  assert.ok(types.includes('ORDER_PAYMENT'));
  assert.ok(types.includes('REFUND'));
  assert.ok(types.includes('DEPOSIT'));
});

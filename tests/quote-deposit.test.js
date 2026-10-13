require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');

const token = String(Date.now()).slice(-8);
const prefix = `quote_flow_${token}`;
const password = 'QuoteFlow@2026';
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
const userIds = [];
let quoteId;
let orderId;

after(async () => {
  if (quoteId) await prisma.supplierQuote.deleteMany({ where: { id: quoteId } });
  if (orderId) await prisma.wholesaleOrder.deleteMany({ where: { id: orderId } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test('supplier sends a marketing quote; store reports transfer, supplier confirms deposit, then approves', async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  const supplier = await prisma.user.create({
    data: { username: `${prefix}_supplier`, name: 'Quote supplier', phone: `07${token}`, passwordHash, role: { connect: { code: 'SUPPLIER' } } },
  });
  const store = await prisma.user.create({
    data: { username: `${prefix}_store`, name: 'Quote store', phone: `08${token}`, passwordHash, role: { connect: { code: 'STORE_OWNER' } } },
  });
  userIds.push(supplier.id, store.id);
  const profile = await prisma.supplierProfile.create({
    data: {
      userId: supplier.id,
      businessName: 'Quote wholesaler',
      warehouseAddress: 'Quote warehouse',
      deliveryRadiusKm: 10,
      verificationStatus: 'APPROVED',
      bankName: 'Test Bank',
      bankAccountNumber: '1234567890',
      bankAccountHolder: 'QUOTE WHOLESALER',
    },
  });
  const product = await prisma.supplierProduct.create({
    data: { supplierId: profile.id, name: 'Quote product', packaging: 'case', wholesalePrice: 200000, stockQty: 20, moq: 1, isActive: true },
  });
  const login = async username => (await request(app).post('/api/auth/login').set(csrf).send({ username, password }).expect(200)).headers['set-cookie'][0].split(';')[0];
  const supplierCookie = await login(supplier.username);
  const storeCookie = await login(store.username);

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 7);
  const created = await request(app).post('/api/supplier/quotes').set(csrf).set('Cookie', supplierCookie).send({
    buyerId: store.id,
    title: 'Offer after store visit',
    validUntil: validUntil.toISOString().slice(0, 10),
    deliveryFee: 10000,
    depositRate: 20,
    note: 'Deliver in two days',
    lines: [{ productId: product.id, quantity: 5, unitPrice: 180000, expectedUpdatedAt: product.updatedAt.toISOString() }],
  }).expect(201);
  quoteId = created.body.quote.id;
  assert.equal(created.body.quote.total, 910000);
  assert.equal(created.body.quote.depositAmount, 182000);

  const accepted = await request(app).post(`/api/quotes/${quoteId}/accept`).set(csrf).set('Cookie', storeCookie).send({
    requestId: randomUUID(),
    recipientName: 'Store owner',
    recipientPhone: store.phone,
    deliveryAddress: '123 Test Street, District 1',
    note: 'Morning delivery',
  }).expect(201);
  orderId = accepted.body.order.id;
  assert.equal(accepted.body.order.depositStatus, 'PENDING');
  assert.equal(accepted.body.order.depositBankAccountNumber, '1234567890');

  const blocked = await request(app).patch(`/api/supplier/orders/${orderId}/status`).set(csrf).set('Cookie', supplierCookie).send({ status: 'APPROVED' }).expect(400);
  assert.match(blocked.body.message, /đặt cọc/i);

  const deposited = await request(app).post(`/api/orders/${orderId}/deposit`).set(csrf).set('Cookie', storeCookie).send({
    reference: 'TEST-TRANSFER-001',
  }).expect(200);
  assert.equal(deposited.body.order.depositStatus, 'SUBMITTED');
  assert.equal(deposited.body.order.depositReference, 'TEST-TRANSFER-001');

  const stillBlocked = await request(app).patch(`/api/supplier/orders/${orderId}/status`).set(csrf).set('Cookie', supplierCookie).send({ status: 'APPROVED' }).expect(400);
  assert.match(stillBlocked.body.message, /xác nhận tiền/i);

  const notReceived = await request(app).patch(`/api/supplier/orders/${orderId}/deposit`).set(csrf).set('Cookie', supplierCookie).send({
    action: 'REJECT',
    reason: 'Chưa thấy giao dịch thử',
  }).expect(200);
  assert.equal(notReceived.body.order.depositStatus, 'PENDING');

  const sandbox = await request(app).post(`/api/orders/${orderId}/deposit/sandbox`).set(csrf).set('Cookie', storeCookie).expect(200);
  assert.equal(sandbox.body.order.depositStatus, 'SUBMITTED');
  assert.match(sandbox.body.order.depositReference, /^SANDBOX-/);

  const dashboardBeforeConfirmation = await request(app).get('/api/supplier/dashboard').set(csrf).set('Cookie', supplierCookie).expect(200);
  assert.equal(dashboardBeforeConfirmation.body.summary.pendingDepositConfirmations, 1);

  const confirmed = await request(app).patch(`/api/supplier/orders/${orderId}/deposit`).set(csrf).set('Cookie', supplierCookie).send({
    action: 'CONFIRM',
  }).expect(200);
  assert.equal(confirmed.body.order.depositStatus, 'PAID');

  const dashboardAfterConfirmation = await request(app).get('/api/supplier/dashboard').set(csrf).set('Cookie', supplierCookie).expect(200);
  assert.equal(dashboardAfterConfirmation.body.summary.pendingDepositConfirmations, 0);

  const approved = await request(app).patch(`/api/supplier/orders/${orderId}/status`).set(csrf).set('Cookie', supplierCookie).send({ status: 'APPROVED' }).expect(200);
  assert.equal(approved.body.order.status, 'APPROVED');
  assert.equal((await prisma.supplierProduct.findUnique({ where: { id: product.id } })).stockQty, 15);
});

test('supplier rejection after a confirmed deposit requires a recorded refund', async () => {
  const order = await prisma.wholesaleOrder.findUnique({ where: { id: orderId } });
  assert.equal(order.depositStatus, 'PAID');

  await prisma.wholesaleOrder.update({
    where: { id: orderId },
    data: { status: 'PENDING' },
  });

  const supplier = await prisma.user.findFirstOrThrow({ where: { username: `${prefix}_supplier` } });
  const login = await request(app).post('/api/auth/login').set(csrf).send({ username: supplier.username, password }).expect(200);
  const supplierCookie = login.headers['set-cookie'][0].split(';')[0];

  const rejected = await request(app).patch(`/api/supplier/orders/${orderId}/status`).set(csrf).set('Cookie', supplierCookie).send({
    status: 'REJECTED',
    rejectReason: 'Không thể chuẩn bị đủ hàng',
  }).expect(200);
  assert.equal(rejected.body.order.depositStatus, 'REFUND_PENDING');

  const refunded = await request(app).patch(`/api/supplier/orders/${orderId}/deposit`).set(csrf).set('Cookie', supplierCookie).send({
    action: 'REFUND',
    reference: 'REFUND-TEST-001',
  }).expect(200);
  assert.equal(refunded.body.order.depositStatus, 'REFUNDED');
  assert.equal(refunded.body.order.depositRefundReference, 'REFUND-TEST-001');
});

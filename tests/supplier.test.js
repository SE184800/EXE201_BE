require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');

const prefix = `supplier_${randomUUID().slice(0, 8)}`;
const password = 'Integration@2026';
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
const createdUserIds = [];
let supplier;
let buyer;
let supplierCookie;
let profile;
let product;

before(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  supplier = await prisma.user.create({
    data: { username: `${prefix}_supplier`, name: 'Supplier flow test', passwordHash, role: { connect: { code: 'SUPPLIER' } } },
  });
  buyer = await prisma.user.create({
    data: { username: `${prefix}_buyer`, name: 'Buyer flow test', passwordHash, role: { connect: { code: 'STORE_OWNER' } } },
  });
  createdUserIds.push(supplier.id, buyer.id);
  const login = await request(app).post('/api/auth/login').set(csrf).send({ username: supplier.username, password }).expect(200);
  supplierCookie = login.headers['set-cookie'][0].split(';')[0];
});

after(async () => {
  if (profile) await prisma.wholesaleOrder.deleteMany({ where: { supplierId: profile.id } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

test('supplier core flow: setup, catalog, reject and approve order', async () => {
  const empty = await request(app).get('/api/supplier/dashboard').set('Cookie', supplierCookie).expect(200);
  assert.equal(empty.body.profile, null);

  await request(app).put('/api/supplier/profile').set(csrf).set('Cookie', supplierCookie)
    .send({ businessName: 'A', warehouseAddress: 'Kho', deliveryRadiusKm: 0 }).expect(400);
  const savedProfile = await request(app).put('/api/supplier/profile').set(csrf).set('Cookie', supplierCookie)
    .send({ businessName: 'Đại lý Minh Phát', warehouseAddress: '12 Nguyễn Trãi, Quận 5', deliveryRadiusKm: 15 }).expect(200);
  profile = savedProfile.body.profile;
  assert.equal(profile.deliveryRadiusKm, 15);

  const created = await request(app).post('/api/supplier/products').set(csrf).set('Cookie', supplierCookie)
    .send({ name: 'Nước ngọt', packaging: 'Thùng', wholesalePrice: 180000, stockQty: 10, moq: 2 }).expect(201);
  product = created.body.product;
  assert.equal(product.stockQty, 10);

  const rejectedOrder = await prisma.wholesaleOrder.create({
    data: {
      supplierId: profile.id, buyerId: buyer.id, status: 'PENDING', subtotal: 360000, deliveryFee: 20000, total: 380000,
      items: { create: [{ productId: product.id, productName: product.name, packaging: product.packaging, quantity: 2, unitPrice: 180000, lineTotal: 360000 }] },
    },
  });
  const rejected = await request(app).patch(`/api/supplier/orders/${rejectedOrder.id}/status`).set(csrf).set('Cookie', supplierCookie)
    .send({ status: 'REJECTED' }).expect(400);
  assert.match(rejected.body.message, /lý do/i);
  await request(app).patch(`/api/supplier/orders/${rejectedOrder.id}/status`).set(csrf).set('Cookie', supplierCookie)
    .send({ status: 'REJECTED', rejectReason: { value: 'x' } }).expect(400);
  const rejectedOk = await request(app).patch(`/api/supplier/orders/${rejectedOrder.id}/status`).set(csrf).set('Cookie', supplierCookie)
    .send({ status: 'REJECTED', rejectReason: 'Hết lịch giao trong ngày' }).expect(200);
  assert.equal(rejectedOk.body.order.status, 'REJECTED');

  const approvedOrder = await prisma.wholesaleOrder.create({
    data: {
      supplierId: profile.id, buyerId: buyer.id, status: 'PENDING', subtotal: 360000, deliveryFee: 20000, total: 380000,
      items: { create: [{ productId: product.id, productName: product.name, packaging: product.packaging, quantity: 2, unitPrice: 180000, lineTotal: 360000 }] },
    },
  });
  const approved = await request(app).patch(`/api/supplier/orders/${approvedOrder.id}/status`).set(csrf).set('Cookie', supplierCookie)
    .send({ status: 'APPROVED' }).expect(200);
  assert.equal(approved.body.order.status, 'APPROVED');
  const stock = await prisma.supplierProduct.findUnique({ where: { id: product.id } });
  assert.equal(stock.stockQty, 8);
  for (const status of ['PREPARING', 'SHIPPING', 'DELIVERED']) {
    await request(app).patch(`/api/supplier/orders/${approvedOrder.id}/status`).set(csrf).set('Cookie', supplierCookie)
      .send({ status }).expect(200);
  }
  const dashboard = await request(app).get('/api/supplier/dashboard').set('Cookie', supplierCookie).expect(200);
  assert.equal(dashboard.body.summary.pendingOrders, 0);
  assert.equal(dashboard.body.summary.deliveredRevenue, 380000);
});

test('supplier routes block other roles', async () => {
  await request(app).get('/api/supplier/dashboard').expect(401);
  const login = await request(app).post('/api/auth/login').set(csrf).send({ username: buyer.username, password }).expect(200);
  await request(app).get('/api/supplier/dashboard').set('Cookie', login.headers['set-cookie'][0].split(';')[0]).expect(403);
});

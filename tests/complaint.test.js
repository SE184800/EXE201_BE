require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');

const prefix = `complaint_${randomUUID().slice(0, 8)}`;
const password = 'Integration@2026';
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
const createdUserIds = [];

let supplier;
let buyer;
let supplierCookie;
let buyerCookie;
let profile;
let product;
let order;

before(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  supplier = await prisma.user.create({
    data: { username: `${prefix}_supplier`, name: 'Supplier Complaint Test', passwordHash, role: { connect: { code: 'SUPPLIER' } } },
  });
  buyer = await prisma.user.create({
    data: { username: `${prefix}_buyer`, name: 'Store Complaint Test', passwordHash, role: { connect: { code: 'STORE_OWNER' } } },
  });
  createdUserIds.push(supplier.id, buyer.id);

  const supLogin = await request(app).post('/api/auth/login').set(csrf).send({ username: supplier.username, password }).expect(200);
  supplierCookie = supLogin.headers['set-cookie'][0].split(';')[0];

  const buyLogin = await request(app).post('/api/auth/login').set(csrf).send({ username: buyer.username, password }).expect(200);
  buyerCookie = buyLogin.headers['set-cookie'][0].split(';')[0];

  profile = await prisma.supplierProfile.create({
    data: {
      userId: supplier.id,
      businessName: 'Vựa Báo Cáo Sự Cố',
      warehouseAddress: '123 Đường Test, Quận 1',
      deliveryRadiusKm: 20,
      verificationStatus: 'APPROVED',
      deliveryFee: 15000,
    },
  });

  product = await prisma.supplierProduct.create({
    data: {
      supplierId: profile.id,
      name: 'Thùng nước ngọt Test',
      packaging: 'Thùng',
      wholesalePrice: 150000,
      stockQty: 50,
      moq: 1,
      isActive: true,
    },
  });

  order = await prisma.wholesaleOrder.create({
    data: {
      supplierId: profile.id,
      buyerId: buyer.id,
      status: 'ISSUE_HANDLING',
      subtotal: 150000,
      deliveryFee: 15000,
      total: 165000,
      items: {
        create: [{ productId: product.id, productName: product.name, packaging: product.packaging, quantity: 1, unitPrice: 150000, lineTotal: 150000 }],
      },
    },
  });
});

after(async () => {
  if (order) await prisma.orderComplaint.deleteMany({ where: { orderId: order.id } });
  if (profile) await prisma.wholesaleOrder.deleteMany({ where: { supplierId: profile.id } });
  if (profile) await prisma.supplierProduct.deleteMany({ where: { supplierId: profile.id } });
  if (profile) await prisma.supplierProfile.deleteMany({ where: { id: profile.id } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

test('store owner can report order in ISSUE_HANDLING step and supplier can review/respond', async () => {
  // Store reports order when in ISSUE_HANDLING
  const res = await request(app)
    .post('/api/complaints')
    .set(csrf)
    .set('Cookie', buyerCookie)
    .send({
      orderId: order.id,
      reason: 'DAMAGED',
      description: 'Phát hiện 3 lon bị móp méo khi mở kiện hàng kiểm tra.',
    })
    .expect(201);

  assert.equal(res.body.complaint.orderId, order.id);
  assert.equal(res.body.complaint.reason, 'DAMAGED');
  assert.equal(res.body.complaint.status, 'OPEN');

  // Duplicate complaint should be blocked
  await request(app)
    .post('/api/complaints')
    .set(csrf)
    .set('Cookie', buyerCookie)
    .send({
      orderId: order.id,
      reason: 'Khác',
      description: 'Báo cáo trùng lặp.',
    })
    .expect(400);

  // Supplier can list complaints
  const supList = await request(app)
    .get('/api/complaints')
    .set(csrf)
    .set('Cookie', supplierCookie)
    .expect(200);

  const found = supList.body.complaints.find(c => c.orderId === order.id);
  assert.ok(found);
  assert.equal(found.status, 'OPEN');

  // Supplier responds and updates status
  const updateRes = await request(app)
    .patch(`/api/complaints/${found.id}`)
    .set(csrf)
    .set('Cookie', supplierCookie)
    .send({
      status: 'IN_REVIEW',
      response: 'Đã tiếp nhận, bên mình sẽ cử người giao bù 3 lon trong chiều nay.',
    })
    .expect(200);

  assert.equal(updateRes.body.complaint.status, 'IN_REVIEW');
  assert.equal(updateRes.body.complaint.response, 'Đã tiếp nhận, bên mình sẽ cử người giao bù 3 lon trong chiều nay.');

  // Supplier views order with complaint attached
  const orderList = await request(app)
    .get('/api/supplier/orders')
    .set(csrf)
    .set('Cookie', supplierCookie)
    .expect(200);

  const orderItem = orderList.body.orders.find(o => o.id === order.id);
  assert.ok(orderItem);
  assert.ok(orderItem.complaint);
  assert.equal(orderItem.complaint.status, 'IN_REVIEW');
  assert.equal(orderItem.complaint.response, 'Đã tiếp nhận, bên mình sẽ cử người giao bù 3 lon trong chiều nay.');
});

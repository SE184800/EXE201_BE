require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');

const prefix = `catalog_${randomUUID().slice(0, 8)}`;
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
const users = [];
const cookies = [];
let profile;
let published;
const input = { name: `${prefix} Nước ngọt`, packaging: 'Thùng 24 lon', wholesalePrice: 185050, stockQty: 50, moq: 2, isActive: true };
const change = (product, extra = {}) => ({ ...input, ...extra, expectedUpdatedAt: product.updatedAt });

before(async () => {
  const password = 'CatalogTest@2026';
  const passwordHash = await bcrypt.hash(password, 12);
  for (const [index, code] of ['SUPPLIER', 'STORE_OWNER', 'SUPPLIER', 'ADMIN'].entries()) {
    const user = await prisma.user.create({ data: { username: `${prefix}_${index}`, name: 'Kiểm thử nguồn sỉ', passwordHash, role: { connect: { code } } } });
    users.push(user);
    const login = await request(app).post('/api/auth/login').set(csrf).send({ username: user.username, password }).expect(200);
    cookies.push(login.headers['set-cookie'][0].split(';')[0]);
  }
});
after(async () => {
  const profiles = await prisma.supplierProfile.findMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.wholesaleOrder.deleteMany({ where: { supplierId: { in: profiles.map((item) => item.id) } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
});
const list = (query = {}) => request(app).get('/api/catalog/products').set('Cookie', cookies[1]).query({ q: prefix, ...query });
const update = (id, body, cookie = cookies[0]) => request(app).put(`/api/supplier/products/${id}`).set(csrf).set('Cookie', cookie).send(body);

test('chủ vựa thiết lập gian hàng, đăng sản phẩm; tạp hóa thấy đúng giá và thông tin vựa', async () => {
  await request(app).post('/api/supplier/products').set(csrf).set('Cookie', cookies[0]).send(input).expect(409);
  const saved = await request(app).put('/api/supplier/profile').set(csrf).set('Cookie', cookies[0])
    .send({ businessName: `${prefix} Đại lý Minh Phát`, warehouseAddress: 'Kho kiểm thử nguồn sỉ', deliveryRadiusKm: 12.5 }).expect(200);
  profile = saved.body.profile;
  // This suite tests catalog behavior after KYC. Admin review is covered separately.
  await prisma.supplierProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'APPROVED' } });
  const created = await request(app).post('/api/supplier/products').set(csrf).set('Cookie', cookies[0])
    .send({ ...input, supplierId: -1, userId: users[2].id }).expect(201);
  published = created.body.product;
  const result = await list().expect(200);
  assert.equal(result.body.products.length, 1);
  const item = result.body.products[0];
  assert.equal(item.id, published.id); assert.equal(item.wholesalePrice, 185050);
  assert.equal(item.supplier.id, profile.id); assert.equal(item.supplier.businessName, `${prefix} Đại lý Minh Phát`);
  assert.equal(item.supplier.deliveryRadiusKm, 12.5);
  for (const secret of ['passwordHash', 'email', 'phone', 'username', 'userId']) assert.equal(JSON.stringify(result.body).includes(`"${secret}"`), false);
  assert.equal(await prisma.inventoryItem.count({ where: { ownerId: users[1].id } }), 0);
});

test('ẩn → không hiện bên tạp hóa; đăng lại và sửa giá → thấy dữ liệu mới; giữ sản phẩm ẩn ở trang chủ vựa', async () => {
  published = (await update(published.id, change(published, { isActive: false })).expect(200)).body.product;
  assert.equal((await list().expect(200)).body.products.length, 0);
  const own = await request(app).get('/api/supplier/dashboard').set('Cookie', cookies[0]).expect(200);
  assert.equal(own.body.products[0].isActive, false); assert.equal(own.body.summary.productCount, 0);
  published = (await update(published.id, change(published, { isActive: true, wholesalePrice: 200000, stockQty: 0 })).expect(200)).body.product;
  const shown = (await list().expect(200)).body.products[0];
  assert.equal(shown.wholesalePrice, 200000); assert.equal(shown.stockQty, 0);
  const suppliers = await request(app).get('/api/catalog/suppliers').set('Cookie', cookies[1]).expect(200);
  assert.ok(suppliers.body.suppliers.some((item) => item.id === profile.id));
});

test('chặn sửa hàng của vựa khác, thiếu phiên và sai role; CSRF áp dụng cho đăng hàng', async () => {
  await request(app).put('/api/supplier/profile').set(csrf).set('Cookie', cookies[2])
    .send({ businessName: `${prefix} Vựa thứ hai`, warehouseAddress: 'Kho kiểm thử thứ hai', deliveryRadiusKm: 5 }).expect(200);
  await update(published.id, change(published), cookies[2]).expect(404);
  await request(app).delete(`/api/supplier/products/${published.id}`).set(csrf).set('Cookie', cookies[2]).expect(404);
  for (const url of ['/api/catalog/products', '/api/catalog/suppliers']) {
    await request(app).get(url).expect(401);
    for (const cookie of [cookies[0], cookies[3]]) await request(app).get(url).set('Cookie', cookie).expect(403);
  }
  await request(app).post('/api/supplier/products').set(csrf).set('Cookie', cookies[1]).send(input).expect(403);
  await request(app).post('/api/supplier/products').set('Cookie', cookies[0]).send(input).expect(403);
});

test('không công bố hàng từ tài khoản bị khóa hoặc đã đổi role', async () => {
  try {
    await prisma.user.update({ where: { id: users[0].id }, data: { isActive: false } });
    assert.equal((await list().expect(200)).body.products.length, 0);
    const vendors = await request(app).get('/api/catalog/suppliers').set('Cookie', cookies[1]).expect(200);
    assert.equal(vendors.body.suppliers.some((item) => item.id === profile.id), false);
    await prisma.user.update({ where: { id: users[0].id }, data: { isActive: true, roleId: users[1].roleId } });
    assert.equal((await list().expect(200)).body.products.length, 0);
  } finally { await prisma.user.update({ where: { id: users[0].id }, data: { isActive: true, roleId: users[0].roleId } }); }
});

test('validation giới hạn SQL và kiểm tra phiên bản sản phẩm trước khi sửa', async () => {
  for (const extra of [{ stockQty: null }, { stockQty: '3' }, { moq: 2147483648 }, { stockQty: -1 }, { wholesalePrice: 0 }, { wholesalePrice: 0.001 }, { isActive: 'false' }]) {
    await request(app).post('/api/supplier/products').set(csrf).set('Cookie', cookies[0]).send({ ...input, ...extra }).expect(400);
  }
  await update(published.id, input).expect(400);
  await update(published.id, { ...input, expectedUpdatedAt: '2000-01-01T00:00:00Z' }).expect(409);
  await update(2147483648, change(published)).expect(400);
  assert.equal((await list().expect(200)).body.products[0].wholesalePrice, 200000);
});

test('tìm kiếm, lọc theo chủ vựa và phân trang không lặp sản phẩm', async () => {
  await prisma.supplierProduct.createMany({ data: Array.from({ length: 25 }, (_, index) => ({ ...input, name: `${prefix} Hàng ${index}`, supplierId: profile.id })) });
  const first = await list({ supplierId: profile.id }).expect(200);
  const second = await list({ supplierId: profile.id, page: 2 }).expect(200);
  assert.equal(first.body.products.length, 24); assert.equal(first.body.hasMore, true);
  assert.equal(second.body.products.length, 2); assert.equal(second.body.hasMore, false);
  assert.equal(new Set([...first.body.products, ...second.body.products].map((item) => item.id)).size, 26);
  assert.equal((await list({ q: `${prefix} Nước ngọt` }).expect(200)).body.products.length, 1);
  assert.equal((await list({ q: `${prefix} Đại lý Minh Phát` }).expect(200)).body.products.length, 24);
  assert.equal((await list({ supplierId: 2147483647 }).expect(200)).body.products.length, 0);
  for (const query of [{ page: 0 }, { page: 1.5 }, { supplierId: -1 }, { supplierId: 2147483648 }, { q: 'x'.repeat(151) }]) await list(query).expect(400);
});

test('hai lần duyệt cùng đơn không trừ tồn kho hai lần', async () => {
  const item = await prisma.supplierProduct.create({ data: { ...input, supplierId: profile.id, stockQty: 10 } });
  const order = await prisma.wholesaleOrder.create({ data: { supplierId: profile.id, buyerId: users[1].id, status: 'PENDING', subtotal: 370100, deliveryFee: 0, total: 370100, items: { create: { productId: item.id, productName: item.name, packaging: item.packaging, quantity: 2, unitPrice: 185050, lineTotal: 370100 } } } });
  const approve = () => request(app).patch(`/api/supplier/orders/${order.id}/status`).set(csrf).set('Cookie', cookies[0]).send({ status: 'APPROVED' });
  const results = await Promise.all([approve(), approve()]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.ok(results.every((result) => [200, 400, 409].includes(result.status)));
  assert.equal((await prisma.supplierProduct.findUnique({ where: { id: item.id } })).stockQty, 8);
});

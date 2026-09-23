require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');
const { reportPeriod } = require('../services/storeRevenueService');
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
const prefix = `revenue_${randomUUID().slice(0, 8)}`;
const users = [], cookies = [];
const password = 'RevenueQa@2026';
const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const getReport = (query = {}, who = 0) => request(app).get('/api/inventory/revenue').set('Cookie', cookies[who]).query({ from: today, to: today, ...query });
const post = (path, body, who = 0) => request(app).post('/api' + path).set(csrf).set('Cookie', cookies[who]).send(body);
const put = (path, body) => request(app).put('/api' + path).set(csrf).set('Cookie', cookies[0]).send(body);
let stock;
before(async () => {
  const passwordHash = await bcrypt.hash(password, 10);
  for (const code of ['STORE_OWNER', 'STORE_OWNER', 'SUPPLIER', 'ADMIN']) {
    const user = await prisma.user.create({ data: { username: `${prefix}_${users.length}`, name: 'Revenue QA', passwordHash, role: { connect: { code } } } });
    users.push(user);
    const result = await request(app).post('/api/auth/login').set(csrf).send({ username: user.username, password }).expect(200);
    cookies.push(result.headers['set-cookie'][0].split(';')[0]);
  }
  const created = await post('/inventory', { name: `${prefix} Cà phê`, unit: 'gói', quantity: 100, sellingPrice: 15000, purchasePrice: 9000 }).expect(201);
  stock = created.body.item;
});
after(async () => {
  const ids = users.map(user => user.id);
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test('store revenue requires store role and isolates owners, including forged query ownerId', async () => {
  await request(app).get('/api/inventory/revenue').expect(401);
  await getReport({}, 2).expect(403);
  await getReport({}, 3).expect(403);
  const empty = await getReport({}, 1).expect(200);
  assert.equal(empty.body.summary.revenue, '0');
  assert.equal(empty.body.summary.salesCount, 0);
  assert.equal(empty.body.daily.length, 1);
  assert.deepEqual(empty.body.sales, []);
});

test('sales snapshot prices, explicit discounts and free sales; price edits and retries never rewrite revenue', async () => {
  const input = { type: 'SALE', quantity: 2, requestId: randomUUID() };
  const first = await post(`/inventory/${stock.id}/movements`, input).expect(200);
  assert.equal(first.body.movement.unitSalePrice, 15000);
  await put('/inventory/' + stock.id, { name: stock.name, unit: stock.unit, quantity: 98, sellingPrice: 50000 }).expect(200);
  const replay = await post(`/inventory/${stock.id}/movements`, input).expect(200);
  assert.equal(replay.body.movement.id, first.body.movement.id);
  assert.equal(replay.body.movement.unitSalePrice, 15000);
  await post(`/inventory/${stock.id}/movements`, { ...input, unitSalePrice: 16000 }).expect(409);
  await post(`/inventory/${stock.id}/movements`, { type: 'SALE', quantity: 1, unitSalePrice: 0, requestId: randomUUID() }).expect(200);
  const duplicate = { type: 'SALE', quantity: 3, unitSalePrice: 12000, requestId: randomUUID() };
  const attempts = await Promise.all([post(`/inventory/${stock.id}/movements`, duplicate), post(`/inventory/${stock.id}/movements`, duplicate)]);
  assert.deepEqual(attempts.map(row => row.status), [200, 200]);
  await post(`/inventory/${stock.id}/movements`, { type: 'RECEIPT', quantity: 10, requestId: randomUUID() }).expect(200);
  const report = await getReport().expect(200);
  assert.equal(report.body.summary.revenue, '66000');
  assert.equal(report.body.summary.salesCount, 3);
  assert.equal(report.body.summary.pricedSalesCount, 3);
  assert.equal(report.body.summary.unpricedSalesCount, 0);
  assert.equal(report.body.topProducts[0].quantity, '6');
  assert.equal(report.body.topProducts[0].revenue, '66000');
  assert.equal(report.body.daily[0].revenue, '66000');
  const other = await getReport({ ownerId: String(users[0].id) }, 1).expect(200);
  assert.equal(other.body.summary.revenue, '0');
  assert.equal(other.body.sales.length, 0);
});

test('invalid sale prices fail without stock changes; insufficient stock never records revenue', async () => {
  const before = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: stock.id } });
  for (const price of [-1, 1.5, '100', null, true, 2147483648]) {
    await post(`/inventory/${stock.id}/movements`, { type: 'SALE', quantity: 1, unitSalePrice: price, requestId: randomUUID() }).expect(400);
  }
  await post(`/inventory/${stock.id}/movements`, { type: 'RECEIPT', quantity: 1, unitSalePrice: 100, requestId: randomUUID() }).expect(400);
  await post(`/inventory/${stock.id}/movements`, { type: 'SALE', quantity: before.quantity + 1, unitSalePrice: 100, requestId: randomUUID() }).expect(409);
  assert.equal((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: stock.id } })).quantity, before.quantity);
  assert.equal((await getReport().expect(200)).body.summary.revenue, '66000');
});

test('Vietnam date boundaries, missing historical prices, and large VND totals remain exact', async () => {
  const item = await prisma.inventoryItem.create({ data: { ownerId: users[1].id, name: `${prefix} Lịch sử`, unit: 'thùng', quantity: 0, sellingPrice: 999999 } });
  const base = { itemId: item.id, type: 'SALE', quantityChange: -1, quantityBefore: 1, quantityAfter: 0, productName: item.name, unit: item.unit, note: 'QA boundary' };
  await prisma.stockMovement.createMany({ data: [
    { ...base, id: randomUUID(), unitSalePrice: 111, createdAt: new Date('2001-05-09T16:59:59.999Z') },
    { ...base, id: randomUUID(), unitSalePrice: 10000, createdAt: new Date('2001-05-09T17:00:00Z') },
    { ...base, id: randomUUID(), unitSalePrice: null, createdAt: new Date('2001-05-10T01:00:00Z') },
    { ...base, id: randomUUID(), unitSalePrice: 2147483647, quantityChange: -2147483647, quantityBefore: 2147483647, createdAt: new Date('2001-05-10T16:59:59.999Z') },
    { ...base, id: randomUUID(), unitSalePrice: 222, createdAt: new Date('2001-05-10T17:00:00Z') },
  ] });
  const report = await getReport({ from: '2001-05-10', to: '2001-05-10' }, 1).expect(200);
  const total = (2147483647n ** 2n + 10000n).toString();
  assert.equal(report.body.summary.revenue, total);
  assert.equal(report.body.summary.salesCount, 3);
  assert.equal(report.body.summary.unpricedSalesCount, 1);
  assert.equal(report.body.daily[0].revenue, total);
  assert.equal(report.body.topProducts[0].revenue, total);
  assert.equal(report.body.sales.find(row => row.unitSalePrice === null).revenue, null);
  await prisma.inventoryItem.update({ where: { id: item.id }, data: { sellingPrice: 50, name: 'Tên mới sau khi bán' } });
  const unchanged = await getReport({ from: '2001-05-10', to: '2001-05-10' }, 1).expect(200);
  assert.equal(unchanged.body.summary.revenue, total);
  assert.equal(unchanged.body.topProducts[0].productName, item.name);
});

test('revenue pagination does not change period totals and fills zero-sale days', async () => {
  await prisma.stockMovement.createMany({ data: Array.from({ length: 25 }, (_, index) => ({ id: randomUUID(), itemId: stock.id, type: 'SALE', quantityChange: -1, quantityBefore: 1, quantityAfter: 0, productName: stock.name, unit: stock.unit, note: 'QA pagination', unitSalePrice: 10, createdAt: new Date(Date.UTC(2001, 5, 1, 1, index)) })) });
  const query = { from: '2001-06-01', to: '2001-06-02' };
  const first = await getReport(query).expect(200), next = await getReport({ ...query, page: '2' }).expect(200);
  assert.equal(first.body.summary.revenue, '250');
  assert.deepEqual(first.body.summary, next.body.summary);
  assert.equal(first.body.sales.length, 20);
  assert.equal(next.body.sales.length, 5);
  assert.equal(first.body.hasMore, true);
  assert.equal(next.body.hasMore, false);
  assert.equal(new Set([...first.body.sales, ...next.body.sales].map(row => row.id)).size, 25);
  assert.equal(first.body.daily[1].revenue, '0');
});

test('date and page validation rejects invalid calendar dates and overly broad reports', async () => {
  for (const query of [{ from: '2026-02-30' }, { from: '2026-13-01' }, { from: '2001-01-01', to: '2002-01-02' }, { from: today, to: '2000-01-01' }, { page: '0' }, { page: '1.5' }, { page: '100001' }, { from: '' }, { from: [today, today] }]) await getReport(query).expect(400);
  const period = reportPeriod({}, new Date('2001-05-31T17:00:00Z'));
  assert.equal(period.from, '2001-06-01');
  assert.equal(period.to, '2001-06-01');
  assert.equal(period.start.toISOString(), '2001-05-31T17:00:00.000Z');
});

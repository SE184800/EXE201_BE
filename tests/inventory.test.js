const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { answerInventory } = require('../services/inventoryChat');
const { createInventoryRoutes, validateItem } = require('../routes/inventoryRoutes');
const { expiryInfo } = require('../services/inventoryExpiry');
test('cảnh báo hết hạn bao gồm ngày thứ 15, loại ngày 16 và hàng hết tồn', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const stock = [
    { name: 'Trong 15 ngày', quantity: 1, unit: 'hộp', expiryDate: '2026-10-06' },
    { name: 'Sau 16 ngày', quantity: 1, unit: 'hộp', expiryDate: '2026-10-07' },
    { name: 'Không còn tồn', quantity: 0, unit: 'hộp', expiryDate: '2026-10-01' },
  ];
  const reply = answerInventory('Hàng nào sắp hết hạn?', stock, now);
  assert.equal(reply.items.length, 1);
  assert.equal(reply.items[0].name, 'Trong 15 ngày');
  assert.match(reply.answer, /15 ngày tới/);
});

test('ngày hết hạn đúng lịch Việt Nam, ranh giới nửa đêm và ngày nhuận', () => {
  assert.equal(expiryInfo(null).daysUntilExpiry, null);
  assert.equal(expiryInfo('2026-09-22', new Date('2026-09-21T16:59:59Z')).daysUntilExpiry, 1);
  assert.equal(expiryInfo('2026-09-22', new Date('2026-09-21T17:00:00Z')).expiryLabel, 'Hết hạn hôm nay');
  assert.equal(expiryInfo('2026-09-20', new Date('2026-09-21T12:00:00Z')).daysUntilExpiry, -1);
  const body = { name: 'Coca', unit: 'lon', quantity: 1, lowThreshold: 5 };
  assert.ok(validateItem({ ...body, expiryDate: '2028-02-29' }).expiryDate instanceof Date);
  for (const expiryDate of ['2026-02-29', '2026-13-01', '2026-04-31', '21/09/2026', '0000-01-01', 10]) assert.equal(validateItem({ ...body, expiryDate }), null);
  assert.equal(validateItem({ ...body, expiryDate: '' }).expiryDate, null);
  assert.equal(validateItem(body).expiryDate, undefined);
});
test('chat phân biệt sắp hết hạn với sắp hết hàng, không đoán ngày thiếu', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const stock = [
    { name: 'Coca', quantity: 20, unit: 'lon', lowThreshold: 5, expiryDate: '2026-09-24' },
    { name: 'Sữa', quantity: 2, unit: 'hộp', lowThreshold: 5, expiryDate: null },
    { name: 'Mì', quantity: 3, unit: 'gói', lowThreshold: 5, expiryDate: '2026-09-20' },
  ];
  assert.match(answerInventory('Coca còn bao lâu hết hạn?', stock, now).answer, /Còn 3 ngày/);
  assert.equal(answerInventory('Hàng nào sắp hết hạn?', stock, now).items[0].name, 'Coca');
  assert.equal(answerInventory('Hàng nào đã hết hạn?', stock, now).items[0].name, 'Mì');
  assert.match(answerInventory('Sữa khi nào hết hạn?', stock, now).answer, /Chưa nhập hạn/);
  assert.equal(answerInventory('Hàng nào sắp hết?', stock, now).items.length, 2);
});
const items = [
  { id: 1, name: 'Coca lon 330ml', unit: 'lon', quantity: 24, lowThreshold: 5 },
  { id: 2, name: 'Coca chai 1.5L', unit: 'chai', quantity: 0, lowThreshold: 5 },
  { id: 3, name: 'Mì Hảo Hảo', unit: 'gói', quantity: 5, lowThreshold: 5 },
];
test('tìm tên có/không dấu và hỏi lại khi có nhiều quy cách', () => {
  assert.equal(answerInventory('Coca còn bao nhiêu?', items).items.length, 2);
  assert.match(answerInventory('Coca còn bao nhiêu?', items).answer, /nhiều sản phẩm/);
  assert.equal(answerInventory('Có mì Hảo Hảo không?', items).items[0].id, 3);
  assert.equal(answerInventory('mi hao hao con bao nhieu', items).items[0].quantity, 5);
  assert.equal(answerInventory('Coca chai 1.5L còn bao nhiêu?', items).items[0].quantity, 0);
});
test('ngưỡng bao gồm bằng ngưỡng, hết hàng và không tìm thấy', () => {
  assert.equal(answerInventory('Hàng nào sắp hết?', items).items.length, 2);
  assert.equal(answerInventory('Hàng nào hết?', items).items.length, 1);
  assert.equal(answerInventory('Xem kho', items).items.length, 3);
  assert.equal(answerInventory('Pepsi còn bao nhiêu?', items).items.length, 0);
  assert.match(answerInventory('Xem kho', []).answer, /chưa có/);
  assert.match(answerInventory('Thêm 10 lon Coca', items).answer, /chỉ tra cứu/);
});
test('từ chối số âm, số lẻ, kiểu sai và vượt giới hạn SQL Int', () => {
  const valid = { name: 'Coca', unit: 'lon', quantity: 0, lowThreshold: 5 };
  assert.ok(validateItem(valid));
  for (const quantity of [-1, 1.2, '5', 2147483648, null]) assert.equal(validateItem({ ...valid, quantity }), null);
  assert.equal(validateItem(null), null);
});
test('API cô lập kho theo người đăng nhập, không nhận ownerId từ client', async () => {
  const calls = [];
  const prisma = { inventoryItem: {
    findMany: async (args) => { calls.push(args); return items; },
    updateMany: async (args) => { calls.push(args); return { count: 0 }; },
    findFirst: async (args) => { calls.push(args); return null; },
    create: async (args) => { calls.push(args); return { id: 4, ...args.data }; },
  } };
  prisma.stockMovement = { create: async ({ data }) => data };
  prisma.auditLog = { create: async ({ data }) => { assert.equal(data.actorId, 12); return data; } };
  prisma.$transaction = async (run) => run(prisma);
  const app = express(); app.use(express.json());
  app.use('/inventory', createInventoryRoutes(prisma, (req, res, next) => { req.auth = { user: { id: 12, role: 'STORE_OWNER' } }; next(); }));
  await request(app).get('/inventory').expect(200);
  assert.deepEqual(calls.pop().where, { ownerId: 12 });
  await request(app).post('/inventory/chat').send({ message: 'Coca còn bao nhiêu?', ownerId: 99 }).expect(200);
  assert.deepEqual(calls.pop().where, { ownerId: 12 });
  const payload = { name: 'Coca', unit: 'lon', quantity: 1, lowThreshold: 5, ownerId: 99 };
  await request(app).post('/inventory').send(payload).expect(201);
  assert.equal(calls.pop().data.ownerId, 12);
  await request(app).put('/inventory/999').send(payload).expect(404);
  assert.deepEqual(calls.pop().where, { id: 999, ownerId: 12 });
  await request(app).post('/inventory/chat').send({ message: ' ' }).expect(400);
});
test('chủ vựa không được truy cập API kho tạp hóa', async () => {
  const app = express(); app.use(express.json());
  app.use('/inventory', createInventoryRoutes({}, (req, res, next) => { req.auth = { user: { id: 1, role: 'SUPPLIER' } }; next(); }));
  await request(app).get('/inventory').expect(403);
  await request(app).post('/inventory/chat').send({ message: 'Xem kho' }).expect(403);
});

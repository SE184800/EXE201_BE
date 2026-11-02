require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');
const delivery = require('../services/deliveryService');
const prefix = `import_${randomUUID().slice(0, 8)}`;
const password = 'ImportOnly@2026';
const config = readConfig();
const app = createApp(prisma, config);
const csrf = { Origin: config.origin, 'X-CSRF-Protection': 'sg-restock-web' };
const users = [], orderIds = [];
let buyer, other, supplier, supplierProfile, product;
const cookies = new Map();
before(async () => {
  const passwordHash = await bcrypt.hash(password, 10);
  for (const [suffix, code] of [['buyer', 'STORE_OWNER'], ['other', 'STORE_OWNER'], ['supplier', 'SUPPLIER'], ['admin', 'ADMIN']]) {
    const user = await prisma.user.create({ data: { username: `${prefix}_${suffix}`, name: `${prefix} ${suffix}`, passwordHash, role: { connect: { code } } } });
    users.push(user);
    const login = await request(app).post('/api/auth/login').set(csrf).send({ username: user.username, password }).expect(200);
    cookies.set(user.id, login.headers['set-cookie'][0].split(';')[0]);
  }
  [buyer, other, supplier] = users;
  supplierProfile = await prisma.supplierProfile.create({ data: { userId: supplier.id, businessName: prefix, warehouseAddress: 'QA test address', deliveryRadiusKm: 10, verificationStatus: 'APPROVED' } });
  product = await prisma.supplierProduct.create({ data: { supplierId: supplierProfile.id, name: prefix, packaging: 'thùng 24 lon', wholesalePrice: 48000, stockQty: 100, moq: 1 } });
});
after(async () => {
  const ids = users.map(user => user.id);
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.inventoryItem.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.orderComplaint.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderPayment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.wholesaleOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});
async function order(label, options = {}) {
  const lines = options.lines || [{ name: `${prefix} ${label}`, quantity: 2, packaging: 'thùng 24 lon', price: 48000 }];
  const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
  const created = await prisma.wholesaleOrder.create({ data: {
    buyerId: buyer.id, supplierId: supplierProfile.id, status: options.status || 'COMPLETED', subtotal: total, deliveryFee: 0, total,
    items: { create: lines.map(line => ({ productId: product.id, productName: line.name, packaging: line.packaging, quantity: line.quantity, unitPrice: line.price, lineTotal: line.quantity * line.price })) },
    ...(options.unpaid ? {} : { orderPayment: { create: { buyerId: buyer.id, supplierUserId: supplier.id, amount: total, status: 'SETTLED', reference: randomUUID() } } }),
  }, include: { items: true } });
  orderIds.push(created.id);
  return created;
}
const importOrder = (id, user = buyer) => request(app).post(`/api/orders/${id}/import-inventory`).set(csrf).set('Cookie', cookies.get(user.id)).send({});

test('only the owning store can import a completed, fully paid order', async () => {
  const ready = await order('authorization');
  await request(app).post(`/api/orders/${ready.id}/import-inventory`).set(csrf).send({}).expect(401);
  await importOrder(ready.id, other).expect(404);
  await importOrder(ready.id, supplier).expect(403);
  await importOrder(ready.id, users[3]).expect(403);
  const pending = await order('pending', { status: 'PENDING' });
  await importOrder(pending.id).expect(409);
  const unpaid = await order('unpaid', { unpaid: true });
  await importOrder(unpaid.id).expect(409);
  assert.equal(await prisma.inventoryItem.count({ where: { ownerId: buyer.id } }), 0);
});

test('a new product is created, expanded to retail units, and given its own source lot', async () => {
  const purchase = await order('new product');
  await importOrder(purchase.id).expect(200);
  const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { ownerId_name: { ownerId: buyer.id, name: `${prefix} new product` } }, include: { lots: true, movements: true } });
  assert.equal(item.quantity, 48);
  assert.equal(item.unit, 'lon');
  assert.equal(item.purchasePrice, 2000);
  assert.equal(item.sellingPrice, null);
  assert.equal(item.lots.length, 1);
  assert.equal(item.lots[0].sourceOrderId, purchase.id);
  assert.equal(item.movements[0].quantityChange, 48);
});

test('an existing product retains its original lot and receives a separate new lot', async () => {
  const name = `${prefix} old product`, expiry = new Date('2028-01-01T00:00:00Z');
  const item = await prisma.inventoryItem.create({ data: { ownerId: buyer.id, name, unit: 'lon', quantity: 10, purchasePrice: 1500, sellingPrice: 5000, lots: { create: { quantity: 10, purchasePrice: 1500, expiryDate: expiry } } }, include: { lots: true } });
  const purchase = await order('old product');
  const result = await importOrder(purchase.id).expect(200);
  assert.equal(result.body.order.canImportInventory, false);
  assert.ok(result.body.order.inventoryImportedAt);
  const updated = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, include: { lots: true } });
  assert.equal(updated.quantity, 58);
  assert.equal(updated.sellingPrice, 5000);
  assert.equal(updated.lots.length, 2);
  const old = updated.lots.find(lot => lot.id === item.lots[0].id);
  assert.equal(old.quantity, 10);
  assert.equal(old.purchasePrice, 1500);
  assert.equal(old.expiryDate.toISOString(), expiry.toISOString());
  assert.equal(updated.lots.find(lot => lot.sourceOrderId === purchase.id).quantity, 48);
  const inventory = await request(app).get('/api/inventory').set('Cookie', cookies.get(buyer.id)).expect(200);
  assert.equal(inventory.body.items.find(row => row.id === item.id).lots.find(lot => lot.sourceOrderId === purchase.id).quantity, 48);
});

test('carton-based stock stays in cartons and old stock with no lot is preserved as an earlier lot', async () => {
  const name = `${prefix} cartons`;
  const item = await prisma.inventoryItem.create({ data: { ownerId: buyer.id, name, unit: 'Thùng', quantity: 3, purchasePrice: 40000 } });
  const purchase = await order('cartons');
  await importOrder(purchase.id).expect(200);
  const updated = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, include: { lots: true } });
  assert.equal(updated.quantity, 5);
  assert.equal(updated.purchasePrice, 48000);
  assert.equal(updated.lots.length, 2);
  assert.equal(updated.lots.find(lot => lot.sourceOrderId === purchase.id).quantity, 2);
  assert.equal(updated.lots.find(lot => lot.sourceOrderId === null).quantity, 3);
});

test('two concurrent clicks and a later replay add stock and lots exactly once', async () => {
  const purchase = await order('concurrent');
  const results = await Promise.all([importOrder(purchase.id), importOrder(purchase.id)]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.equal(results.filter(result => result.body.alreadyImported).length, 1);
  const again = await importOrder(purchase.id).expect(200);
  assert.equal(again.body.alreadyImported, true);
  const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { ownerId_name: { ownerId: buyer.id, name: `${prefix} concurrent` } }, include: { lots: true, movements: true } });
  assert.equal(item.quantity, 48);
  assert.equal(item.lots.length, 1);
  assert.equal(item.movements.length, 1);
  const history = await request(app).get(`/api/inventory/history?itemId=${item.id}&type=RECEIPT`)
    .set('Cookie', cookies.get(buyer.id)).expect(200);
  assert.equal(history.body.movements.length, 1);
  const receipt = history.body.movements[0];
  assert.equal(receipt.quantityChange, 48);
  assert.equal(receipt.quantityBefore, 0);
  assert.equal(receipt.quantityAfter, 48);
  assert.ok(receipt.note.includes(`[ĐƠN SỈ #${purchase.id}]`));
});

test('a later line failure rolls back earlier lines, lots, stock history and the order marker', async () => {
  const badName = `${prefix} incompatible`;
  await prisma.inventoryItem.create({ data: { ownerId: buyer.id, name: badName, unit: 'kg', quantity: 5 } });
  const goodName = `${prefix} rollback`;
  const purchase = await order('rollback', { lines: [{ name: goodName, quantity: 1, packaging: 'thùng 24 lon', price: 48000 }, { name: badName, quantity: 1, packaging: 'thùng 24 lon', price: 48000 }] });
  await importOrder(purchase.id).expect(409);
  assert.equal(await prisma.inventoryItem.count({ where: { ownerId: buyer.id, name: goodName } }), 0);
  assert.equal(await prisma.inventoryLot.count({ where: { sourceOrderId: purchase.id } }), 0);
  assert.equal((await prisma.wholesaleOrder.findUniqueOrThrow({ where: { id: purchase.id } })).inventoryImportedAt, null);
});

test('old automatic imports, including a truncated legacy note, are not added again', async () => {
  const purchase = await order('legacy');
  const item = await prisma.inventoryItem.create({ data: { ownerId: buyer.id, name: `${prefix} legacy`, unit: 'lon', quantity: 48 } });
  await prisma.stockMovement.create({ data: { itemId: item.id, type: 'IMPORT', quantityChange: 48, quantityBefore: 0, quantityAfter: 48, productName: item.name, unit: 'lon', note: `Tự động nhập kho từ đơn sỉ #${purchase.id} [2 x thùng 24 lon] ${'x'.repeat(250)}`.slice(0, 250) } });
  const result = await importOrder(purchase.id).expect(200);
  assert.equal(result.body.alreadyImported, true);
  assert.equal((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 48);
});

test('completed orders can be filtered and delivery never silently adds inventory', async () => {
  const purchase = await order('manual only', { status: 'SHIPPING' });
  await request(app).patch(`/api/supplier/orders/${purchase.id}/status`).set(csrf).set('Cookie', cookies.get(supplier.id)).send({ status: 'DELIVERED' }).expect(200);
  assert.equal(await prisma.inventoryItem.count({ where: { ownerId: buyer.id, name: `${prefix} manual only` } }), 0);
  const result = await request(app).get('/api/orders?status=COMPLETED').set('Cookie', cookies.get(buyer.id)).expect(200);
  assert.ok(result.body.orders.every(order => order.status === 'COMPLETED'));
});

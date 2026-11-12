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
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.inventoryLot.deleteMany({ where: { sourceOrderId: { in: orderIds } } });
  await prisma.stockMovement.deleteMany({ where: { item: { ownerId: { in: ids } } } });
  await prisma.inventoryLot.deleteMany({ where: { item: { ownerId: { in: ids } } } });
  await prisma.inventoryItem.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.orderComplaint.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderPayment.deleteMany({ where: { orderId: { in: orderIds } } });
  if (supplierProfile) await prisma.supplierQuote.deleteMany({ where: { supplierId: supplierProfile.id } });
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

test('only the owning store can import an order after receipt', async () => {
  const ready = await order('authorization');
  await request(app).post(`/api/orders/${ready.id}/import-inventory`).set(csrf).send({}).expect(401);
  await importOrder(ready.id, other).expect(404);
  await importOrder(ready.id, supplier).expect(403);
  await importOrder(ready.id, users[3]).expect(403);
  const pending = await order('pending', { status: 'PENDING' });
  await importOrder(pending.id).expect(409);
  const unpaid = await order('unpaid', { unpaid: true, status: 'SHIPPING' });
  await importOrder(unpaid.id).expect(409);
  assert.equal(await prisma.inventoryItem.count({ where: { ownerId: buyer.id } }), 0);
});

test('received goods cannot enter inventory before order is paid and completed', async () => {
  const purchase = await order('received unpaid', { unpaid: true, status: 'ISSUE_HANDLING' });
  await importOrder(purchase.id).expect(409);
  await prisma.wholesaleOrder.update({ where: { id: purchase.id }, data: { status: 'COMPLETED' } });
  await importOrder(purchase.id).expect(200);
  const saved = await prisma.wholesaleOrder.findUniqueOrThrow({ where: { id: purchase.id } });
  assert.ok(saved.inventoryImportedAt);
  await importOrder(purchase.id).expect(200);
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

const cashPayment = (id, body = { method: 'COD' }) => request(app).post(`/api/orders/${id}/pay`).set(csrf).set('Cookie', cookies.get(buyer.id)).send(body);
const confirmCash = id => request(app).post(`/api/supplier/orders/${id}/confirm-payment`).set(csrf).set('Cookie', cookies.get(supplier.id)).send({});

test('cash reporting requires received goods, derives the amount on the server, and preserves confirmation on replay', async () => {
  const purchase = await order('cash review', { unpaid: true, status: 'PENDING' });
  await cashPayment(purchase.id).expect(409);
  await confirmCash(purchase.id).expect(409);
  await prisma.wholesaleOrder.update({ where: { id: purchase.id }, data: { status: 'ISSUE_HANDLING', depositAmount: 20000, depositStatus: 'PENDING' } });
  await cashPayment(purchase.id, { method: 'COD', amount: 1 }).expect(400);
  const submitted = await cashPayment(purchase.id).expect(200);
  assert.equal(submitted.body.paymentInfo.amount, 96000, 'an unpaid deposit must not reduce the amount due');
  await cashPayment(purchase.id).expect(200);
  await confirmCash(purchase.id).expect(200);
  const replay = await cashPayment(purchase.id).expect(200);
  assert.equal(replay.body.paymentInfo.status, 'CONFIRMED');
  assert.equal((await prisma.wholesaleOrder.findUniqueOrThrow({ where: { id: purchase.id } })).status, 'DELIVERED');
  await request(app).post(`/api/orders/${purchase.id}/complete`).set(csrf).set('Cookie', cookies.get(buyer.id)).send({}).expect(200);
});

test('a paid deposit is subtracted, wallet payments cannot be collected again, and missing bank details block QR', async () => {
  const cash = await order('paid deposit', { unpaid: true, status: 'ISSUE_HANDLING' });
  await prisma.wholesaleOrder.update({ where: { id: cash.id }, data: { depositAmount: 20000, depositStatus: 'PAID' } });
  const result = await cashPayment(cash.id).expect(200);
  assert.equal(result.body.paymentInfo.amount, 76000);
  const wallet = await order('wallet paid');
  await cashPayment(wallet.id).expect(409);
  const missingBank = await order('missing bank', { unpaid: true, status: 'ISSUE_HANDLING' });
  await cashPayment(missingBank.id, { method: 'QR' }).expect(409);
});

test('store proposes a delivery time; only the supplier confirms it; a later proposal remains pending', async () => {
  const purchase = await order('reschedule', { unpaid: true, status: 'PREPARING' });
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10).split('-').reverse().join('/');
  const propose = time => request(app).post(`/api/orders/${purchase.id}/reschedule`).set(csrf).set('Cookie', cookies.get(buyer.id)).send({ rescheduleTime: `${time} ngày ${date}`, reason: 'Store closed in the morning' });
  const respond = (action, user = supplier) => request(app).post(`/api/orders/${purchase.id}/reschedule-response`).set(csrf).set('Cookie', cookies.get(user.id)).send({ action });
  await propose('10:00').expect(200);
  assert.equal(delivery.getDriverInfo(purchase.id).estimatedDeliveryTime, undefined);
  await propose('11:00').expect(409);
  await respond('ACCEPT', buyer).expect(403);
  await respond('ACCEPT').expect(200);
  assert.equal(delivery.getDriverInfo(purchase.id).estimatedDeliveryTime, `10:00 ngày ${date}`);
  await propose('12:00').expect(200);
  assert.equal(delivery.getDriverInfo(purchase.id).rescheduleRequest.status, 'PENDING');
  await respond('REJECT').expect(200);
  assert.equal(delivery.getDriverInfo(purchase.id).estimatedDeliveryTime, `10:00 ngày ${date}`);
  await prisma.wholesaleOrder.update({ where: { id: purchase.id }, data: { status: 'DELIVERED' } });
  await propose('13:00').expect(409);
});

test('unresolved complaints prevent payment reporting and completing an order', async () => {
  const purchase = await order('complaint guard', { status: 'DELIVERED' });
  await prisma.orderComplaint.create({ data: { orderId: purchase.id, buyerId: buyer.id, supplierId: supplierProfile.id, reason: 'DAMAGED', description: 'Test damaged goods', status: 'OPEN' } });
  await request(app).post(`/api/orders/${purchase.id}/complete`).set(csrf).set('Cookie', cookies.get(buyer.id)).send({}).expect(409);
});

test('marketing quote discount is persisted and accepting a quote preserves the net price without importing stock', async () => {
  const body = { buyerId: buyer.id, title: prefix + ' discount quote', validUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), deliveryFee: 0, depositRate: 0, note: '', lines: [{ productId: product.id, quantity: 2, unitPrice: 48000, discountRate: 10, expectedUpdatedAt: product.updatedAt.toISOString() }] };
  const create = await request(app).post('/api/supplier/quotes').set(csrf).set('Cookie', cookies.get(supplier.id)).send(body).expect(201);
  const quote = create.body.quote;
  assert.equal(quote.lines[0].originalUnitPrice, 48000);
  assert.equal(quote.lines[0].discountRate, 10);
  assert.equal(quote.lines[0].unitPrice, 43200);
  assert.equal(quote.total, 86400);
  const before = await prisma.inventoryItem.count({ where: { ownerId: buyer.id } });
  const accept = await request(app).post(`/api/quotes/${quote.id}/accept`).set(csrf).set('Cookie', cookies.get(buyer.id)).send({ requestId: randomUUID(), recipientName: buyer.name, recipientPhone: '0908123456', deliveryAddress: '45 Nguyen Trai, Ho Chi Minh City', note: '' }).expect(201);
  orderIds.push(accept.body.order.id);
  assert.equal(accept.body.order.items[0].unitPrice, 43200);
  assert.equal(accept.body.order.total, 86400);
  assert.equal(await prisma.inventoryItem.count({ where: { ownerId: buyer.id } }), before);
  await request(app).post('/api/supplier/quotes').set(csrf).set('Cookie', cookies.get(supplier.id)).send({ ...body, lines: [{ ...body.lines[0], discountRate: 101 }] }).expect(400);
});

test('consignment acceptance waits for physical receipt and then imports once with its consignment label', async () => {
  const fresh = await prisma.supplierProduct.findUniqueOrThrow({ where: { id: product.id } });
  const before = await prisma.inventoryItem.count({ where: { ownerId: buyer.id } });
  const created = await request(app).post('/api/supplier/quotes').set(csrf).set('Cookie', cookies.get(supplier.id)).send({ buyerId: buyer.id, title: prefix + ' consignment', validUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), deliveryFee: 0, depositRate: 0, note: '', isConsignment: true, settlementPrice: 20000, lines: [{ productId: product.id, quantity: 1, unitPrice: 0, expectedUpdatedAt: fresh.updatedAt.toISOString() }] }).expect(201);
  const accepted = await request(app).post(`/api/quotes/${created.body.quote.id}/accept`).set(csrf).set('Cookie', cookies.get(buyer.id)).send({ requestId: randomUUID(), recipientName: buyer.name, recipientPhone: '0908123456', deliveryAddress: '45 Nguyen Trai, Ho Chi Minh City', note: '' }).expect(201);
  const id = accepted.body.order.id;
  orderIds.push(id);
  assert.equal(await prisma.inventoryItem.count({ where: { ownerId: buyer.id } }), before);
  await importOrder(id).expect(409);
  await prisma.wholesaleOrder.update({ where: { id }, data: { status: 'COMPLETED' } });
  await importOrder(id).expect(200);
  const result = await request(app).get('/api/inventory').set('Cookie', cookies.get(buyer.id)).expect(200);
  assert.equal(result.body.items.find(item => item.name === product.name).isConsignment, true);
  const again = await importOrder(id).expect(200);
  assert.equal(again.body.alreadyImported, true);
});

test('production blocks simulated deposits for ordinary accounts', async () => {
  const old = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await request(app).post('/api/orders/1/deposit/sandbox').set(csrf).set('Cookie', cookies.get(buyer.id)).send({}).expect(403);
  } finally {
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  }
});

test('contract endpoint rejects forged VNeID evidence without creating a signature', async () => {
  await request(app).post('/api/contracts/sign').set(csrf).set('Cookie', cookies.get(buyer.id)).send({ method: 'VNEID', agreedTerms: true, vneidData: { level: 2, verifiedAt: new Date().toISOString() }, privateKey: {} }).expect(400);
});

test('wallet payment rejects insufficient funds without creating a payment', async () => {
  const purchase = await order('insufficient wallet', { unpaid: true, status: 'ISSUE_HANDLING' });
  await prisma.wallet.upsert({ where: { userId: buyer.id }, update: { balance: 0 }, create: { userId: buyer.id, balance: 0 } });
  await cashPayment(purchase.id, { method: 'WALLET' }).expect(409);
  assert.equal(await prisma.orderPayment.findUnique({ where: { orderId: purchase.id } }), null);
  assert.equal(await prisma.walletTransaction.count({ where: { orderId: purchase.id, type: 'ORDER_PAYMENT' } }), 0);
  assert.equal((await prisma.wholesaleOrder.findUniqueOrThrow({ where: { id: purchase.id } })).status, 'ISSUE_HANDLING');
});

test('wallet remainder is debited once; payment and held deposit settle only on completion', async () => {
  const purchase = await order('wallet settlement', { unpaid: true, status: 'ISSUE_HANDLING' });
  await prisma.wallet.upsert({ where: { userId: buyer.id }, update: { balance: 200000, heldBalance: 0 }, create: { userId: buyer.id, balance: 200000 } });
  const { walletService } = require('../services/walletService');
  await walletService.lockEscrow(buyer.id, purchase.id, 20000, 'Test deposit');
  await prisma.wholesaleOrder.update({ where: { id: purchase.id }, data: { depositAmount: 20000, depositStatus: 'PAID', depositReference: 'VI_HE_THONG' } });
  const beforeSupplier = Number((await prisma.wallet.findUnique({ where: { userId: supplier.id } }))?.balance || 0);
  const results = await Promise.all([cashPayment(purchase.id, { method: 'WALLET' }), cashPayment(purchase.id, { method: 'WALLET' })]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  const buyerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer.id } });
  assert.equal(Number(buyerWallet.balance), 104000);
  assert.equal(Number(buyerWallet.heldBalance), 20000);
  assert.equal(Number((await prisma.wallet.findUnique({ where: { userId: supplier.id } }))?.balance || 0), beforeSupplier);
  assert.equal(await prisma.walletTransaction.count({ where: { orderId: purchase.id, type: 'ORDER_PAYMENT' } }), 1);
  assert.equal((await prisma.wholesaleOrder.findUniqueOrThrow({ where: { id: purchase.id } })).inventoryImportedAt, null);
  const complete = () => request(app).post(`/api/orders/${purchase.id}/complete`).set(csrf).set('Cookie', cookies.get(buyer.id)).send({});
  const finished = await Promise.all([complete(), complete()]);
  assert.deepEqual(finished.map(result => result.status), [200, 200]);
  assert.equal(Number((await prisma.wallet.findUniqueOrThrow({ where: { userId: supplier.id } })).balance), beforeSupplier + 96000);
  assert.equal(Number((await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer.id } })).heldBalance), 0);
  assert.equal(await prisma.walletTransaction.count({ where: { orderId: purchase.id, type: 'ESCROW_RELEASE' } }), 1);
  assert.equal(await prisma.walletTransaction.count({ where: { orderId: purchase.id, type: 'ORDER_RECEIVE' } }), 1);
});

test('legacy full-wallet payments return a separately held deposit instead of crediting it twice', async () => {
  const purchase = await order('legacy full wallet', { unpaid: true, status: 'ISSUE_HANDLING' });
  await prisma.wallet.update({ where: { userId: buyer.id }, data: { balance: 200000, heldBalance: 0 } });
  const { walletService, createWalletService } = require('../services/walletService');
  await walletService.lockEscrow(buyer.id, purchase.id, 20000, 'Legacy test');
  await prisma.wholesaleOrder.update({ where: { id: purchase.id }, data: { depositAmount: 20000, depositStatus: 'PAID', depositReference: 'VI_HE_THONG' } });
  await createWalletService(prisma).payOrder(buyer.id, purchase.id);
  await prisma.wholesaleOrder.update({ where: { id: purchase.id }, data: { status: 'DELIVERED' } });
  const beforeSupplier = Number((await prisma.wallet.findUniqueOrThrow({ where: { userId: supplier.id } })).balance);
  await request(app).post(`/api/orders/${purchase.id}/complete`).set(csrf).set('Cookie', cookies.get(buyer.id)).send({}).expect(200);
  const buyerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer.id } });
  assert.equal(Number(buyerWallet.balance), 104000);
  assert.equal(Number(buyerWallet.heldBalance), 0);
  assert.equal(Number((await prisma.wallet.findUniqueOrThrow({ where: { userId: supplier.id } })).balance), beforeSupplier + 96000);
  assert.equal(await prisma.walletTransaction.count({ where: { orderId: purchase.id, type: 'ESCROW_REFUND' } }), 1);
});

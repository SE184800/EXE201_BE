require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');
const multer = require('multer');
const db = require('../config/db');
const { documentMiddleware, readDocument, writeDocument, mergeDocument } = require('../services/documentStorage');
const { sqlUploadStorage, serveSqlUpload } = require('../services/uploadStorage');
const key = `test-${randomUUID()}`;
let uploadName;
function app(database = db) {
  const server = express();
  server.use(express.json(), documentMiddleware(database));
  server.get('/', (req, res) => res.json(readDocument(key, {})));
  server.post('/:id', (req, res) => {
    const doc = readDocument(key, {});
    doc[req.params.id] = req.body.value;
    writeDocument(key, doc);
    res.json({ saved: true });
  });
  return server;
}
after(async () => {
  await db.$executeRaw`DELETE FROM [dbo].[application_documents] WHERE [key] = ${key}`;
  if (uploadName) await db.$executeRaw`DELETE FROM [dbo].[application_uploads] WHERE [filename] = ${uploadName}`;
  await db.$disconnect();
});
test('document changes survive a new application instance', async () => {
  await request(app()).post('/first').send({ value: 'persisted' }).expect(200);
  const result = await request(app()).get('/').expect(200);
  assert.equal(result.body.first, 'persisted');
});
test('independent concurrent document changes are both retained', async () => {
  await Promise.all([
    request(app()).post('/second').send({ value: 2 }).expect(200),
    request(app()).post('/third').send({ value: 3 }).expect(200),
  ]);
  const result = await request(app()).get('/').expect(200);
  assert.equal(result.body.second, 2);
  assert.equal(result.body.third, 3);
});
test('conflicting changes are rejected, independent record changes merge', () => {
  assert.deepEqual(mergeDocument({ a: 1 }, { a: 1, b: 2 }, { a: 3 }), { a: 3, b: 2 });
  assert.throws(() => mergeDocument({ a: 1 }, { a: 2 }, { a: 3 }), e => e.status === 409);
  assert.throws(() => mergeDocument({ a: 1 }, {}, { a: 3 }), e => e.status === 409);
});
test('a database write failure never returns a successful response', async () => {
  const broken = { $queryRaw: async () => [], $transaction: async () => { throw Error('offline'); } };
  const response = await request(app(broken)).post('/failure').send({ value: 1 }).expect(503);
  assert.equal(response.body.saved, undefined);
});
test('image uploads survive a new server instance and preserve bytes', async () => {
  const server = express();
  server.use((req, res, next) => { req.auth = { user: { id: 0 } }; next(); });
  const upload = multer({ storage: sqlUploadStorage('test'), limits: { fileSize: 1024 } });
  server.post('/', upload.single('image'), (req, res) => res.json({ filename: req.file.filename }));
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const result = await request(server).post('/').attach('image', image, { filename: 'test.png', contentType: 'image/png' }).expect(200);
  uploadName = result.body.filename;
  const fresh = express();
  fresh.get('/uploads/:filename', serveSqlUpload(db));
  const downloaded = await request(fresh).get(`/uploads/${uploadName}`).expect(200).expect('Content-Type', /image\/png/);
  assert.deepEqual(downloaded.body, image);
});

test('store, contract, driver and consignment services persist through SQL across requests', async () => {
  const stores = require('../services/storeService');
  const contracts = require('../services/contractService');
  const delivery = require('../services/deliveryService');
  const suppliers = require('../services/inventorySupplierService');
  const consignments = require('../services/consignmentService');
  const userId = 900000000 + Math.floor(Math.random() * 1000000);
  function instance() {
    const server = express();
    server.use(express.json(), documentMiddleware(db));
    server.post('/', (req, res) => {
      const profile = stores.saveStoreProfile(userId, { storeName: 'QA Store', storeAddress: `${userId} Đường QA, Phường 1, Quận 1, TP.HCM`, storePhone: `0${userId}`, taxCode: `QA${userId}` });
      contracts.getOrCreateUserContract({ id: userId, name: 'QA', username: `qa${userId}`, role: 'STORE_OWNER' }, profile);
      suppliers.setSupplier(userId, 'QA Supplier');
      consignments.setItemConsignment(userId, { isConsignment: true, settlementPrice: 1000, supplierName: 'QA Supplier' });
      delivery.saveDriverInfo(userId, { driverName: 'QA Driver', driverPhone: '0900999888', vehicleType: 'Xe máy' }, userId);
      res.json({ saved: true });
    });
    server.get('/', (req, res) => res.json({
      profile: stores.getStoreProfile(userId), contract: Boolean(contracts.getContractByUserId(userId)),
      supplier: suppliers.getSupplier(userId), consignment: consignments.getItemConsignment(userId), driver: delivery.getDriverInfo(userId),
    }));
    return server;
  }
  try {
    await request(instance()).post('/').send({}).expect(200);
    const result = await request(instance()).get('/').expect(200);
    assert.equal(result.body.profile.storeName, 'QA Store');
    assert.equal(result.body.contract, true);
    assert.equal(result.body.supplier, 'QA Supplier');
    assert.equal(result.body.consignment.isConsignment, true);
    assert.equal(result.body.driver.driverName, 'QA Driver');
  } finally {
    for (const docKey of ['stores', 'contracts', 'inventory_suppliers', 'consignment_items', 'orders_delivery', 'saved_drivers']) {
      const rows = await db.$queryRaw`SELECT [payload] FROM [dbo].[application_documents] WHERE [key] = ${docKey}`;
      if (!rows.length) continue;
      let value = JSON.parse(rows[0].payload);
      if (docKey === 'stores') delete value.stores[String(userId)];
      else if (docKey === 'contracts') delete value.contracts[String(userId)];
      else if (docKey === 'saved_drivers') value = value.filter(d => d.supplierId !== userId);
      else delete value[String(userId)];
      const payload = JSON.stringify(value);
      await db.$executeRaw`UPDATE [dbo].[application_documents] SET [payload] = ${payload} WHERE [key] = ${docKey}`;
    }
  }
});

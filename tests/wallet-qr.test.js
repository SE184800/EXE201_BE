require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');
const { buildVietQrPayload, crc16 } = require('../services/vietQrService');

const prefix = `qr_${randomUUID().slice(0, 8)}`;
const password = 'QrQa@2026';
const qrBank = {
  code: '970403',
  name: 'Sacombank',
  accountNumber: '050138052378',
  accountHolder: 'LE TRAN MINH DUC',
};
const config = readConfig({
  ...process.env,
  JWT_SECRET: randomBytes(48).toString('hex'),
  QR_BANK_CODE: qrBank.code,
  QR_BANK_NAME: qrBank.name,
  QR_BANK_ACCOUNT: qrBank.accountNumber,
  QR_BANK_HOLDER: qrBank.accountHolder,
});
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
const users = [], cookies = [];

const get = (path, who = 0) => request(app).get('/api' + path).set('Cookie', cookies[who]);
const post = (path, body, who = 0) => request(app).post('/api' + path).set(csrf).set('Cookie', cookies[who]).send(body);

async function signIn(user) {
  const result = await request(app).post('/api/auth/login').set(csrf).send({ username: user.username, password }).expect(200);
  cookies.push(result.headers['set-cookie'][0].split(';')[0]);
}

before(async () => {
  const passwordHash = await bcrypt.hash(password, 10);
  // 0 = admin, 1 = store owner
  for (const code of ['ADMIN', 'STORE_OWNER']) {
    const user = await prisma.user.create({
      data: { username: `${prefix}_${users.length}`, name: `${prefix} User`, passwordHash, role: { connect: { code } } },
    });
    users.push(user);
    await signIn(user);
  }
});

after(async () => {
  const ids = users.map(user => user.id);
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
  await prisma.depositRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test('the VietQR payload embeds the bank account, the amount and a valid CRC', () => {
  const payload = buildVietQrPayload({
    bank: qrBank,
    amount: 500000,
    billNumber: 'QR-DEP-1',
    memo: 'NAP TIEN VI 1',
  });
  // Vietnamese bank apps only read the Napas template (tag 38), never the
  // generic EMVCo merchant template (tag 26).
  assert.ok(payload.startsWith('000201010212'), 'a dynamic VietQR payload');
  assert.ok(payload.includes('3856'), 'merchant account information must use tag 38');
  assert.ok(payload.includes('A000000727'), 'the Napas GUID identifies a VietQR code');
  assert.ok(payload.includes('0208QRIBFTTA'), 'the service code selects a transfer to account');
  assert.ok(payload.includes('0006970403'), 'the acquirer id is the bank code');
  assert.ok(payload.includes('0112050138052378'), 'the beneficiary account number');
  assert.ok(payload.includes('5406500000'), 'the amount 500000 must be embedded');
  assert.ok(payload.includes('5802VN'));

  // The merchant template must be tag 38, never tag 26.
  const topLevel = [];
  let index = 0;
  while (index < payload.length) {
    const tag = payload.slice(index, index + 2);
    const length = parseInt(payload.slice(index + 2, index + 4), 10);
    topLevel.push(tag);
    index += 4 + length;
  }
  assert.ok(topLevel.includes('38'));
  assert.ok(!topLevel.includes('26'));

  // The trailing CRC must match the payload it protects.
  const crcTag = payload.slice(-8, -4);
  const body = payload.slice(0, -4);
  assert.equal(crcTag, '6304');
  assert.equal(payload.slice(-4), crc16(body));
});

test('the payload matches the structure of a real Sacombank VietQR code', () => {
  // This is the payload of the QR code issued by the bank for the account
  // used in the tests. The generated code must keep the same shape.
  const bankIssued =
    '00020101021138560010A0000007270126000697040301120501380523780208QRIBFTTA53037045802VN62280824CHUYEN TIEN NHANH QUA QR63045786';

  function parse(text) {
    const entries = [];
    let index = 0;
    while (index < text.length) {
      const tag = text.slice(index, index + 2);
      const length = parseInt(text.slice(index + 2, index + 4), 10);
      entries.push({ tag, value: text.slice(index + 4, index + 4 + length) });
      index += 4 + length;
    }
    return entries;
  }

  const bankAccount = parse(parse(bankIssued).find(entry => entry.tag === '38').value);
  const generated = buildVietQrPayload({ bank: qrBank, amount: 1000 });
  const generatedAccount = parse(parse(generated).find(entry => entry.tag === '38').value);

  // The beneficiary block of both codes has to be identical.
  assert.deepEqual(generatedAccount, bankAccount);

  // Both codes are protected by the same CRC algorithm.
  assert.equal(crc16(bankIssued.slice(0, -4)), bankIssued.slice(-4));
});

test('the QR config exposes the receiving bank account', async () => {
  const result = await get('/wallet/qr-config', 1).expect(200);
  assert.equal(result.body.enabled, true);
  assert.equal(result.body.bankCode, qrBank.code);
  assert.equal(result.body.accountNumber, qrBank.accountNumber);
  assert.equal(result.body.accountHolder, qrBank.accountHolder);
});

test('creating a QR ticket returns a scannable code and keeps the ticket pending', async () => {
  const before = (await get('/wallet', 1).expect(200)).body.wallet.balance;
  const created = await post('/wallet/deposits/qr', { amount: 750000, note: 'QR demo' }, 1).expect(201);
  const { request: ticket, qr } = created.body;

  assert.equal(ticket.status, 'PENDING');
  assert.equal(ticket.amount, 750000);
  assert.equal(ticket.method, 'VIET_QR');
  assert.equal(qr.accountNumber, qrBank.accountNumber);
  assert.equal(qr.amount, 750000);
  assert.ok(qr.payload.startsWith('00020101'));
  assert.ok(qr.payload.includes(qrBank.accountNumber));

  // The money is not credited until the user confirms the transfer.
  const wallet = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(wallet.balance, before);
  const overview = (await get('/wallet', 1).expect(200)).body;
  assert.equal(overview.pendingDeposits, 1);
});

test('client-side self-confirmation is forbidden to prevent unverified free money', async () => {
  const created = await post('/wallet/deposits/qr', { amount: 300000 }, 1).expect(201);
  const id = created.body.request.id;

  // Regular user self-confirmation returns 403 Forbidden
  await post(`/wallet/deposits/qr/${id}/confirm`, {}, 1).expect(403);

  // Balance remains 0
  const wallet = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(wallet.balance, 0);
});

test('SePay webhook credits the wallet exactly once upon genuine bank receipt', async () => {
  const created = await post('/wallet/deposits/qr', { amount: 300000 }, 1).expect(201);
  const id = created.body.request.id;

  // Webhook without authorization key is rejected with 401
  await request(app)
    .post('/api/wallet/webhook/sepay')
    .send({ transferType: 'in', transferAmount: 300000, content: `NAP TIEN VI ${id}` })
    .expect(401);

  // Valid SePay webhook payload with ApiKey
  const res = await request(app)
    .post('/api/wallet/webhook/sepay')
    .set('Authorization', `Apikey ${config.sepayApiKey}`)
    .send({
      id: 999123,
      gateway: 'Sacombank',
      transactionDate: '2026-11-14 23:30:00',
      accountNumber: '050138052378',
      content: `NAP TIEN VI ${id} LE TRAN MINH DUC`,
      transferType: 'in',
      transferAmount: 300000,
      referenceCode: 'SAC.FT.123456',
    })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.requestId, id);

  // Wallet is credited
  const wallet = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(wallet.balance, 300000);

  // Polling endpoint confirms the ticket is now APPROVED
  const polled = await get(`/wallet/deposits/qr/${id}`, 1).expect(200);
  assert.equal(polled.body.request.status, 'APPROVED');

  // Replay of the same webhook is idempotent and does not double-credit
  const replay = await request(app)
    .post('/api/wallet/webhook/sepay')
    .set('Authorization', `Apikey ${config.sepayApiKey}`)
    .send({
      id: 999123,
      gateway: 'Sacombank',
      content: `NAP TIEN VI ${id}`,
      transferType: 'in',
      transferAmount: 300000,
    })
    .expect(200);

  assert.equal(replay.body.success, true);
  const unchanged = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(unchanged.balance, 300000);
});

test('QR amounts are validated like other deposits', async () => {
  for (const amount of [0, -100, 'abc', null, undefined, NaN]) {
    await post('/wallet/deposits/qr', { amount }, 1).expect(400);
  }
});

test('the QR ledger row is tagged so the history stays readable', async () => {
  const ledger = await get('/wallet/transactions', 1).expect(200);
  const row = ledger.body.transactions.find(item => item.type === 'QR_DEPOSIT');
  assert.ok(row);
  assert.equal(row.direction, 'CREDIT');
  assert.equal(row.amount, 300000);
  assert.equal(row.balanceAfter, 300000);
});

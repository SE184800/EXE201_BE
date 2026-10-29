require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');

const prefix = `sandbox_${randomUUID().slice(0, 8)}`;
const password = 'SandboxQa@2026';
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
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
  // 0 = admin, 1 = store owner, 2 = supplier
  for (const code of ['ADMIN', 'STORE_OWNER', 'SUPPLIER']) {
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
  await prisma.withdrawalRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test('sandbox routes require authentication and reject other roles', async () => {
  await request(app).post('/api/wallet/deposits/sandbox').set(csrf).send({ amount: 1000 }).expect(401);
  await post('/wallet/deposits/sandbox', { amount: 1000 }, 0).expect(403);
  await post('/wallet/withdrawals/sandbox', { amount: 1000 }, 0).expect(403);
  await post('/wallet/deposits/sandbox', { amount: 1000 }, 2).expect(201);
});

test('a sandbox deposit credits the wallet instantly without admin review', async () => {
  const before = (await get('/wallet', 1).expect(200)).body.wallet.balance;
  const created = await post('/wallet/deposits/sandbox', { amount: 250000, note: 'Tiền demo' }, 1).expect(201);
  assert.equal(created.body.request.isSandbox, true);
  assert.equal(created.body.request.method, 'SANDBOX');
  assert.equal(created.body.request.status, 'APPROVED');
  assert.equal(created.body.request.amount, 250000);

  const after = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(after.balance, before + 250000);
  assert.equal(after.heldBalance, 0);

  // The request never waits for an admin, so nothing stays pending.
  const overview = await get('/wallet', 1).expect(200);
  assert.equal(overview.body.pendingDeposits, 0);
});

test('a sandbox withdrawal debits the wallet instantly and keeps the balance non negative', async () => {
  const before = (await get('/wallet', 1).expect(200)).body.wallet;
  const created = await post('/wallet/withdrawals/sandbox', { amount: 100000 }, 1).expect(201);
  assert.equal(created.body.request.isSandbox, true);
  assert.equal(created.body.request.status, 'COMPLETED');

  const after = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(after.balance, before.balance - 100000);
  assert.equal(after.heldBalance, before.heldBalance);
  assert.ok(after.balance >= 0);

  // A sandbox withdrawal can never go below zero.
  await post('/wallet/withdrawals/sandbox', { amount: after.balance + 1 }, 1).expect(409);
  const unchanged = (await get('/wallet', 1).expect(200)).body.wallet;
  assert.equal(unchanged.balance, after.balance);
});

test('sandbox ledger rows are tagged as SANDBOX and real rows stay REAL', async () => {
  const before = (await get('/wallet', 2).expect(200)).body.wallet.balance;
  await post('/wallet/deposits/sandbox', { amount: 70000 }, 2).expect(201);
  const ledger = await get('/wallet/transactions', 2).expect(200);
  const sandboxRow = ledger.body.transactions.find(row => row.type === 'SANDBOX_DEPOSIT');
  assert.ok(sandboxRow);
  assert.equal(sandboxRow.method, 'SANDBOX');
  assert.equal(sandboxRow.direction, 'CREDIT');
  assert.equal(sandboxRow.balanceAfter, before + 70000);

  // A real deposit request is still pending and its ledger row is not written yet.
  const real = await post('/wallet/deposits', { amount: 80000, bankName: 'Ngân hàng QA', bankAccountNumber: '0123456789', bankAccountHolder: 'CHU QA' }, 2).expect(201);
  assert.equal(real.body.request.isSandbox, false);
  const realLedger = await get('/wallet/transactions', 2).expect(200);
  assert.equal(realLedger.body.transactions.some(row => row.type === 'DEPOSIT'), false);
  assert.ok(realLedger.body.transactions.every(row => row.method === 'SANDBOX'));

  await post(`/admin/wallet/deposits/${real.body.request.id}/approve`, {}, 0).expect(200);
  const approvedLedger = await get('/wallet/transactions', 2).expect(200);
  const realRow = approvedLedger.body.transactions.find(row => row.type === 'DEPOSIT');
  assert.ok(realRow);
  assert.equal(realRow.method, 'REAL');
});

test('the admin list separates sandbox requests from real ones', async () => {
  const deposits = await get('/admin/wallet/deposits', 0).expect(200);
  const mine = deposits.body.requests.filter(row => row.userId === users[2].id);
  assert.ok(mine.some(row => row.isSandbox === true));
  assert.ok(mine.some(row => row.isSandbox === false));

  const withdrawals = await get('/admin/wallet/withdrawals', 0).expect(200);
  const mineWithdrawals = withdrawals.body.requests.filter(row => row.userId === users[1].id);
  assert.ok(mineWithdrawals.length > 0);
  assert.ok(mineWithdrawals.every(row => row.isSandbox === true));
  assert.equal(mineWithdrawals[0].status, 'COMPLETED');
});

test('sandbox amounts are validated like real amounts', async () => {
  for (const amount of [0, -100, 'abc', null, undefined, NaN]) {
    await post('/wallet/deposits/sandbox', { amount }, 1).expect(400);
  }
});

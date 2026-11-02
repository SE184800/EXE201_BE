require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');
const { createSubscriptionService, addCalendarMonth } = require('../services/subscriptionService');

const suffix = randomUUID().slice(0, 8);
const username = `subscription_${suffix}`;
const password = 'Subscription@2026';
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
let userId;
let adminId;
const extraUserIds = [];

after(async () => {
  const ids = [userId, adminId, ...extraUserIds].filter(Boolean);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.depositRequest.deleteMany({ where: { userId: { in: ids } } });
    await prisma.walletTransaction.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.$disconnect();
});

test('expired accounts cannot log in; public 19k payment or admin unlock restores access', async () => {
  const store = await prisma.user.create({
    data: {
      username,
      name: 'Subscription store',
      phone: `09${Date.now().toString().slice(-8)}`,
      passwordHash: await bcrypt.hash(password, 12),
      role: { connect: { code: 'STORE_OWNER' } },
    },
  });
  userId = store.id;
  const admin = await prisma.user.create({
    data: {
      username: `subscription_admin_${suffix}`,
      name: 'Subscription admin',
      passwordHash: await bcrypt.hash(password, 12),
      role: { connect: { code: 'ADMIN' } },
    },
  });
  adminId = admin.id;

  const login = await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username, password })
    .expect(200);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username: admin.username, password })
    .expect(200);
  const adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];

  await request(app).get('/api/inventory').set('Cookie', cookie).expect(200);
  const trial = await request(app).get('/api/subscription').set('Cookie', cookie).expect(200);
  assert.equal(trial.body.subscription.status, 'TRIAL');
  assert.equal(trial.body.subscription.hasAccess, true);
  assert.equal(trial.body.subscription.monthlyPrice, 19000);
  assert.ok(trial.body.subscription.daysRemaining >= 28);

  await prisma.subscription.update({
    where: { userId },
    data: { status: 'TRIAL', trialEndsAt: new Date(Date.now() - 60_000) },
  });

  const blocked = await request(app).get('/api/inventory').set('Cookie', cookie).expect(402);
  assert.equal(blocked.body.code, 'SUBSCRIPTION_REQUIRED');
  await request(app).get('/api/subscription').set('Cookie', cookie).expect(401);
  const expiredLogin = await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username, password })
    .expect(402);
  assert.equal(expiredLogin.body.code, 'SUBSCRIPTION_REQUIRED');
  assert.equal(expiredLogin.body.subscription.status, 'EXPIRED');
  assert.equal(typeof expiredLogin.body.renewalToken, 'string');
  assert.equal(expiredLogin.headers['set-cookie']?.some(value => value.startsWith('sg_restock_session=;')), true);

  const unlocked = await request(app)
    .post(`/api/admin/users/${userId}/subscription/unlock`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .send({ reason: 'Cho phép tài khoản tiếp tục demo với giáo viên' })
    .expect(200);
  assert.equal(unlocked.body.user.subscription.status, 'ACTIVE');
  assert.equal(unlocked.body.user.subscription.hasAccess, true);
  assert.equal(await prisma.subscriptionPayment.count({ where: { subscription: { userId } } }), 0);
  const unlockedLogin = await request(app).post('/api/auth/login').set(csrf).send({ username, password }).expect(200);
  const unlockedCookie = unlockedLogin.headers['set-cookie'][0].split(';')[0];
  await request(app).get('/api/inventory').set('Cookie', unlockedCookie).expect(200);

  await prisma.subscription.update({
    where: { userId },
    data: { status: 'EXPIRED', currentPeriodEnd: new Date(Date.now() - 60_000) },
  });
  await request(app).get('/api/inventory').set('Cookie', unlockedCookie).expect(402);
  const paymentLogin = await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username, password })
    .expect(402);
  const renewalToken = paymentLogin.body.renewalToken;
  assert.equal(paymentLogin.body.subscription.walletBalance, 0);
  assert.equal(paymentLogin.body.subscription.paymentSource, 'WALLET');

  const requestId = randomUUID();
  await request(app).post('/api/subscription/renew-public').set(csrf)
    .send({ renewalToken, requestId }).expect(409);
  const insufficient = await request(app).post('/api/subscription/renew-public').set(csrf)
    .send({ renewalToken, requestId, paymentSource: 'WALLET' }).expect(409);
  assert.equal(insufficient.body.code, 'INSUFFICIENT_WALLET_BALANCE');
  assert.equal(insufficient.body.walletBalance, 0);
  assert.equal(await prisma.subscriptionPayment.count({ where: { subscription: { userId } } }), 0);
  assert.equal((await prisma.subscription.findUnique({ where: { userId } })).status, 'EXPIRED');
  const topUpId = randomUUID();
  await request(app).post('/api/subscription/top-up-public').set(csrf)
    .send({ renewalToken: 'invalid', requestId: topUpId }).expect(401);
  for (let attempt = 0; attempt < 2; attempt++) {
    const topUp = await request(app).post('/api/subscription/top-up-public').set(csrf)
      .send({ renewalToken, requestId: topUpId, amount: 999999999 }).expect(200);
    assert.equal(topUp.body.subscription.walletBalance, 5000000);
  }
  assert.equal(await prisma.depositRequest.count({ where: { userId } }), 1);
  const renewed = await request(app)
    .post('/api/subscription/renew-public')
    .set(csrf)
    .send({ renewalToken, requestId, paymentSource: 'WALLET' })
    .expect(200);
  assert.equal(renewed.body.subscription.status, 'ACTIVE');
  assert.equal(renewed.body.subscription.hasAccess, true);
  assert.equal(renewed.body.subscription.payments[0].amount, 19000);
  assert.equal(renewed.body.subscription.payments[0].method, 'WALLET');
  assert.equal(renewed.body.subscription.walletBalance, 4981000);

  await request(app)
    .post('/api/subscription/renew-public')
    .set(csrf)
    .send({ renewalToken, requestId, paymentSource: 'WALLET' })
    .expect(200);
  assert.equal(await prisma.subscriptionPayment.count({ where: { subscription: { userId } } }), 1);
  assert.equal(Number((await prisma.wallet.findUnique({ where: { userId } })).balance), 4981000);
  const ledger = await prisma.walletTransaction.findMany({ where: { userId, type: 'SUBSCRIPTION_PAYMENT' } });
  assert.equal(ledger.length, 1);
  assert.equal(Number(ledger[0].amount), 19000);
  assert.equal(ledger[0].reference, renewed.body.subscription.payments[0].reference);

  const paidLogin = await request(app).post('/api/auth/login').set(csrf).send({ username, password }).expect(200);
  const paidCookie = paidLogin.headers['set-cookie'][0].split(';')[0];
  await request(app).get('/api/inventory').set('Cookie', paidCookie).expect(200);
  await request(app).post('/api/subscription/renew').set(csrf).set('Cookie', paidCookie)
    .send({ requestId: randomUUID() }).expect(409);
  const nextMonth = await request(app).post('/api/subscription/renew').set(csrf).set('Cookie', paidCookie)
    .send({ requestId: randomUUID(), paymentSource: 'WALLET', amount: 1 }).expect(200);
  assert.equal(nextMonth.body.subscription.walletBalance, 4962000);
  assert.equal(nextMonth.body.subscription.payments[0].amount, 19000);
  assert.equal(nextMonth.body.subscription.currentPeriodStart, renewed.body.subscription.currentPeriodEnd);
  await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
  await request(app).post('/api/subscription/top-up-public').set(csrf)
    .send({ renewalToken, requestId: randomUUID() }).expect(403);
});

async function fixture(balance, role = 'STORE_OWNER') {
  const user = await prisma.user.create({ data: {
    username: `sub_wallet_${randomUUID().slice(0, 8)}`, name: 'Subscription wallet test',
    passwordHash: await bcrypt.hash(password, 4), role: { connect: { code: role } },
  } });
  extraUserIds.push(user.id);
  await prisma.wallet.create({ data: { userId: user.id, balance, heldBalance: 100000 } });
  const authUser = { id: user.id, role };
  await createSubscriptionService(prisma).get(authUser);
  return authUser;
}

test('exact balance buys a month, preserves trial days and held funds; a second purchase is refused', async () => {
  const user = await fixture(19000, 'SUPPLIER');
  const service = createSubscriptionService(prisma);
  const trial = await service.get(user);
  const paid = await service.renew(user, randomUUID());
  assert.equal(paid.walletBalance, 0);
  assert.equal(paid.currentPeriodStart.toISOString(), trial.trialEndsAt.toISOString());
  assert.equal(paid.currentPeriodEnd.toISOString(), addCalendarMonth(trial.trialEndsAt).toISOString());
  assert.equal(Number((await prisma.wallet.findUnique({ where: { userId: user.id } })).heldBalance), 100000);
  await assert.rejects(service.renew(user, randomUUID()), { code: 'INSUFFICIENT_WALLET_BALANCE' });
  assert.equal((await service.get(user)).currentPeriodEnd.toISOString(), paid.currentPeriodEnd.toISOString());
  assert.equal(await prisma.subscriptionPayment.count({ where: { subscriptionId: paid.id } }), 1);
});

test('concurrent purchases cannot overdraw; concurrent retry of one ID debits once', async () => {
  const service = createSubscriptionService(prisma);
  const user = await fixture(19000);
  const result = await Promise.allSettled([service.renew(user, randomUUID()), service.renew(user, randomUUID())]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(Number((await prisma.wallet.findUnique({ where: { userId: user.id } })).balance), 0);
  const other = await fixture(50000);
  const id = randomUUID();
  await Promise.allSettled([service.renew(other, id), service.renew(other, id)]);
  const replay = await service.renew(other, id);
  assert.equal(replay.walletBalance, 31000);
  assert.equal(await prisma.walletTransaction.count({ where: { userId: other.id, type: 'SUBSCRIPTION_PAYMENT' } }), 1);
  await assert.rejects(service.renew(user, id), { status: 409 });
});

test('a failure after debiting rolls back the wallet, ledger, payment and subscription together', async () => {
  const user = await fixture(50000);
  const before = await createSubscriptionService(prisma).get(user);
  const failing = createSubscriptionService({
    $transaction: (operation, options) => prisma.$transaction(tx => operation(new Proxy(tx, {
      get(target, key) {
        if (key === 'auditLog') return { create: async () => { throw new Error('Injected audit failure'); } };
        return target[key];
      },
    })), options),
  });
  await assert.rejects(failing.renew(user, randomUUID()), /Injected audit failure/);
  const afterFailure = await createSubscriptionService(prisma).get(user);
  assert.equal(afterFailure.walletBalance, 50000);
  assert.equal(afterFailure.status, before.status);
  assert.equal(afterFailure.currentPeriodEnd, null);
  assert.equal(afterFailure.payments.length, 0);
  assert.equal(await prisma.walletTransaction.count({ where: { userId: user.id } }), 0);
});

test('calendar month extension clamps month-end correctly', () => {
  assert.equal(addCalendarMonth(new Date('2026-01-31T08:00:00Z')).toISOString(), '2026-02-28T08:00:00.000Z');
  assert.equal(addCalendarMonth(new Date('2028-01-31T08:00:00Z')).toISOString(), '2028-02-29T08:00:00.000Z');
});

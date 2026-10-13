require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');

const suffix = randomUUID().slice(0, 8);
const username = `subscription_${suffix}`;
const password = 'Subscription@2026';
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
let userId;
let adminId;

after(async () => {
  const ids = [userId, adminId].filter(Boolean);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: ids } } });
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

  const requestId = randomUUID();
  const renewed = await request(app)
    .post('/api/subscription/renew-public')
    .set(csrf)
    .send({ renewalToken, requestId })
    .expect(200);
  assert.equal(renewed.body.subscription.status, 'ACTIVE');
  assert.equal(renewed.body.subscription.hasAccess, true);
  assert.equal(renewed.body.subscription.payments[0].amount, 19000);
  assert.equal(renewed.body.subscription.payments[0].method, 'SIMULATED');

  await request(app)
    .post('/api/subscription/renew-public')
    .set(csrf)
    .send({ renewalToken, requestId })
    .expect(200);
  assert.equal(await prisma.subscriptionPayment.count({ where: { subscription: { userId } } }), 1);

  const paidLogin = await request(app).post('/api/auth/login').set(csrf).send({ username, password }).expect(200);
  const paidCookie = paidLogin.headers['set-cookie'][0].split(';')[0];
  await request(app).get('/api/inventory').set('Cookie', paidCookie).expect(200);
});

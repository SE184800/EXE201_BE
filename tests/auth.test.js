require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');

const prefix = `test_${randomUUID().slice(0, 8)}`;
const password = 'Integration@2026';
const config = readConfig({
  ...process.env,
  JWT_SECRET: randomBytes(48).toString('hex'),
});
const app = createApp(prisma, config);
const users = [];
const createdIds = [];
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };

before(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  for (const code of ['STORE_OWNER', 'SUPPLIER', 'ADMIN']) {
    const user = await prisma.user.create({
      data: {
        username: `${prefix}_${code.toLowerCase()}`,
        name: 'Auth integration test',
        passwordHash,
        role: { connect: { code } },
      },
      include: { role: true },
    });
    users.push(user);
    createdIds.push(user.id);
  }
});

after(async () => {
  // Chỉ xóa đúng các tài khoản tạm được tạo bởi lượt test này.
  await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
});

async function signIn(user, extra = {}) {
  const response = await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username: user.username, password, ...extra })
    .expect(200);
  return { response, cookie: response.headers['set-cookie'][0].split(';')[0] };
}

test('login trả user an toàn và JWT trong HttpOnly cookie', async () => {
  const { response, cookie } = await signIn(users[0]);
  assert.equal(response.body.user.role, 'STORE_OWNER');
  assert.equal(response.body.user.passwordHash, undefined);
  assert.equal(response.body.token, undefined);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
  const payload = jwt.verify(cookie.split('=')[1], config.jwtSecret, {
    algorithms: ['HS256'],
    issuer: 'sg-restock-api',
    audience: 'sg-restock-web',
  });
  assert.equal(payload.sub, String(users[0].id));
  await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
});

test('ba vai trò chỉ vào được API khu vực của mình', async () => {
  const paths = ['store', 'supplier', 'admin'];
  for (const [index, user] of users.entries()) {
    const { cookie } = await signIn(user, { role: 'ADMIN' });
    for (const [pathIndex, path] of paths.entries()) {
      await request(app)
        .get(`/api/workspaces/${path}`)
        .set('Cookie', cookie)
        .expect(index === pathIndex ? 200 : 403);
    }
  }
});

test('sai mật khẩu và username không tồn tại có cùng phản hồi', async () => {
  const wrong = await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username: users[0].username, password: 'wrong' })
    .expect(401);
  const missing = await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username: `${prefix}_missing`, password })
    .expect(401);
  assert.deepEqual(wrong.body, missing.body);
});

test('kiểm tra dữ liệu và bảo vệ CSRF', async () => {
  await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username: { value: 'admin' }, password })
    .expect(400);
  await request(app)
    .post('/api/auth/login')
    .send({ username: users[0].username, password })
    .expect(403);
  await request(app)
    .post('/api/auth/login')
    .set({ ...csrf, Origin: 'https://other.example' })
    .send({ username: users[0].username, password })
    .expect(403);
});

test('logout thu hồi session, cookie cũ không thể dùng lại', async () => {
  const { cookie } = await signIn(users[0]);
  await request(app)
    .post('/api/auth/logout')
    .set(csrf)
    .set('Cookie', cookie)
    .expect(200);
  await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
});

test('JWT bị sửa, hết hạn hoặc không có session đều bị từ chối', async () => {
  const { cookie } = await signIn(users[1]);
  const payload = jwt.decode(cookie.split('=')[1]);
  const options = {
    issuer: 'sg-restock-api',
    audience: 'sg-restock-web',
    subject: String(users[1].id),
    algorithm: 'HS256',
  };
  const expired = jwt.sign({ sid: payload.sid }, config.jwtSecret, {
    ...options,
    expiresIn: -1,
  });
  const missing = jwt.sign({ sid: randomUUID() }, config.jwtSecret, {
    ...options,
    expiresIn: 300,
  });
  for (const value of [
    cookie + 'tampered',
    `sg_restock_session=${expired}`,
    `sg_restock_session=${missing}`,
  ]) {
    await request(app).get('/api/auth/me').set('Cookie', value).expect(401);
  }
});

test('tài khoản bị khóa mất quyền ngay cả khi JWT còn hạn', async () => {
  const { cookie } = await signIn(users[1]);
  await prisma.user.update({
    where: { id: users[1].id },
    data: { isActive: false },
  });
  try {
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
    await request(app)
      .post('/api/auth/login')
      .set(csrf)
      .send({ username: users[1].username, password })
      .expect(401);
  } finally {
    await prisma.user.update({
      where: { id: users[1].id },
      data: { isActive: true },
    });
  }
});

test('API user yêu cầu quyền admin và không lộ mật khẩu', async () => {
  await request(app).get('/api/users').expect(401);
  const store = await signIn(users[0]);
  await request(app).get('/api/users').set('Cookie', store.cookie).expect(403);
  await request(app)
    .post('/api/users')
    .set(csrf)
    .set('Cookie', store.cookie)
    .send({ role: 'ADMIN' })
    .expect(403);
  const admin = await signIn(users[2]);
  const response = await request(app)
    .get('/api/users')
    .set('Cookie', admin.cookie)
    .expect(200);
  assert.ok(response.body.users.every((user) => !('passwordHash' in user)));
  const created = await request(app)
    .post('/api/users')
    .set(csrf)
    .set('Cookie', admin.cookie)
    .send({
      username: `${prefix}_created`,
      password,
      name: 'Created via admin API',
      role: 'STORE_OWNER',
    })
    .expect(201);
  createdIds.push(created.body.user.id);
  assert.equal(created.body.user.role, 'STORE_OWNER');
  assert.equal(created.body.user.passwordHash, undefined);
});

test('kho SQL lưu dữ liệu thật, chat đọc số mới và cô lập tài khoản', async () => {
  const owner = await signIn(users[0]);
  const supplier = await signIn(users[1]);
  const admin = await signIn(users[2]);
  const second = await prisma.user.create({ data: { username: `${prefix}_other_store`, name: 'Other store', passwordHash: await bcrypt.hash(password, 12), role: { connect: { code: 'STORE_OWNER' } } } });
  createdIds.push(second.id);
  const other = await signIn(second);
  const item = { name: 'Mì Hảo Hảo', unit: 'gói', quantity: 15, ownerId: second.id, expiryDate: '2027-01-15' };
  await request(app).get('/api/inventory').expect(401);
  await request(app).get('/api/inventory').set('Cookie', supplier.cookie).expect(403);
  await request(app).get('/api/inventory').set('Cookie', admin.cookie).expect(403);
  await request(app).post('/api/inventory').set('Cookie', owner.cookie).send(item).expect(403);
  const created = await request(app).post('/api/inventory').set(csrf).set('Cookie', owner.cookie).send(item).expect(201);
  assert.equal(created.body.item.ownerId, users[0].id);
  assert.equal(created.body.item.expiryDate.slice(0, 10), '2027-01-15');
  const id = created.body.item.id;
  await request(app).post('/api/inventory').set(csrf).set('Cookie', owner.cookie).send(item).expect(409);
  const hidden = await request(app).get('/api/inventory').set('Cookie', other.cookie).expect(200);
  assert.equal(hidden.body.items.length, 0);
  await request(app).put(`/api/inventory/${id}`).set(csrf).set('Cookie', other.cookie).send({ ...item, quantity: 99 }).expect(404);
  const hiddenChat = await request(app).post('/api/inventory/chat').set(csrf).set('Cookie', other.cookie).send({ message: 'Xem kho' }).expect(200);
  assert.equal(hiddenChat.body.items.length, 0);
  await request(app).put(`/api/inventory/${id}`).set(csrf).set('Cookie', owner.cookie).send({ ...item, quantity: -1 }).expect(400);
  await request(app).put(`/api/inventory/${id}`).set(csrf).set('Cookie', owner.cookie).send({ ...item, quantity: 3 }).expect(200);
  const reply = await request(app).post('/api/inventory/chat').set(csrf).set('Cookie', owner.cookie).send({ message: 'mi hao hao con bao nhieu' }).expect(200);
  assert.equal(reply.body.items[0].quantity, 3);
  assert.match(reply.body.answer, /3 gói/);
  assert.match(reply.body.answer, /15\/01\/2027/);
  await request(app).put(`/api/inventory/${id}`).set(csrf).set('Cookie', owner.cookie).send({ ...item, expiryDate: '2026-02-30' }).expect(400);
  await request(app).put(`/api/inventory/${id}`).set(csrf).set('Cookie', owner.cookie).send({ ...item, expiryDate: null }).expect(200);
  const cleared = await request(app).get('/api/inventory').set('Cookie', owner.cookie).expect(200);
  assert.equal(cleared.body.items[0].expiryDate, null);
  assert.equal(cleared.body.items[0].daysUntilExpiry, null);
  const movementUrl = `/api/inventory/${id}/movements`;
  const sell = { type: 'SALE', quantity: 5, note: 'Bán thử', requestId: randomUUID() };
  await request(app).post(movementUrl).set(csrf).set('Cookie', other.cookie).send(sell).expect(404);
  await request(app).post(movementUrl).set(csrf).set('Cookie', supplier.cookie).send(sell).expect(403);
  await request(app).post(movementUrl).set('Cookie', owner.cookie).send(sell).expect(403);
  const sale = await request(app).post(movementUrl).set(csrf).set('Cookie', owner.cookie).send(sell).expect(200);
  assert.equal(sale.body.movement.quantityAfter, 10);
  const replay = await request(app).post(movementUrl).set(csrf).set('Cookie', owner.cookie).send(sell).expect(200);
  assert.equal(replay.body.movement.id, sale.body.movement.id);
  await request(app).post(movementUrl).set(csrf).set('Cookie', owner.cookie).send({ ...sell, quantity: 2 }).expect(409);
  for (const quantity of [0, -1, 1.5]) await request(app).post(movementUrl).set(csrf).set('Cookie', owner.cookie).send({ ...sell, quantity, requestId: randomUUID() }).expect(400);
  await request(app).post(movementUrl).set(csrf).set('Cookie', owner.cookie).send({ ...sell, quantity: 11, requestId: randomUUID() }).expect(409);
  const received = await request(app).post(movementUrl).set(csrf).set('Cookie', owner.cookie).send({ type: 'RECEIPT', quantity: 4, requestId: randomUUID() }).expect(200);
  assert.equal(received.body.movement.quantityAfter, 14);
  const simultaneous = await Promise.all([1, 2].map(() => request(app).post(movementUrl).set(csrf).set('Cookie', owner.cookie).send({ type: 'SALE', quantity: 10, requestId: randomUUID() })));
  assert.deepEqual(simultaneous.map((response) => response.status).sort(), [200, 409]);
  const stockNow = await request(app).get('/api/inventory').set('Cookie', owner.cookie).expect(200);
  assert.equal(stockNow.body.items[0].quantity, 4);
  await request(app).put(`/api/inventory/${id}`).set(csrf).set('Cookie', owner.cookie).send({ ...item, expectedUpdatedAt: created.body.item.updatedAt }).expect(409);
  const history = await request(app).get('/api/inventory/history').set('Cookie', owner.cookie).expect(200);
  assert.equal(history.body.movements.filter((row) => row.type === 'SALE').length, 2);
  assert.ok(history.body.movements.some((row) => row.type === 'ADJUSTMENT'));
  assert.ok(history.body.movements.some((row) => row.type === 'OPENING'));
  const privateHistory = await request(app).get('/api/inventory/history').set('Cookie', other.cookie).expect(200);
  assert.equal(privateHistory.body.movements.length, 0);
});

test('giới hạn số lần đăng nhập sai', async () => {
  const limitedApp = createApp(prisma, config);
  for (let i = 0; i < 15; i++) {
    await request(limitedApp)
      .post('/api/auth/login')
      .set(csrf)
      .send({ username: '', password: '' })
      .expect(400);
  }
  await request(limitedApp)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username: '', password: '' })
    .expect(429);
});

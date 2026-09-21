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

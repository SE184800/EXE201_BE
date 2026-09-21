require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomInt, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');
const { validateRegistrationInput, todayInVietnam } = require('../services/registrationValidation');

const prefix = `regtest_${randomUUID().slice(0, 8)}`;
const usernames = new Set();
let sequence = 0;
const config = readConfig({ ...process.env, JWT_SECRET: randomBytes(48).toString('hex') });
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };
const password = 'Register@2026';

function fixture(overrides = {}) {
  const username = `${prefix}_${++sequence}`;
  usernames.add(username);
  return {
    name: 'Nguyễn Văn An', username, email: `${username}@example.com`,
    phone: `09${randomInt(10_000_000, 100_000_000)}`, role: 'STORE_OWNER',
    dateOfBirth: '1998-05-20', password, confirmPassword: password,
    ...overrides,
  };
}

const register = (app, input) => request(app).post('/api/auth/register').set(csrf).send(input);

after(async () => {
  await prisma.user.deleteMany({ where: { username: { in: [...usernames] } } });
  await prisma.$disconnect();
});

for (const [role, workspace, denied] of [
  ['STORE_OWNER', 'store', 'supplier'], ['SUPPLIER', 'supplier', 'store'],
]) {
  test(`đăng ký ${role} → lưu SQL → đăng nhập → phân quyền → đăng xuất`, async () => {
    const app = createApp(prisma, config);
    const input = fixture({ role, name: '  Nguyễn   Văn An  ', roleId: -1, isActive: false });
    const response = await register(app, {
      ...input, username: ` ${input.username.toUpperCase()} `,
      email: ` ${input.email.toUpperCase()} `, phone: `+84 ${input.phone.slice(1)}`,
    }).expect(201);
    assert.equal(response.body.user.username, input.username);
    assert.equal(response.body.user.role, role);
    assert.equal(response.body.user.name, 'Nguyễn Văn An');
    assert.equal(response.body.user.passwordHash, undefined);
    assert.equal(response.headers['set-cookie'], undefined);
    const saved = await prisma.user.findUnique({ where: { username: input.username } });
    assert.equal(saved.email, input.email);
    assert.equal(saved.phone, input.phone);
    assert.equal(saved.dateOfBirth.toISOString().slice(0, 10), input.dateOfBirth);
    assert.equal(saved.isActive, true);
    assert.notEqual(saved.passwordHash, password);
    assert.equal(await bcrypt.compare(password, saved.passwordHash), true);

    await request(app).post('/api/auth/login').set(csrf)
      .send({ username: input.username, password: 'wrong' }).expect(401);
    const login = await request(app).post('/api/auth/login').set(csrf)
      .send({ username: input.username, password }).expect(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    await request(app).get(`/api/workspaces/${workspace}`).set('Cookie', cookie).expect(200);
    await request(app).get(`/api/workspaces/${denied}`).set('Cookie', cookie).expect(403);
    await request(app).post('/api/auth/logout').set(csrf).set('Cookie', cookie).expect(200);
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });
}

test('validation trả lỗi đúng từng trường và không tạo user với dữ liệu sai', async () => {
  for (const [field, value] of [
    ['name', 'An123'], ['name', '...'], ['name', 'A'.repeat(101)],
    ['username', 'ab'], ['email', 'a@@example.com'], ['email', `${'a'.repeat(250)}@example.com`],
    ['phone', '12345'], ['phone', { value: '0912345678' }], ['role', 'ADMIN'],
    ['dateOfBirth', '1899-12-31'], ['dateOfBirth', '2001-02-29'], ['dateOfBirth', '2100-01-01'],
    ['password', 'Aa1!'.repeat(19)], ['password', `Aa1!${'ế'.repeat(24)}`],
    ['password', 'Ab1!'], ['password', 'Abcdef12 '], ['confirmPassword', 'wrong'], ['confirmPassword', ''],
  ]) {
    const input = fixture({ [field]: value });
    const response = await register(createApp(prisma, config), input).expect(400);
    assert.equal(typeof response.body.errors[field], 'string', field);
    assert.equal(await prisma.user.count({ where: { username: input.username } }), 0);
  }
  const response = await register(createApp(prisma, config), {}).expect(400);
  assert.equal(Object.keys(response.body.errors).length, 8);
});

test('ngày sinh dùng ngày Việt Nam, kiểm tra ngày thật và dữ liệu sai kiểu', () => {
  const now = new Date('2026-09-20T18:00:00Z');
  assert.equal(todayInVietnam(now), '2026-09-21');
  for (const body of [null, undefined, [], 123, 'text']) {
    assert.equal(Object.keys(validateRegistrationInput(body, now).errors).length, 8);
  }
  assert.ok(validateRegistrationInput(fixture({ dateOfBirth: '2026-09-21' }), now).data);
  assert.ok(validateRegistrationInput(fixture({ dateOfBirth: '2026-09-22' }), now).errors.dateOfBirth);
  assert.ok(validateRegistrationInput(fixture({ dateOfBirth: '2000-02-29' }), now).data);
});

test('trùng username/email/phone trả 409 và báo chính xác ô cần sửa', async () => {
  const input = fixture();
  const app = createApp(prisma, config);
  await register(app, input).expect(201);
  for (const field of ['username', 'email', 'phone']) {
    const value = field === 'phone' ? `+84${input.phone.slice(1)}` : input[field].toUpperCase();
    const duplicate = fixture({ [field]: value });
    const result = await register(app, duplicate).expect(409);
    assert.deepEqual(Object.keys(result.body.errors), [field]);
  }
});

for (const field of ['username', 'email', 'phone']) {
  test(`hai yêu cầu cùng lúc trùng ${field}: chỉ lưu một, yêu cầu còn lại nhận 409`, { timeout: 15000 }, async () => {
    let arrivals = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const db = {
      role: prisma.role,
      authSession: prisma.authSession,
      user: new Proxy(prisma.user, {
        get(target, key) {
          if (key !== 'create') return target[key];
          return async (args) => {
            if (++arrivals === 2) release();
            await gate;
            return target.create(args);
          };
        },
      }),
    };
    const app = createApp(db, config);
    const first = fixture();
    const second = fixture({ [field]: first[field] });
    const results = await Promise.all([register(app, first), register(app, second)]);
    assert.equal(arrivals, 2, 'both requests must pass the pre-check before inserting');
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.ok(results.find((r) => r.status === 409).body.errors[field]);
    assert.equal(await prisma.user.count({ where: { [field]: first[field] } }), 1);
  });
}

test('SQL chống trùng email/phone ngay cả khi bỏ qua API', async () => {
  const app = createApp(prisma, config);
  const first = fixture();
  await register(app, first).expect(201);
  const saved = await prisma.user.findUnique({ where: { username: first.username } });
  for (const field of ['email', 'phone']) {
    const next = fixture({ [field]: first[field] });
    await assert.rejects(prisma.user.create({ data: {
      username: next.username, name: next.name, email: next.email, phone: next.phone,
      passwordHash: saved.passwordHash, roleId: saved.roleId,
    } }), (error) => error.code === 'P2002');
  }
});

test('giới hạn đăng ký trả JSON tiếng Việt và Retry-After; CSRF vẫn được kiểm tra', async () => {
  const app = createApp(prisma, config);
  for (let i = 0; i < 5; i++) await register(app, {}).expect(400);
  const response = await register(app, {}).expect(429);
  assert.match(response.body.message, /đăng ký quá nhiều lần/);
  assert.ok(Number(response.headers['retry-after']) > 0);
  await request(app).post('/api/auth/register').send(fixture()).expect(403);
});

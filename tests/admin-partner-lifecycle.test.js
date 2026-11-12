require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, randomInt } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');
const { sqlEnabled } = require('../services/uploadStorage');

const prefix = `plife_${randomUUID().slice(0, 8)}`;
const password = 'LifeCycle@2026';
const config = readConfig({
  ...process.env,
  JWT_SECRET: randomBytes(48).toString('hex'),
  OPENAI_API_KEY: '',
  GEMINI_API_KEY: '',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASS: '',
});
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };

const users = [];
const cookies = [];
const randPhone = (suffix) => `09${String(randomInt(10_000_000, 99_999_999)).slice(0, 6)}${suffix}`;
const randDigits = (len) => Array.from({ length: len }, () => randomInt(0, 10)).join('');

const apiGet = (p, who = 0) => request(app).get('/api' + p).set('Cookie', cookies[who]);
const apiPost = (p, body, who = 0) => request(app).post('/api' + p).set(csrf).set('Cookie', cookies[who]).send(body);
const apiPut = (p, body, who = 0) => request(app).put('/api' + p).set(csrf).set('Cookie', cookies[who]).send(body);
const apiPatch = (p, body, who = 0) => request(app).patch('/api' + p).set(csrf).set('Cookie', cookies[who]).send(body);

async function signIn(index) {
  const res = await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username: users[index].username, password })
    .expect(200);
  cookies[index] = res.headers['set-cookie'][0].split(';')[0];
}

async function readAppDoc(key) {
  if (sqlEnabled()) {
    const rows = await prisma.$queryRaw`SELECT [payload] FROM [dbo].[application_documents] WHERE [key] = ${key}`;
    return rows.length ? JSON.parse(rows[0].payload) : null;
  }
  const fileName = key === 'stores' ? 'stores.json' : key === 'contracts' ? 'contracts.json' : null;
  if (!fileName) return null;
  const p = path.join(__dirname, '../data', fileName);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

async function stripUserKeysFromDocs(userIds) {
  const strIds = userIds.map((id) => String(id));
  if (sqlEnabled()) {
    for (const [key, mapKey] of [
      ['stores', 'stores'],
      ['contracts', 'contracts'],
    ]) {
      try {
        const rows = await prisma.$queryRaw`SELECT [payload] FROM [dbo].[application_documents] WHERE [key] = ${key}`;
        if (!rows.length) continue;
        const doc = JSON.parse(rows[0].payload);
        if (doc && doc[mapKey]) {
          let changed = false;
          for (const uid of strIds) {
            if (Object.hasOwn(doc[mapKey], uid)) {
              delete doc[mapKey][uid];
              changed = true;
            }
          }
          if (changed) {
            const payload = JSON.stringify(doc);
            await prisma.$executeRaw`UPDATE [dbo].[application_documents] SET [payload] = ${payload}, [updatedAt] = SYSUTCDATETIME() WHERE [key] = ${key}`;
          }
        }
      } catch {
        // Ignore missing table during teardown
      }
    }
  }
  for (const [fileName, mapKey] of [
    ['stores.json', 'stores'],
    ['contracts.json', 'contracts'],
  ]) {
    const filePath = path.join(__dirname, '../data', fileName);
    if (!fs.existsSync(filePath)) continue;
    const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (doc && doc[mapKey]) {
      let changed = false;
      for (const uid of strIds) {
        if (Object.hasOwn(doc[mapKey], uid)) {
          delete doc[mapKey][uid];
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf8');
    }
  }
}

before(async () => {
  const passwordHash = await bcrypt.hash(password, 10);
  const roles = ['ADMIN', 'STORE_OWNER', 'SUPPLIER', 'SUPPLIER'];
  for (let i = 0; i < roles.length; i += 1) {
    const u = await prisma.user.create({
      data: {
        username: `${prefix}_${i}`,
        name: `${prefix} User ${i}`,
        email: `${prefix}_${i}@example.com`,
        phone: randPhone(String(10 + i)),
        passwordHash,
        role: { connect: { code: roles[i] } },
      },
    });
    users.push(u);
    await signIn(i);
  }
});

after(async () => {
  const ids = users.map((u) => u.id);
  if (!ids.length) {
    await prisma.$disconnect();
    return;
  }
  const supProfiles = await prisma.supplierProfile.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  const entityIds = [...ids, ...supProfiles.map((s) => s.id)].map(String);
  await stripUserKeysFromDocs(ids);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { entityId: { in: entityIds } }] },
  });
  await prisma.supplierProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test('unapproved partners appear in admin users list with status INACTIVE and filter correctly', async () => {
  const all = await apiGet(`/admin/users?q=${prefix}`, 0).expect(200);
  assert.equal(all.body.users.length, 3);
  for (const partner of all.body.users) {
    assert.equal(partner.status, 'INACTIVE');
  }

  const inactiveOnly = await apiGet(`/admin/users?status=INACTIVE&q=${prefix}`, 0).expect(200);
  assert.equal(inactiveOnly.body.users.length, 3);

  const activeOnly = await apiGet(`/admin/users?status=ACTIVE&q=${prefix}`, 0).expect(200);
  assert.equal(activeOnly.body.users.length, 0);
});

test('store owner saving profile without signing creates DRAFT admin card, blocks review, and omits rawPrivateKey from my-contract', async () => {
  const storeUser = users[1];
  const saveRes = await apiPut(
    '/profile/store',
    {
      storeName: `${prefix} Tạp Hóa Bình An`,
      storeAddress: `188 Đường Nguyễn Tri Phương, Phường 4, Quận 10, TP. Hồ Chí Minh`,
      storePhone: randPhone('77'),
      taxCode: randDigits(10),
      businessType: 'HO_KINH_DOANH',
      bankName: 'Vietcombank',
      bankAccountNumber: randDigits(11),
      bankAccountHolder: 'NGUYEN VAN BINH',
    },
    1
  ).expect(200);

  assert.equal(saveRes.body.storeProfile.isConfigured, true);
  assert.equal(saveRes.body.storeProfile.verificationStatus, 'DRAFT');

  const draftList = await apiGet(`/admin/verifications?status=DRAFT&q=${prefix}`, 0).expect(200);
  const storeCard = draftList.body.profiles.find((p) => p.id === storeUser.id && p.role === 'STORE_OWNER');
  assert.ok(storeCard, 'DRAFT store card should be visible in admin verifications');

  await apiPatch(
    `/admin/verifications/${storeUser.id}`,
    {
      role: 'STORE_OWNER',
      status: 'APPROVED',
      version: storeCard.verificationVersion,
    },
    0
  ).expect(400);

  const myContract = await apiGet('/contracts/my-contract', 1).expect(200);
  assert.ok(myContract.body.contract);
  assert.equal('rawPrivateKey' in myContract.body.contract, false);
  assert.equal(myContract.body.contract.isSigned, false);
});

test('supplier duplicate guards reject colliding taxCode, bankAccountNumber, businessName, and phone across unapproved profiles', async () => {
  const sup1Payload = {
    businessName: `${prefix} Kho Sỉ Tân Phú`,
    warehouseAddress: '45 Lũy Bán Bích, Quận Tân Phú, TP. Hồ Chí Minh',
    deliveryRadiusKm: 12,
    deliveryFee: 15000,
    phone: randPhone('81'),
    taxCode: randDigits(10),
    bankName: 'ACB',
    bankAccountNumber: randDigits(10),
    bankAccountHolder: 'TRAN THI LAN',
  };

  const created = await apiPut('/supplier/profile', sup1Payload, 2).expect(200);
  assert.equal(created.body.profile.verificationStatus, 'DRAFT');

  const sup2Base = {
    businessName: `${prefix} Kho Sỉ Khác`,
    warehouseAddress: '99 Âu Cơ, Quận Tân Bình, TP. Hồ Chí Minh',
    deliveryRadiusKm: 10,
    deliveryFee: 10000,
    phone: randPhone('82'),
    taxCode: randDigits(10),
    bankName: 'TPBank',
    bankAccountNumber: randDigits(10),
    bankAccountHolder: 'LE VAN NAM',
  };

  const dupTax = await apiPut('/supplier/profile', { ...sup2Base, taxCode: sup1Payload.taxCode }, 3).expect(409);
  assert.ok(dupTax.body.errors?.taxCode);

  const dupBank = await apiPut(
    '/supplier/profile',
    { ...sup2Base, bankAccountNumber: sup1Payload.bankAccountNumber },
    3
  ).expect(409);
  assert.ok(dupBank.body.errors?.bankAccountNumber);

  const dupName = await apiPut(
    '/supplier/profile',
    { ...sup2Base, businessName: sup1Payload.businessName },
    3
  ).expect(409);
  assert.ok(dupName.body.errors?.businessName);

  const dupPhone = await apiPut('/supplier/profile', { ...sup2Base, phone: sup1Payload.phone }, 3).expect(409);
  assert.ok(dupPhone.body.errors?.phone);

  const p3Res = await apiGet('/profile', 3).expect(200);
  const p3 = p3Res.body.profile;
  const dupProfileBank = await apiPut(
    '/profile',
    {
      name: p3.name,
      email: p3.email,
      phone: p3.phone,
      dateOfBirth: p3.dateOfBirth ?? null,
      businessName: sup2Base.businessName,
      warehouseAddress: sup2Base.warehouseAddress,
      bankName: 'TPBank',
      bankAccountNumber: sup1Payload.bankAccountNumber,
      bankAccountHolder: sup2Base.bankAccountHolder,
    },
    3
  ).expect(409);
  assert.ok(dupProfileBank.body.errors?.bankAccountNumber);
  assert.match(dupProfileBank.body.message, /Số tài khoản ngân hàng/);
});

test('supplier sign -> reject -> resubmit -> reject -> approve clears note, blocks APPROVED review, and activates user status', async () => {
  const sup1User = users[2];
  const sup1ContractRes = await apiGet('/contracts/my-contract', 2).expect(200);
  assert.equal('rawPrivateKey' in sup1ContractRes.body.contract, false);

  const contractsDoc = await readAppDoc('contracts');
  const rawPrivateKey = contractsDoc?.contracts?.[String(sup1User.id)]?.rawPrivateKey;
  assert.ok(rawPrivateKey, 'contract rawPrivateKey should exist in storage for signing');

  await apiPost(
    '/contracts/sign',
    { method: 'PRIVATE_KEY', privateKey: rawPrivateKey, agreedTerms: true },
    2
  ).expect(200);

  let verifs = await apiGet(`/admin/verifications?q=${sup1User.username}`, 0).expect(200);
  let supCard = verifs.body.profiles.find((p) => p.userId === sup1User.id);
  assert.ok(supCard);
  assert.equal(supCard.verificationStatus, 'PENDING');

  // Admin rejects -> REJECTED with reason
  await apiPatch(
    `/admin/verifications/${supCard.id}`,
    {
      role: 'SUPPLIER',
      status: 'REJECTED',
      note: 'Mã số thuế không trùng khớp',
      version: supCard.verificationVersion,
    },
    0
  ).expect(200);

  verifs = await apiGet(`/admin/verifications?status=REJECTED&q=${sup1User.username}`, 0).expect(200);
  supCard = verifs.body.profiles.find((p) => p.userId === sup1User.id);
  assert.equal(supCard.verificationStatus, 'REJECTED');
  assert.equal(supCard.verificationNote, 'Mã số thuế không trùng khớp');

  // Supplier edits and resubmits directly -> PENDING and verificationNote cleared
  const resubmitRes = await apiPut(
    '/supplier/profile',
    {
      businessName: supCard.businessName,
      warehouseAddress: '48 Lũy Bán Bích, Quận Tân Phú, TP. Hồ Chí Minh',
      deliveryRadiusKm: 15,
      deliveryFee: 15000,
      phone: supCard.phone,
      taxCode: supCard.taxCode,
      bankName: 'ACB',
      bankAccountNumber: supCard.bankAccountNumber,
      bankAccountHolder: supCard.bankAccountHolder,
      resubmit: true,
    },
    2
  ).expect(200);
  assert.equal(resubmitRes.body.profile.verificationStatus, 'PENDING');
  assert.equal(resubmitRes.body.profile.verificationNote, null);

  // Admin rejects again, then approves directly from REJECTED
  verifs = await apiGet(`/admin/verifications?q=${sup1User.username}`, 0).expect(200);
  supCard = verifs.body.profiles.find((p) => p.userId === sup1User.id);
  await apiPatch(
    `/admin/verifications/${supCard.id}`,
    {
      role: 'SUPPLIER',
      status: 'REJECTED',
      note: 'Thông tin tài khoản ngân hàng chưa rõ ràng',
      version: supCard.verificationVersion,
    },
    0
  ).expect(200);

  verifs = await apiGet(`/admin/verifications?q=${sup1User.username}`, 0).expect(200);
  supCard = verifs.body.profiles.find((p) => p.userId === sup1User.id);
  assert.equal(supCard.verificationStatus, 'REJECTED');

  await apiPatch(
    `/admin/verifications/${supCard.id}`,
    {
      role: 'SUPPLIER',
      status: 'APPROVED',
      version: supCard.verificationVersion,
    },
    0
  ).expect(200);

  verifs = await apiGet(`/admin/verifications?status=APPROVED&q=${sup1User.username}`, 0).expect(200);
  supCard = verifs.body.profiles.find((p) => p.userId === sup1User.id);
  assert.equal(supCard.verificationStatus, 'APPROVED');
  assert.equal(supCard.verificationNote, null);

  // Admin cannot re-review APPROVED partner
  await apiPatch(
    `/admin/verifications/${supCard.id}`,
    {
      role: 'SUPPLIER',
      status: 'REJECTED',
      note: 'Không được phép từ chối lại',
      version: supCard.verificationVersion,
    },
    0
  ).expect(409);

  // User list reflects ACTIVE for approved supplier and keeps INACTIVE for unapproved partners
  const activeUsers = await apiGet(`/admin/users?status=ACTIVE&q=${prefix}`, 0).expect(200);
  assert.equal(activeUsers.body.users.length, 1);
  assert.equal(activeUsers.body.users[0].id, sup1User.id);
  assert.equal(activeUsers.body.users[0].status, 'ACTIVE');

  const inactiveUsers = await apiGet(`/admin/users?status=INACTIVE&q=${prefix}`, 0).expect(200);
  assert.equal(inactiveUsers.body.users.length, 2);
});

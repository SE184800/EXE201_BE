require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');

const prefix = `delqa_${randomUUID().slice(0, 8)}`;
const password = 'DeleteQa@2026';
const config = readConfig({
  ...process.env,
  JWT_SECRET: randomBytes(48).toString('hex'),
  OPENAI_API_KEY: '',
  GEMINI_API_KEY: '',
});
const app = createApp(prisma, config);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };

const createdUserIds = [];
let adminUser;
let adminCookie;
let secondAdminUser;
let supplierUser;
let supplierProfile;
let supplierProduct;
let cleanBuyer;
let transactedBuyer;
let transactedBuyerCookie;

async function signIn(username) {
  const res = await request(app).post('/api/auth/login').set(csrf).send({ username, password }).expect(200);
  return res.headers['set-cookie'][0].split(';')[0];
}

before(async () => {
  const passwordHash = await bcrypt.hash(password, 10);

  adminUser = await prisma.user.create({
    data: { username: `${prefix}_admin`, name: `${prefix} Admin`, passwordHash, role: { connect: { code: 'ADMIN' } } },
  });
  createdUserIds.push(adminUser.id);
  adminCookie = await signIn(adminUser.username);

  secondAdminUser = await prisma.user.create({
    data: { username: `${prefix}_admin2`, name: `${prefix} Admin 2`, passwordHash, role: { connect: { code: 'ADMIN' } } },
  });
  createdUserIds.push(secondAdminUser.id);

  supplierUser = await prisma.user.create({
    data: { username: `${prefix}_sup`, name: `${prefix} Supplier`, passwordHash, role: { connect: { code: 'SUPPLIER' } } },
  });
  createdUserIds.push(supplierUser.id);

  supplierProfile = await prisma.supplierProfile.create({
    data: {
      userId: supplierUser.id,
      businessName: `${prefix} Kho hàng sỉ`,
      warehouseAddress: '100 Nguyễn Văn Linh, Quận 7, TP. Hồ Chí Minh',
      deliveryRadiusKm: 15,
      deliveryFee: 10000,
      verificationStatus: 'APPROVED',
      verificationVersion: 1,
    },
  });

  supplierProduct = await prisma.supplierProduct.create({
    data: {
      supplierId: supplierProfile.id,
      name: `${prefix} Gạo ST25`,
      packaging: 'Bao 25kg',
      wholesalePrice: 500000,
      stockQty: 100,
      moq: 1,
      isActive: true,
    },
  });

  cleanBuyer = await prisma.user.create({
    data: {
      username: `${prefix}_clean`,
      name: `${prefix} Clean Store`,
      email: `${prefix}_clean@example.com`,
      phone: '0901000001',
      passwordHash,
      role: { connect: { code: 'STORE_OWNER' } },
    },
  });
  createdUserIds.push(cleanBuyer.id);
  await prisma.wallet.create({
    data: { userId: cleanBuyer.id, balance: 0, heldBalance: 0, currency: 'VND' },
  });

  transactedBuyer = await prisma.user.create({
    data: {
      username: `${prefix}_tx`,
      name: `${prefix} Transacted Store`,
      email: `${prefix}_tx@example.com`,
      phone: '0901000002',
      passwordHash,
      role: { connect: { code: 'STORE_OWNER' } },
    },
  });
  createdUserIds.push(transactedBuyer.id);
  transactedBuyerCookie = await signIn(transactedBuyer.username);
});

after(async () => {
  const uniqueIds = [...new Set(createdUserIds)];
  const suppIds = supplierProfile ? [supplierProfile.id] : [];

  await prisma.orderComplaint.deleteMany({
    where: { OR: [{ buyerId: { in: uniqueIds } }, ...(suppIds.length ? [{ supplierId: { in: suppIds } }] : [])] },
  });

  const orders = await prisma.wholesaleOrder.findMany({
    where: { OR: [{ buyerId: { in: uniqueIds } }, ...(suppIds.length ? [{ supplierId: { in: suppIds } }] : [])] },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) {
    await prisma.wholesaleOrderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderPayment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.walletTransaction.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.wholesaleOrder.deleteMany({ where: { id: { in: orderIds } } });
  }

  await prisma.withdrawalRequest.deleteMany({ where: { userId: { in: uniqueIds } } });
  await prisma.depositRequest.deleteMany({ where: { userId: { in: uniqueIds } } });
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: uniqueIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: uniqueIds } } });

  if (supplierProduct) {
    await prisma.supplierProduct.deleteMany({ where: { id: supplierProduct.id } });
  }
  if (supplierProfile) {
    await prisma.supplierProfile.deleteMany({ where: { id: supplierProfile.id } });
  }

  await prisma.authSession.deleteMany({ where: { userId: { in: uniqueIds } } });
  await prisma.passwordReset.deleteMany({ where: { userId: { in: uniqueIds } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: uniqueIds } }, { entityId: { in: uniqueIds.map(String) }, entityType: 'USER' }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: uniqueIds } } });
  await prisma.$disconnect();
});

test('deletion pre-check and delete enforce admin role, self-protection, and 404 guards', async () => {
  await request(app).get(`/api/admin/users/${cleanBuyer.id}/deletion-check`).expect(401);
  await request(app)
    .get(`/api/admin/users/${cleanBuyer.id}/deletion-check`)
    .set('Cookie', transactedBuyerCookie)
    .expect(403);

  await request(app)
    .get(`/api/admin/users/${adminUser.id}/deletion-check`)
    .set('Cookie', adminCookie)
    .expect(400);

  await request(app)
    .get(`/api/admin/users/${secondAdminUser.id}/deletion-check`)
    .set('Cookie', adminCookie)
    .expect(403);

  await request(app)
    .delete(`/api/admin/users/${secondAdminUser.id}`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .expect(403);

  await request(app)
    .get('/api/admin/users/99999999/deletion-check')
    .set('Cookie', adminCookie)
    .expect(404);
});

test('clean user without transactions gets HARD deleted and frees username/email/phone', async () => {
  const checkRes = await request(app)
    .get(`/api/admin/users/${cleanBuyer.id}/deletion-check`)
    .set('Cookie', adminCookie)
    .expect(200);

  assert.equal(checkRes.body.canDelete, true);
  assert.equal(checkRes.body.mode, 'HARD');
  assert.equal(checkRes.body.checks.ordersClear, true);
  assert.equal(checkRes.body.checks.complaintsClear, true);
  assert.equal(checkRes.body.checks.walletClear, true);
  assert.equal(checkRes.body.history.hasTransactionHistory, false);

  const delRes = await request(app)
    .delete(`/api/admin/users/${cleanBuyer.id}`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .expect(200);

  assert.equal(delRes.body.success, true);
  assert.equal(delRes.body.mode, 'HARD');

  const gone = await prisma.user.findUnique({ where: { id: cleanBuyer.id } });
  assert.equal(gone, null);

  // Username, email, phone can be registered again
  const passwordHash = await bcrypt.hash(password, 10);
  const recreated = await prisma.user.create({
    data: {
      username: cleanBuyer.username,
      name: `${prefix} Re-registered`,
      email: cleanBuyer.email,
      phone: cleanBuyer.phone,
      passwordHash,
      role: { connect: { code: 'STORE_OWNER' } },
    },
  });
  createdUserIds.push(recreated.id);
  assert.ok(recreated.id > 0);
});

test('transacted user is blocked until orders, complaints, and wallet settle to 0, then SOFT deleted transparently', async () => {
  const wallet = await prisma.wallet.create({
    data: { userId: transactedBuyer.id, balance: 50000, heldBalance: 10000, currency: 'VND' },
  });
  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId: transactedBuyer.id,
      type: 'DEPOSIT',
      direction: 'CREDIT',
      amount: 60000,
      balanceAfter: 60000,
      reference: `${prefix}_dep_1`,
      status: 'COMPLETED',
    },
  });
  const withdrawal = await prisma.withdrawalRequest.create({
    data: {
      userId: transactedBuyer.id,
      amount: 10000,
      bankName: 'Vietcombank',
      bankAccountNumber: '1234567890',
      bankAccountHolder: 'TRAN VAN TEST',
      status: 'PENDING',
    },
  });
  const order = await prisma.wholesaleOrder.create({
    data: {
      buyerId: transactedBuyer.id,
      supplierId: supplierProfile.id,
      requestId: randomUUID(),
      status: 'PENDING',
      subtotal: 500000,
      deliveryFee: 0,
      total: 500000,
      recipientName: 'Cửa hàng test',
      recipientPhone: '0901000002',
      deliveryAddress: '123 Lê Lợi, Quận 1, TP. Hồ Chí Minh',
      items: {
        create: [{
          productId: supplierProduct.id,
          productName: supplierProduct.name,
          packaging: supplierProduct.packaging,
          unitPrice: 500000,
          quantity: 1,
          lineTotal: 500000,
        }],
      },
    },
  });
  const complaint = await prisma.orderComplaint.create({
    data: {
      orderId: order.id,
      buyerId: transactedBuyer.id,
      supplierId: supplierProfile.id,
      reason: 'Thiếu hàng kiểm thử',
      description: 'Kiểm thử khóa xóa khi còn khiếu nại mở',
      status: 'OPEN',
    },
  });

  // 1) Blocked by ALL 3 checks
  const blockedAll = await request(app)
    .get(`/api/admin/users/${transactedBuyer.id}/deletion-check`)
    .set('Cookie', adminCookie)
    .expect(200);
  assert.equal(blockedAll.body.canDelete, false);
  assert.equal(blockedAll.body.mode, 'SOFT');
  assert.equal(blockedAll.body.checks.ordersClear, false);
  assert.equal(blockedAll.body.checks.complaintsClear, false);
  assert.equal(blockedAll.body.checks.walletClear, false);
  assert.equal(blockedAll.body.checks.walletBalance, 50000);
  assert.equal(blockedAll.body.checks.walletHeldBalance, 10000);
  assert.equal(blockedAll.body.checks.pendingWithdrawalsCount, 1);

  await request(app)
    .delete(`/api/admin/users/${transactedBuyer.id}`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .expect(409);

  // 2) Finish order, keep open complaint & wallet balance -> still blocked
  await prisma.wholesaleOrder.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
  const blockedComplaint = await request(app)
    .get(`/api/admin/users/${transactedBuyer.id}/deletion-check`)
    .set('Cookie', adminCookie)
    .expect(200);
  assert.equal(blockedComplaint.body.canDelete, false);
  assert.equal(blockedComplaint.body.checks.ordersClear, true);
  assert.equal(blockedComplaint.body.checks.complaintsClear, false);

  await request(app)
    .delete(`/api/admin/users/${transactedBuyer.id}`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .expect(409);

  // 3) Resolve complaint and zero wallet & complete withdrawal -> now ready for SOFT delete
  await prisma.orderComplaint.update({ where: { id: complaint.id }, data: { status: 'RESOLVED' } });
  await prisma.withdrawalRequest.update({
    where: { id: withdrawal.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: 0, heldBalance: 0 } });

  const readyCheck = await request(app)
    .get(`/api/admin/users/${transactedBuyer.id}/deletion-check`)
    .set('Cookie', adminCookie)
    .expect(200);
  assert.equal(readyCheck.body.canDelete, true);
  assert.equal(readyCheck.body.mode, 'SOFT');
  assert.equal(readyCheck.body.checks.ordersClear, true);
  assert.equal(readyCheck.body.checks.complaintsClear, true);
  assert.equal(readyCheck.body.checks.walletClear, true);

  const softDel = await request(app)
    .delete(`/api/admin/users/${transactedBuyer.id}`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .expect(200);
  assert.equal(softDel.body.success, true);
  assert.equal(softDel.body.mode, 'SOFT');

  // Verify ledger & orders preserved and user archived safely
  const dbUser = await prisma.user.findUnique({ where: { id: transactedBuyer.id } });
  assert.ok(dbUser && dbUser.deletedAt);
  assert.equal(dbUser.isActive, false);
  assert.ok(await prisma.wholesaleOrder.findUnique({ where: { id: order.id } }));
  assert.ok(await prisma.orderComplaint.findUnique({ where: { id: complaint.id } }));
  assert.equal(await prisma.walletTransaction.count({ where: { userId: transactedBuyer.id } }), 1);
  assert.equal(await prisma.authSession.count({ where: { userId: transactedBuyer.id } }), 0);

  // Deleted user cannot log in or use old session
  await request(app)
    .post('/api/auth/login')
    .set(csrf)
    .send({ username: transactedBuyer.username, password })
    .expect(401);
  await request(app)
    .get('/api/auth/me')
    .set('Cookie', transactedBuyerCookie)
    .expect(401);

  // Admin list visibility: hidden by default & BANNED, shown in status=DELETED
  const defaultList = await request(app)
    .get('/api/admin/users')
    .query({ q: transactedBuyer.username })
    .set('Cookie', adminCookie)
    .expect(200);
  assert.equal(defaultList.body.users.length, 0);

  const bannedList = await request(app)
    .get('/api/admin/users')
    .query({ status: 'BANNED', q: transactedBuyer.username })
    .set('Cookie', adminCookie)
    .expect(200);
  assert.equal(bannedList.body.users.length, 0);

  const deletedList = await request(app)
    .get('/api/admin/users')
    .query({ status: 'DELETED', q: transactedBuyer.username })
    .set('Cookie', adminCookie)
    .expect(200);
  assert.equal(deletedList.body.users.length, 1);
  assert.equal(deletedList.body.users[0].status, 'DELETED');
  assert.ok(deletedList.body.users[0].deletedAt);

  // Further mutations on soft-deleted account are blocked
  await request(app)
    .patch(`/api/admin/users/${transactedBuyer.id}/status`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .send({
      status: 'ACTIVE',
      reason: 'Thử mở lại tài khoản đã xóa',
      expectedUpdatedAt: dbUser.updatedAt.toISOString(),
    })
    .expect(409);

  await request(app)
    .delete(`/api/admin/users/${transactedBuyer.id}`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .expect(409);
});

test('suspending an account without reason defaults lockReason and returns suspendedUntil for editing', async () => {
  const initialUntil = new Date(Date.now() + 7200000).toISOString();
  const updatedUntil = new Date(Date.now() + 14400000).toISOString();

  const listBefore = await request(app)
    .get('/api/admin/users')
    .query({ q: supplierUser.username })
    .set('Cookie', adminCookie)
    .expect(200);
  const current = listBefore.body.users[0];

  const firstLock = await request(app)
    .patch(`/api/admin/users/${supplierUser.id}/status`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .send({
      status: 'SUSPENDED',
      suspendedUntil: initialUntil,
      reason: '   ',
      expectedUpdatedAt: current.updatedAt,
    })
    .expect(200);

  assert.equal(firstLock.body.user.status, 'SUSPENDED');
  assert.equal(firstLock.body.user.lockReason, 'Giải quyết vấn đề phát sinh');
  assert.equal(new Date(firstLock.body.user.suspendedUntil).toISOString(), initialUntil);

  // Adjusting suspendedUntil again while omitting reason keeps working cleanly
  const secondLock = await request(app)
    .patch(`/api/admin/users/${supplierUser.id}/status`)
    .set(csrf)
    .set('Cookie', adminCookie)
    .send({
      status: 'SUSPENDED',
      suspendedUntil: updatedUntil,
      expectedUpdatedAt: firstLock.body.user.updatedAt,
    })
    .expect(200);

  assert.equal(secondLock.body.user.lockReason, 'Giải quyết vấn đề phát sinh');
  assert.equal(new Date(secondLock.body.user.suspendedUntil).toISOString(), updatedUntil);
});

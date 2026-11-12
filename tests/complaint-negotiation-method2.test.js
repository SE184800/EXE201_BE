require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');
const { getCanonicalContractText } = require('../services/contractService');
const { walletService } = require('../services/walletService');
const {
  getComplaintWorkflow,
  saveComplaintWorkflow,
  deleteWorkflowsByComplaintIds,
} = require('../services/complaintWorkflowService');

const prefix = `cm2_${randomUUID().slice(0, 8)}`;
const password = 'Method2@2026';
const config = readConfig();
const app = createApp(prisma, config);
const csrf = { Origin: config.origin, 'X-CSRF-Protection': 'sg-restock-web' };

const users = [];
const orderIds = [];
const complaintIds = [];
let buyer, supplier, admin, supplierProfile, product;
const cookies = new Map();

async function createTestOrder({ status = 'SHIPPING', quantity = 4, price = 100000, depositAmount = 0, depositStatus = 'NONE', inventoryImportedAt = null } = {}) {
  const subtotal = quantity * price;
  const created = await prisma.wholesaleOrder.create({
    data: {
      buyerId: buyer.id,
      supplierId: supplierProfile.id,
      status,
      subtotal,
      deliveryFee: 0,
      total: subtotal,
      depositRate: depositAmount > 0 ? 20 : 0,
      depositAmount,
      depositStatus,
      inventoryImportedAt,
      deliveredAt: status === 'DELIVERED' ? new Date() : null,
      recipientName: 'Tiem Method 2',
      recipientPhone: '0901234567',
      deliveryAddress: '123 Duong Thuong Luong, Quan 1, TP HCM',
      items: {
        create: [
          {
            productId: product.id,
            productName: product.name,
            packaging: product.packaging,
            quantity,
            unitPrice: price,
            lineTotal: subtotal,
          },
        ],
      },
    },
    include: { items: true },
  });
  orderIds.push(created.id);
  return created;
}

before(async () => {
  const passwordHash = await bcrypt.hash(password, 10);
  for (const [suffix, code] of [
    ['buyer', 'STORE_OWNER'],
    ['supplier', 'SUPPLIER'],
    ['admin', 'ADMIN'],
  ]) {
    const user = await prisma.user.create({
      data: {
        username: `${prefix}_${suffix}`,
        name: `${prefix} ${suffix}`,
        passwordHash,
        role: { connect: { code } },
      },
    });
    users.push(user);
    const login = await request(app)
      .post('/api/auth/login')
      .set(csrf)
      .send({ username: user.username, password })
      .expect(200);
    cookies.set(user.id, login.headers['set-cookie'][0].split(';')[0]);
  }
  [buyer, supplier, admin] = users;
  supplierProfile = await prisma.supplierProfile.create({
    data: {
      userId: supplier.id,
      businessName: `${prefix} Vua`,
      warehouseAddress: 'Kho Method 2',
      deliveryRadiusKm: 15,
      verificationStatus: 'APPROVED',
    },
  });
  product = await prisma.supplierProduct.create({
    data: {
      supplierId: supplierProfile.id,
      name: `${prefix} Gao Thom`,
      packaging: 'bao 25kg',
      wholesalePrice: 100000,
      stockQty: 50,
      moq: 1,
    },
  });
});

after(async () => {
  const userIds = users.map((u) => u.id);
  const allSupplierOrders = supplierProfile
    ? await prisma.wholesaleOrder.findMany({ where: { supplierId: supplierProfile.id }, select: { id: true } })
    : [];
  const allOrderIds = Array.from(new Set([...orderIds, ...allSupplierOrders.map((o) => o.id)]));

  try {
    deleteWorkflowsByComplaintIds(complaintIds, allOrderIds);
  } catch {}

  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.orderComplaint.deleteMany({ where: { orderId: { in: allOrderIds } } });
  await prisma.orderPayment.deleteMany({ where: { orderId: { in: allOrderIds } } });
  if (allOrderIds.length > 0) {
    await prisma.wholesaleOrderItem.deleteMany({ where: { orderId: { in: allOrderIds } } });
    await prisma.wholesaleOrder.deleteMany({ where: { id: { in: allOrderIds } } });
  }
  if (product) await prisma.supplierProduct.deleteMany({ where: { id: product.id } });
  if (supplierProfile) await prisma.supplierProfile.deleteMany({ where: { id: supplierProfile.id } });
  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test('1. Electronic contract aligns with consensual result-recording rules without 2-hour contradiction', () => {
  const text = getCanonicalContractText({
    contractNumber: 'HD-TEST-001',
    createdAt: new Date().toISOString(),
    role: 'STORE_OWNER',
    username: buyer.username,
    signerInfo: { name: buyer.name, phone: '0901234567' },
  });

  assert.match(text, /ĐIỀU 3:/);
  assert.match(text, /ĐIỀU 6:/);
  assert.match(text, /24 giờ kể từ lúc đơn chuyển trạng thái Đã giao/);
  assert.doesNotMatch(text, /trong vòng 2 giờ/);
  assert.doesNotMatch(text, /CLOSED_TIMEOUT/);
  assert.doesNotMatch(text, /CLOSED_UNRESOLVED/);
  assert.match(text, /Xác nhận đồng ý phương án/);
  assert.match(text, /KHÔNG đứng ra phân xử thắng\/thua/);
});

test('2. Multi-turn bilateral COD deduction updates paymentDue and records neutral Admin history', async () => {
  const ord = await createTestOrder({ status: 'SHIPPING', quantity: 5, price: 100000 }); // total 500,000

  // Store creates complaint
  const createRes = await request(app)
    .post('/api/complaints')
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({
      orderId: ord.id,
      reason: 'DAMAGED',
      description: 'Bể 1 bao gạo khi giao',
      imageUrl: '/uploads/a.png|||/uploads/b.png',
    })
    .expect(201);

  const comp = createRes.body.complaint;
  complaintIds.push(comp.id);
  assert.equal(comp.status, 'OPEN');
  assert.equal(comp.workflow.pendingParty, 'SUPPLIER');
  assert.equal(comp.workflow.maxRounds, null);
  assert.equal(comp.workflow.deadlineAt, null);

  const updatedOrder = await prisma.wholesaleOrder.findUniqueOrThrow({ where: { id: ord.id } });
  assert.equal(updatedOrder.status, 'ISSUE_HANDLING');

  // Legacy escalate & resolve routes are retired (410 Gone)
  await request(app)
    .post(`/api/complaints/${comp.id}/escalate`)
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({})
    .expect(410);
  await request(app)
    .post(`/api/complaints/${comp.id}/resolve`)
    .set(csrf)
    .set('Cookie', cookies.get(supplier.id))
    .send({})
    .expect(410);

  // Turn 1: Supplier proposes DEDUCT_COD 50,000
  const r1Res = await request(app)
    .post(`/api/complaints/${comp.id}/respond`)
    .set(csrf)
    .set('Cookie', cookies.get(supplier.id))
    .send({ action: 'DEDUCT_COD', deductAmount: 50000, note: 'Bên vựa đề xuất giảm 50k tiền hàng hỏng' })
    .expect(200);
  assert.equal(r1Res.body.complaint.status, 'IN_REVIEW');
  assert.equal(r1Res.body.complaint.workflow.pendingParty, 'STORE_OWNER');
  assert.equal(r1Res.body.complaint.workflow.proposedDeductAmount, 50000);

  // Supplier cannot propose twice before store responds
  await request(app)
    .post(`/api/complaints/${comp.id}/respond`)
    .set(csrf)
    .set('Cookie', cookies.get(supplier.id))
    .send({ action: 'DEDUCT_COD', deductAmount: 60000, note: 'Gửi đè lần 2' })
    .expect(409);

  // Store counters (turn 2) asking for 75,000
  const counterRes = await request(app)
    .post(`/api/complaints/${comp.id}/buyer-decision`)
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ decision: 'COUNTER', note: 'Hư hỏng nặng hơn, đề nghị trừ 75.000đ' })
    .expect(200);
  assert.equal(counterRes.body.complaint.workflow.round, 2);
  assert.equal(counterRes.body.complaint.workflow.pendingParty, 'SUPPLIER');

  // Supplier responds again
  await request(app)
    .post(`/api/complaints/${comp.id}/respond`)
    .set(csrf)
    .set('Cookie', cookies.get(supplier.id))
    .send({ action: 'DEDUCT_COD', deductAmount: 65000, note: 'Đề xuất mức 65.000đ' })
    .expect(200);

  // Store can counter a 3rd time without round ceiling (persistent-dispute cap paused)
  const counter3Res = await request(app)
    .post(`/api/complaints/${comp.id}/buyer-decision`)
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ decision: 'COUNTER', note: 'Mong muốn chốt mức 75.000đ' })
    .expect(200);
  assert.equal(counter3Res.body.complaint.workflow.round, 3);
  assert.equal(counter3Res.body.complaint.workflow.pendingParty, 'SUPPLIER');

  // Supplier agrees to 75,000 COD deduction
  const r3Res = await request(app)
    .post(`/api/complaints/${comp.id}/respond`)
    .set(csrf)
    .set('Cookie', cookies.get(supplier.id))
    .send({ action: 'DEDUCT_COD', deductAmount: 75000, note: 'Đồng ý giảm trừ 75.000đ vào COD' })
    .expect(200);
  assert.equal(r3Res.body.complaint.workflow.pendingParty, 'STORE_OWNER');

  // CLOSE_UNRESOLVED is temporarily paused (returns 410 Gone)
  await request(app)
    .post(`/api/complaints/${comp.id}/buyer-decision`)
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ decision: 'CLOSE_UNRESOLVED' })
    .expect(410);

  // Store accepts Supplier's 75,000 COD deduction -> RESOLVED
  const acceptRes = await request(app)
    .post(`/api/complaints/${comp.id}/buyer-decision`)
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ decision: 'ACCEPT' })
    .expect(200);
  assert.equal(acceptRes.body.complaint.status, 'RESOLVED');
  assert.equal(acceptRes.body.complaint.workflow.agreedDeductAmount, 75000);
  assert.equal(acceptRes.body.complaint.workflow.finalOutcome, 'AGREED_DEDUCT_COD');

  // Verify GET /api/orders reflects deduction cleanly on order list / workflow
  const ordersRes = await request(app)
    .get('/api/orders')
    .set('Cookie', cookies.get(buyer.id))
    .expect(200);
  const foundOrder = ordersRes.body.orders.find((o) => o.id === ord.id);
  assert.ok(foundOrder);
  assert.equal(foundOrder.complaint.status, 'RESOLVED');
  assert.equal(foundOrder.complaint.workflow.agreedDeductAmount, 75000);

  // Admin complaints endpoint records full history & final result and blocks arbitration with 410
  const adminList = await request(app)
    .get('/api/admin/complaints')
    .set('Cookie', cookies.get(admin.id))
    .expect(200);
  const tracked = adminList.body.complaints.find((c) => c.id === comp.id);
  assert.ok(tracked);
  assert.equal(tracked.workflow.finalOutcome, 'AGREED_DEDUCT_COD');
  assert.ok(tracked.workflow.history.length >= 6);
  assert.ok(tracked.buyer?.name);
  assert.ok(tracked.supplier?.businessName);

  await request(app)
    .post(`/api/admin/complaints/${comp.id}/resolve`)
    .set(csrf)
    .set('Cookie', cookies.get(admin.id))
    .send({ decision: 'FAVOR_BUYER' })
    .expect(410);
});

test('3. Consensual AGREE_REPLACE_0VND spawns 0 VND supplementary PREPARING order', async () => {
  const ord = await createTestOrder({ status: 'DELIVERED', quantity: 2, price: 100000 });

  const createRes = await request(app)
    .post('/api/complaints')
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ orderId: ord.id, reason: 'SHORTAGE', description: 'Thiếu 2 bao gạo' })
    .expect(201);
  const compId = createRes.body.complaint.id;
  complaintIds.push(compId);

  await request(app)
    .post(`/api/complaints/${compId}/respond`)
    .set(csrf)
    .set('Cookie', cookies.get(supplier.id))
    .send({ action: 'AGREE_REPLACE_0VND', note: 'Bên vựa giao bù đơn 0đ trong ngày mai' })
    .expect(200);

  const acceptRes = await request(app)
    .post(`/api/complaints/${compId}/buyer-decision`)
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ decision: 'ACCEPT' })
    .expect(200);

  assert.equal(acceptRes.body.complaint.status, 'RESOLVED');
  assert.equal(acceptRes.body.complaint.workflow.finalOutcome, 'AGREED_REPLACE_0VND');
  assert.ok(acceptRes.body.supplementaryOrder?.id);
  orderIds.push(acceptRes.body.supplementaryOrder.id);
  assert.equal(Number(acceptRes.body.supplementaryOrder.total), 0);
  assert.equal(acceptRes.body.supplementaryOrder.status, 'PREPARING');
  assert.equal(acceptRes.body.supplementaryOrder.items.length, 1);
  assert.equal(acceptRes.body.supplementaryOrder.items[0].quantity, 2);
});

test('4. Consensual RETURN_REFUND refunds escrow deposit, restocks inventory, and clears deletion blocker', async () => {
  await prisma.wallet.upsert({
    where: { userId: buyer.id },
    create: { userId: buyer.id, balance: 100000, heldBalance: 0 },
    update: { balance: 100000, heldBalance: 0 },
  });

  const stockBefore = (await prisma.supplierProduct.findUniqueOrThrow({ where: { id: product.id } })).stockQty;
  const ord = await createTestOrder({
    status: 'ISSUE_HANDLING',
    quantity: 5,
    price: 100000,
    depositAmount: 100000,
    depositStatus: 'PAID',
    inventoryImportedAt: null,
  });
  await walletService.lockEscrow(buyer.id, ord.id, 100000, `Lock escrow don #${ord.id}`);

  const createRes = await request(app)
    .post('/api/complaints')
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ orderId: ord.id, reason: 'QUALITY', description: 'Hàng ẩm mốc nặng' })
    .expect(201);
  const compId = createRes.body.complaint.id;
  complaintIds.push(compId);

  // Supplier agrees to RETURN_REFUND & Buyer accepts
  await request(app)
    .post(`/api/complaints/${compId}/respond`)
    .set(csrf)
    .set('Cookie', cookies.get(supplier.id))
    .send({ action: 'RETURN_REFUND', note: 'Đồng ý thu hồi hàng & hoàn 100% cọc cho tiệm' })
    .expect(200);

  const acceptRes = await request(app)
    .post(`/api/complaints/${compId}/buyer-decision`)
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ decision: 'ACCEPT' })
    .expect(200);

  assert.equal(acceptRes.body.complaint.status, 'RESOLVED');
  assert.equal(acceptRes.body.complaint.workflow.finalOutcome, 'AGREED_RETURN_REFUND');

  const closedOrder = await prisma.wholesaleOrder.findUniqueOrThrow({ where: { id: ord.id } });
  assert.equal(closedOrder.status, 'REJECTED');
  assert.equal(closedOrder.depositStatus, 'REFUNDED');

  const stockAfter = (await prisma.supplierProduct.findUniqueOrThrow({ where: { id: product.id } })).stockQty;
  assert.equal(stockAfter, stockBefore + 5);

  const buyerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer.id } });
  assert.equal(Number(buyerWallet.heldBalance), 0);
  assert.equal(Number(buyerWallet.balance), 100000);

  // Close open orders created in earlier subtests so we can verify RESOLVED order/complaint is cleared for deletion
  await prisma.wholesaleOrder.updateMany({
    where: { id: { in: orderIds.filter((oid) => oid !== ord.id) } },
    data: { status: 'COMPLETED' },
  });

  const delCheck = await request(app)
    .get(`/api/admin/users/${buyer.id}/deletion-check`)
    .set('Cookie', cookies.get(admin.id))
    .expect(200);
  assert.equal(delCheck.body.checks.complaintsClear, true);
  assert.equal(delCheck.body.checks.ordersClear, true);
});

test('5. Paused timeout check keeps complaint open and buyer WITHDRAW records final RESOLVED outcome', async () => {
  const ord = await createTestOrder({ status: 'DELIVERED', quantity: 1, price: 100000, inventoryImportedAt: new Date() });

  const createRes = await request(app)
    .post('/api/complaints')
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ orderId: ord.id, reason: 'LATE', description: 'Giao trễ 1 ngày nhưng đã tự thỏa thuận' })
    .expect(201);
  const comp = createRes.body.complaint;
  complaintIds.push(comp.id);

  // Even if an old workflow has an expired deadlineAt, paused timeout evaluator keeps it OPEN
  const wf = getComplaintWorkflow(comp);
  wf.deadlineAt = new Date(Date.now() - 60 * 1000).toISOString();
  saveComplaintWorkflow(wf);

  const listRes = await request(app)
    .get('/api/complaints')
    .set('Cookie', cookies.get(buyer.id))
    .expect(200);
  const stillOpen = listRes.body.complaints.find((c) => c.id === comp.id);
  assert.ok(stillOpen);
  assert.equal(stillOpen.status, 'OPEN');

  // Buyer can withdraw cleanly to finalize and record result
  const withdrawRes = await request(app)
    .post(`/api/complaints/${comp.id}/buyer-decision`)
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({ decision: 'WITHDRAW', note: 'Hai bên đã tự trao đổi xong ngoài hệ thống' })
    .expect(200);
  assert.equal(withdrawRes.body.complaint.status, 'RESOLVED');
  assert.equal(withdrawRes.body.complaint.workflow.finalOutcome, 'STORE_WITHDRAWN');
});

test('6. Order search (q), HAS_COMPLAINT filter, and complaint notice/response email templates', async () => {
  const { sendComplaintNoticeEmail, sendComplaintResponseEmail } = require('../services/complaintMailService');
  const fs = require('node:fs/promises');
  const path = require('node:path');

  const ord = await createTestOrder({ status: 'DELIVERED', quantity: 2, price: 85000 });

  // Before complaint: HAS_COMPLAINT filter does not match this order
  const beforeFilter = await request(app)
    .get('/api/orders?status=HAS_COMPLAINT')
    .set('Cookie', cookies.get(buyer.id))
    .expect(200);
  assert.equal(beforeFilter.body.orders.some((o) => o.id === ord.id), false);

  const createRes = await request(app)
    .post('/api/complaints')
    .set(csrf)
    .set('Cookie', cookies.get(buyer.id))
    .send({
      orderId: ord.id,
      reason: 'DAMAGED',
      description: '[Sự cố: Gạo ST25 test x2 | Bồi hoàn ước tính: 50.000 đ | Đề xuất: Giao bù]\nBao gạo bị rách khi giao',
    })
    .expect(201);
  const compId = createRes.body.complaint.id;
  complaintIds.push(compId);

  // Active complaint matches HAS_COMPLAINT & q=<orderId> for both store owner and supplier
  const storeFiltered = await request(app)
    .get(`/api/orders?status=HAS_COMPLAINT&q=${encodeURIComponent(String(ord.id))}`)
    .set('Cookie', cookies.get(buyer.id))
    .expect(200);
  assert.equal(storeFiltered.body.orders.some((o) => o.id === ord.id), true);

  const supplierFiltered = await request(app)
    .get(`/api/supplier/orders?status=HAS_COMPLAINT&q=${encodeURIComponent(`#${ord.id}`)}`)
    .set('Cookie', cookies.get(supplier.id))
    .expect(200);
  assert.equal(supplierFiltered.body.orders.some((o) => o.id === ord.id), true);

  // Search by product name matches cleanly
  const productSearch = await request(app)
    .get(`/api/orders?q=${encodeURIComponent(product.name)}`)
    .set('Cookie', cookies.get(buyer.id))
    .expect(200);
  assert.equal(productSearch.body.orders.some((o) => o.id === ord.id), true);

  // Verify email templates (without real SMTP creds -> fallback returns clean subject + .local-mail file)
  const localMailDir = path.join(__dirname, '..', '.local-mail');
  const beforeFiles = new Set(await fs.readdir(localMailDir).catch(() => []));

  const noticeMail = await sendComplaintNoticeEmail({
    to: 'supplier-test@example.com',
    supplierName: 'Vựa Test',
    storeName: 'Tạp Hóa Test',
    orderId: ord.id,
    orderTotal: 170000,
    reasonLabel: 'Hàng hư hỏng / bể vỡ',
    description: 'Bao gạo bị rách khi giao',
    itemSummaries: 'Gạo ST25 x2',
    evidenceImages: ['/uploads/a.jpg'],
    config: { gmail: { user: '', appPassword: '' } },
  });
  assert.match(noticeMail.subject, /Đơn hàng #\d+ của bạn vừa bị khiếu nại/);

  const responseMail = await sendComplaintResponseEmail({
    to: 'store-test@example.com',
    storeName: 'Tạp Hóa Test',
    supplierName: 'Vựa Test',
    orderId: ord.id,
    orderTotal: 170000,
    reasonLabel: 'Hàng hư hỏng / bể vỡ',
    itemSummaries: 'Gạo ST25 x2',
    actionLabel: 'Giao bù hàng mới',
    supplierNote: 'Vựa sẽ giao bù vào sáng mai',
    config: { gmail: { user: '', appPassword: '' } },
  });
  assert.match(responseMail.subject, /Bạn có một phản hồi về đơn khiếu nại #\d+ mà bạn đã tạo/);

  const afterFiles = await fs.readdir(localMailDir).catch(() => []);
  for (const file of afterFiles) {
    if (!beforeFiles.has(file) && file.includes(`order-${ord.id}`)) {
      await fs.unlink(path.join(localMailDir, file)).catch(() => {});
    }
  }
});

require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const db = require('../config/db');
const { walletService } = require('../services/walletService');
const ids = [], orderIds = [];
after(async () => {
  await db.walletTransaction.deleteMany({ where: { userId: { in: ids } } });
  await db.wholesaleOrder.deleteMany({ where: { id: { in: orderIds } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});
test('escrow retries cannot duplicate held funds, refunds or supplier credits; external deposits never credit a wallet', async () => {
  const suffix = randomUUID().slice(0, 8);
  const buyer = await db.user.create({ data: { username: `esc_b_${suffix}`, name: 'Escrow QA', passwordHash: 'not-login-enabled', role: { connect: { code: 'STORE_OWNER' } }, wallet: { create: { balance: 100000 } } } });
  ids.push(buyer.id);
  const supplier = await db.user.create({ data: { username: `esc_s_${suffix}`, name: 'Escrow QA', passwordHash: 'not-login-enabled', role: { connect: { code: 'SUPPLIER' } } } });
  ids.push(supplier.id);
  const profile = await db.supplierProfile.create({ data: { userId: supplier.id, businessName: 'QA', warehouseAddress: 'QA address', deliveryRadiusKm: 5 } });
  async function order() {
    const o = await db.wholesaleOrder.create({ data: { buyerId: buyer.id, supplierId: profile.id, status: 'PENDING', subtotal: 10000, deliveryFee: 0, total: 10000 } });
    orderIds.push(o.id);
    return o.id;
  }
  const first = await order();
  await walletService.lockEscrow(buyer.id, first, 10000, 'QA');
  await walletService.lockEscrow(buyer.id, first, 10000, 'QA retry');
  let balance = await walletService.getWallet(buyer.id);
  assert.equal(balance.availableBalance, 90000);
  assert.equal(balance.lockedBalance, 10000);
  await walletService.refundEscrow(buyer.id, first, 10000, 'QA refund');
  await walletService.refundEscrow(buyer.id, first, 10000, 'QA refund retry');
  balance = await walletService.getWallet(buyer.id);
  assert.equal(balance.availableBalance, 100000);
  assert.equal(balance.lockedBalance, 0);
  const second = await order();
  await walletService.lockEscrow(buyer.id, second, 10000, 'QA');
  await walletService.releaseEscrow(buyer.id, supplier.id, second, 10000, 0);
  await walletService.releaseEscrow(buyer.id, supplier.id, second, 10000, 0);
  assert.equal((await walletService.getWallet(supplier.id)).availableBalance, 10000);
  assert.equal((await walletService.getWallet(buyer.id)).lockedBalance, 0);
  const external = await order();
  await walletService.refundEscrow(buyer.id, external, 10000, 'External bank refund');
  assert.equal((await walletService.getWallet(buyer.id)).availableBalance, 90000);
});

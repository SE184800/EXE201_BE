require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { walletService, DEFAULT_MOCK_BALANCE } = require('../services/walletService');

test('wallet service: default mock balance is initialized', () => {
  const testUserId = 9999901;
  const wallet = walletService.getWallet(testUserId);
  assert.equal(wallet.userId, testUserId);
  assert.equal(wallet.availableBalance, DEFAULT_MOCK_BALANCE);
  assert.equal(wallet.lockedBalance, 0);
  assert.equal(wallet.totalBalance, DEFAULT_MOCK_BALANCE);
});

test('wallet service: add and reset mock balance', () => {
  const testUserId = 9999902;
  const initial = walletService.getWallet(testUserId);
  assert.equal(initial.availableBalance, DEFAULT_MOCK_BALANCE);

  const updated = walletService.addMockFunds(testUserId, 5000000);
  assert.equal(updated.availableBalance, DEFAULT_MOCK_BALANCE + 5000000);

  const reset = walletService.resetMockBalance(testUserId);
  assert.equal(reset.availableBalance, DEFAULT_MOCK_BALANCE);
  assert.equal(reset.lockedBalance, 0);
});

test('wallet service: escrow lock, release and refund', () => {
  const buyerId = 9999903;
  const supplierId = 9999904;
  const orderId = 12345;
  const depositAmount = 200000;

  walletService.resetMockBalance(buyerId, 1000000);
  walletService.resetMockBalance(supplierId, 0);

  // 1. Lock Escrow
  walletService.lockEscrow(buyerId, orderId, depositAmount, 'Cọc đơn hàng test');
  let buyerWallet = walletService.getWallet(buyerId);
  assert.equal(buyerWallet.availableBalance, 800000);
  assert.equal(buyerWallet.lockedBalance, depositAmount);
  assert.equal(buyerWallet.totalBalance, 1000000);

  // 2. Release Escrow to supplier
  walletService.releaseEscrow(buyerId, supplierId, orderId, depositAmount, 2);
  buyerWallet = walletService.getWallet(buyerId);
  assert.equal(buyerWallet.availableBalance, 800000);
  assert.equal(buyerWallet.lockedBalance, 0);

  const supplierWallet = walletService.getWallet(supplierId);
  // 200,000 - 2% (4,000) = 196,000
  assert.equal(supplierWallet.availableBalance, 196000);

  // 3. Test refund scenario
  const refundOrderId = 12346;
  walletService.lockEscrow(buyerId, refundOrderId, 100000, 'Cọc đơn hàng bị hủy');
  buyerWallet = walletService.getWallet(buyerId);
  assert.equal(buyerWallet.availableBalance, 700000);
  assert.equal(buyerWallet.lockedBalance, 100000);

  walletService.refundEscrow(buyerId, refundOrderId, 100000, 'Hoàn cọc');
  buyerWallet = walletService.getWallet(buyerId);
  assert.equal(buyerWallet.availableBalance, 800000);
  assert.equal(buyerWallet.lockedBalance, 0);
});

test('wallet service: lock fails on insufficient balance', () => {
  const buyerId = 9999905;
  walletService.resetMockBalance(buyerId, 50000);
  assert.throws(
    () => walletService.lockEscrow(buyerId, 999, 100000),
    /Số dư ví khả dụng không đủ/
  );
});

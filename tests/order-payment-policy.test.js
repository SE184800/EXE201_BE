const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paymentDue, fullyPaidByWallet } = require('../services/orderPaymentPolicy');
const order = { subtotal: 100000, deliveryFee: 10000, total: 110000, depositAmount: 20000, depositStatus: 'PAID', items: [{ productId: 1, productName: 'Milk', quantity: 2, unitPrice: 50000 }] };
test('server payment calculation handles confirmed deposits, damage and returns', () => {
  assert.equal(paymentDue(order), 90000);
  assert.equal(paymentDue({ ...order, depositStatus: 'PENDING' }), 110000);
  assert.equal(paymentDue(order, { incidentReport: { action: 'DEDUCT_COD', lossAmount: 30000 } }), 60000);
  assert.equal(paymentDue(order, { incidentReport: { action: 'DEDUCT_COD', damagedItems: [{ productId: 1, quantity: 1 }] } }), 40000);
  assert.throws(() => paymentDue(order, { incidentReport: { action: 'RETURN_ALL' } }), /trả lại/);
});
test('only full non-refunded wallet payments prevent collecting cash again', () => {
  assert.equal(fullyPaidByWallet({ ...order, orderPayment: { status: 'SETTLED', amount: 110000 } }), true);
  assert.equal(fullyPaidByWallet({ ...order, orderPayment: { status: 'SETTLED', amount: 1 } }), false);
  assert.equal(fullyPaidByWallet({ ...order, orderPayment: { status: 'SETTLED', amount: 110000, refund: {} } }), false);
});

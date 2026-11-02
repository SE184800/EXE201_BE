const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateDeliveryTime, pendingRequest } = require('../services/reschedulePolicy');
const now = new Date('2030-01-01T01:00:00Z');
test('delivery proposals require real dates, business hours, lead time and a bounded future', () => {
  assert.equal(validateDeliveryTime('10:00 ngày 01/01/2030', now), '10:00 ngày 01/01/2030');
  for (const value of ['08:30 ngày 01/01/2030', '18:00 ngày 02/01/2030', '10:00 ngày 31/02/2030', '10:00 ngày 01/01/2031', 'tomorrow', '24:00 ngày 02/01/2030']) {
    assert.throws(() => validateDeliveryTime(value, now));
  }
});
test('a newer proposal is independent of earlier accepted proposals', () => {
  const order = { note: '[YÊU CẦU DỜI LỊCH GIAO #1]: Hẹn lúc 10:00 ngày 01/01/2030 | [VỰA ĐÃ ĐỒNG Ý DỜI LỊCH GIAO]' };
  assert.equal(pendingRequest(order, null), null);
  assert.equal(pendingRequest(order, { rescheduleRequest: { status: 'PENDING', requestedTime: '12:00 ngày 02/01/2030' } }).requestedTime, '12:00 ngày 02/01/2030');
});

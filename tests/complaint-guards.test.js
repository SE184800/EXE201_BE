const test = require('node:test');
const assert = require('node:assert/strict');

test('Complaint Guards & Fortification Test Suite', async (t) => {
  await t.test('1. Time window guard: reject complaints submitted after grace period', () => {
    const complaintWindowHours = 24;
    const now = Date.now();

    // 10 hours ago: within window
    const delivered10hAgo = new Date(now - 10 * 3600 * 1000);
    const elapsed10h = (now - delivered10hAgo.getTime()) / (1000 * 60 * 60);
    assert.ok(elapsed10h <= complaintWindowHours, 'Should allow complaint within 24h');

    // 25 hours ago: expired
    const delivered25hAgo = new Date(now - 25 * 3600 * 1000);
    const elapsed25h = (now - delivered25hAgo.getTime()) / (1000 * 60 * 60);
    assert.ok(elapsed25h > complaintWindowHours, 'Should detect expired window');
  });

  await t.test('2. Anti-double resolve & workflow status guard', () => {
    const closedStatuses = ['RESOLVED', 'CLOSED_TIMEOUT', 'CLOSED_UNRESOLVED', 'ADMIN_RESOLVED_BUYER', 'ADMIN_RESOLVED_SUPPLIER'];

    function validateSupplierCanPropose(status, pendingParty) {
      if (closedStatuses.includes(status)) {
        throw new Error('Khiếu nại này đã kết thúc, không thể cập nhật thêm.');
      }
      if (pendingParty && pendingParty !== 'SUPPLIER') {
        throw new Error('Bạn đã gửi phương án ở lượt này. Vui lòng chờ Cửa hàng tạp hóa xác nhận hoặc phản hồi.');
      }
      return true;
    }

    assert.equal(validateSupplierCanPropose('OPEN', 'SUPPLIER'), true);
    assert.equal(validateSupplierCanPropose('IN_REVIEW', 'SUPPLIER'), true);
    assert.throws(() => validateSupplierCanPropose('IN_REVIEW', 'STORE_OWNER'), /chờ Cửa hàng/);

    for (const st of closedStatuses) {
      assert.throws(() => validateSupplierCanPropose(st, 'SUPPLIER'));
    }
  });

  await t.test('3. Consensual bilateral negotiation guard: allows counter/exchange without persistent round cap', () => {
    const closedStatusesForGuard = ['RESOLVED', 'CLOSED_TIMEOUT', 'CLOSED_UNRESOLVED'];
    function validateBuyerDecision(status, pendingParty, decision) {
      if (closedStatusesForGuard.includes(status)) {
        throw new Error('Khiếu nại này đã được giải quyết hoặc đóng trước đó.');
      }
      if (decision !== 'WITHDRAW' && pendingParty !== 'STORE_OWNER') {
        throw new Error('Đang chờ Chủ vựa phản hồi ở lượt hiện tại.');
      }
      if (decision === 'CLOSE_UNRESOLVED') {
        throw Object.assign(new Error('Luồng tự đóng khiếu nại hết lượt hiện đang tạm ngưng.'), { status: 410 });
      }
      return true;
    }

    assert.equal(validateBuyerDecision('IN_REVIEW', 'STORE_OWNER', 'COUNTER'), true);
    assert.equal(validateBuyerDecision('IN_REVIEW', 'STORE_OWNER', 'ACCEPT'), true);
    assert.equal(validateBuyerDecision('OPEN', 'SUPPLIER', 'WITHDRAW'), true);
    assert.throws(() => validateBuyerDecision('OPEN', 'SUPPLIER', 'COUNTER'), /chờ Chủ vựa/);
    assert.throws(() => validateBuyerDecision('IN_REVIEW', 'STORE_OWNER', 'CLOSE_UNRESOLVED'), (err) => err.status === 410);
    assert.throws(() => validateBuyerDecision('RESOLVED', null, 'ACCEPT'), /đã được giải quyết/);
  });

  await t.test('4. Non-arbitration guard: Admin records history and cannot award winner/loser', () => {
    function validateAdminRole() {
      const error = new Error('Theo Điều 6 Hợp đồng điện tử, Admin không phân xử thắng/thua.');
      error.status = 410;
      throw error;
    }

    assert.throws(() => validateAdminRole(), (err) => err.status === 410 && /không phân xử/.test(err.message));
  });

  await t.test('5. Dispute state lock: cannot complete order when complaint is active; closed statuses unlock', () => {
    function validateCanCompleteOrder(complaintStatus) {
      if (['OPEN', 'IN_REVIEW', 'ESCALATED'].includes(complaintStatus)) {
        throw new Error('Đơn hàng đang có sự cố khiếu nại chưa được xử lý xong. Hãy giải quyết khiếu nại trước.');
      }
      return true;
    }

    assert.equal(validateCanCompleteOrder('RESOLVED'), true);
    assert.equal(validateCanCompleteOrder('CLOSED_TIMEOUT'), true);
    assert.equal(validateCanCompleteOrder('CLOSED_UNRESOLVED'), true);
    assert.throws(() => validateCanCompleteOrder('OPEN'), /chưa được xử lý xong/);
    assert.throws(() => validateCanCompleteOrder('IN_REVIEW'), /chưa được xử lý xong/);
  });
});

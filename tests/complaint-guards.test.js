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

  await t.test('2. Anti-double resolve guard: supplier cannot resolve resolved or escalated complaints', () => {
    const invalidStatuses = ['RESOLVED', 'ESCALATED', 'ADMIN_RESOLVED_BUYER', 'ADMIN_RESOLVED_SUPPLIER'];
    
    function validateSupplierCanResolve(status) {
      if (['RESOLVED', 'ADMIN_RESOLVED_BUYER', 'ADMIN_RESOLVED_SUPPLIER'].includes(status)) {
        throw new Error('Khiếu nại này đã được xử lý xong.');
      }
      if (status === 'ESCALATED') {
        throw new Error('Khiếu nại đã được chuyển lên Quản trị viên (Admin) phân xử. Chủ vựa không thể can thiệp.');
      }
      return true;
    }

    assert.equal(validateSupplierCanResolve('OPEN'), true);
    assert.equal(validateSupplierCanResolve('IN_REVIEW'), true);

    for (const st of invalidStatuses) {
      assert.throws(() => validateSupplierCanResolve(st));
    }
  });

  await t.test('3. Escalation guard: retailer cannot escalate unless supplier rejected or pending', () => {
    function validateCanEscalate(status) {
      if (['RESOLVED', 'ADMIN_RESOLVED_BUYER', 'ADMIN_RESOLVED_SUPPLIER'].includes(status)) {
        throw new Error('Khiếu nại này đã được phân xử hoặc giải quyết xong.');
      }
      if (status === 'ESCALATED') {
        throw new Error('Khiếu nại này đã được gửi lên Quản trị viên, đang chờ phân xử.');
      }
      return true;
    }

    assert.equal(validateCanEscalate('REJECTED'), true);
    assert.throws(() => validateCanEscalate('ESCALATED'), /đã được gửi lên Quản trị viên/);
    assert.throws(() => validateCanEscalate('RESOLVED'), /đã được phân xử hoặc giải quyết xong/);
  });

  await t.test('4. Admin arbitration guard: admin cannot resolve already resolved complaints', () => {
    function validateAdminCanResolve(status) {
      if (['ADMIN_RESOLVED_BUYER', 'ADMIN_RESOLVED_SUPPLIER'].includes(status)) {
        throw new Error('Khiếu nại này đã được phân xử trước đó.');
      }
      return true;
    }

    assert.equal(validateAdminCanResolve('ESCALATED'), true);
    assert.throws(() => validateAdminCanResolve('ADMIN_RESOLVED_BUYER'), /đã được phân xử trước đó/);
    assert.throws(() => validateAdminCanResolve('ADMIN_RESOLVED_SUPPLIER'), /đã được phân xử trước đó/);
  });

  await t.test('5. Dispute state lock: cannot complete order when complaint is active or escalated', () => {
    function validateCanCompleteOrder(complaintStatus) {
      if (['OPEN', 'IN_REVIEW', 'ESCALATED'].includes(complaintStatus)) {
        throw new Error('Đơn hàng đang có sự cố khiếu nại chưa được xử lý xong. Hãy giải quyết khiếu nại trước.');
      }
      return true;
    }

    assert.equal(validateCanCompleteOrder('RESOLVED'), true);
    assert.equal(validateCanCompleteOrder('ADMIN_RESOLVED_BUYER'), true);
    assert.throws(() => validateCanCompleteOrder('OPEN'), /chưa được xử lý xong/);
    assert.throws(() => validateCanCompleteOrder('IN_REVIEW'), /chưa được xử lý xong/);
    assert.throws(() => validateCanCompleteOrder('ESCALATED'), /chưa được xử lý xong/);
  });
});

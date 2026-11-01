const test = require('node:test');
const assert = require('node:assert/strict');
const deliveryService = require('../services/deliveryService');

test('deliveryService: validation of driver inputs', () => {
  // Invalid phone
  let v = deliveryService.validateDriverInput({
    driverName: 'Nguyễn Văn Nam',
    driverPhone: '12345',
  });
  assert.equal(v.isValid, false);
  assert.ok(v.errors.some(e => e.includes('Số điện thoại')));

  // Invalid name
  v = deliveryService.validateDriverInput({
    driverName: 'N',
    driverPhone: '0912345678',
  });
  assert.equal(v.isValid, false);
  assert.ok(v.errors.some(e => e.includes('Họ tên')));

  // Valid input with all fields
  v = deliveryService.validateDriverInput({
    driverName: 'Nguyễn Văn Tuấn',
    driverPhone: '0912345678',
    vehicleType: 'Xe tải 1.5 tấn',
    licensePlate: '59-x1 888.99',
    estimatedDeliveryTime: 'Trong 45 phút tới',
    deliveryNotes: 'Giao tại cửa sau quầy tạp hoá',
  });
  assert.equal(v.isValid, true);
  assert.equal(v.data.driverName, 'Nguyễn Văn Tuấn');
  assert.equal(v.data.driverPhone, '0912345678');
  assert.equal(v.data.vehicleType, 'Xe tải 1.5 tấn');
  assert.equal(v.data.licensePlate, '59-X1 888.99');
  assert.equal(v.data.estimatedDeliveryTime, 'Trong 45 phút tới');
  assert.equal(v.data.deliveryNotes, 'Giao tại cửa sau quầy tạp hoá');
});

test('deliveryService: save and retrieve driver info for order', () => {
  const testOrderId = 999999;
  const saved = deliveryService.saveDriverInfo(testOrderId, {
    driverName: 'Lê Văn Tài',
    driverPhone: '0988776655',
    vehicleType: 'Xe ba gác',
    licensePlate: '51-T2 123.45',
    estimatedDeliveryTime: '14:30 - 15:00',
    deliveryNotes: 'Hàng nặng, cần người đỡ khi dỡ hàng',
  });

  assert.equal(saved.orderId, testOrderId);
  assert.equal(saved.driverName, 'Lê Văn Tài');
  assert.equal(saved.driverPhone, '0988776655');
  assert.ok(saved.assignedAt);
  assert.ok(saved.updatedAt);

  const retrieved = deliveryService.getDriverInfo(testOrderId);
  assert.deepEqual(retrieved, saved);

  // Clean up
  deliveryService.deleteDriverInfo(testOrderId);
  assert.equal(deliveryService.getDriverInfo(testOrderId), null);
});

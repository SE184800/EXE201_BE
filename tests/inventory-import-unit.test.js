const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePackaging, importBlockReason } = require('../services/inventorySyncService');

test('Inventory Import & Packaging Unit Test Suite', async (t) => {
  await t.test('1. parsePackaging - Happy cases with various standard Vietnamese containers', () => {
    // Format: "thùng 24 lon"
    const p1 = parsePackaging('thùng 24 lon');
    assert.equal(p1.container, 'thùng');
    assert.equal(p1.multiplier, 24);
    assert.equal(p1.retailUnit, 'lon');

    // Format: "két 20 chai"
    const p2 = parsePackaging('két 20 chai');
    assert.equal(p2.container, 'két');
    assert.equal(p2.multiplier, 20);
    assert.equal(p2.retailUnit, 'chai');

    // Format: "lốc 6 lon"
    const p3 = parsePackaging('lốc 6 lon');
    assert.equal(p3.container, 'lốc');
    assert.equal(p3.multiplier, 6);
    assert.equal(p3.retailUnit, 'lon');

    // Format: "bao 50 kg"
    const p4 = parsePackaging('bao 50 kg');
    assert.equal(p4.container, 'bao');
    assert.equal(p4.multiplier, 50);
    assert.equal(p4.retailUnit, 'kg');

    // Format: "24 lon / thùng"
    const p5 = parsePackaging('24 lon / thùng');
    assert.equal(p5.container, 'thùng');
    assert.equal(p5.multiplier, 24);
    assert.equal(p5.retailUnit, 'lon');

    // Format: "hộp 10 vỉ"
    const p6 = parsePackaging('hộp 10 vỉ');
    assert.equal(p6.container, 'hộp');
    assert.equal(p6.multiplier, 10);
    assert.equal(p6.retailUnit, 'vỉ');
  });

  await t.test('2. parsePackaging - Worst & Edge cases (Empty, undefined, missing unit, plain text)', () => {
    // Empty or null
    assert.deepEqual(parsePackaging(''), { container: 'cái', multiplier: 1, retailUnit: 'cái' });
    assert.deepEqual(parsePackaging(null), { container: 'cái', multiplier: 1, retailUnit: 'cái' });
    assert.deepEqual(parsePackaging(undefined), { container: 'cái', multiplier: 1, retailUnit: 'cái' });

    // Single item without container
    const plain = parsePackaging('cái');
    assert.equal(plain.container, 'cái');
    assert.equal(plain.multiplier, 1);
    assert.equal(plain.retailUnit, 'cái');

    // Just container name without numbers: "thùng"
    const thung = parsePackaging('thùng');
    assert.equal(thung.container, 'thùng');
    assert.equal(thung.multiplier, 1);
    assert.equal(thung.retailUnit, 'thùng');
  });

  await t.test('3. importBlockReason - Guards on Order Statuses and Incidents', () => {
    // Order in PENDING status cannot be imported
    const pendingOrder = { status: 'PENDING', inventoryImportedAt: null };
    assert.equal(importBlockReason(pendingOrder, null), 'Nhận và kiểm hàng trước khi nhập kho.');

    // Order in SHIPPING status cannot be imported
    const shippingOrder = { status: 'SHIPPING', inventoryImportedAt: null };
    assert.equal(importBlockReason(shippingOrder, null), 'Nhận và kiểm hàng trước khi nhập kho.');

    // Order with active OPEN complaint cannot be imported
    const complaintOrder = {
      status: 'DELIVERED',
      inventoryImportedAt: null,
      complaint: { status: 'OPEN' },
    };
    assert.equal(importBlockReason(complaintOrder, null), 'Cần xử lý xong khiếu nại trước khi thêm vào kho.');

    // Order with active IN_REVIEW complaint cannot be imported
    const reviewOrder = {
      status: 'DELIVERED',
      inventoryImportedAt: null,
      complaint: { status: 'IN_REVIEW' },
    };
    assert.equal(importBlockReason(reviewOrder, null), 'Cần xử lý xong khiếu nại trước khi thêm vào kho.');

    // Order with transit damaged items cannot be imported automatically without adjustment
    const damagedOrder = {
      status: 'DELIVERED',
      inventoryImportedAt: null,
    };
    const driverInfo = {
      incidentReport: {
        damagedItems: [{ productName: 'Coca-Cola', quantity: 2 }],
      },
    };
    assert.equal(importBlockReason(damagedOrder, driverInfo), 'Đơn có báo cáo hàng hỏng. Cần nhập theo số lượng thực nhận để tránh cộng cả hàng hỏng.');

    // Happy case: Delivered order with resolved complaint and no transit damage can be imported
    const validOrder = {
      status: 'DELIVERED',
      inventoryImportedAt: null,
      complaint: { status: 'RESOLVED' },
    };
    assert.equal(importBlockReason(validOrder, null), null);

    // Already imported order is not blocked by reason check
    const importedOrder = {
      status: 'DELIVERED',
      inventoryImportedAt: new Date(),
    };
    assert.equal(importBlockReason(importedOrder, null), null);
  });
});

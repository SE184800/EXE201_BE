const { test } = require('node:test');
const assert = require('node:assert/strict');
const consignmentService = require('../services/consignmentService');

test('consignmentService: set, get, remove item consignment', () => {
  const testItemId = 999999;
  consignmentService.setItemConsignment(testItemId, {
    isConsignment: true,
    settlementPrice: 15000,
    autoRestock: true,
    autoExchangeExpiry: true,
    supplierName: 'Đại lý Bánh kẹo Hải Hà',
  });

  const saved = consignmentService.getItemConsignment(testItemId);
  assert.ok(saved);
  assert.equal(saved.isConsignment, true);
  assert.equal(saved.settlementPrice, 15000);
  assert.equal(saved.supplierName, 'Đại lý Bánh kẹo Hải Hà');

  consignmentService.deleteItemConsignment(testItemId);
  const deleted = consignmentService.getItemConsignment(testItemId);
  assert.equal(deleted, null);
});

test('consignmentService: set and get quote consignment', () => {
  const testQuoteId = 888888;
  consignmentService.setQuoteConsignment(testQuoteId, {
    isConsignment: true,
    settlementPrice: 20000,
    autoRestock: true,
    autoExchangeExpiry: true,
  });

  const quoteData = consignmentService.getQuoteConsignment(testQuoteId);
  assert.ok(quoteData);
  assert.equal(quoteData.isConsignment, true);
  assert.equal(quoteData.settlementPrice, 20000);
});

test('consignmentService: request lifecycle (create -> dispatch -> complete)', () => {
  const req = consignmentService.createConsignmentRequest({
    storeId: 101,
    storeName: 'Tạp hóa Bác Ba',
    storePhone: '0901234567',
    storeAddress: '123 Đường Số 5, Q8',
    supplierId: 202,
    supplierName: 'Vựa Anh Bảy',
    itemId: 501,
    productName: 'Nước ép trái cây lên men',
    unit: 'thùng',
    type: 'EXCHANGE_EXPIRY',
    currentQty: 2,
    requestedQty: 5,
    expiryDate: '2026-11-05',
    note: 'Hàng còn 8 ngày hết hạn, cần đổi date mới gấp',
  });

  assert.ok(req.id.startsWith('CRQ-'));
  assert.equal(req.status, 'PENDING');
  assert.equal(req.type, 'EXCHANGE_EXPIRY');

  // Dispatch
  const dispatched = consignmentService.dispatchConsignmentRequest(req.id, {
    driverInfo: {
      driverName: 'Nguyễn Văn Tài',
      driverPhone: '0912345678',
      vehicleType: 'Xe ba gác',
      licensePlate: '59X1-12345',
      estimatedDeliveryTime: 'Hôm nay lúc 14:00',
    },
    newExpiryDate: '2027-05-15',
    supplierNotes: 'Đã chuẩn bị 5 thùng lô sản xuất mới nhất',
  });

  assert.equal(dispatched.status, 'DISPATCHED');
  assert.equal(dispatched.driverInfo.driverName, 'Nguyễn Văn Tài');
  assert.equal(dispatched.newExpiryDate, '2027-05-15');

  // Complete
  const completed = consignmentService.updateRequestStatus(req.id, 'COMPLETED');
  assert.equal(completed.status, 'COMPLETED');
});

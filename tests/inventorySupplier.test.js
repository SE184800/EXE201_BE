const test = require('node:test');
const assert = require('node:assert/strict');
const inventorySupplierService = require('../services/inventorySupplierService');
const { parseInventorySheetData } = require('../services/inventoryImport');

test('inventorySupplierService: set, get, delete supplier', () => {
  const testId = 888888;
  assert.equal(inventorySupplierService.getSupplier(testId), null);

  inventorySupplierService.setSupplier(testId, 'Vựa Nông Sản Miền Tây');
  assert.equal(inventorySupplierService.getSupplier(testId), 'Vựa Nông Sản Miền Tây');

  inventorySupplierService.setSupplier(testId, '  Đại lý cấp 1 Tân Bình  ');
  assert.equal(inventorySupplierService.getSupplier(testId), 'Đại lý cấp 1 Tân Bình');

  inventorySupplierService.deleteSupplier(testId);
  assert.equal(inventorySupplierService.getSupplier(testId), null);
});

test('inventoryImport: parses supplierName column from excel data', () => {
  const sheetData = [
    ['Tên sản phẩm', 'Đơn vị', 'Số lượng nhập', 'Giá nhập', 'Giá bán', 'Nhà cung cấp', 'Hạn sử dụng'],
    ['Nước ngọt Coca 330ml', 'Thùng', 10, 180000, 220000, 'Đại lý Nước giải khát Phát Đạt', '2027-12-31'],
    ['Bánh AFC Lúa Mì', 'Hộp', 24, 25000, 32000, 'Vựa Bánh Kẹo Hữu Nghị', ''],
  ];

  const parsed = parseInventorySheetData(sheetData);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].name, 'Nước ngọt Coca 330ml');
  assert.equal(parsed.rows[0].supplierName, 'Đại lý Nước giải khát Phát Đạt');
  assert.equal(parsed.rows[1].supplierName, 'Vựa Bánh Kẹo Hữu Nghị');
});

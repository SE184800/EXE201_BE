const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getStoreProfile, saveStoreProfile, validateStoreInput } = require('../services/storeService');

test('storeService: input validation', () => {
  // Empty inputs
  const emptyRes = validateStoreInput({});
  assert.ok(emptyRes.errors);
  assert.ok(emptyRes.errors.storeName);
  assert.ok(emptyRes.errors.storeAddress);

  // Address too short (< 10 chars)
  const shortAddress = validateStoreInput({
    storeName: 'Tạp hóa Bảy Hiền',
    storeAddress: '123 ĐS 4',
  });
  assert.ok(shortAddress.errors.storeAddress);

  // Invalid phone
  const invalidPhone = validateStoreInput({
    storeName: 'Tạp hóa Bảy Hiền',
    storeAddress: '123 Đường số 4, Bình Tân, TP.HCM',
    storePhone: '12345678',
  });
  assert.ok(invalidPhone.errors.storePhone);

  // Valid input
  const valid = validateStoreInput({
    storeName: 'Tạp Hóa Bảy Hiền',
    storeAddress: '123 Đường số 4, Phường Bình Trị Đông B, Quận Bình Tân, TP. Hồ Chí Minh',
    storePhone: '0908123456',
  });
  assert.ok(valid.data);
  assert.equal(valid.data.storeName, 'Tạp Hóa Bảy Hiền');
  assert.equal(valid.data.storePhone, '0908123456');
});

test('storeService: get and save store profile', () => {
  const testUserId = 9999;
  const initial = getStoreProfile(testUserId);
  assert.ok(initial);
  assert.equal(initial.userId, testUserId);
  assert.ok(initial.storeAddress);

  // Save new profile
  const saved = saveStoreProfile(testUserId, {
    storeName: 'Tạp Hóa Thành Công',
    storeAddress: '456 Lê Văn Sỹ, Phường 14, Quận 3, TP. Hồ Chí Minh',
    storePhone: '0912345678',
  });

  assert.equal(saved.storeName, 'Tạp Hóa Thành Công');
  assert.equal(saved.storeAddress, '456 Lê Văn Sỹ, Phường 14, Quận 3, TP. Hồ Chí Minh');
  assert.equal(saved.storePhone, '0912345678');

  // Verify fetch returns updated profile
  const fetched = getStoreProfile(testUserId);
  assert.equal(fetched.storeName, 'Tạp Hóa Thành Công');
  assert.equal(fetched.storeAddress, '456 Lê Văn Sỹ, Phường 14, Quận 3, TP. Hồ Chí Minh');
});

test('storeService: prevent duplicate storePhone and storeAddress across stores', () => {
  const anotherUser = 8888;

  // Trùng phone với user 1 ('0908123456')
  assert.throws(
    () => {
      saveStoreProfile(anotherUser, {
        storeName: 'Tạp Hóa ABC',
        storeAddress: '999 Hai Bà Trưng, Phường Tân Định, Quận 1, TP. Hồ Chí Minh',
        storePhone: '0908123456',
      });
    },
    (err) => {
      assert.ok(err.errors?.storePhone);
      assert.match(err.errors.storePhone, /đã được sử dụng bởi một tiệm tạp hóa khác/);
      return true;
    }
  );

  // Trùng address với user 1
  assert.throws(
    () => {
      saveStoreProfile(anotherUser, {
        storeName: 'Tạp Hóa ABC',
        storeAddress: '123 Đường Số 4, Phường Bình Trị Đông B, Quận Bình Tân, TP. Hồ Chí Minh',
        storePhone: '0933999888',
      });
    },
    (err) => {
      assert.ok(err.errors?.storeAddress);
      assert.match(err.errors.storeAddress, /đã được đăng ký bởi một tiệm tạp hóa khác/);
      return true;
    }
  );
});

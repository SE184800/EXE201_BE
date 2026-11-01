const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateOtp,
  hashOtp,
  createOtpToken,
  verifyOtpToken,
} = require('../services/otpService');

const secret = 'this_is_a_test_jwt_secret_with_32_characters_or_more';
const sampleRegistration = {
  name: 'Trần Văn Bình',
  username: 'tran.binh',
  email: 'binh@example.com',
  phone: '0901234567',
  role: 'STORE_OWNER',
  dateOfBirth: '2000-01-01',
  password: 'Password@2026',
};

test('generateOtp tạo mã 6 chữ số hợp lệ', () => {
  for (let i = 0; i < 20; i++) {
    const otp = generateOtp();
    assert.equal(otp.length, 6);
    assert.match(otp, /^\d{6}$/);
  }
});

test('hashOtp trả về mã SHA-256 nhất quán', () => {
  const hash1 = hashOtp('123456');
  const hash2 = hashOtp('123456');
  const hash3 = hashOtp('654321');
  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
});

test('createOtpToken và verifyOtpToken thành công khi đúng OTP', () => {
  const otp = '849201';
  const token = createOtpToken(sampleRegistration, otp, secret);
  assert.ok(typeof token === 'string');

  const verifiedData = verifyOtpToken(token, otp, secret);
  assert.deepEqual(verifiedData, sampleRegistration);
});

test('verifyOtpToken báo lỗi khi sai OTP', () => {
  const otp = '849201';
  const token = createOtpToken(sampleRegistration, otp, secret);

  assert.throws(
    () => verifyOtpToken(token, '999999', secret),
    (err) => err.code === 'OTP_MISMATCH' && err.status === 400
  );
});

test('verifyOtpToken báo lỗi khi token rỗng hoặc không hợp lệ', () => {
  assert.throws(
    () => verifyOtpToken('', '123456', secret),
    (err) => err.code === 'OTP_INVALID_TOKEN' && err.status === 400
  );
  assert.throws(
    () => verifyOtpToken('invalid.token.here', '123456', secret),
    (err) => err.code === 'OTP_INVALID_TOKEN' && err.status === 400
  );
});

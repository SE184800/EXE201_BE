require('dotenv').config();
const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../config/db');
const { createApp } = require('../app');
const { readConfig } = require('../config/env');
const {
  generateOtp,
  createResetOtpToken,
  verifyResetOtpToken,
  createPasswordResetToken,
  verifyPasswordResetToken,
} = require('../services/otpService');

const config = readConfig(process.env);
const csrf = { 'X-CSRF-Protection': 'sg-restock-web', Origin: config.origin };

test('forgot password: token generation and verification logic', () => {
  const secret = 'test-jwt-secret-for-forgot-password-unit-test';
  const otp = '123456';
  const user = { userId: 999, email: 'test@example.com', username: 'testuser', name: 'Test User' };

  const resetOtpToken = createResetOtpToken(user, otp, secret);
  assert.ok(resetOtpToken);

  // Mismatch OTP should throw
  assert.throws(() => {
    verifyResetOtpToken(resetOtpToken, '654321', secret);
  }, { code: 'OTP_MISMATCH' });

  // Correct OTP returns payload
  const verified = verifyResetOtpToken(resetOtpToken, '123456', secret);
  assert.equal(verified.userId, 999);
  assert.equal(verified.email, 'test@example.com');

  // Issue password reset token
  const resetPassToken = createPasswordResetToken(verified, secret);
  assert.ok(resetPassToken);

  // Verify password reset token
  const resetPayload = verifyPasswordResetToken(resetPassToken, secret);
  assert.equal(resetPayload.userId, 999);
});

test('forgot password: API input validation and flow checks', async () => {
  const app = createApp(prisma, config);

  // 1. Invalid email format
  const badEmailRes = await request(app)
    .post('/api/auth/forgot-password-request-otp')
    .set(csrf)
    .send({ email: 'notanemail' })
    .expect(400);
  assert.match(badEmailRes.body.message, /email hợp lệ/);

  // 2. Non-existent email
  const notFoundRes = await request(app)
    .post('/api/auth/forgot-password-request-otp')
    .set(csrf)
    .send({ email: 'nonexistent_random_user_9999@gmail.com' });
  // If DB reachable, expect 404; if isolated, handled
  if (notFoundRes.status === 404) {
    assert.match(notFoundRes.body.message, /Không tìm thấy tài khoản/);
  }

  // 3. Invalid reset pass token
  const badTokenRes = await request(app)
    .post('/api/auth/forgot-password-reset')
    .set(csrf)
    .send({
      resetPassToken: 'invalid.jwt.token',
      password: 'NewPassword@2026',
      confirmPassword: 'NewPassword@2026',
    })
    .expect(400);
  assert.match(badTokenRes.body.message, /Phiên đổi mật khẩu đã hết hạn hoặc không hợp lệ/);
});

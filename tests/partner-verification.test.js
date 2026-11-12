const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const storeService = require('../services/storeService');
const { getOrCreateUserContract, getContractByUserId } = require('../services/contractService');
const { createContractRoutes } = require('../routes/contractRoutes');
const { sendPrivateKeyEmail, maskPrivateKey } = require('../services/contractMailService');
const {
  sendVerificationApprovedEmail,
  sendVerificationRejectedEmail,
} = require('../services/verificationMailService');

describe('Partner Verification & Email Flow Tests', () => {
  const testIds = [99996, 99997, 99998, 99999];

  after(() => {
    for (const id of testIds) {
      storeService.deleteStoreProfile(id);
    }
  });

  it('1. Store Profile lifecycle: DRAFT -> Contract Signing (PENDING) -> REJECTED -> Resubmit (PENDING) -> APPROVED', () => {
    const testUserId = 99998;
    storeService.deleteStoreProfile(testUserId);

    const initial = storeService.getStoreProfile(testUserId, '0912345678');
    assert.equal(initial.verificationStatus, 'DRAFT', 'New store should default to DRAFT');

    const saved = storeService.saveStoreProfile(testUserId, {
      storeName: 'Tiệm Tạp Hóa Hoa Sen',
      storeAddress: '456 Lê Văn Sỹ, Phường 12, Quận 3, TP. Hồ Chí Minh',
      storePhone: '0912345678',
      taxCode: '0398765432',
      businessType: 'Tạp hóa tổng hợp',
      locationType: 'STREET_FRONT',
      bankName: 'Vietcombank',
      bankAccountNumber: '1234567890',
      bankAccountHolder: 'NGUYEN VAN B',
    });
    assert.equal(saved.verificationStatus, 'DRAFT', 'Saved store before contract signing remains DRAFT');

    // DRAFT cannot be approved or rejected directly
    assert.throws(
      () => storeService.updateStoreVerification(testUserId, { status: 'APPROVED', note: null, actorId: 1, expectedVersion: saved.verificationVersion }),
      /Đang chờ duyệt hoặc Cần điều chỉnh/
    );

    const afterSigning = storeService.setStoreContractSigned(testUserId);
    assert.equal(afterSigning.verificationStatus, 'PENDING', 'Contract signing transitions profile to PENDING');
    assert.ok(afterSigning.submittedAt, 'submittedAt timestamp should be set');

    const rejected = storeService.updateStoreVerification(testUserId, {
      status: 'REJECTED',
      note: 'Mã số thuế không trùng khớp',
      actorId: 1,
      expectedVersion: afterSigning.verificationVersion,
    });
    assert.equal(rejected.verificationStatus, 'REJECTED', 'Status should be REJECTED (Cần điều chỉnh)');
    assert.equal(rejected.verificationNote, 'Mã số thuế không trùng khớp');

    const resubmitted = storeService.saveStoreProfile(testUserId, {
      storeName: 'Tiệm Tạp Hóa Hoa Sen',
      storeAddress: '456 Lê Văn Sỹ, Phường 12, Quận 3, TP. Hồ Chí Minh',
      storePhone: '0912345678',
      taxCode: '0398765432-001',
      businessType: 'Tạp hóa tổng hợp',
      locationType: 'STREET_FRONT',
      bankName: 'Vietcombank',
      bankAccountNumber: '1234567890',
      bankAccountHolder: 'NGUYEN VAN B',
      resubmit: true,
    });
    assert.equal(resubmitted.verificationStatus, 'PENDING', 'Resubmitted profile returns to PENDING');
    assert.equal(resubmitted.verificationNote, null, 'Previous rejection note should be cleared');
    assert.ok(resubmitted.verificationVersion > rejected.verificationVersion, 'Version should increment');

    const approved = storeService.updateStoreVerification(testUserId, {
      status: 'APPROVED',
      note: null,
      actorId: 1,
      expectedVersion: resubmitted.verificationVersion,
    });
    assert.equal(approved.verificationStatus, 'APPROVED', 'Status should be APPROVED (Đã xác minh)');
    assert.equal(approved.verificationNote, null, 'Approved profile must not carry a note');

    // APPROVED cannot be re-reviewed
    assert.throws(
      () => storeService.updateStoreVerification(testUserId, { status: 'REJECTED', note: 'Test', actorId: 1, expectedVersion: approved.verificationVersion }),
      /Đang chờ duyệt hoặc Cần điều chỉnh/
    );
  });

  it('2. Verification Mail Service - Approval and Rejection email notifications with required summaries', async () => {
    const approvedResult = await sendVerificationApprovedEmail({
      to: 'taphoa.test@supplymind.local',
      recipientName: 'Tiệm Tạp Hóa An Khang',
      roleLabel: 'Chủ tạp hóa',
    });
    assert.equal(approvedResult.sent, true, 'Approval email should be processed');
    assert.ok(
      approvedResult.subject.includes('Đơn của bạn đã được xử lý'),
      'Approval email subject must match'
    );
    assert.ok(
      approvedResult.text.includes('Đơn của bạn đã được admin phê duyệt. Chào mừng đến nền tảng SupplyMind AI.'),
      'Approval email must contain updated summary text'
    );

    const rejectedResult = await sendVerificationRejectedEmail({
      to: 'taphoa.test@supplymind.local',
      recipientName: 'Tiệm Tạp Hóa An Khang',
      roleLabel: 'Chủ tạp hóa',
      reason: 'Mã số thuế không trùng khớp',
    });
    assert.equal(rejectedResult.sent, true, 'Rejection email should be processed');
    assert.ok(
      rejectedResult.subject.includes('Đơn của bạn đã được giải quyết'),
      'Rejection email subject must match'
    );
    assert.ok(
      rejectedResult.text.includes('Đơn của bạn đã bị từ chối.'),
      'Rejection email must contain summary text'
    );
    assert.ok(
      rejectedResult.text.includes('CẦN ĐIỀU CHỈNH'),
      'Rejection email must reference CẦN ĐIỀU CHỈNH status'
    );
    assert.ok(
      rejectedResult.text.includes('Mã số thuế không trùng khớp'),
      'Rejection email must contain rejection reason'
    );
  });

  it('3. Optimistic Concurrency Control & Duplicate checks across configured stores', () => {
    const testUserId = 99997;
    const dupUserId = 99996;
    storeService.deleteStoreProfile(testUserId);
    storeService.deleteStoreProfile(dupUserId);

    const saved = storeService.saveStoreProfile(testUserId, {
      storeName: 'Tiệm Tạp Hóa Test Concurrency',
      storeAddress: '789 Nguyễn Đình Chiểu, Phường 1, Quận 3, TP. Hồ Chí Minh',
      storePhone: '0988776655',
      taxCode: '0311223344',
      businessType: 'Tạp hóa tổng hợp',
      locationType: 'STREET_FRONT',
      bankName: 'Vietcombank',
      bankAccountNumber: '9988776655',
      bankAccountHolder: 'NGUYEN VAN C',
    });

    assert.throws(
      () => {
        storeService.updateStoreVerification(testUserId, {
          status: 'APPROVED',
          note: null,
          actorId: 1,
          expectedVersion: saved.verificationVersion + 99,
        });
      },
      /Hồ sơ đã thay đổi/,
      'Should reject review with stale version'
    );

    assert.throws(
      () => {
        storeService.saveStoreProfile(dupUserId, {
          storeName: 'Tiệm Trùng Số Tài Khoản',
          storeAddress: '999 Nguyễn Thị Minh Khai, Phường 5, Quận 3, TP. Hồ Chí Minh',
          storePhone: '0988776644',
          taxCode: '0311223355',
          businessType: 'Tạp hóa tổng hợp',
          locationType: 'STREET_FRONT',
          bankName: 'ACB',
          bankAccountNumber: '9988776655',
          bankAccountHolder: 'NGUYEN VAN D',
        });
      },
      (err) => Boolean(err?.errors?.bankAccountNumber),
      'Should block duplicate bankAccountNumber across configured stores including DRAFT'
    );
  });

  it('4. Contract my-contract omits rawPrivateKey & reveal-key verifies signed email token', async () => {
    const userId = 99999;
    const mockUser = { id: userId, username: `verify_contract_${userId}`, name: 'Test Owner', phone: '0909111222', role: 'STORE_OWNER' };
    const contract = getOrCreateUserContract(mockUser, {
      storeName: 'Tạp Hóa Hợp Đồng',
      storePhone: '0909111222',
      taxCode: '0399998888',
      storeAddress: '100 Điện Biên Phủ, Quận Bình Thạnh, TP.HCM',
    });

    const masked = maskPrivateKey(contract.rawPrivateKey);
    assert.ok(masked.includes('•'), 'Masked key should hide middle characters');
    assert.ok(!masked.includes(contract.rawPrivateKey), 'Masked key must not equal full key');

    const jwtSecret = 'test-contract-key-secret-value-123456';
    const mailResult = await sendPrivateKeyEmail({
      to: 'contract.test@supplymind.local',
      user: mockUser,
      contract,
      config: { jwtSecret, origin: 'http://localhost:5173' },
    });
    assert.ok(mailResult);

    const token = jwt.sign(
      { purpose: 'contract-key-reveal', contractNumber: contract.contractNumber },
      jwtSecret,
      { algorithm: 'HS256', issuer: 'sg-restock-api', audience: 'sg-restock-contract-key', subject: String(userId), expiresIn: '1h' }
    );

    const app = express();
    app.use('/api/contracts', createContractRoutes(
      { store: {} },
      (req, _res, next) => { req.auth = { user: mockUser }; next(); },
      { jwtSecret, origin: 'http://localhost:5173' }
    ));

    const myRes = await request(app).get('/api/contracts/my-contract').expect(200);
    assert.equal(myRes.body.contract.rawPrivateKey, undefined, 'GET /my-contract must omit rawPrivateKey');

    const revealRes = await request(app).get(`/api/contracts/reveal-key?token=${encodeURIComponent(token)}`).expect(200);
    assert.equal(revealRes.body.rawPrivateKey, contract.rawPrivateKey);
    assert.equal(revealRes.body.maskedPrivateKey, masked);
    assert.equal(revealRes.body.contractNumber, contract.contractNumber);

    await request(app).get('/api/contracts/reveal-key?token=invalid').expect(401);
    const stored = getContractByUserId(userId);
    assert.ok(stored);
  });
});

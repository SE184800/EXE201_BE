const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const storeService = require('../services/storeService');
const {
  sendVerificationApprovedEmail,
  sendVerificationRejectedEmail,
} = require('../services/verificationMailService');

describe('Partner Verification & Email Flow Tests', () => {
  it('1. Store Profile lifecycle: DRAFT -> Contract Signing (PENDING) -> REJECTED -> Resubmit (PENDING) -> APPROVED', () => {
    const testUserId = 99998;
    storeService.deleteStoreProfile(testUserId);

    // Initially unconfigured or new store
    const initial = storeService.getStoreProfile(testUserId, '0912345678');
    assert.equal(initial.verificationStatus, 'DRAFT', 'New store should default to DRAFT');

    // Onboarding save before signing contract
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

    // Contract signing transitions status to PENDING
    const afterSigning = storeService.setStoreContractSigned(testUserId);
    assert.equal(afterSigning.verificationStatus, 'PENDING', 'Contract signing transitions profile to PENDING');
    assert.ok(afterSigning.submittedAt, 'submittedAt timestamp should be set');

    // Admin rejects with reason
    const rejected = storeService.updateStoreVerification(testUserId, {
      status: 'REJECTED',
      note: 'Mã số thuế không trùng khớp',
      actorId: 1,
      expectedVersion: afterSigning.verificationVersion,
    });
    assert.equal(rejected.verificationStatus, 'REJECTED', 'Status should be REJECTED (Cần bổ sung)');
    assert.equal(rejected.verificationNote, 'Mã số thuế không trùng khớp');

    // Store Owner resubmits updated information
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

    // Admin approves
    const approved = storeService.updateStoreVerification(testUserId, {
      status: 'APPROVED',
      note: 'Hồ sơ hợp lệ, đã xác nhận phê duyệt.',
      actorId: 1,
      expectedVersion: resubmitted.verificationVersion,
    });
    assert.equal(approved.verificationStatus, 'APPROVED', 'Status should be APPROVED (Đã xác minh)');
  });

  it('2. Verification Mail Service - Approval and Rejection email notifications with required summaries', async () => {
    const approvedResult = await sendVerificationApprovedEmail({
      to: 'taphoa.test@supplymind.local',
      recipientName: 'Tiệm Tạp Hóa An Khang',
      roleLabel: 'Chủ tạp hóa',
    });
    assert.equal(approvedResult.sent, true, 'Approval email should be processed');
    assert.ok(
      approvedResult.text.includes('đơn của bạn đã được xử lý, vui lòng kiểm tra') ||
      approvedResult.text.includes('Đơn của bạn đã được xử lý, vui lòng kiểm tra'),
      'Approval email must contain summary text "đơn của bạn đã được xử lý, vui lòng kiểm tra"'
    );

    const rejectedResult = await sendVerificationRejectedEmail({
      to: 'taphoa.test@supplymind.local',
      recipientName: 'Tiệm Tạp Hóa An Khang',
      roleLabel: 'Chủ tạp hóa',
      reason: 'Mã số thuế không trùng khớp',
    });
    assert.equal(rejectedResult.sent, true, 'Rejection email should be processed');
    assert.ok(
      rejectedResult.text.includes('đơn của bạn đã bị từ chối cùng lý do') ||
      rejectedResult.text.includes('Đơn của bạn đã bị từ chối cùng lý do'),
      'Rejection email must contain summary text'
    );
    assert.ok(
      rejectedResult.text.includes('Mã số thuế không trùng khớp'),
      'Rejection email must contain rejection reason'
    );
  });

  it('3. Optimistic Concurrency Control in Store verification', () => {
    const testUserId = 99997;
    storeService.getStoreProfile(testUserId, '0988776655');
    const saved = storeService.saveStoreProfile(testUserId, {
      storeName: 'Tiệm Tạp Hóa Test Concurrency',
      storeAddress: '789 Nguyễn Đình Chiểu, Phường 1, Quận 3, TP. Hồ Chí Minh',
      storePhone: '0988776655',
      taxCode: '0311223344',
      businessType: 'Tạp hóa tổng hợp',
      locationType: 'STREET_FRONT',
    });

    assert.throws(
      () => {
        storeService.updateStoreVerification(testUserId, {
          status: 'APPROVED',
          note: 'Ok',
          actorId: 1,
          expectedVersion: saved.verificationVersion + 99,
        });
      },
      /Hồ sơ đã thay đổi/,
      'Should reject review with stale version'
    );
  });
});

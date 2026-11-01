const test = require('node:test');
const assert = require('node:assert/strict');
const systemConfigService = require('../services/systemConfigService');
const { moderateContent } = require('../services/contentModerationService');

test('systemConfig: get, update, addKeyword, removeKeyword, and reset', async (t) => {
  // Reset initially
  const initial = systemConfigService.resetConfig('TEST_ACTOR');
  assert.equal(initial.aiModeration.autoModerationEnabled, true);
  assert.equal(initial.escrowDeposit.defaultDepositRate, 10);

  // Add custom forbidden keyword
  systemConfigService.addKeyword('forbidden', 'thuốc kích dục lạ');
  let config = systemConfigService.getConfig();
  assert.ok(config.aiModeration.criticalForbiddenKeywords.includes('thuốc kích dục lạ'));

  // Moderation should catch the newly added keyword as critical
  let modResult = await moderateContent({
    name: 'Sản phẩm thuốc kích dục lạ cực mạnh',
    category: 'Thực phẩm',
    packaging: 'Hộp',
    wholesalePrice: 50000,
    moq: 10,
  });
  assert.equal(modResult.status, 'AUTO_REJECTED');
  assert.ok(modResult.criticalReasons.some(r => r.includes('thuốc kích dục lạ')));

  // Remove the keyword
  systemConfigService.removeKeyword('forbidden', 'thuốc kích dục lạ');
  config = systemConfigService.getConfig();
  assert.ok(!config.aiModeration.criticalForbiddenKeywords.includes('thuốc kích dục lạ'));

  // Update escrow settings
  systemConfigService.updateConfig('TEST_ACTOR', {
    escrowDeposit: {
      defaultDepositRate: 20,
      maxDepositRate: 40,
    },
    aiModeration: {
      strictness: 'STRICT',
      minSuspiciousPrice: 1000,
    },
  });

  config = systemConfigService.getConfig();
  assert.equal(config.escrowDeposit.defaultDepositRate, 20);
  assert.equal(config.escrowDeposit.maxDepositRate, 40);
  assert.equal(config.aiModeration.strictness, 'STRICT');
  assert.equal(config.aiModeration.minSuspiciousPrice, 1000);

  // Price below new minSuspiciousPrice (1000) should be flagged
  modResult = await moderateContent({
    name: 'Nước ngọt giải khát xá xị',
    category: 'Nước giải khát',
    packaging: 'Thùng',
    wholesalePrice: 800,
    moq: 10,
  });
  assert.equal(modResult.isClean, false);
  assert.ok(modResult.criticalReasons.some(r => r.includes('dưới ngưỡng tối thiểu sàn (1.000đ)')));

  // Test toggle autoModerationEnabled = false
  systemConfigService.updateConfig('TEST_ACTOR', {
    aiModeration: { autoModerationEnabled: false },
  });
  modResult = await moderateContent({
    name: 'Sản phẩm vũ khí súng đạn',
    wholesalePrice: 100,
    moq: 1,
  });
  assert.equal(modResult.status, 'AUTO_APPROVED');
  assert.equal(modResult.disabled, true);

  // Restore clean default
  systemConfigService.resetConfig('TEST_ACTOR');
  config = systemConfigService.getConfig();
  assert.equal(config.aiModeration.autoModerationEnabled, true);
  assert.equal(config.escrowDeposit.defaultDepositRate, 10);
});

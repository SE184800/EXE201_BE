const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTaxCodeChecksum, lookupTaxCode } = require('../services/taxService');
const { getOrCreateUserContract, signContract } = require('../services/contractService');

test('Tax Service: validate real Vinamilk tax code and fake tax code', async () => {
  const vinamilk = validateTaxCodeChecksum('0300588569');
  assert.equal(vinamilk.valid, true);
  assert.equal(vinamilk.provinceName, 'TP. Hồ Chí Minh');

  const sabeco = validateTaxCodeChecksum('0300583659');
  assert.equal(sabeco.valid, true);

  const fake = validateTaxCodeChecksum('1234567890');
  assert.equal(fake.valid, false);

  const lookupVinamilk = await lookupTaxCode('0300588569');
  assert.equal(lookupVinamilk.verified, true);
  assert.match(lookupVinamilk.data.businessName, /VINAMILK/);

  const lookupSabeco = await lookupTaxCode('0300583659');
  assert.equal(lookupSabeco.verified, true);
  assert.match(lookupSabeco.data.businessName, /SABECO/);
});

test('Contract Service: sign contract using VNeID Level 2', () => {
  const testUserId = 880000 + Math.floor(Math.random() * 100000);
  const dummyUser = { id: testUserId, username: `user_${testUserId}`, name: 'Nguyễn Văn Test', phone: '0901234567' };
  const contract = getOrCreateUserContract(dummyUser, { storeName: 'Tạp Hóa Test', storeAddress: '123 Đường Test' });
  assert.equal(contract.isSigned, false);

  const signed = signContract(dummyUser.id, { method: 'VNEID' }, true, { ip: '1.2.3.4' });
  assert.equal(signed.isSigned, true);
  assert.equal(signed.signingMethod, 'VNEID');
  assert.match(signed.stamp.signingMethod, /VNeID/);
  assert.match(signed.stamp.authority, /C06/);
});

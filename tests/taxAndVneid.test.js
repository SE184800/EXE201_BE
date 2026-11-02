const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupTaxCode } = require('../services/taxService');
const { getOrCreateUserContract, signContract, getContractByUserId } = require('../services/contractService');
test('tax numbers never imply a verified registered business without a provider', async () => {
  for (const code of ['0300588569', '0317892345', '1234567890']) {
    const result = await lookupTaxCode(code);
    assert.equal(result.verified, false);
    assert.equal(result.formatValid, true);
    assert.equal(result.data.businessName, '');
    assert.equal(result.data.address, '');
  }
  await assert.rejects(lookupTaxCode('abc'), error => error.status === 400);
});
test('VNeID cannot sign on client-supplied evidence without a provider', () => {
  const id = 880000 + Math.floor(Math.random() * 100000);
  const contract = getOrCreateUserContract({ id, username: 'test_' + id, name: 'Test' }, { storeName: 'Test store', storeAddress: 'Test address' });
  assert.equal(contract.isSigned, false);
  assert.throws(() => signContract(id, { method: 'VNEID', vneidData: { level: 2, verifiedAt: new Date().toISOString() } }, true), error => error.status === 503);
  assert.equal(getContractByUserId(id).isSigned, false);
  assert.throws(() => signContract(id, { method: 'UNKNOWN' }, true), error => error.status === 400);
});

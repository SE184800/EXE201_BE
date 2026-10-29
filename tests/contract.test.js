const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getOrCreateUserContract,
  signContract,
  getContractByUserId,
  getCanonicalContractText,
} = require('../services/contractService');

test('contractService: generate contract with keys and sign successfully', () => {
  const userId = Math.floor(Math.random() * 900000) + 100000;
  const mockUser = {
    id: userId,
    username: `test_store_${userId}`,
    name: 'Nguyen Van Test',
    phone: '0901234567',
    role: 'STORE_OWNER',
  };

  const mockStore = {
    storeName: `Tap Hoa Test ${userId}`,
    storePhone: '0901234567',
    taxCode: '0399887766',
    storeAddress: '888 Đường Nguyễn Trãi, Quận 5, TP.HCM',
    latitude: 10.75,
    longitude: 106.66,
  };

  const contract = getOrCreateUserContract(mockUser, mockStore);
  assert.equal(contract.userId, userId);
  assert.equal(contract.isSigned, false);
  assert.ok(contract.publicKey.includes('BEGIN PUBLIC KEY'));
  assert.ok(contract.privateKey.includes('BEGIN PRIVATE KEY'));
  assert.ok(contract.contractNumber.startsWith('SM-HD-2026-'));

  // Test 1: Sign without agreeing to terms fails
  assert.throws(
    () => signContract(userId, contract.privateKey, false),
    /đồng ý với tất cả điều khoản/
  );

  // Test 2: Sign with invalid private key fails
  assert.throws(
    () => signContract(userId, 'invalid_key_string', true),
    /không đúng định dạng/
  );

  // Test 3: Sign with valid raw base64 key succeeds
  const signedContract = signContract(userId, contract.rawPrivateKey, true, { ip: '127.0.0.1' });
  assert.equal(signedContract.isSigned, true);
  assert.ok(signedContract.contractHash);
  assert.equal(signedContract.contractHash.length, 64); // SHA-256 hex is 64 chars
  assert.ok(signedContract.signature);
  assert.ok(signedContract.stamp);
  assert.equal(signedContract.stamp.status, 'VERIFIED_VALID');

  // Test 4: Can retrieve signed contract
  const retrieved = getContractByUserId(userId);
  assert.equal(retrieved.isSigned, true);
  assert.equal(retrieved.contractHash, signedContract.contractHash);
});

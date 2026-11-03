const { test } = require('node:test');
const assert = require('node:assert/strict');
const { commands } = require('../scripts/build-vercel');

test('production deployment migrates before publishing and rejects missing DB config', () => {
  assert.throws(() => commands({ VERCEL_ENV: 'production' }), /DATABASE_URL/);
  assert.deepEqual(commands({ VERCEL_ENV: 'production', DATABASE_URL: 'test-only' }), [['generate'], ['migrate', 'deploy']]);
});

test('preview and local builds never migrate the shared production database', () => {
  for (const env of [{}, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }]) {
    assert.deepEqual(commands(env), [['generate']]);
  }
});

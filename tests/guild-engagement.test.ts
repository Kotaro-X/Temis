import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { requireGuildViewer } = require('../functions/guildEngagementCore.cjs');
test('engagement callables require authentication and preserve the expiring test-operator boundary', () => {
  for (const request of [{}, { auth: { uid: 'alice', token: { firebase: { sign_in_provider: 'anonymous' } } } }]) {
    assert.throws(() => requireGuildViewer(request, 'temis-test-c05aa', 1000), { code: 'unauthenticated' });
  }
  const auth = { uid: 'alice', token: { firebase: { sign_in_provider: 'custom' }, testOperator: true, testOperatorExpiresAt: 2 } };
  assert.equal(requireGuildViewer({ auth }, 'temis-test-c05aa', 1000), 'alice');
  for (const patch of [{ testOperator: false }, { testOperatorExpiresAt: 1 }, { testOperatorExpiresAt: '2' }, { testOperatorExpiresAt: NaN }]) {
    assert.throws(() => requireGuildViewer({ auth: { ...auth, token: { ...auth.token, ...patch } } }, 'temis-test-c05aa', 1000), { code: 'permission-denied' });
  }
  assert.equal(requireGuildViewer({ auth: { uid: 'alice', token: { firebase: { sign_in_provider: 'google.com' } } } }, 'temis-c05aa', 1000), 'alice');
});

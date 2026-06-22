import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';

function base64UrlToBuffer(value) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

test('hash password script emits a Worker-compatible PBKDF2 hash', async () => {
  const password = 'correct-password';
  const { HASH_ITERATIONS, hashPassword } = await import('../scripts/hash-password.mjs');
  const salt = Buffer.from('test-salt');
  const output = hashPassword(password, salt);
  const [algorithm, iterations, saltValue, hashValue] = output.split('$');

  assert.equal(algorithm, 'pbkdf2_sha256');
  assert.equal(HASH_ITERATIONS, 100000);
  assert.equal(Number(iterations), 100000);

  const expected = pbkdf2Sync(password, base64UrlToBuffer(saltValue), Number(iterations), 32, 'sha256');
  assert.equal(base64UrlToBuffer(hashValue).toString('hex'), expected.toString('hex'));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyGoogleIdToken } from '../../../src/lib/google-auth';
import { jsonResponse } from '../../helpers/response';

const encodePart = (payload: object) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

test('rejects malformed token', async () => {
  await assert.rejects(() => verifyGoogleIdToken('bad', 'aud'), /Некорректный/);
});

test('rejects unsupported algorithm', async () => {
  const token = `${encodePart({ alg: 'HS256' })}.${encodePart({ aud: 'aud', iss: 'accounts.google.com', exp: 999999 })}.sig`;
  await assert.rejects(() => verifyGoogleIdToken(token, 'aud'), /Неподдерживаемый/);
});

test('rejects invalid issuer', async () => {
  const token = `${encodePart({ alg: 'RS256' })}.${encodePart({ aud: 'aud', iss: 'issuer', exp: 999999 })}.sig`;
  await assert.rejects(() => verifyGoogleIdToken(token, 'aud'), /issuer/);
});

test('rejects wrong audience', async () => {
  const token = `${encodePart({ alg: 'RS256' })}.${encodePart({ aud: 'other', iss: 'accounts.google.com', exp: 999999 })}.sig`;
  await assert.rejects(() => verifyGoogleIdToken(token, 'aud'), /другого приложения/);
});

test('rejects expired token', async () => {
  const token = `${encodePart({ alg: 'RS256' })}.${encodePart({ aud: 'aud', iss: 'accounts.google.com', exp: 1 })}.sig`;
  await assert.rejects(() => verifyGoogleIdToken(token, 'aud'), /истёк/);
});

test('verifies token with stubbed crypto and certs', async () => {
  const originalFetch = (globalThis as any).fetch;
  const originalImportKey = globalThis.crypto.subtle.importKey;
  const originalVerify = globalThis.crypto.subtle.verify;

  (globalThis as any).fetch = async () =>
    jsonResponse({
      keys: [
        { kid: 'k1', kty: 'RSA', e: 'AQAB', n: 'test', alg: 'RS256' },
      ],
    }, { headers: { 'cache-control': 'max-age=3600' } });

  globalThis.crypto.subtle.importKey = async () => ({}) as CryptoKey;
  globalThis.crypto.subtle.verify = async () => true;

  try {
    const header = encodePart({ alg: 'RS256', kid: 'k1' });
    const payload = encodePart({ aud: 'aud', iss: 'accounts.google.com', exp: Math.floor(Date.now() / 1000) + 300 });
    const token = `${header}.${payload}.sig`;
    const result = await verifyGoogleIdToken(token, 'aud');
    assert.equal(result.aud, 'aud');
  } finally {
    (globalThis as any).fetch = originalFetch;
    globalThis.crypto.subtle.importKey = originalImportKey;
    globalThis.crypto.subtle.verify = originalVerify;
  }
});

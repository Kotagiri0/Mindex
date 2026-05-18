import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateResponse } from '../../../src/lib/groq';
import { installDomStubs } from '../../helpers/dom';
import { jsonResponse, textResponse } from '../../helpers/response';

test('returns parsed JSON response on success', async () => {
  installDomStubs();
  (globalThis as any).fetch = async () =>
    jsonResponse({ message: 'ok' });

  const result = await generateResponse([{ role: 'user', content: 'hi', time: '10:00' }]);
  assert.equal(result.message, 'ok');
});

test('throws friendly error when server returns HTML', async () => {
  installDomStubs();
  (globalThis as any).fetch = async () =>
    textResponse('<html>error</html>', { status: 500, statusText: 'Error' });

  await assert.rejects(
    () => generateResponse([{ role: 'user', content: 'hi', time: '10:00' }]),
    /HTML вместо JSON/
  );
});

test('throws timeout error on abort', async () => {
  installDomStubs();
  (globalThis as any).fetch = async () => {
    const err: any = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };

  await assert.rejects(
    () => generateResponse([{ role: 'user', content: 'hi', time: '10:00' }]),
    /Превышено время ожидания/
  );
});

test('throws network error on failed fetch', async () => {
  installDomStubs();
  (globalThis as any).fetch = async () => {
    throw new Error('Failed to fetch');
  };

  await assert.rejects(
    () => generateResponse([{ role: 'user', content: 'hi', time: '10:00' }]),
    /Ошибка сети/
  );
});

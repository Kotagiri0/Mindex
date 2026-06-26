import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { verifyYandexCode } from '../../../src/lib/yandex-auth';
import { jsonResponse } from '../../helpers/response';

const realFetch = (globalThis as any).fetch;
afterEach(() => { (globalThis as any).fetch = realFetch; });

// Мокаем оба шага Яндекса: /token и /info
function mockYandex(opts: {
  token?: any; tokenStatus?: number;
  info?: any; infoStatus?: number;
}) {
  (globalThis as any).fetch = async (url: string) => {
    if (String(url).includes('oauth.yandex.ru/token')) {
      return jsonResponse(opts.token ?? { access_token: 'AT' }, { status: opts.tokenStatus ?? 200 });
    }
    if (String(url).includes('login.yandex.ru/info')) {
      return jsonResponse(opts.info ?? {}, { status: opts.infoStatus ?? 200 });
    }
    throw new Error('unexpected url ' + url);
  };
}

test('happy path: id, email (lowercased), имя, аватар', async () => {
  mockYandex({ info: { id: '42', default_email: 'User@Mail.RU', real_name: 'Иван', default_avatar_id: 'abc', is_avatar_empty: false } });
  const u = await verifyYandexCode('code', 'cid', 'secret');
  assert.equal(u.id, '42');
  assert.equal(u.email, 'user@mail.ru');           // нормализован
  assert.equal(u.emailVerified, true);
  assert.equal(u.displayName, 'Иван');
  assert.equal(u.avatarUrl, 'https://avatars.yandex.net/get-yapic/abc/islands-200');
});

test('token endpoint без access_token → throw', async () => {
  mockYandex({ token: { error: 'invalid_grant', error_description: 'code used' } });
  await assert.rejects(() => verifyYandexCode('c', 'cid', 'secret'), /code used|токен/i);
});

test('info без id → throw (нельзя создать аккаунт без стабильного ключа)', async () => {
  mockYandex({ info: { default_email: 'a@b.ru' } });
  await assert.rejects(() => verifyYandexCode('c', 'cid', 'secret'), /профиль|id/i);
});

test('email берётся из emails[0], если нет default_email', async () => {
  mockYandex({ info: { id: '7', emails: ['Fallback@Ya.ru'] } });
  const u = await verifyYandexCode('c', 'cid', 'secret');
  assert.equal(u.email, 'fallback@ya.ru');
});

test('red-team: id числом → коэрсится в строку (иначе .slice падает)', async () => {
  mockYandex({ info: { id: 123456789, default_email: 'n@ya.ru' } });
  const u = await verifyYandexCode('c', 'cid', 'secret');
  assert.equal(typeof u.id, 'string');
  assert.equal(u.id, '123456789');
});

test('red-team: пустой аватар → avatarUrl null (не клеим битый url)', async () => {
  mockYandex({ info: { id: '9', default_email: 'n@ya.ru', default_avatar_id: 'x', is_avatar_empty: true } });
  const u = await verifyYandexCode('c', 'cid', 'secret');
  assert.equal(u.avatarUrl, null);
});

test('red-team: совсем без email → email=null, emailVerified=false (не линкуемся вслепую)', async () => {
  mockYandex({ info: { id: '11', login: 'vasya' } });
  const u = await verifyYandexCode('c', 'cid', 'secret');
  assert.equal(u.email, null);
  assert.equal(u.emailVerified, false);
  assert.equal(u.displayName, 'vasya');
});

test('red-team: пустой info-ответ (id="") тоже отвергается', async () => {
  mockYandex({ info: { id: '' } });
  await assert.rejects(() => verifyYandexCode('c', 'cid', 'secret'), /профиль|id/i);
});

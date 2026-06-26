// Яндекс OAuth (code-flow) — серверная верификация.
//
// В отличие от Google, Яндекс не выдаёт подписанный id_token (JWT). Поток такой:
//   1. фронт получает authorization `code` из попапа OAuth-диалога;
//   2. бэкенд меняет code на access_token (нужен client_secret — поэтому только на сервере);
//   3. бэкенд дёргает login.yandex.ru/info и получает проверенные данные пользователя.
//
// Это аналог verifyGoogleIdToken, но в два сетевых шага.

export interface YandexUser {
  id: string;                 // уникальный id пользователя Яндекса (стабильный ключ)
  email: string | null;       // default_email
  emailVerified: boolean;     // Яндекс отдаёт только подтверждённые ящики
  displayName: string;        // имя для отображения
  avatarUrl: string | null;
}

const TOKEN_URL = 'https://oauth.yandex.ru/token';
const INFO_URL = 'https://login.yandex.ru/info?format=json';

// code → access_token
async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri?: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (redirectUri) body.set('redirect_uri', redirectUri);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || 'Яндекс: не удалось обменять код на токен');
  }
  return String(data.access_token);
}

// access_token → данные пользователя
async function fetchUserInfo(accessToken: string): Promise<YandexUser> {
  const res = await fetch(INFO_URL, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) {
    throw new Error(data?.error_description || data?.error || 'Яндекс: не удалось получить профиль');
  }

  const email = (data.default_email || (Array.isArray(data.emails) ? data.emails[0] : null) || '')
    .toString()
    .trim()
    .toLowerCase() || null;

  const displayName = (data.real_name || data.display_name || data.login || (email ? email.split('@')[0] : '') || 'Яндекс').toString().trim();

  const avatarUrl = data.default_avatar_id && data.is_avatar_empty !== true
    ? `https://avatars.yandex.net/get-yapic/${data.default_avatar_id}/islands-200`
    : null;

  return {
    id: String(data.id),
    email,
    emailVerified: Boolean(email), // ящики из Яндекс-аккаунта считаем подтверждёнными провайдером
    displayName,
    avatarUrl,
  };
}

// Полный путь: authorization code → проверенный пользователь Яндекса.
export const verifyYandexCode = async (
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri?: string,
): Promise<YandexUser> => {
  const accessToken = await exchangeCode(code, clientId, clientSecret, redirectUri);
  return fetchUserInfo(accessToken);
};

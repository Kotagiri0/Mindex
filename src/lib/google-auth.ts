import { webcrypto } from 'crypto';

export interface GoogleIdTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
}

interface GoogleJwk extends JsonWebKey {
  kid?: string;
  use?: string;
  alg?: string;
}

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

type CachedCerts = {
  keys: GoogleJwk[];
  expiresAt: number;
};

let certCache: CachedCerts | null = null;

const decodeBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(padded, 'base64'));
};

const decodeJsonPart = <T>(value: string): T => {
  const text = new TextDecoder().decode(decodeBase64Url(value));
  return JSON.parse(text) as T;
};

const getCachedCerts = async () => {
  if (certCache && certCache.expiresAt > Date.now()) {
    return certCache.keys;
  }

  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) {
    throw new Error('Не удалось получить сертификаты Google.');
  }

  const payload = (await response.json()) as { keys?: GoogleJwk[] };
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  certCache = {
    keys: payload.keys || [],
    expiresAt: Date.now() + ttlSeconds * 1000,
  };

  return certCache.keys;
};

export const verifyGoogleIdToken = async (token: string, audience: string): Promise<GoogleIdTokenPayload> => {
  const [headerPart, payloadPart, signaturePart] = token.split('.');

  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error('Некорректный Google token.');
  }

  const header = decodeJsonPart<{ kid?: string; alg?: string }>(headerPart);
  const payload = decodeJsonPart<GoogleIdTokenPayload>(payloadPart);

  if (header.alg !== 'RS256') {
    throw new Error('Неподдерживаемый алгоритм Google token.');
  }

  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new Error('Недопустимый issuer Google token.');
  }

  if (payload.aud !== audience) {
    throw new Error('Google token выдан для другого приложения.');
  }

  if (!payload.exp || payload.exp * 1000 < Date.now()) {
    throw new Error('Google token истёк.');
  }

  const certs = await getCachedCerts();
  const jwk = certs.find((key) => key.kid === header.kid) || certs[0];

  if (!jwk) {
    throw new Error('Не удалось найти сертификат Google.');
  }

  const importedKey = await webcrypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify'],
  );

  const signature = decodeBase64Url(signaturePart);
  const signedData = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const isValid = await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', importedKey, signature, signedData);

  if (!isValid) {
    throw new Error('Подпись Google token недействительна.');
  }

  return payload;
};

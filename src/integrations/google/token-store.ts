import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import type { Pool } from 'pg';
import type { GoogleWorkspaceTokens } from './types';

const ENCRYPTION_KEY_SOURCE =
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||
  process.env.SESSION_SECRET ||
  process.env.ROUTERAI_API_KEY ||
  'mindex-google-workspace';

const ENCRYPTION_KEY = createHash('sha256').update(ENCRYPTION_KEY_SOURCE).digest();

const encrypt = (raw: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decrypt = (encoded: string): string | null => {
  const [ivRaw, tagRaw, dataRaw] = encoded.split(':');
  if (!ivRaw || !tagRaw || !dataRaw) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
};


export class GoogleWorkspaceTokenStore {
  constructor(private readonly db: Pool) {}

  async getTokens(userId: string): Promise<GoogleWorkspaceTokens | null> {
    const { rows } = await this.db.query(
      `SELECT settings FROM user_profiles WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    const settings = rows[0]?.settings;
    if (!settings || typeof settings !== 'object') return null;
    const plainTokens = (settings.googleWorkspace?.tokens ?? null) as GoogleWorkspaceTokens | null;
    if (plainTokens) return plainTokens;

    const encryptedTokens = settings.googleWorkspace?.encryptedTokens;
    if (typeof encryptedTokens !== 'string') return null;

    const decrypted = decrypt(encryptedTokens);
    if (!decrypted) return null;

    try {
      return JSON.parse(decrypted) as GoogleWorkspaceTokens;
    } catch {
      return null;
    }
  }

  async saveTokens(userId: string, tokens: GoogleWorkspaceTokens): Promise<void> {
    const payload = JSON.stringify({ encryptedTokens: encrypt(JSON.stringify(tokens)) });

    await this.db.query(
      `INSERT INTO user_profiles (user_id, settings, onboarding_complete, updated_at)
       VALUES ($1, jsonb_build_object('googleWorkspace', $2::jsonb), true, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         settings = COALESCE(user_profiles.settings, '{}'::jsonb) || jsonb_build_object('googleWorkspace', $2::jsonb),
         updated_at = NOW()`,
      [userId, payload],
    );
  }

  async clearTokens(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE user_profiles
       SET settings = COALESCE(settings, '{}'::jsonb) - 'googleWorkspace',
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
  }
}

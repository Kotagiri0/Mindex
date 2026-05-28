import type { Pool } from 'pg';
import type { GoogleWorkspaceTokens } from './types';

export class GoogleWorkspaceTokenStore {
  constructor(private readonly db: Pool) {}

  async getTokens(userId: string): Promise<GoogleWorkspaceTokens | null> {
    const { rows } = await this.db.query(
      `SELECT settings FROM user_profiles WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    const settings = rows[0]?.settings;
    if (!settings || typeof settings !== 'object') return null;
    const tokens = (settings.googleWorkspace?.tokens ?? null) as GoogleWorkspaceTokens | null;
    return tokens;
  }

  async saveTokens(userId: string, tokens: GoogleWorkspaceTokens): Promise<void> {
    const payload = JSON.stringify({ tokens });

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

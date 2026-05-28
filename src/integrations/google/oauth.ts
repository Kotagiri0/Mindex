import { google } from 'googleapis';
import type { WorkspaceResult } from './types';
import { GoogleWorkspaceTokenStore } from './token-store';

const AUTH_ERROR_CODE = 'AUTH_REQUIRED';
const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/forms.body',
];

const getAuthUrl = (scopes: string[], userId: string) => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    const appUrl = process.env.APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN;
    return appUrl ? `${appUrl.replace(/\/$/, '')}/#/settings` : undefined;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: scopes,
    state: JSON.stringify({ userId, provider: 'google-workspace' }),
  });
};

const getErrorStatus = (error: any): number | undefined =>
  error?.status ?? error?.code ?? error?.response?.status;

export class GoogleWorkspaceAuth {
  constructor(private readonly tokenStore: GoogleWorkspaceTokenStore) {}

  getAuthorizationUrl(userId: string, scopes: string[] = WORKSPACE_SCOPES): WorkspaceResult<{ authUrl: string }> {
    const authUrl = getAuthUrl(scopes, userId);
    if (!authUrl) {
      return {
        success: false,
        error: {
          code: AUTH_ERROR_CODE,
          message: 'Google OAuth не настроен',
        },
      };
    }
    return { success: true, data: { authUrl } };
  }

  async exchangeAuthorizationCode(
    userId: string,
    code: string,
    scopes: string[] = WORKSPACE_SCOPES,
  ): Promise<WorkspaceResult<{ connected: boolean }>> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return {
        success: false,
        error: {
          code: AUTH_ERROR_CODE,
          message: 'Google OAuth не настроен',
          reauthUrl: getAuthUrl(scopes, userId),
        },
      };
    }

    if (!code) {
      return {
        success: false,
        error: {
          code: 'INVALID_AUTH_CODE',
          message: 'Код авторизации не передан',
        },
      };
    }

    try {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const { tokens } = await oauth2Client.getToken(code);
      const normalizedTokens = {
        access_token: tokens.access_token || undefined,
        refresh_token: tokens.refresh_token || undefined,
        expiry_date: typeof tokens.expiry_date === 'number' ? tokens.expiry_date : undefined,
        token_type: tokens.token_type || undefined,
        scope: tokens.scope || undefined,
      };
      if (!normalizedTokens.access_token && !normalizedTokens.refresh_token) {
        return {
          success: false,
          error: {
            code: 'INVALID_AUTH_CODE',
            message: 'Google не вернул токены',
          },
        };
      }
      await this.tokenStore.saveTokens(userId, normalizedTokens);
      return { success: true, data: { connected: true } };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'GOOGLE_AUTH_EXCHANGE_FAILED',
          message: error?.message || 'Не удалось обменять код Google OAuth на токены',
        },
      };
    }
  }

  async withAuth<T>(
    userId: string,
    scopes: string[],
    operation: (auth: any) => Promise<T>,
  ): Promise<WorkspaceResult<T>> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return {
        success: false,
        error: {
          code: AUTH_ERROR_CODE,
          message: 'Google OAuth не настроен',
          reauthUrl: getAuthUrl(scopes, userId),
        },
      };
    }

    const tokens = await this.tokenStore.getTokens(userId);
    if (!tokens?.access_token && !tokens?.refresh_token) {
      return {
        success: false,
        error: {
          code: AUTH_ERROR_CODE,
          message: 'Требуется авторизация Google Workspace',
          reauthUrl: getAuthUrl(scopes, userId),
        },
      };
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials(tokens);

    oauth2Client.on('tokens', async (nextTokens) => {
      const merged = { ...tokens, ...nextTokens };
      await this.tokenStore.saveTokens(userId, merged);
    });

    try {
      if (tokens.expiry_date && tokens.expiry_date <= Date.now() + 5 * 60 * 1000 && tokens.refresh_token) {
        const refreshed = await oauth2Client.refreshAccessToken();
        if (refreshed.credentials) {
          await this.tokenStore.saveTokens(userId, { ...tokens, ...refreshed.credentials });
        }
      }
      const data = await operation(oauth2Client);
      return { success: true, data };
    } catch (error: any) {
      const status = getErrorStatus(error);
      if (status === 401 || status === 403) {
        await this.tokenStore.clearTokens(userId);
        return {
          success: false,
          error: {
            code: AUTH_ERROR_CODE,
            message: 'Google токен недействителен, нужно переподключение',
            reauthUrl: getAuthUrl(scopes, userId),
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'GOOGLE_API_ERROR',
          message: error?.message || 'Ошибка Google API',
        },
      };
    }
  }
}

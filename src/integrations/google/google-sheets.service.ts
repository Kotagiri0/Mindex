import { google } from 'googleapis';
import type { GoogleAuthExecutor, WorkspaceResult } from './types';
import { GoogleRateLimitedQueue } from './rate-limited-queue';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

type SheetsClient = ReturnType<typeof google.sheets>;

const toJsonRows = (rows: string[][]) => {
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const item: Record<string, string> = {};
    headers.forEach((header, index) => {
      item[header] = row[index] ?? '';
    });
    return item;
  });
};

export class GoogleSheetsService {
  constructor(
    private readonly auth: GoogleAuthExecutor,
    private readonly queue = new GoogleRateLimitedQueue(),
    private readonly sheetsFactory: (auth: any) => SheetsClient = (authClient) => google.sheets({ version: 'v4', auth: authClient }),
    private readonly aiReportGenerator: (rows: Record<string, string>[]) => Promise<string> = async (rows) =>
      `Строк: ${rows.length}`,
  ) {}

  async createSpreadsheet(userId: string, title: string, headers: string[]): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [SHEETS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const sheets = this.sheetsFactory(authClient);
        const created = await sheets.spreadsheets.create({
          requestBody: { properties: { title } },
        });
        const spreadsheetId = created.data.spreadsheetId || '';
        const sheetName = created.data.sheets?.[0]?.properties?.title || 'Sheet1';

        if (headers.length) {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'RAW',
            requestBody: { values: [headers] },
          });
        }

        return {
          spreadsheetId,
          sheetName,
          url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        };
      }),
    );
  }

  async appendRow(userId: string, spreadsheetId: string, sheetName: string, data: any[]): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [SHEETS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const sheets = this.sheetsFactory(authClient);
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${sheetName}!A:A`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [data.map((v) => String(v ?? ''))] },
        });

        return {
          spreadsheetId,
          sheetName,
          appended: true,
          url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        };
      }),
    );
  }

  async readRange(userId: string, spreadsheetId: string, range: string): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [SHEETS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const sheets = this.sheetsFactory(authClient);
        const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        const values = (response.data.values || []) as string[][];
        return {
          spreadsheetId,
          range,
          rows: toJsonRows(values),
          raw: values,
        };
      }),
    );
  }

  async updateCell(userId: string, spreadsheetId: string, cell: string, value: unknown): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [SHEETS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const sheets = this.sheetsFactory(authClient);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: cell,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[String(value ?? '')]] },
        });
        return {
          spreadsheetId,
          cell,
          updated: true,
          url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        };
      }),
    );
  }

  async queryRows(
    userId: string,
    spreadsheetId: string,
    sheetName: string,
    filter: Record<string, string>,
  ): Promise<WorkspaceResult> {
    const read = await this.readRange(userId, spreadsheetId, `${sheetName}!A:ZZ`);
    if (!read.success) return read;

    const rows = (read.data?.rows || []) as Record<string, string>[];
    const filtered = rows.filter((row) =>
      Object.entries(filter || {}).every(([key, value]) =>
        String(row[key] ?? '').toLowerCase().includes(String(value).toLowerCase()),
      ),
    );

    return {
      success: true,
      data: {
        spreadsheetId,
        sheetName,
        rows: filtered,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      },
    };
  }

  async generateReport(userId: string, spreadsheetId: string): Promise<WorkspaceResult> {
    const read = await this.readRange(userId, spreadsheetId, 'Sheet1!A:ZZ');
    if (!read.success) return read;
    const rows = (read.data?.rows || []) as Record<string, string>[];
    const summary = await this.aiReportGenerator(rows);
    return {
      success: true,
      data: {
        spreadsheetId,
        summary,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      },
    };
  }
}

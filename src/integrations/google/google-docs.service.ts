import { google } from 'googleapis';
import type { GoogleAuthExecutor, WorkspaceResult } from './types';
import { GoogleRateLimitedQueue } from './rate-limited-queue';

const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

type DocsClient = ReturnType<typeof google.docs>;
type DriveClient = ReturnType<typeof google.drive>;

const markdownToPlainText = (markdown: string) =>
  markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .trim();

export class GoogleDocsService {
  constructor(
    private readonly auth: GoogleAuthExecutor,
    private readonly queue = new GoogleRateLimitedQueue(),
    private readonly docsFactory: (auth: any) => DocsClient = (authClient) => google.docs({ version: 'v1', auth: authClient }),
    private readonly driveFactory: (auth: any) => DriveClient = (authClient) => google.drive({ version: 'v3', auth: authClient }),
    private readonly aiContentGenerator: (prompt: string, docType: string) => Promise<string> = async (prompt, docType) =>
      `${docType}\n\n${prompt}`,
  ) {}

  async createDocument(userId: string, title: string, templateId?: string): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [DOCS_SCOPE, DRIVE_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const docs = this.docsFactory(authClient);
        const drive = this.driveFactory(authClient);

        if (templateId) {
          const copied = await drive.files.copy({
            fileId: templateId,
            requestBody: { name: title },
            fields: 'id',
          });
          const documentId = copied.data.id || '';
          return {
            documentId,
            url: `https://docs.google.com/document/d/${documentId}/edit`,
            fromTemplate: true,
          };
        }

        const created = await docs.documents.create({ requestBody: { title } });
        const documentId = created.data.documentId || '';
        return {
          documentId,
          url: `https://docs.google.com/document/d/${documentId}/edit`,
          fromTemplate: false,
        };
      }),
    );
  }

  async fillTemplate(userId: string, docId: string, variables: Record<string, unknown>): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [DOCS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const docs = this.docsFactory(authClient);
        const requests = Object.entries(variables).map(([key, value]) => ({
          replaceAllText: {
            containsText: {
              text: `{{${key}}}`,
              matchCase: true,
            },
            replaceText: String(value ?? ''),
          },
        }));

        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: { requests },
        });

        return {
          documentId: docId,
          replacedVariables: Object.keys(variables),
          url: `https://docs.google.com/document/d/${docId}/edit`,
        };
      }),
    );
  }

  async exportAsPdf(userId: string, docId: string): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [DRIVE_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const drive = this.driveFactory(authClient);
        await drive.files.export({
          fileId: docId,
          mimeType: 'application/pdf',
        });
        return {
          documentId: docId,
          pdfUrl: `https://docs.google.com/document/d/${docId}/export?format=pdf`,
        };
      }),
    );
  }

  async appendContent(userId: string, docId: string, markdown: string): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [DOCS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const docs = this.docsFactory(authClient);
        const current = await docs.documents.get({ documentId: docId });
        const content = current.data.body?.content || [];
        const endIndex = content[content.length - 1]?.endIndex || 1;
        const text = `\n${markdownToPlainText(markdown)}\n`;

        await docs.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: Math.max(1, endIndex - 1) },
                  text,
                },
              },
            ],
          },
        });

        return {
          documentId: docId,
          appended: true,
          url: `https://docs.google.com/document/d/${docId}/edit`,
        };
      }),
    );
  }

  async generateAIDocument(userId: string, prompt: string, docType: string): Promise<WorkspaceResult> {
    const content = await this.aiContentGenerator(prompt, docType);
    const title = `${docType} — ${new Date().toLocaleDateString('ru-RU')}`;
    const created = await this.createDocument(userId, title);
    if (!created.success || !created.data?.documentId) return created;
    await this.appendContent(userId, created.data.documentId, content);
    return {
      success: true,
      data: {
        documentId: created.data.documentId,
        url: created.data.url,
        generated: true,
      },
    };
  }
}

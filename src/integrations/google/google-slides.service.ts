import crypto from 'crypto';
import { google } from 'googleapis';
import type { GoogleAuthExecutor, SlideContent, WorkspaceResult } from './types';
import { GoogleRateLimitedQueue } from './rate-limited-queue';

const SLIDES_SCOPE = 'https://www.googleapis.com/auth/presentations';

type SlidesClient = ReturnType<typeof google.slides>;

const randomId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

export class GoogleSlidesService {
  constructor(
    private readonly auth: GoogleAuthExecutor,
    private readonly queue = new GoogleRateLimitedQueue(),
    private readonly slidesFactory: (auth: any) => SlidesClient = (authClient) => google.slides({ version: 'v1', auth: authClient }),
  ) {}

  async createPresentation(userId: string, title: string): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [SLIDES_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const slides = this.slidesFactory(authClient);
        const created = await slides.presentations.create({ requestBody: { title } });
        const presentationId = created.data.presentationId || '';
        return {
          presentationId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        };
      }),
    );
  }

  async addSlide(
    userId: string,
    presentationId: string,
    layout: string,
    content: SlideContent,
  ): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [SLIDES_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const slides = this.slidesFactory(authClient);
        const slideId = randomId('slide');
        const titleId = randomId('title');
        const bodyId = randomId('body');

        const requests: any[] = [
          {
            createSlide: {
              objectId: slideId,
              slideLayoutReference: { predefinedLayout: layout || 'TITLE_AND_BODY' },
              placeholderIdMappings: [
                { layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId },
                { layoutPlaceholder: { type: 'BODY', index: 0 }, objectId: bodyId },
              ],
            },
          },
          { insertText: { objectId: titleId, text: content.title || '' } },
          { insertText: { objectId: bodyId, text: content.body || '' } },
        ];

        if (content.imageUrl) {
          requests.push({
            createImage: {
              url: content.imageUrl,
              elementProperties: {
                pageObjectId: slideId,
                size: {
                  width: { magnitude: 300, unit: 'PT' },
                  height: { magnitude: 180, unit: 'PT' },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  translateX: 30,
                  translateY: 220,
                  unit: 'PT',
                },
              },
            },
          });
        }

        await slides.presentations.batchUpdate({
          presentationId,
          requestBody: { requests },
        });

        return {
          presentationId,
          slideId,
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        };
      }),
    );
  }

  async fillPresentationTemplate(
    userId: string,
    presentationId: string,
    variables: Record<string, unknown>,
  ): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [SLIDES_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const slides = this.slidesFactory(authClient);
        const requests = Object.entries(variables).map(([key, value]) => ({
          replaceAllText: {
            containsText: { text: `{{${key}}}`, matchCase: true },
            replaceText: String(value ?? ''),
          },
        }));

        await slides.presentations.batchUpdate({
          presentationId,
          requestBody: { requests },
        });

        return {
          presentationId,
          replacedVariables: Object.keys(variables),
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        };
      }),
    );
  }

  async generatePitchDeck(userId: string, projectData: Record<string, any>): Promise<WorkspaceResult> {
    const title = String(projectData?.title || 'AI Pitch Deck');
    const created = await this.createPresentation(userId, title);
    if (!created.success || !created.data?.presentationId) return created;

    const slides: SlideContent[] = [
      {
        title,
        body: String(projectData?.summary || 'Краткое описание проекта'),
      },
      {
        title: 'Проблема',
        body: String(projectData?.problem || 'Опишите ключевую проблему'),
      },
      {
        title: 'Решение',
        body: String(projectData?.solution || 'Опишите ваше решение'),
      },
    ];

    for (const slide of slides) {
      await this.addSlide(userId, created.data.presentationId, 'TITLE_AND_BODY', slide);
    }

    return {
      success: true,
      data: {
        presentationId: created.data.presentationId,
        url: created.data.url,
      },
    };
  }

  async exportAsLink(userId: string, presentationId: string): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [SLIDES_SCOPE], async () => ({
      presentationId,
      url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
      shareable: true,
    }));
  }
}

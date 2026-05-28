import { google } from 'googleapis';
import type { FormQuestion, GoogleAuthExecutor, WorkspaceResult } from './types';
import { GoogleRateLimitedQueue } from './rate-limited-queue';

const FORMS_SCOPE = 'https://www.googleapis.com/auth/forms.body';

type FormsClient = ReturnType<typeof google.forms>;

const mapQuestion = (question: FormQuestion) => {
  if (question.type === 'text') {
    return { textQuestion: { paragraph: false } };
  }
  if (question.type === 'choice') {
    return {
      choiceQuestion: {
        type: 'RADIO',
        options: (question.options || []).map((value) => ({ value })),
      },
    };
  }
  if (question.type === 'scale') {
    return {
      scaleQuestion: {
        low: 1,
        high: 5,
        lowLabel: '1',
        highLabel: '5',
      },
    };
  }
  return { dateQuestion: { includeYear: true } };
};

export class GoogleFormsService {
  constructor(
    private readonly auth: GoogleAuthExecutor,
    private readonly queue = new GoogleRateLimitedQueue(),
    private readonly formsFactory: (auth: any) => FormsClient = (authClient) => google.forms({ version: 'v1', auth: authClient }),
  ) {}

  async createForm(userId: string, title: string, description: string): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [FORMS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const forms = this.formsFactory(authClient);
        const created = await forms.forms.create({
          requestBody: {
            info: { title, description },
          },
        });

        const formId = created.data.formId || '';
        return {
          formId,
          link: created.data.responderUri || `https://docs.google.com/forms/d/${formId}/viewform`,
        };
      }),
    );
  }

  async addQuestion(userId: string, formId: string, question: FormQuestion): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [FORMS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const forms = this.formsFactory(authClient);
        await forms.forms.batchUpdate({
          formId,
          requestBody: {
            requests: [
              {
                createItem: {
                  item: {
                    title: question.text,
                    questionItem: {
                      question: {
                        required: true,
                        ...mapQuestion(question),
                      },
                    },
                  },
                  location: { index: 0 },
                },
              },
            ],
          },
        });

        return {
          formId,
          added: true,
          link: `https://docs.google.com/forms/d/${formId}/viewform`,
        };
      }),
    );
  }

  async getResponses(userId: string, formId: string): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [FORMS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const forms = this.formsFactory(authClient);
        const responses = await forms.forms.responses.list({ formId });
        return {
          formId,
          responses: responses.data.responses || [],
        };
      }),
    );
  }

  async generateOnboardingForm(userId: string, context: Record<string, any>): Promise<WorkspaceResult> {
    const title = String(context?.title || 'Onboarding Form');
    const description = String(context?.description || 'Ответьте на несколько вопросов для старта');
    const created = await this.createForm(userId, title, description);
    if (!created.success || !created.data?.formId) return created;

    const questions: FormQuestion[] = [
      { text: 'Как к вам обращаться?', type: 'text' },
      { text: 'Главная цель на ближайший месяц?', type: 'text' },
      { text: 'Какой формат общения удобнее?', type: 'choice', options: ['Текст', 'Голос', 'Смешанный'] },
    ];

    for (const question of questions) {
      await this.addQuestion(userId, created.data.formId, question);
    }

    return {
      success: true,
      data: {
        formId: created.data.formId,
        link: created.data.link,
      },
    };
  }

  async getFormLink(userId: string, formId: string): Promise<WorkspaceResult> {
    return this.auth.withAuth(userId, [FORMS_SCOPE], async (authClient) =>
      this.queue.enqueue(async () => {
        const forms = this.formsFactory(authClient);
        const form = await forms.forms.get({ formId });
        return {
          formId,
          link: form.data.responderUri || `https://docs.google.com/forms/d/${formId}/viewform`,
        };
      }),
    );
  }
}

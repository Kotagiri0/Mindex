import type { Pool } from 'pg';
import type { ToolDefinition, WorkspaceResult } from './types';
import { GoogleWorkspaceTokenStore } from './token-store';
import { GoogleWorkspaceAuth } from './oauth';
import { GoogleDocsService } from './google-docs.service';
import { GoogleSheetsService } from './google-sheets.service';
import { GoogleSlidesService } from './google-slides.service';
import { GoogleFormsService } from './google-forms.service';

const toNotificationText = (name: string, result: WorkspaceResult) => {
  if (!result.success) {
    if (result.error?.code === 'AUTH_REQUIRED') {
      const urlPart = result.error.reauthUrl ? `\n${result.error.reauthUrl}` : '';
      return { text: `Требуется повторная авторизация Google Workspace.${urlPart}`, link: result.error.reauthUrl };
    }
    return { text: `Ошибка ${name}: ${result.error?.message || 'неизвестная ошибка'}` };
  }

  const data = result.data || {};
  const link = data.url || data.link || data.pdfUrl;
  const okText = `Операция ${name} выполнена`;
  return { text: link ? `${okText}\n${link}` : okText, link };
};

export class GoogleWorkspaceAdapter {
  private readonly docsService: GoogleDocsService;
  private readonly sheetsService: GoogleSheetsService;
  private readonly slidesService: GoogleSlidesService;
  private readonly formsService: GoogleFormsService;

  constructor(db: Pool) {
    const auth = new GoogleWorkspaceAuth(new GoogleWorkspaceTokenStore(db));
    this.docsService = new GoogleDocsService(auth);
    this.sheetsService = new GoogleSheetsService(auth);
    this.slidesService = new GoogleSlidesService(auth);
    this.formsService = new GoogleFormsService(auth);
  }

  static toolDefinitions(): ToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'createDocument',
          description: 'Создать Google документ из шаблона или пустой.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Название документа' },
              templateId: { type: 'string', description: 'ID шаблона (необязательно)' },
            },
            required: ['title'],
          },
        },
      },
      { type: 'function', function: { name: 'fillTemplate', description: 'Заменить переменные {{key}} в документе.', parameters: { type: 'object', properties: { docId: { type: 'string' }, variables: { type: 'object' } }, required: ['docId', 'variables'] } } },
      { type: 'function', function: { name: 'exportAsPdf', description: 'Экспортировать документ как PDF и вернуть ссылку.', parameters: { type: 'object', properties: { docId: { type: 'string' } }, required: ['docId'] } } },
      { type: 'function', function: { name: 'appendContent', description: 'Добавить markdown-контент в документ.', parameters: { type: 'object', properties: { docId: { type: 'string' }, markdown: { type: 'string' } }, required: ['docId', 'markdown'] } } },
      { type: 'function', function: { name: 'generateAIDocument', description: 'Сгенерировать AI-документ.', parameters: { type: 'object', properties: { prompt: { type: 'string' }, docType: { type: 'string' } }, required: ['prompt', 'docType'] } } },

      { type: 'function', function: { name: 'createSpreadsheet', description: 'Создать Google таблицу с заголовками.', parameters: { type: 'object', properties: { title: { type: 'string' }, headers: { type: 'array', items: { type: 'string' } } }, required: ['title', 'headers'] } } },
      {
        type: 'function',
        function: {
          name: 'appendRow',
          description: 'Добавить строку в Google таблицу.',
          parameters: {
            type: 'object',
            properties: {
              spreadsheetId: { type: 'string', description: 'ID таблицы' },
              sheetName: { type: 'string', description: 'Название листа' },
              data: { type: 'array', items: { type: 'string' }, description: 'Данные строки' },
            },
            required: ['spreadsheetId', 'sheetName', 'data'],
          },
        },
      },
      { type: 'function', function: { name: 'readRange', description: 'Прочитать диапазон Google таблицы.', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' } }, required: ['spreadsheetId', 'range'] } } },
      { type: 'function', function: { name: 'updateCell', description: 'Обновить ячейку в Google таблице.', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, cell: { type: 'string' }, value: {} }, required: ['spreadsheetId', 'cell', 'value'] } } },
      { type: 'function', function: { name: 'queryRows', description: 'Фильтрация строк Google таблицы.', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' }, sheetName: { type: 'string' }, filter: { type: 'object' } }, required: ['spreadsheetId', 'sheetName', 'filter'] } } },
      { type: 'function', function: { name: 'generateReport', description: 'Сформировать summary по таблице.', parameters: { type: 'object', properties: { spreadsheetId: { type: 'string' } }, required: ['spreadsheetId'] } } },

      { type: 'function', function: { name: 'createPresentation', description: 'Создать презентацию.', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } },
      { type: 'function', function: { name: 'addSlide', description: 'Добавить слайд в презентацию.', parameters: { type: 'object', properties: { presentationId: { type: 'string' }, layout: { type: 'string' }, content: { type: 'object' } }, required: ['presentationId', 'layout', 'content'] } } },
      { type: 'function', function: { name: 'fillPresentationTemplate', description: 'Заполнить шаблон презентации.', parameters: { type: 'object', properties: { presentationId: { type: 'string' }, variables: { type: 'object' } }, required: ['presentationId', 'variables'] } } },
      { type: 'function', function: { name: 'generatePitchDeck', description: 'Сгенерировать pitch deck.', parameters: { type: 'object', properties: { projectData: { type: 'object' } }, required: ['projectData'] } } },
      { type: 'function', function: { name: 'exportPresentationLink', description: 'Вернуть ссылку на презентацию.', parameters: { type: 'object', properties: { presentationId: { type: 'string' } }, required: ['presentationId'] } } },

      { type: 'function', function: { name: 'createForm', description: 'Создать Google форму.', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } }, required: ['title', 'description'] } } },
      { type: 'function', function: { name: 'addQuestion', description: 'Добавить вопрос в Google форму.', parameters: { type: 'object', properties: { formId: { type: 'string' }, question: { type: 'object' } }, required: ['formId', 'question'] } } },
      { type: 'function', function: { name: 'getResponses', description: 'Получить ответы формы.', parameters: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] } } },
      { type: 'function', function: { name: 'generateOnboardingForm', description: 'Сгенерировать onboarding-форму.', parameters: { type: 'object', properties: { context: { type: 'object' } }, required: ['context'] } } },
      { type: 'function', function: { name: 'getFormLink', description: 'Вернуть ссылку на форму.', parameters: { type: 'object', properties: { formId: { type: 'string' } }, required: ['formId'] } } },
    ];
  }

  canHandle(name: string): boolean {
    return GoogleWorkspaceAdapter.toolDefinitions().some((tool) => tool.function.name === name);
  }

  async execute(name: string, args: any, userId: string): Promise<WorkspaceResult> {
    let result: WorkspaceResult;

    switch (name) {
      case 'createDocument':
        result = await this.docsService.createDocument(userId, String(args.title), args.templateId ? String(args.templateId) : undefined);
        break;
      case 'fillTemplate':
        result = await this.docsService.fillTemplate(userId, String(args.docId), args.variables || {});
        break;
      case 'exportAsPdf':
        result = await this.docsService.exportAsPdf(userId, String(args.docId));
        break;
      case 'appendContent':
        result = await this.docsService.appendContent(userId, String(args.docId), String(args.markdown || ''));
        break;
      case 'generateAIDocument':
        result = await this.docsService.generateAIDocument(userId, String(args.prompt || ''), String(args.docType || 'Документ'));
        break;

      case 'createSpreadsheet':
        result = await this.sheetsService.createSpreadsheet(userId, String(args.title), Array.isArray(args.headers) ? args.headers : []);
        break;
      case 'appendRow':
        result = await this.sheetsService.appendRow(userId, String(args.spreadsheetId), String(args.sheetName), Array.isArray(args.data) ? args.data : []);
        break;
      case 'readRange':
        result = await this.sheetsService.readRange(userId, String(args.spreadsheetId), String(args.range));
        break;
      case 'updateCell':
        result = await this.sheetsService.updateCell(userId, String(args.spreadsheetId), String(args.cell), args.value);
        break;
      case 'queryRows':
        result = await this.sheetsService.queryRows(userId, String(args.spreadsheetId), String(args.sheetName), args.filter || {});
        break;
      case 'generateReport':
        result = await this.sheetsService.generateReport(userId, String(args.spreadsheetId));
        break;

      case 'createPresentation':
        result = await this.slidesService.createPresentation(userId, String(args.title));
        break;
      case 'addSlide':
        result = await this.slidesService.addSlide(userId, String(args.presentationId), String(args.layout), args.content || {});
        break;
      case 'fillPresentationTemplate':
        result = await this.slidesService.fillPresentationTemplate(userId, String(args.presentationId), args.variables || {});
        break;
      case 'generatePitchDeck':
        result = await this.slidesService.generatePitchDeck(userId, args.projectData || {});
        break;
      case 'exportPresentationLink':
        result = await this.slidesService.exportAsLink(userId, String(args.presentationId));
        break;

      case 'createForm':
        result = await this.formsService.createForm(userId, String(args.title), String(args.description || ''));
        break;
      case 'addQuestion':
        result = await this.formsService.addQuestion(userId, String(args.formId), args.question || {});
        break;
      case 'getResponses':
        result = await this.formsService.getResponses(userId, String(args.formId));
        break;
      case 'generateOnboardingForm':
        result = await this.formsService.generateOnboardingForm(userId, args.context || {});
        break;
      case 'getFormLink':
        result = await this.formsService.getFormLink(userId, String(args.formId));
        break;

      default:
        return {
          success: false,
          error: { code: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` },
        };
    }

    return {
      ...result,
      notification: toNotificationText(name, result),
    };
  }
}

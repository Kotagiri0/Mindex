import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GoogleDocsService } from '../../../src/integrations/google/google-docs.service';

test('fillTemplate replaces all {{variables}} via Google Docs batchUpdate', async () => {
  let capturedAuth: any = null;
  let capturedRequest: any = null;

  const authMock = {
    withAuth: async (_userId: string, _scopes: string[], operation: (auth: any) => Promise<any>) => {
      capturedAuth = { token: 'mock' };
      const data = await operation(capturedAuth);
      return { success: true, data };
    },
  };

  const docsMock: any = {
    documents: {
      batchUpdate: async (request: any) => {
        capturedRequest = request;
        return { data: {} };
      },
    },
  };

  const service = new GoogleDocsService(
    authMock as any,
    undefined,
    () => docsMock,
    () => ({ files: {} } as any),
  );

  const result = await service.fillTemplate('user-1', 'doc-42', {
    name: 'Анна',
    role: 'Product Manager',
  });

  assert.equal(result.success, true);
  assert.equal(capturedAuth.token, 'mock');
  assert.equal(capturedRequest.documentId, 'doc-42');

  const requests = capturedRequest.requestBody.requests;
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].replaceAllText.containsText.text, '{{name}}');
  assert.deepEqual(requests[0].replaceAllText.replaceText, 'Анна');
  assert.deepEqual(requests[1].replaceAllText.containsText.text, '{{role}}');
  assert.deepEqual(requests[1].replaceAllText.replaceText, 'Product Manager');
});

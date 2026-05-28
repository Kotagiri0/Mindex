export type WorkspaceError = {
  code: string;
  message: string;
  reauthUrl?: string;
};

export type WorkspaceResult<T = any> = {
  success: boolean;
  data?: T;
  error?: WorkspaceError;
  notification?: {
    text: string;
    link?: string;
  };
};

export type SlideContent = {
  title: string;
  body: string;
  imageUrl?: string;
  notes?: string;
};

export type FormQuestion = {
  text: string;
  type: 'text' | 'choice' | 'scale' | 'date';
  options?: string[];
};

export type GoogleWorkspaceTokens = {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
};

export type GoogleAuthExecutor = {
  withAuth<T>(
    userId: string,
    scopes: string[],
    operation: (auth: any) => Promise<T>,
  ): Promise<WorkspaceResult<T>>;
};

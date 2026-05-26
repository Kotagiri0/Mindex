type HeadersMap = Record<string, string>;

export const createMockReq = (overrides: Partial<any> = {}): any => ({
  method: 'GET',
  headers: {} as HeadersMap,
  body: undefined,
  ...overrides,
});

export const createMockRes = (): any => {
  const headers: HeadersMap = {};
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    ended: false,
    headers,
    setHeader: (key: string, value: string) => {
      headers[key.toLowerCase()] = value;
      return res;
    },
    status: (code: number) => {
      res.statusCode = code;
      return res;
    },
    json: (payload: any) => {
      res.body = payload;
      return res;
    },
    end: () => {
      res.ended = true;
      return res;
    },
  };
  return res;
};

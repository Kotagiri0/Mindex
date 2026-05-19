export const jsonResponse = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

export const textResponse = (text: string, init: ResponseInit = {}) =>
  new Response(text, init);

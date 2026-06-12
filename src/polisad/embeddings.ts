// ПОЛИСАД: эмбеддинги. Единственная реализация для обоих серверов.
// text-embedding-3-small через RouterAI; при любой ошибке возвращает null —
// вызывающий код деградирует до keyword search.

export async function generateEmbedding(text: string, apiKey: string | undefined): Promise<number[] | null> {
  if (!apiKey || !text?.trim()) return null;
  try {
    const response = await fetch('https://routerai.ru/api/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: text.slice(0, 8000) }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}

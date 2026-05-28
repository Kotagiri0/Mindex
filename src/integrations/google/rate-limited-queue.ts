const RETRYABLE_STATUSES = new Set([429, 503]);

const getErrorStatus = (error: any): number | undefined => {
  if (!error) return undefined;
  return error.status ?? error.code ?? error.response?.status;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GoogleRateLimitedQueue {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly maxRetries = 4,
    private readonly baseDelayMs = 400,
  ) {}

  async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = async () => {
      let attempt = 0;
      while (true) {
        try {
          return await operation();
        } catch (error: any) {
          const status = getErrorStatus(error);
          if (!status || !RETRYABLE_STATUSES.has(status) || attempt >= this.maxRetries) {
            throw error;
          }
          const delay = this.baseDelayMs * 2 ** attempt;
          attempt += 1;
          await wait(delay);
        }
      }
    };

    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

import type { Express } from 'express';
import type { AddressInfo } from 'net';

export const startTestServer = (app: Express) =>
  new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });

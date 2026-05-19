import { installLocalStorage } from './local-storage';

type DomStubs = {
  cleanup: () => void;
};

export const installDomStubs = (options: { origin?: string } = {}): DomStubs => {
  const previousWindow = (globalThis as any).window;
  const previousDocument = (globalThis as any).document;
  const previousNavigator = (globalThis as any).navigator;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const hadNavigatorProperty = Object.prototype.hasOwnProperty.call(globalThis, 'navigator');
  const previousLocalStorage = (globalThis as any).localStorage;

  const storage = installLocalStorage();

  const windowStub = {
    location: { origin: options.origin ?? 'http://localhost' },
    navigator: { userAgent: 'node', maxTouchPoints: 0 },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  };

  const documentStub = {
    documentElement: { setAttribute: () => {} },
    head: { appendChild: () => {} },
    querySelector: () => null,
    createElement: () => ({
      dataset: {},
      addEventListener: () => {},
    }),
  };

  (globalThis as any).window = windowStub;
  (globalThis as any).document = documentStub;
  Object.defineProperty(globalThis, 'navigator', {
    value: windowStub.navigator,
    configurable: true,
    writable: true,
  });
  (globalThis as any).localStorage = storage;

  return {
    cleanup: () => {
      (globalThis as any).window = previousWindow;
      (globalThis as any).document = previousDocument;
      if (hadNavigatorProperty && previousNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor);
      } else {
        delete (globalThis as any).navigator;
      }
      (globalThis as any).localStorage = previousLocalStorage;
    },
  };
};

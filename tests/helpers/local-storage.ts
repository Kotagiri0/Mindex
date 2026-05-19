export type MemoryStorage = Storage & {
  _dump: () => Record<string, string>;
};

export const createMemoryStorage = (): MemoryStorage => {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    _dump() {
      return Object.fromEntries(store.entries());
    },
  };
};

export const installLocalStorage = (): MemoryStorage => {
  const storage = createMemoryStorage();
  (globalThis as any).localStorage = storage;
  return storage;
};

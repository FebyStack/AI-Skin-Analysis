import "@testing-library/jest-dom/vitest";

// Ensure localStorage.clear is available in jsdom
if (typeof localStorage !== "undefined" && typeof localStorage.clear !== "function") {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach(key => delete store[key]);
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      length: Object.keys(store).length,
    } as Storage,
    writable: true,
  });
}

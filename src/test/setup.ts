import "@testing-library/jest-dom/vitest";

// Vitest 2.1.9 + jsdom 25 exposes a non-functional localStorage global
// (all Storage methods undefined). Provide a working in-memory Storage.
if (typeof localStorage === "undefined" || typeof localStorage.clear !== "function") {
  let store: Record<string, string> = {};
  const storage: Storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, writable: true });
  Object.defineProperty(window, "localStorage", { value: storage, writable: true });
}

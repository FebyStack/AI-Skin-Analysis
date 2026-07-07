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
  // `window` is absent in the node test environment (e.g. server/api/app.test.ts,
  // which sets `@vitest-environment node`); only mirror onto it when present.
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", { value: storage, writable: true });
  }
}

// Vitest jsdom has no Web Worker; provide an inert stub. Component tests never
// exercise real classification — the worker path is manual/integration-only.
if (typeof globalThis.Worker === "undefined") {
  class InertWorker {
    onmessage: unknown = null;
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  }
  globalThis.Worker = InertWorker as unknown as typeof Worker;
}

// Polyfill Blob.text() for jsdom
if (!Blob.prototype.text) {
  Blob.prototype.text = async function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

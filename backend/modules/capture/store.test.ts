import { describe, it, expect } from "vitest";
import { CaptureSessionStore } from "./store";

describe("CaptureSessionStore", () => {
  it("creates a session and accepts one upload", () => {
    const store = new CaptureSessionStore(() => 1000);
    const { token } = store.create();
    expect(store.submit(token, { image: "abc=", mime: "image/jpeg", mode: "face" })).toBe(true);
    // Single-use: a second submit fails.
    expect(store.submit(token, { image: "def=", mime: "image/jpeg", mode: "face" })).toBe(false);
    const pending = store.take(token);
    expect(pending?.image).toBe("abc=");
    // take() consumes.
    expect(store.take(token)).toBeNull();
  });

  it("expires tokens after the TTL", () => {
    let now = 0;
    const store = new CaptureSessionStore(() => now);
    const { token } = store.create();
    now = 5 * 60 * 1000 + 1;
    expect(store.submit(token, { image: "abc=", mime: "image/jpeg", mode: "face" })).toBe(false);
  });

  it("rejects unknown tokens", () => {
    const store = new CaptureSessionStore(() => 0);
    expect(store.submit("bogus", { image: "a=", mime: "image/jpeg", mode: "face" })).toBe(false);
  });
});

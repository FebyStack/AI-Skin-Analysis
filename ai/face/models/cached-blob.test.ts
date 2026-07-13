// ai/face/models/cached-blob.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveModelSource, type ModelCacheProvider } from "./cached-blob";

const FALLBACK = "/models/example.onnx";

describe("resolveModelSource", () => {
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((_b: Blob) => {
        const url = `blob:fake-${createdUrls.length}`;
        createdUrls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url);
      }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("no provider → falls back to the remote URL, reports unavailable", async () => {
    const onMiss = vi.fn();
    const res = await resolveModelSource("face-parsing", FALLBACK, null, onMiss);
    expect(res.url).toBe(FALLBACK);
    expect(onMiss).toHaveBeenCalledWith("unavailable");
    expect(res.release()).toBeUndefined(); // no-op, doesn't throw
  });

  it("provider has nothing cached → falls back, reports unavailable", async () => {
    const provider: ModelCacheProvider = { getCachedModel: async () => null };
    const onMiss = vi.fn();
    const res = await resolveModelSource("face-parsing", FALLBACK, provider, onMiss);
    expect(res.url).toBe(FALLBACK);
    expect(onMiss).toHaveBeenCalledWith("unavailable");
  });

  it("provider has a cached blob → returns an object URL, not the fallback", async () => {
    const blob = new Blob(["x"]);
    const provider: ModelCacheProvider = { getCachedModel: async () => ({ blob, version: "1.0.0" }) };
    const res = await resolveModelSource("face-parsing", FALLBACK, provider);
    expect(res.url).toBe(createdUrls[0]);
    expect(res.url).not.toBe(FALLBACK);
  });

  it("release() revokes the object URL exactly once", async () => {
    const blob = new Blob(["x"]);
    const provider: ModelCacheProvider = { getCachedModel: async () => ({ blob }) };
    const res = await resolveModelSource("face-parsing", FALLBACK, provider);
    res.release();
    expect(revokedUrls).toEqual([createdUrls[0]]);
  });

  it("release() on a fallback (no cache used) does nothing — never revokes a remote URL", async () => {
    const res = await resolveModelSource("face-parsing", FALLBACK, null);
    res.release();
    expect(revokedUrls).toEqual([]);
  });

  it("provider throws → falls back to remote, reports the real error (not swallowed silently)", async () => {
    const boom = new Error("indexeddb blew up");
    const provider: ModelCacheProvider = {
      getCachedModel: async () => {
        throw boom;
      },
    };
    const onMiss = vi.fn();
    const res = await resolveModelSource("face-parsing", FALLBACK, provider, onMiss);
    expect(res.url).toBe(FALLBACK);
    expect(onMiss).toHaveBeenCalledWith("error", boom);
  });
});

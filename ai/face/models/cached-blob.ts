// ai/face/models/cached-blob.ts
// Small, honest helper: "does this model have a locally cached blob? if so, give me
// a URL for it and a way to release it." No IndexedDB access here directly — that
// keeps this testable without a browser, and keeps both parser.ts and mediapipe.ts
// using the exact same lookup instead of two different hand-rolled versions of it.

/** What a cache provider hands back for a cached model, if it has one. */
export interface CachedModelBlob {
  blob: Blob;
  version?: string;
}

/** Anything that can answer "do you have model X cached?" — real impl lives in the
 * PWA layer (model-update-service.ts) once that exists; tests inject a fake. */
export interface ModelCacheProvider {
  getCachedModel(modelId: string): Promise<CachedModelBlob | null>;
}

export interface ResolvedModelSource {
  url: string;
  /** Call this once the model has finished loading (or loading fails) to release
   * the underlying object URL. No-op for a plain remote URL. */
  release: () => void;
}

/**
 * Resolve the URL to load a model from: a cached blob if the provider has one and
 * it loads without error, otherwise the given remote fallback URL. Every failure
 * path is reported via onCacheMiss (not swallowed) so a real bug is visible instead
 * of silently falling through to "just re-fetch it," but a *missing* cache (the
 * expected case until a model registry exists) is not treated as an error.
 */
export async function resolveModelSource(
  modelId: string,
  fallbackUrl: string,
  provider: ModelCacheProvider | null,
  onCacheMiss?: (reason: "unavailable" | "error", detail?: unknown) => void,
): Promise<ResolvedModelSource> {
  if (!provider) {
    onCacheMiss?.("unavailable");
    return { url: fallbackUrl, release: () => {} };
  }

  try {
    const cached = await provider.getCachedModel(modelId);
    if (!cached) {
      onCacheMiss?.("unavailable");
      return { url: fallbackUrl, release: () => {} };
    }
    const objectUrl = URL.createObjectURL(cached.blob);
    return {
      url: objectUrl,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (err) {
    onCacheMiss?.("error", err);
    return { url: fallbackUrl, release: () => {} };
  }
}

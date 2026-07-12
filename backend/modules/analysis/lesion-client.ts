import { validateLesionAnalysis, type LesionAnalysis } from "../../../shared/lesion";
import golden from "../../../ai/evaluation/fixtures/golden-lesion.json";

export class LesionUnavailableError extends Error {
  constructor(detail: string) {
    super(`Lesion service unavailable: ${detail}`);
    this.name = "LesionUnavailableError";
  }
}

export interface LesionProvider {
  analyze(imageB64: string, mime: string): Promise<LesionAnalysis>;
}

// Calls the Python FastAPI service (ai/service/lesion_service.py) over HTTP.
export class HttpLesionProvider implements LesionProvider {
  constructor(
    private baseUrl: string,
    private timeoutMs = 20_000,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async analyze(imageB64: string, mime: string): Promise<LesionAnalysis> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.baseUrl}/v1/lesion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: imageB64, mime }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new LesionUnavailableError(`status ${res.status}`);
      const parsed = validateLesionAnalysis(await res.json());
      if (!parsed.ok) throw new LesionUnavailableError(`malformed result: ${parsed.errors.join("; ")}`);
      return parsed.analysis;
    } catch (err) {
      if (err instanceof LesionUnavailableError) throw err;
      throw new LesionUnavailableError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}

// Dev/test provider: full backend flow with no Python running (LESION_FAKE=1).
export class FakeLesionProvider implements LesionProvider {
  async analyze(): Promise<LesionAnalysis> {
    const parsed = validateLesionAnalysis(golden);
    if (!parsed.ok) throw new LesionUnavailableError(`golden fixture invalid: ${parsed.errors.join("; ")}`);
    return parsed.analysis;
  }
}

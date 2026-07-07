import { describe, it, expect, vi } from "vitest";
import { handleAnalyze, type PipelineDeps } from "./pipeline";
import golden from "./fixtures/golden-report.json";

const goldenText = JSON.stringify(golden);
const approvedText = '{"verdict":"approved"}';

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    config: {
      apiKey: "sk-clinic",
      primaryModel: "claude-sonnet-5",
      critiqueModel: "claude-haiku-4-5-20251001",
      maxTokens: 2048,
    },
    callProvider: vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5" ? goldenText : approvedText,
    ),
    ...overrides,
  };
}

const goodInput = { image: "aGVsbG8=", mime: "image/jpeg", mode: "face" as const };

describe("handleAnalyze", () => {
  it("returns ok with a validated report on the happy path", async () => {
    const out = await handleAnalyze(goodInput, deps());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.report.summary).toBe((golden as { summary: string }).summary);
  });

  it("returns invalid-input for a bad mime type", async () => {
    const out = await handleAnalyze({ ...goodInput, mime: "text/html" }, deps());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("invalid-input");
  });

  it("retries once when the critique rejects, then fails honestly", async () => {
    const callProvider = vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5" ? goldenText : '{"verdict":"rejected","reasons":["bad"]}',
    );
    const out = await handleAnalyze(goodInput, deps({ callProvider }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("analysis-unreliable");
    expect(callProvider.mock.calls.filter(([, m]) => m === "claude-sonnet-5")).toHaveLength(2);
  });

  it("fails when the report never passes schema validation", async () => {
    const callProvider = vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5" ? '{"summary":"hi"}' : approvedText,
    );
    const out = await handleAnalyze(goodInput, deps({ callProvider }));
    expect(out.ok).toBe(false);
  });

  it("uses the amended report when the critique amends", async () => {
    const amended = {
      ...(golden as Record<string, unknown>),
      summary: "Amended summary — see a professional if unsure.",
    };
    const callProvider = vi.fn(async (_req, model: string) =>
      model === "claude-sonnet-5"
        ? goldenText
        : JSON.stringify({ verdict: "amended", reasons: [], amendedReport: amended }),
    );
    const out = await handleAnalyze(goodInput, deps({ callProvider }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.report.summary).toMatch(/^Amended/);
  });

  it("surfaces provider auth failures distinctly", async () => {
    const callProvider = vi.fn(async () => {
      const { ProviderAuthError } = await import("./providers/common");
      throw new ProviderAuthError();
    });
    const out = await handleAnalyze(goodInput, deps({ callProvider }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("provider-auth");
  });
});

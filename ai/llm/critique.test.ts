import { describe, it, expect, vi } from "vitest";
import { runCritique, buildCritiquePrompt } from "./critique";
import golden from "../evaluation/fixtures/golden-report.json";
import type { AnalysisReport } from "../../shared/contract";

const report = golden as unknown as AnalysisReport;

describe("buildCritiquePrompt", () => {
  it("embeds the report and review criteria", () => {
    const p = buildCritiquePrompt(report);
    expect(p).toContain(report.summary);
    expect(p).toMatch(/overconfiden/i);
    expect(p).toMatch(/approved|amended|rejected/);
  });
});

describe("runCritique", () => {
  it("returns approved verdicts as-is", async () => {
    const llm = vi.fn(async () => '{"verdict":"approved","reasons":[]}');
    const out = await runCritique(report, llm);
    expect(out.verdict).toBe("approved");
  });

  it("returns an amended report when the critic amends", async () => {
    const amended = { ...report, summary: report.summary + " (amended)" };
    const llm = vi.fn(async () =>
      JSON.stringify({ verdict: "amended", reasons: ["softened wording"], amendedReport: amended }),
    );
    const out = await runCritique(report, llm);
    expect(out.verdict).toBe("amended");
    if (out.verdict === "amended") expect(out.report.summary).toMatch(/\(amended\)$/);
  });

  it("treats an amended verdict with an invalid amendedReport as rejected", async () => {
    const llm = vi.fn(async () =>
      JSON.stringify({ verdict: "amended", reasons: [], amendedReport: { bad: true } }),
    );
    const out = await runCritique(report, llm);
    expect(out.verdict).toBe("rejected");
  });

  it("treats unparseable critic output as rejected", async () => {
    const llm = vi.fn(async () => "I refuse to answer in JSON");
    const out = await runCritique(report, llm);
    expect(out.verdict).toBe("rejected");
  });
});

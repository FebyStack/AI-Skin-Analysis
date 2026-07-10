import { validateAnalysisReport, type AnalysisReport } from "../../shared/contract";
import { extractJson } from "./providers/common";

export type CritiqueOutcome =
  | { verdict: "approved" }
  | { verdict: "amended"; report: AnalysisReport; reasons: string[] }
  | { verdict: "rejected"; reasons: string[] };

export function buildCritiquePrompt(report: AnalysisReport): string {
  return `You are reviewing another AI's skin-analysis report for safety and reasoning quality. Do NOT re-analyze the image; review the report text.

REPORT:
${JSON.stringify(report)}

CHECK:
1. Does each conclusion follow from the stated observations?
2. Is any confidence overconfident given the evidence described (overconfidence check)?
3. Are the safety rules intact: "consistent with" language, no diagnosis, no treatment advice, lesions escalated to professional evaluation, disclaimer present, visual-proxy dimensions framed as inference not measurement?

Respond with ONLY JSON: {"verdict":"approved"} if fine; {"verdict":"amended","reasons":[...],"amendedReport":<full corrected report with the same schema>} for fixable wording/confidence issues; {"verdict":"rejected","reasons":[...]} if the report is unsalvageable.`;
}

export type LlmTextFn = (prompt: string) => Promise<string>;

export async function runCritique(
  report: AnalysisReport,
  llm: LlmTextFn,
): Promise<CritiqueOutcome> {
  const raw = await llm(buildCritiquePrompt(report));
  const parsed = extractJson(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed.verdict !== "string") {
    return { verdict: "rejected", reasons: ["critic output unparseable"] };
  }
  const reasons = Array.isArray(parsed.reasons) ? (parsed.reasons as string[]) : [];

  if (parsed.verdict === "approved") return { verdict: "approved" };

  if (parsed.verdict === "amended") {
    const validated = validateAnalysisReport(parsed.amendedReport);
    if (validated.ok) return { verdict: "amended", report: validated.report, reasons };
    return { verdict: "rejected", reasons: [...reasons, "amended report failed schema validation"] };
  }

  return { verdict: "rejected", reasons };
}

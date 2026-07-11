// Gemini receives ONLY the classifier's structured JSON — never the image.
// Turns a LesionAnalysis into patient-friendly text, guardrailed and retried.
import { extractJson } from "./providers/common";
import {
  hasMalignantSignal,
  validateLesionExplanation,
  type LesionAnalysis,
  type LesionExplanation,
} from "../../shared/lesion";

export const LESION_EXPLAIN_PROMPT_VERSION = 1;

const CERTAINTY = /\b(definitely|certainly|without a doubt|you have|it is cancer|confirmed diagnosis)\b/i;
const TREATMENT = /\b(take|apply|prescri|dosage|\d+\s*mg)\b/i;

export function buildLesionPrompt(analysis: LesionAnalysis): string {
  return [
    "You are a careful medical-communication assistant for a skin-analysis tool.",
    "An image classifier (not you) produced this structured result:",
    "```json",
    JSON.stringify(analysis, null, 2),
    "```",
    "Write a JSON object with exactly these fields:",
    `{"patientSummary": string, "education": string, "referral": {"recommended": boolean, "urgency": "routine"|"soon"|"urgent", "reason": string}, "disclaimer": string, "source": "gemini", "promptVersion": ${LESION_EXPLAIN_PROMPT_VERSION}}`,
    "Hard rules — do not violate any:",
    "- Do NOT diagnose, do NOT claim certainty, do NOT override or re-rank the classifier.",
    "- Frame everything as 'the analysis suggests…'; a professional must confirm.",
    "- If any of MEL, BCC, or SCC appears in the results, referral.recommended MUST be true.",
    "- No treatment or medication advice.",
    "- disclaimer must state this is not a diagnosis.",
    "- If the prediction is blank/unknown, explain it was inconclusive and recommend professional evaluation.",
    "Respond with ONLY the JSON object.",
  ].join("\n");
}

export function checkLesionExplanationGuardrails(
  explanation: LesionExplanation,
  analysis: LesionAnalysis,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const text = `${explanation.patientSummary} ${explanation.education}`;
  if (CERTAINTY.test(text)) violations.push("certainty language");
  if (TREATMENT.test(text)) violations.push("treatment advice");
  if (!/not a diagnosis/i.test(explanation.disclaimer)) violations.push("weak disclaimer");
  if (hasMalignantSignal(analysis) && !explanation.referral.recommended) violations.push("missing mandatory referral");
  return { ok: violations.length === 0, violations };
}

// callProvider: (prompt) => raw text. Returns a guardrail-passing explanation, or null
// (caller then substitutes the builtin explanation).
export async function explainLesion(
  analysis: LesionAnalysis,
  callProvider: (prompt: string) => Promise<string>,
): Promise<LesionExplanation | null> {
  const prompt = buildLesionPrompt(analysis);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callProvider(prompt).catch(() => null);
    if (raw === null) continue;
    const parsed = validateLesionExplanation(extractJson(raw));
    if (!parsed.ok) continue;
    const explanation: LesionExplanation = {
      ...parsed.explanation,
      source: "gemini",
      promptVersion: LESION_EXPLAIN_PROMPT_VERSION,
    };
    if (checkLesionExplanationGuardrails(explanation, analysis).ok) return explanation;
  }
  return null;
}

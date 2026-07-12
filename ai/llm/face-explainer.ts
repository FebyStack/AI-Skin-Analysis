// Gemini receives ONLY the FaceReport JSON — never any image.
// Turns a face report into a rephrased/personalized summary + education,
// guardrailed and retried; caller substitutes the builtin on failure.
import { extractJson } from "./providers/common";
import {
  validateFaceExplanation,
  type FaceExplanation,
  type FaceReport,
} from "../../shared/face";

export const FACE_EXPLAIN_PROMPT_VERSION = 1;

const CERTAINTY = /\b(definitely|certainly|without a doubt|you have|diagnos)\b/i;
const TREATMENT = /\b(prescri|dosage|\d+\s*mg|apply\s+\w+\s+cream)\b/i;

export function buildFacePrompt(report: FaceReport): string {
  // Include the dimensions + overall + recommendations. No image, ever.
  const trimmed = {
    overall: report.overall,
    dimensions: report.dimensions,
    recommendations: report.recommendations,
    disclaimer: report.disclaimer,
  };
  return [
    "You are a careful cosmetic-communication assistant for a skin-analysis tool.",
    "An on-device analysis (not you) produced this structured face report:",
    "```json",
    JSON.stringify(trimmed, null, 2),
    "```",
    "Write a JSON object with exactly these fields:",
    `{"patientSummary": string, "education": string, "source": "gemini", "promptVersion": ${FACE_EXPLAIN_PROMPT_VERSION}}`,
    "Hard rules — do not violate any:",
    "- Rephrase and personalize the report ONLY; do not add new clinical claims or invent findings.",
    "- Do NOT diagnose, do NOT claim certainty, do NOT prescribe medications or dosages.",
    "- Keep language cosmetic and educational, not medical.",
    "- Respond with ONLY the JSON object.",
  ].join("\n");
}

export function checkFaceExplanationGuardrails(
  explanation: FaceExplanation,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const text = `${explanation.patientSummary} ${explanation.education}`;
  if (CERTAINTY.test(text)) violations.push("certainty language");
  if (TREATMENT.test(text)) violations.push("treatment advice");
  if (explanation.patientSummary.length < 10) violations.push("summary too short");
  if (explanation.education.length < 10) violations.push("education too short");
  return { ok: violations.length === 0, violations };
}

// callProvider: (prompt) => raw text. Returns a guardrail-passing explanation, or null.
export async function explainFace(
  report: FaceReport,
  callProvider: (prompt: string) => Promise<string>,
): Promise<FaceExplanation | null> {
  const prompt = buildFacePrompt(report);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callProvider(prompt).catch(() => null);
    if (raw === null) continue;
    const parsed = validateFaceExplanation(extractJson(raw));
    if (!parsed.ok) continue;
    const explanation: FaceExplanation = {
      ...parsed.explanation,
      source: "gemini",
      promptVersion: FACE_EXPLAIN_PROMPT_VERSION,
    };
    if (checkFaceExplanationGuardrails(explanation).ok) return explanation;
  }
  return null;
}

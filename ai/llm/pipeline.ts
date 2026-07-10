import { validateAnalysisReport, type AnalysisReport } from "../../shared/contract";
import { validateInput, checkOutputGuardrails, type AnalyzeInput } from "./guardrails";
import { systemPrompt, userPrompt, PROMPT_VERSION } from "./prompts";
import { extractJson, ProviderAuthError } from "./providers/common";
import { runCritique } from "./critique";

export interface PipelineConfig {
  apiKey: string;
  primaryModel: string;
  critiqueModel: string;
  maxTokens: number;
}

export interface VisionCall {
  imageB64: string;
  mime: string;
  system: string;
  user: string;
}

export interface PipelineDeps {
  config: PipelineConfig;
  // Seam over the provider: (request, model) → raw text. The api key is in config.
  callProvider: (req: VisionCall, model: string) => Promise<string>;
}

export type PipelineOutcome =
  | { ok: true; report: AnalysisReport; promptVersion: number }
  | { ok: false; reason: "invalid-input" | "provider-auth" | "analysis-unreliable"; detail?: string };

async function analyzeOnce(input: AnalyzeInput, deps: PipelineDeps): Promise<AnalysisReport | null> {
  const raw = await deps.callProvider(
    { imageB64: input.image, mime: input.mime, system: systemPrompt(), user: userPrompt(input.mode) },
    deps.config.primaryModel,
  );
  const parsed = extractJson(raw);
  const validated = validateAnalysisReport(parsed);
  if (!validated.ok) return null;

  const critique = await runCritique(validated.report, (prompt) =>
    deps.callProvider(
      { imageB64: input.image, mime: input.mime, system: "You are a careful reviewer.", user: prompt },
      deps.config.critiqueModel,
    ),
  );

  if (critique.verdict === "approved") return validated.report;
  if (critique.verdict === "amended") return critique.report;
  return null;
}

export async function handleAnalyze(
  input: AnalyzeInput,
  deps: PipelineDeps,
): Promise<PipelineOutcome> {
  const inputCheck = validateInput(input);
  if (!inputCheck.ok) return { ok: false, reason: "invalid-input", detail: inputCheck.error };

  try {
    // One honest retry: rejected critique / invalid schema / guardrail violation
    // gets a second attempt, then an honest failure — never a degraded guess.
    for (let attempt = 0; attempt < 2; attempt++) {
      const report = await analyzeOnce(input, deps);
      if (report) {
        const guard = checkOutputGuardrails(report);
        if (!guard.ok) continue;
        return { ok: true, report, promptVersion: PROMPT_VERSION };
      }
    }
    return { ok: false, reason: "analysis-unreliable" };
  } catch (err) {
    if (err instanceof ProviderAuthError) return { ok: false, reason: "provider-auth" };
    throw err;
  }
}

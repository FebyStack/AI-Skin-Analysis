import type { PatientRepo } from "../modules/patients/repository";
import type { ScanRepo } from "../modules/analysis/repository";
import type { SettingsRepo } from "../modules/settings/repository";
import type { PipelineDeps } from "../../ai/llm/pipeline";
import type { LesionProvider } from "../modules/analysis/lesion-client";
import type { LesionAnalysis, LesionExplanation } from "../../shared/lesion";

export interface AppDeps {
  patients: PatientRepo;
  scans: ScanRepo;
  settings: SettingsRepo;
  pipeline: PipelineDeps;
  lesion: LesionProvider; // Python lesion service (HTTP), or Fake in dev/test
  // Optional online explainer (Gemini). Undefined/failing → route uses the builtin
  // offline explanation. Never receives the image, only the analysis JSON.
  lesionExplain?: (analysis: LesionAnalysis) => Promise<LesionExplanation | null>;
  sessionSecret: string;
  now: () => number;
}

import type { Pool } from "pg";
import type { PatientRepo } from "../modules/patients/repository";
import type { ScanRepo } from "../modules/analysis/repository";
import type { SettingsRepo } from "../modules/settings/repository";
import type { PipelineDeps } from "../../ai/llm/pipeline";
import type { LesionProvider } from "../modules/analysis/lesion-client";
import type { LesionAnalysis, LesionExplanation } from "../../shared/lesion";
import type { FaceReport, FaceExplanation } from "../../shared/face";

export interface AppDeps {
  pool?: Pool;
  patients: PatientRepo;
  scans: ScanRepo;
  settings: SettingsRepo;
  pipeline: PipelineDeps;
  lesion: LesionProvider; // Python lesion service (HTTP), or Fake in dev/test
  // Optional online explainer (Gemini). Undefined/failing → route uses the builtin
  // offline explanation. Never receives the image, only the analysis JSON.
  lesionExplain?: (analysis: LesionAnalysis) => Promise<LesionExplanation | null>;
  // Optional online face explainer (Gemini). Same JSON-only, offline-safe pattern.
  faceExplain?: (report: FaceReport) => Promise<FaceExplanation | null>;
  sessionSecret: string;
  now: () => number;
}

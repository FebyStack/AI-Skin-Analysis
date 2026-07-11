import type { PatientRepo } from "../modules/patients/repository";
import type { ScanRepo } from "../modules/analysis/repository";
import type { SettingsRepo } from "../modules/settings/repository";
import type { PipelineDeps } from "../../ai/llm/pipeline";
import type { LesionProvider } from "../modules/analysis/lesion-client";

export interface AppDeps {
  patients: PatientRepo;
  scans: ScanRepo;
  settings: SettingsRepo;
  pipeline: PipelineDeps;
  lesion: LesionProvider; // Python lesion service (HTTP), or Fake in dev/test
  sessionSecret: string;
  now: () => number;
}

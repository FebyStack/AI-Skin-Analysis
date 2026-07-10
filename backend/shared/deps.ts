import type { PatientRepo } from "../modules/patients/repository";
import type { ScanRepo } from "../modules/analysis/repository";
import type { SettingsRepo } from "../modules/settings/repository";
import type { PipelineDeps } from "../../ai/llm/pipeline";

export interface AppDeps {
  patients: PatientRepo;
  scans: ScanRepo;
  settings: SettingsRepo;
  pipeline: PipelineDeps;
  sessionSecret: string;
  now: () => number;
}

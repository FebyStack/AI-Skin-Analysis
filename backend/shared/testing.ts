import { MemoryPatientRepo } from "../modules/patients/repository";
import { MemoryScanRepo } from "../modules/analysis/repository";
import { MemorySettingsRepo } from "../modules/settings/repository";
import { FakeLesionProvider } from "../modules/analysis/lesion-client";
import type { AppDeps } from "./deps";
import goldenReport from "../../ai/evaluation/fixtures/golden-report.json";

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    patients: new MemoryPatientRepo(),
    scans: new MemoryScanRepo(),
    settings: new MemorySettingsRepo(),
    pipeline: {
      config: {
        apiKey: "sk-test",
        primaryModel: "claude-sonnet-5",
        critiqueModel: "claude-haiku-4-5-20251001",
        maxTokens: 2048,
      },
      callProvider: async (_req, model) =>
        model === "claude-sonnet-5"
          ? JSON.stringify(goldenReport)
          : '{"verdict":"approved"}',
    },
    lesion: new FakeLesionProvider(),
    sessionSecret: "test-secret",
    now: () => Date.now(),
    ...overrides,
  };
}

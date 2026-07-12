/**
 * Lightweight dev server that uses in-memory repos instead of PostgreSQL.
 * No Docker required — just `npm run dev:lite`.
 */
import { randomBytes } from "node:crypto";
import { createApp } from "../app/app";
import { lesionProviderFromEnv } from "../modules/analysis/lesion-provider";
import { explainLesion } from "../../ai/llm/lesion-explainer";
import { explainFace } from "../../ai/llm/face-explainer";
import { MemoryPatientRepo } from "../modules/patients/repository";
import { MemoryScanRepo } from "../modules/analysis/repository";
import { MemorySettingsRepo } from "../modules/settings/repository";
import { callGemini } from "../../ai/llm/providers/gemini";

async function main() {
  const settings = new MemorySettingsRepo();
  const sessionSecret = randomBytes(32).toString("hex");

  const apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) console.warn("⚠  GEMINI_API_KEY unset — analyses will fail (partial scans only)");

  console.log("🧪 Running in LITE mode (in-memory storage, no PostgreSQL)");
  console.log("   Data will be lost when the server restarts.\n");

  const app = createApp({
    patients: new MemoryPatientRepo(),
    scans: new MemoryScanRepo(),
    settings,
    pipeline: {
      config: {
        apiKey,
        primaryModel: process.env.PRIMARY_MODEL ?? "gemini-2.5-flash",
        critiqueModel: process.env.CRITIQUE_MODEL ?? "gemini-2.5-flash",
        maxTokens: Number(process.env.MAX_TOKENS ?? "2048"),
      },
      callProvider: async (req, model) => {
        const result = await callGemini(req, {
          apiKey,
          model,
          maxTokens: Number(process.env.MAX_TOKENS ?? "2048"),
        });
        return result.text;
      },
    },
    lesion: lesionProviderFromEnv(),
    lesionExplain: apiKey
      ? (analysis) =>
          explainLesion(analysis, (prompt) =>
            callGemini(
              { imageB64: "", mime: "", system: "You are a careful medical-communication assistant.", user: prompt },
              { apiKey, model: process.env.CRITIQUE_MODEL ?? "gemini-2.5-flash", maxTokens: Number(process.env.MAX_TOKENS ?? "2048") },
            ).then((r) => r.text),
          )
      : undefined,
    faceExplain: apiKey
      ? (report) =>
          explainFace(report, (prompt) =>
            callGemini(
              { imageB64: "", mime: "", system: "You are a careful cosmetic-communication assistant.", user: prompt },
              { apiKey, model: process.env.CRITIQUE_MODEL ?? "gemini-2.5-flash", maxTokens: Number(process.env.MAX_TOKENS ?? "2048") },
            ).then((r) => r.text),
          )
      : undefined,
    sessionSecret,
    now: () => Date.now(),
  });

  const port = Number(process.env.PORT ?? "3001");
  app.listen(port, () => console.log(`✅ API listening on http://localhost:${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

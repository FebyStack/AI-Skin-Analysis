import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../app/app";
import { lesionProviderFromEnv } from "../modules/analysis/lesion-provider";
import { explainLesion } from "../../ai/llm/lesion-explainer";
import { explainFace } from "../../ai/llm/face-explainer";
import { PgPatientRepo } from "../modules/patients/repository";
import { PgScanRepo } from "../modules/analysis/repository";
import { PgSettingsRepo } from "../modules/settings/repository";
import { callGemini } from "../../ai/llm/providers/gemini";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://skin:skin@db:5432/skin",
    max: 20, // Maximum number of connections in the pool
    idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  });
  // Idempotent schema apply on boot — fine for a single-writer clinic app.
  // cwd is the repo root in dev (npm scripts) and /app in the container (WORKDIR).
  const schema = readFileSync(path.resolve(process.cwd(), "database/schema/schema.sql"), "utf8");
  await pool.query(schema);

  const settings = new PgSettingsRepo(pool);
  let sessionSecret = await settings.get("session_secret");
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString("hex");
    await settings.set("session_secret", sessionSecret);
  }

  const apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) console.error("WARNING: GEMINI_API_KEY unset — analyses will fail (partial scans only)");

  const app = createApp({
    patients: new PgPatientRepo(pool),
    scans: new PgScanRepo(pool),
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
  app.listen(port, () => console.log(`api listening on :${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

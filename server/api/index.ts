import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "./app";
import { PgPatientRepo, PgScanRepo, PgSettingsRepo } from "./pg-repos";
import { callGemini } from "../../ai/llm/providers/gemini";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://skin:skin@db:5432/skin",
    max: 20, // Maximum number of connections in the pool
    idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  });
  // Idempotent schema apply on boot — fine for a single-writer clinic app.
  const schema = readFileSync(path.join(import.meta.dirname ?? __dirname, "../db/schema.sql"), "utf8");
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

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "./app";
import { PgPatientRepo, PgScanRepo, PgSettingsRepo } from "./pg-repos";
import { callClaude } from "../analysis/providers/anthropic";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://skin:skin@db:5432/skin",
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

  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) console.error("WARNING: ANTHROPIC_API_KEY unset — analyses will fail (partial scans only)");

  const app = createApp({
    patients: new PgPatientRepo(pool),
    scans: new PgScanRepo(pool),
    settings,
    pipeline: {
      config: {
        apiKey,
        primaryModel: process.env.PRIMARY_MODEL ?? "claude-sonnet-5",
        critiqueModel: process.env.CRITIQUE_MODEL ?? "claude-haiku-4-5-20251001",
        maxTokens: Number(process.env.MAX_TOKENS ?? "2048"),
      },
      callProvider: async (req, model) => {
        const result = await callClaude(req, {
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

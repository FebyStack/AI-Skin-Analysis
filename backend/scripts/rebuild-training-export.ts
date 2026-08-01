/**
 * Rebuild every dimension's training folder from the current database labels.
 *
 *   npx tsx --env-file=.env backend/scripts/rebuild-training-export.ts --dry-run
 *   npx tsx --env-file=.env backend/scripts/rebuild-training-export.ts
 *
 * Same routine the HTTP endpoint runs (./rebuild-export), just without needing a
 * clinician session — this is maintenance, not a clinic action.
 *
 * Why it exists: the export used to append, so `<dim>/scans/` only ever grew.
 * Deleting a scan cascaded its label away in Postgres but left the exported
 * JPEG on disk forever, and re-grading a scan added a second copy under the new
 * label while the old one stayed. The trainer read all of it.
 *
 * Safe to run repeatedly. Every image is reproduced from `scan_images`, so
 * nothing here is unrecoverable — the database is the source of truth and this
 * directory is a derived artefact.
 */
import path from "node:path";
import { Pool } from "pg";
import { PgScanRepo } from "../modules/analysis/repository";
import { rebuildExport } from "../modules/training/rebuild-export";
import { ANNOTATION_FIELDS } from "../../shared/training-queue";

const DRY = process.argv.includes("--dry-run");

function datasetsDir(): string {
  return process.env.DATASETS_DIR ?? path.resolve(process.cwd(), "ai/datasets");
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const scans = new PgScanRepo(pool);

  console.log(
    `${DRY ? "PLAN (nothing written)" : "REBUILD"} — ${datasetsDir()}\n` +
      "dimension          labelled  written  removed  relabelled  retired-dirs",
  );

  let totalRemoved = 0;
  let totalRelabelled = 0;
  for (const field of ANNOTATION_FIELDS) {
    const r = await rebuildExport(
      scans,
      field.key,
      new Set<string>(field.options),
      path.join(datasetsDir(), field.key, "scans"),
      { dryRun: DRY },
    );
    totalRemoved += r.removed;
    totalRelabelled += r.relabelled;
    console.log(
      `  ${field.key.padEnd(17)} ${String(r.labelled).padStart(6)}` +
        `   ${String(r.written).padStart(6)}` +
        `   ${String(r.removed).padStart(6)}` +
        `      ${String(r.relabelled).padStart(6)}` +
        `      ${r.removedDirs.join(",") || "-"}`,
    );
    if (r.missing.length) console.log(`      ${r.missing.length} scan(s) had no image — skipped`);
    // A label the vocabulary cannot express is a contract break, not a warning:
    // it means something wrote a value the annotation panel never offered.
    if (r.unmappable.length) {
      console.log(`      UNMAPPABLE: ${r.unmappable.map((u) => u.label).join(", ")}`);
    }
  }

  await pool.end();
  console.log(
    DRY
      ? `\nWould remove ${totalRemoved} orphan(s) and move ${totalRelabelled}. Re-run without --dry-run.`
      : `\nRemoved ${totalRemoved} orphan(s), moved ${totalRelabelled}. Check: make dimension-readiness`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

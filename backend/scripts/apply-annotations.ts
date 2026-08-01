/**
 * Write a labelling run's JSONL back into `scan_labels`.
 *
 *   npx tsx --env-file=.env backend/scripts/apply-annotations.ts [--dry-run]
 *
 * Reads every ai/datasets/_annotate/labels*.jsonl and applies each record, so the
 * annotations join the SAME pipeline clinician grades use: scan_labels →
 * rebuild-export → <dim>/scans/<label>/ → trainer.
 *
 * What it refuses to write, and why each refusal exists:
 *
 * - **A scan without training consent.** `consent_training` defaults to false
 *   and gates entry to the training queue; building a dataset from a scan that
 *   lacks it is precisely the use the flag withholds. The manifest filters these
 *   out too, but a JSONL written before that filter existed would not have, and
 *   this is the step that writes.
 * - **A value outside the attribute's vocabulary.** The backend would reject it
 *   and the row would vanish silently; better to fail loudly here.
 * - **An attribute the annotator marked `uncertain`.** Those are excluded from
 *   training by design — recording them would launder a low-confidence guess
 *   into apparent fact.
 * - **Any record whose `quality` is not `ok`.** An image that could not be
 *   assessed has no labels worth keeping.
 * - **An attribute the scan already has.** A clinician's grade outranks a
 *   model's; annotation fills gaps, it never overwrites human judgement.
 *   `--overwrite` exists but is deliberately not the default.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { ANNOTATION_FIELDS } from "../../shared/training-queue";
import { labelFiles } from "./label-files";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const OVERWRITE = args.includes("--overwrite");

const VOCAB = new Map<string, Set<string>>(
  ANNOTATION_FIELDS.map((f) => [f.key, new Set<string>(f.options)]),
);

interface Record_ {
  image?: string;
  labels?: Record<string, string>;
  uncertain?: string[];
  quality?: string;
  notes?: string;
}

function datasetsDir(): string {
  return process.env.DATASETS_DIR ?? path.resolve(process.cwd(), "ai/datasets");
}

async function main(): Promise<void> {
  const outDir = path.join(datasetsDir(), "_annotate");
  const files = labelFiles(outDir);
  if (!files.length) {
    console.log(`No labels*.jsonl in ${outDir}. Run the labeller first.`);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });

  // Defence in depth: the manifest already filters on consent, but a JSONL from
  // an older run predates that filter, and this is the step that writes.
  const consented = new Set(
    (await pool.query<{ id: string }>(`SELECT id FROM scans WHERE consent_training = true`)).rows.map(
      (r) => r.id,
    ),
  );

  const existing = new Map<string, Set<string>>();
  for (const r of (await pool.query<{ scan_id: string; dimension: string }>(
    `SELECT scan_id, dimension FROM scan_labels`,
  )).rows) {
    existing.set(r.scan_id, (existing.get(r.scan_id) ?? new Set()).add(r.dimension));
  }

  let applied = 0;
  let skippedQuality = 0;
  let skippedNoConsent = 0;
  let skippedUncertain = 0;
  let skippedExisting = 0;
  let malformed = 0;
  const invalid: string[] = [];

  const lines = files.flatMap((f) => readFileSync(f, "utf8").split("\n"));
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: Record_;
    try {
      rec = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    const scanId = path.basename(rec.image ?? "", ".jpg");
    if (!scanId) {
      malformed++;
      continue;
    }
    if (rec.quality && rec.quality !== "ok") {
      skippedQuality++;
      continue;
    }
    if (!consented.has(scanId)) {
      skippedNoConsent++;
      continue;
    }
    const uncertain = new Set(rec.uncertain ?? []);
    // Kept in the map, not a throwaway copy: with several shards the same scan
    // can appear twice, and the second occurrence must count as existing rather
    // than be applied again.
    let have = existing.get(scanId);
    if (!have) existing.set(scanId, (have = new Set<string>()));

    for (const [dimension, value] of Object.entries(rec.labels ?? {})) {
      if (uncertain.has(dimension)) {
        skippedUncertain++;
        continue;
      }
      const allowed = VOCAB.get(dimension);
      if (!allowed || !allowed.has(value)) {
        invalid.push(`${scanId} ${dimension}=${value}`);
        continue;
      }
      if (have.has(dimension) && !OVERWRITE) {
        skippedExisting++;
        continue;
      }
      if (!DRY) {
        await pool.query(
          `INSERT INTO scan_labels (scan_id, dimension, label)
           VALUES ($1, $2, $3)
           ON CONFLICT (scan_id, dimension) DO UPDATE SET label = EXCLUDED.label`,
          [scanId, dimension, value],
        );
      }
      have.add(dimension);
      applied++;
    }
  }

  await pool.end();
  console.log(
    `${DRY ? "PLAN — nothing written" : "APPLIED"}\n` +
      `  labels written    ${applied}\n` +
      `  skipped uncertain ${skippedUncertain}\n` +
      `  skipped existing  ${skippedExisting}${OVERWRITE ? " (overwrite on)" : " (human grades win)"}\n` +
      `  skipped bad image ${skippedQuality}\n` +
      `  skipped no consent ${skippedNoConsent} (consent_training = false)\n` +
      `  malformed lines   ${malformed}`,
  );
  if (invalid.length) {
    // A value the vocabulary does not contain means the annotator drifted off
    // the rubric. Loud, because the backend would have dropped these silently.
    console.log(`\n  ${invalid.length} INVALID value(s) — not written:`);
    for (const v of invalid.slice(0, 10)) console.log(`    ${v}`);
  }
  if (!DRY && applied) console.log(`\nNext: make rebuild-export  →  make dimension-readiness`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

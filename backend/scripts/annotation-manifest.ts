/**
 * Build a manifest of scans that still need annotating, and stage their images.
 *
 *   npx tsx --env-file=.env backend/scripts/annotation-manifest.ts [--limit 40] [--redo]
 *
 * DEDUPLICATION IS THE POINT. Annotating is the expensive step, so a scan that
 * already carries labels must never be offered again — not on the next batch,
 * not when new data lands, not after a crash halfway through. A scan is
 * considered done when it holds a label for EVERY attribute in
 * ANNOTATION_FIELDS; a partially-labelled scan comes back with only its missing
 * attributes listed, so an interrupted batch resumes instead of restarting.
 *
 * Writes:
 *   ai/datasets/_annotate/images/<scanId>.jpg   staged front image
 *   ai/datasets/_annotate/manifest.jsonl        one line per scan to label
 *
 * The staging directory is NOT a training source — `ai.training.dimension.ingest`
 * only reads `scans/`, so nothing here can reach the trainer un-reviewed.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { PgScanRepo } from "../modules/analysis/repository";
import { ANNOTATION_FIELDS } from "../../shared/training-queue";
import { labelFiles } from "./label-files";

const args = process.argv.slice(2);
const REDO = args.includes("--redo");
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

const ALL_KEYS = ANNOTATION_FIELDS.map((f) => f.key);

function datasetsDir(): string {
  return process.env.DATASETS_DIR ?? path.resolve(process.cwd(), "ai/datasets");
}

/** Scans already recorded in any previous labelling run's output. */
function alreadyEmitted(outDir: string): Set<string> {
  const done = new Set<string>();
  for (const file of labelFiles(outDir)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as { image?: string };
        const id = path.basename(rec.image ?? "", ".jpg");
        if (id) done.add(id);
      } catch {
        /* a truncated final line from an interrupted run — ignore it */
      }
    }
  }
  return done;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const scans = new PgScanRepo(pool);

  const outDir = path.join(datasetsDir(), "_annotate");
  const imgDir = path.join(outDir, "images");
  mkdirSync(imgDir, { recursive: true });

  // Existing labels, so a scan is never offered for an attribute it already has.
  const { rows } = await pool.query<{ scan_id: string; dimension: string }>(
    `SELECT scan_id, dimension FROM scan_labels`,
  );
  const labelled = new Map<string, Set<string>>();
  for (const r of rows) {
    labelled.set(r.scan_id, (labelled.get(r.scan_id) ?? new Set()).add(r.dimension));
  }

  const emitted = REDO ? new Set<string>() : alreadyEmitted(outDir);
  // --redo discards EVERY shard, not just labels.jsonl; leaving one behind would
  // make the "redo" silently partial.
  if (REDO) for (const f of labelFiles(outDir)) rmSync(f, { force: true });

  // Every face scan that has an image AND carries training consent, newest first.
  //
  // The consent filter is not optional. `consent_training` defaults to false and
  // is what gates entry to the training queue; a scan without it must never be
  // used to build a dataset, and labelling it is exactly that use. Without this
  // clause the manifest staged 23 non-consented scans and they were labelled.
  const { rows: candidates } = await pool.query<{ id: string }>(
    `SELECT s.id FROM scans s
      WHERE s.mode = 'face'
        AND s.consent_training = true
        AND EXISTS (SELECT 1 FROM scan_images i WHERE i.scan_id = s.id)
      ORDER BY s.created_at DESC`,
  );

  const manifest: string[] = [];
  let staged = 0;
  let skippedComplete = 0;
  let skippedEmitted = 0;

  for (const { id } of candidates) {
    if (manifest.length >= LIMIT) break;

    const have = labelled.get(id) ?? new Set<string>();
    const missing = ALL_KEYS.filter((k) => !have.has(k));
    if (missing.length === 0) {
      skippedComplete++;
      continue;
    }
    if (emitted.has(id)) {
      skippedEmitted++;
      continue;
    }

    const img = (await scans.getScanImage(id, "front")) ?? (await scans.getImage(id));
    if (!img) continue;

    const file = path.join(imgDir, `${id}.jpg`);
    if (!existsSync(file)) writeFileSync(file, Buffer.from(img.jpeg));
    staged++;

    manifest.push(JSON.stringify({ image: path.relative(process.cwd(), file), needs: missing }));
  }

  writeFileSync(path.join(outDir, "manifest.jsonl"), manifest.join("\n") + (manifest.length ? "\n" : ""));

  await pool.end();
  console.log(
    `scans considered   ${candidates.length}\n` +
      `  already complete ${skippedComplete}  (every attribute labelled)\n` +
      `  already emitted  ${skippedEmitted}  (present in labels*.jsonl)\n` +
      `  staged to label  ${staged}\n\n` +
      `manifest: ${path.join(outDir, "manifest.jsonl")}\n` +
      `images:   ${imgDir}\n` +
      (manifest.length
        ? `\nNext: dispatch the face-labeller agent with that manifest,\n` +
          `appending records to ${path.join(outDir, "labels.jsonl")}.`
        : `\nNothing to label.`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

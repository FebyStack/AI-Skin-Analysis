/**
 * Load external face images into the Training Queue so a clinician can grade
 * them on the app's severity scale.
 *
 *   npx tsx --env-file=.env backend/scripts/import-for-grading.ts [--dry-run]
 *
 * WHY THIS EXISTS
 * ---------------
 * No public dataset grades skin dimensions none/mild/moderate/severe — they all
 * label presence/absence. So a download cannot become training data on its own;
 * somebody has to say how bad it is. This puts the images where that judgement
 * already happens.
 *
 * It also fixes the shape of the clinic's own data. The graded scans so far are
 * almost entirely "mild"/"none", and a model never shown a severe case cannot
 * predict one. These images carry the moderate/severe end that is missing.
 *
 * The scans are marked `imported: true` in their report so they are never
 * mistaken for patient visits, and they are attached to a dedicated
 * "Imported dataset" patient rather than the walk-in record.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { PgPatientRepo } from "../modules/patients/repository";
import { PgScanRepo } from "../modules/analysis/repository";
import { compressToJpeg } from "../utils/image";
import { dHash } from "../utils/image-hash";

const DRY = process.argv.includes("--dry-run");
const ROOT = process.env.DATASETS_DIR ?? path.resolve(process.cwd(), "ai/datasets");
const INCOMING = path.join(ROOT, "_incoming");

/** Angle names the app understands, keyed by the filename each source uses. */
const ANGLE_BY_FILE: Record<string, string> = {
  "front.jpg": "front",
  "left_side.jpg": "left-45",
  "right_side.jpg": "right-45",
};

interface Import {
  /** Files that belong to ONE subject, so multi-angle shots stay together. */
  files: { file: string; angle: string }[];
  /** Free-text note carried into the queue so the grader knows the source. */
  note: string;
}

/** Anywhere under _incoming: `<defect>/<subject>/{front,left_side,right_side}.jpg` */
function collectSkinDefects(): Import[] {
  // Kaggle sometimes nests the payload one level deeper depending on the zip,
  // so locate the "files" directory rather than assuming where it sits.
  const base = findDir(INCOMING, "files");
  if (!base) return [];
  const out: Import[] = [];
  for (const defect of readdirSync(base)) {
    const dir = path.join(base, defect);
    if (!statSync(dir).isDirectory()) continue;
    for (const subject of readdirSync(dir)) {
      const sdir = path.join(dir, subject);
      if (!statSync(sdir).isDirectory()) continue;
      const files = readdirSync(sdir)
        .filter((f) => ANGLE_BY_FILE[f])
        .map((f) => ({ file: path.join(sdir, f), angle: ANGLE_BY_FILE[f] }));
      if (files.length) {
        out.push({ files, note: `TrainingDataPro skin-defects · flagged "${defect}"` });
      }
    }
  }
  return out;
}

/** Locate a directory by name, a few levels down. */
function findDir(root: string, name: string, depth = 3): string | null {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const p = path.join(root, entry);
    if (!statSync(p).isDirectory()) continue;
    if (entry === name) return p;
    if (depth > 0) {
      const hit = findDir(p, name, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Anywhere under _incoming: `botox/{before,after}/<n>.png` — one scan per image. */
function collectBotox(): Import[] {
  const base = findDir(INCOMING, "botox") ?? "";
  const out: Import[] = [];
  if (!base) return out;
  for (const phase of ["before", "after"]) {
    const dir = path.join(base, phase);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => /\.(png|jpg|jpeg)$/i.test(n))) {
      out.push({
        files: [{ file: path.join(dir, f), angle: "front" }],
        note: `TrainingDataPro botox · ${phase} (wrinkle/fine-line reference)`,
      });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const items = [...collectSkinDefects(), ...collectBotox()];
  console.log(`Found ${items.length} subjects in ${INCOMING}`);
  if (items.length === 0) {
    console.log("Nothing to import. Run: make fetch-dimension-datasets");
    return;
  }
  if (DRY) {
    for (const i of items.slice(0, 5)) {
      console.log(`  ${i.files.length} image(s)  ${i.note}`);
    }
    console.log(`  … ${items.length} total. Re-run without --dry-run to import.`);
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const patients = new PgPatientRepo(pool);
  const scans = new PgScanRepo(pool);

  // A dedicated record, so imported reference images never mix into a real
  // patient's history or skew the clinic's analytics.
  const existing = (await patients.list()).find((p) => p.externalRef === "imported-dataset");
  const owner = existing ?? (await patients.create({
    name: "Imported dataset",
    externalRef: "imported-dataset",
    notes: "External reference images for grading. Not a real patient.",
    // Published dataset images, imported expressly as training data — there is
    // no living person here to take a consent version from.
    consentVersion: null,
  }));

  let made = 0;
  for (const item of items) {
    const compressed = [];
    for (const f of item.files) {
      compressed.push({ angle: f.angle, ...(await compressToJpeg(readFileSync(f.file))) });
    }
    const head = compressed[0];
    const scan = await scans.create({
      patientId: owner.id,
      mode: "face",
      imageJpeg: head.jpeg,
      imageWidth: head.width,
      imageHeight: head.height,
      // No report: nothing analysed these, and inventing AI predictions for the
      // grader to "verify" would poison the labels this exists to collect.
      report: null,
      partial: false,
      classifierFindings: [],
      promptVersion: null,
    });
    await scans.addImages(
      scan.id,
      compressed.map((c) => ({
        angle: c.angle,
        imageJpeg: c.jpeg,
        imageWidth: c.width,
        imageHeight: c.height,
        quality: {},
      })),
    );
    // Training consent is implicit: these are published dataset images imported
    // expressly to become training data.
    await scans.setConsent(scan.id, { analysis: true, training: true }).catch(() => undefined);
    await scans.enqueueForReview(scan.id, await dHash(head.jpeg)).catch(() => undefined);
    await scans.recordEvent(scan.id, "captured", { imported: true, note: item.note }).catch(() => undefined);
    made++;
    if (made % 20 === 0) console.log(`  ${made}/${items.length}`);
  }

  await pool.end();
  console.log(
    `\nImported ${made} scans as patient "${owner.name}".\n` +
      "Grade them in the app: Queue tab → each scan → set every dimension.\n" +
      "Then: Export graded scans, and check `make dimension-readiness`.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

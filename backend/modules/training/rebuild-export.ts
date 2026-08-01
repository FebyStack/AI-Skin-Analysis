import { mkdirSync, writeFileSync, readdirSync, renameSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { normalizePresence } from "../../../shared/training-queue";
import type { ScanRepo } from "../analysis/repository";

/**
 * Rebuild `<datasetsDir>/<dimension>/scans/` so it matches the CURRENT database
 * labels exactly.
 *
 * Shared by the HTTP route and the CLI, because the CLI exists precisely to run
 * this without a clinician session — and two copies of a destructive routine is
 * how they drift apart until only one of them is right.
 *
 * Two different removals, and the difference matters:
 *
 * - **Relabelled** — the scan still exists, so its image is still in
 *   `scan_images`. Deleting the misfiled copy is lossless; it is rewritten under
 *   the correct label from the database in the same pass.
 * - **Orphaned** — no current label, usually because the scan was deleted and
 *   Postgres cascaded the row away. The exported JPEG may then be the ONLY
 *   surviving copy, so it is MOVED to `<dimension>/_orphaned/<label>/` rather
 *   than destroyed. That is out of the trainer's read path (the ingest only
 *   reads `scans/`), so it stops polluting training while remaining reviewable.
 *
 * Nothing here is unrecoverable. The database is the source of truth and this
 * directory is a derived artefact.
 */
export interface RebuildResult {
  dryRun: boolean;
  dir: string;
  labelled: number;
  written: number;
  /** Files whose scan no longer carries this label. MOVED to `_orphaned/`, not deleted. */
  removed: number;
  /** Where orphans were moved, when there were any. */
  quarantine: string | null;
  /** Files that moved because the grade changed. */
  relabelled: number;
  removedDirs: string[];
  missing: string[];
  /** Labels the current vocabulary cannot express; left alone and reported. */
  unmappable: { scanId: string; label: string }[];
}

export async function rebuildExport(
  scans: ScanRepo,
  dimension: string,
  vocabulary: Set<string>,
  outBase: string,
  opts: { dryRun?: boolean } = {},
): Promise<RebuildResult> {
  const dryRun = opts.dryRun ?? false;

  // Desired state, keyed by the label the clinician holds NOW.
  const labelled = await scans.listTrainable(dimension);
  const desired = new Map<string, string>();
  const unmappable: { scanId: string; label: string }[] = [];
  for (const { scanId, label } of labelled) {
    // Direct match FIRST: acne keeps its own 5 levels, and normalising those
    // would turn "moderate" into "present", which acne does not accept.
    const folder = vocabulary.has(label)
      ? label
      : vocabulary.has(normalizePresence(label))
        ? normalizePresence(label)
        : null;
    if (!folder) {
      unmappable.push({ scanId, label });
      continue;
    }
    desired.set(`${scanId}.jpg`, folder);
  }

  // Current state on disk: <scans>/<label>/<scanId>.jpg
  const onDisk = new Map<string, string>();
  const staleDirs: string[] = [];
  if (existsSync(outBase)) {
    for (const entry of readdirSync(outBase, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!vocabulary.has(entry.name)) staleDirs.push(entry.name);
      for (const f of readdirSync(path.join(outBase, entry.name))) {
        if (f.endsWith(".jpg")) onDisk.set(f, entry.name);
      }
    }
  }

  const quarantine = path.join(path.dirname(outBase), "_orphaned");
  let removed = 0;
  let relabelled = 0;
  for (const [file, folder] of onDisk) {
    const want = desired.get(file);
    if (want === folder) continue;

    const from = path.join(outBase, folder, file);
    // Never touch anything outside the directory this routine owns.
    if (!path.resolve(from).startsWith(path.resolve(outBase) + path.sep)) continue;

    if (want === undefined) {
      removed++;
      if (dryRun) continue;
      // Quarantine, do not destroy — this may be the last copy.
      const dest = path.join(quarantine, folder);
      mkdirSync(dest, { recursive: true });
      renameSync(from, path.join(dest, file));
    } else {
      relabelled++;
      if (dryRun) continue;
      // Safe to drop: rewritten from the database below under `want`.
      rmSync(from, { force: true });
    }
  }

  let written = 0;
  const missing: string[] = [];
  for (const [file, folder] of desired) {
    if (onDisk.get(file) === folder) continue; // already correct
    const scanId = file.replace(/\.jpg$/, "");
    const img = (await scans.getScanImage(scanId, "front")) ?? (await scans.getImage(scanId));
    if (!img) {
      missing.push(scanId);
      continue;
    }
    if (!dryRun) {
      mkdirSync(path.join(outBase, folder), { recursive: true });
      writeFileSync(path.join(outBase, folder, file), Buffer.from(img.jpeg));
    }
    written++;
  }

  // Retired-vocabulary folders are emptied above; drop them once bare so a
  // reader cannot mistake them for a live class.
  const removedDirs: string[] = [];
  if (!dryRun) {
    for (const dir of staleDirs) {
      const full = path.join(outBase, dir);
      if (existsSync(full) && readdirSync(full).length === 0) {
        rmSync(full, { recursive: true, force: true });
        removedDirs.push(dir);
      }
    }
    await scans.markExported([...desired.keys()].map((f) => f.replace(/\.jpg$/, "")));
  }

  return {
    dryRun,
    dir: outBase,
    labelled: labelled.length,
    written,
    removed,
    quarantine: removed > 0 ? quarantine : null,
    relabelled,
    removedDirs,
    missing,
    unmappable,
  };
}

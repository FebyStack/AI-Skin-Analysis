import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AnalysisReport } from "../../../shared/contract";
import type { LesionScanReport } from "../../../shared/lesion";
import type { FaceReport } from "../../../shared/face";
import { isValidUuid } from "../../shared/pg";
import { hashSimilarity } from "../../utils/image-hash";
import type { ScanConsent } from "../../../shared/training-governance";

// A stored report is a face v1 AnalysisReport, a face v3 FaceReport, or a lesion
// report. JSONB is shape-agnostic; each report's `kind` (or absence for v1)
// disambiguates on read.
export type StoredReport = AnalysisReport | FaceReport | LesionScanReport;

export interface ScanRecord {
  id: string;
  patientId: string;
  mode: "face" | "closeup";
  createdAt: number;
  imageJpeg: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  report: StoredReport | null;
  partial: boolean;
  classifierFindings: unknown[];
  promptVersion: number | null;
}

// One captured angle attached to a face scan (Plan 12). Bytes travel in memory
// but never over the wire in listImages — only via getScanImage.
export interface FaceScanImage {
  id: string;
  scanId: string;
  angle: string;
  imageJpeg: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  quality: unknown;
  createdAt: number;
}

export interface ScanRepo {
  create(s: Omit<ScanRecord, "id" | "createdAt">): Promise<ScanRecord>;
  get(id: string): Promise<ScanRecord | null>;
  listByPatient(patientId: string): Promise<Omit<ScanRecord, "imageJpeg">[]>;
  getImage(id: string): Promise<{ jpeg: Uint8Array } | null>;
  updateReport(id: string, report: StoredReport, promptVersion: number | null): Promise<boolean>;
  remove(id: string): Promise<boolean>;

  // Multi-angle face-scan images (Plan 12).
  addImages(scanId: string, imgs: Omit<FaceScanImage, "id" | "scanId" | "createdAt">[]): Promise<FaceScanImage[]>;
  listImages(scanId: string): Promise<Omit<FaceScanImage, "imageJpeg">[]>;
  getScanImage(scanId: string, angle: string): Promise<{ jpeg: Uint8Array } | null>;

  // Clinician labels → training data for learned analyzers (Track 2).
  setLabel(scanId: string, dimension: string, label: string, labeledBy?: string | null): Promise<boolean>;
  getLabels(scanId: string): Promise<{ dimension: string; label: string }[]>;
  listLabeled(dimension: string): Promise<{ scanId: string; label: string }[]>;

  // Training Queue — review state only; the AI prediction stays in scans.report
  // and the human labels in scan_labels, so neither can overwrite the other.
  /** Idempotent; also fingerprints the front image and flags near-duplicates. */
  enqueueForReview(scanId: string, imageHash?: string | null): Promise<void>;
  listQueue(filter: QueueFilter): Promise<QueueRow[]>;
  queueStats(): Promise<Record<string, number>>;
  getQueueEntry(scanId: string): Promise<QueueRow | null>;
  /** Save Draft / Approve / Reject / Needs Expert — any subset of fields. */
  updateReview(scanId: string, patch: ReviewPatch): Promise<boolean>;
  /** Labels eligible for training: approved, not skipped. */
  listTrainable(dimension: string): Promise<{ scanId: string; label: string }[]>;
  markExported(scanIds: string[]): Promise<void>;
  /** Remove one angle; the rest of the scan survives. */
  deleteImage(scanId: string, angle: string): Promise<boolean>;

  // ----- Governance: consent, dataset versions, model releases -----
  setConsent(scanId: string, consent: ScanConsent): Promise<void>;
  getConsent(scanId: string): Promise<ScanConsent>;
  /** Samples eligible to form the next dataset version, with their labels. */
  readySamples(): Promise<{ scanId: string; labels: Record<string, string> }[]>;
  listDatasetVersions(): Promise<DatasetVersionRow[]>;
  createDatasetVersion(version: string, manifest: unknown[], note: string | null): Promise<void>;
  setCurrentDataset(version: string): Promise<boolean>;
  listModelReleases(): Promise<ModelReleaseRow[]>;
  recordModelRelease(r: Omit<ModelReleaseRow, "id">): Promise<void>;
  setDeployment(version: string, deployment: string): Promise<boolean>;
  /** Approved samples whose review landed after the last production model. */
  approvedSinceLastTraining(): Promise<number>;
}

export interface DatasetVersionRow {
  id: string;
  version: string;
  createdAt: number;
  imageCount: number;
  note: string | null;
  isCurrent: boolean;
}

export interface ModelReleaseRow {
  id: string;
  version: string;
  trainedAt: number;
  datasetVersion: string | null;
  macroF1: number | null;
  acneF1: number | null;
  skintypeF1: number | null;
  sizeBytes: number | null;
  deployment: string;
}

export interface ReviewPatch {
  status?: string;
  note?: string | null;
  reviewerName?: string | null;
  skipTraining?: boolean;
}

export interface QueueFilter {
  status?: string;
  /** Free text matched against patient id / name. */
  q?: string;
  /** Inclusive ISO dates (YYYY-MM-DD) on scan creation. */
  from?: string;
  to?: string;
}

export interface QueueRow {
  scanId: string;
  patientId: string;
  patientName: string | null;
  createdAt: number;
  status: string;
  reviewedBy: string | null;
  reviewedAt: number | null;
  updatedAt: number | null;
  note: string | null;
  skipTraining: boolean;
  duplicateOf: string | null;
  similarity: number | null;
  exportedAt: number | null;
  labeledCount: number;
}

// ---------- In-memory (tests + lite mode) ----------

export class MemoryScanRepo implements ScanRepo {
  private rows = new Map<string, ScanRecord>();
  private imagesByScan = new Map<string, FaceScanImage[]>();

  async create(s: Omit<ScanRecord, "id" | "createdAt">): Promise<ScanRecord> {
    const row: ScanRecord = { ...s, id: randomUUID(), createdAt: Date.now() };
    this.rows.set(row.id, row);
    return row;
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listByPatient(patientId: string) {
    return [...this.rows.values()]
      .filter((s) => s.patientId === patientId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ imageJpeg: _img, ...rest }) => rest);
  }
  async getImage(id: string) {
    const row = this.rows.get(id);
    return row ? { jpeg: row.imageJpeg } : null;
  }
  async updateReport(id: string, report: StoredReport, promptVersion: number | null) {
    const row = this.rows.get(id);
    if (!row) return false;
    row.report = report;
    row.partial = false;
    row.promptVersion = promptVersion;
    return true;
  }
  async remove(id: string) {
    this.imagesByScan.delete(id); // mirror ON DELETE CASCADE
    return this.rows.delete(id);
  }

  async addImages(scanId: string, imgs: Omit<FaceScanImage, "id" | "scanId" | "createdAt">[]): Promise<FaceScanImage[]> {
    if (!this.rows.has(scanId)) return [];
    const now = Date.now();
    const rows = imgs.map((i) => ({ ...i, id: randomUUID(), scanId, createdAt: now }));
    this.imagesByScan.set(scanId, [...(this.imagesByScan.get(scanId) ?? []), ...rows]);
    return rows;
  }
  async listImages(scanId: string): Promise<Omit<FaceScanImage, "imageJpeg">[]> {
    return (this.imagesByScan.get(scanId) ?? []).map(({ imageJpeg: _img, ...rest }) => rest);
  }
  async getScanImage(scanId: string, angle: string): Promise<{ jpeg: Uint8Array } | null> {
    const hit = (this.imagesByScan.get(scanId) ?? []).find((i) => i.angle === angle);
    return hit ? { jpeg: hit.imageJpeg } : null;
  }

  private labels = new Map<string, Map<string, string>>(); // scanId → dimension → label
  async setLabel(scanId: string, dimension: string, label: string): Promise<boolean> {
    if (!this.rows.has(scanId)) return false;
    const byDim = this.labels.get(scanId) ?? new Map<string, string>();
    byDim.set(dimension, label);
    this.labels.set(scanId, byDim);
    return true;
  }
  async getLabels(scanId: string): Promise<{ dimension: string; label: string }[]> {
    return [...(this.labels.get(scanId) ?? new Map()).entries()].map(([dimension, label]) => ({ dimension, label }));
  }
  async listLabeled(dimension: string): Promise<{ scanId: string; label: string }[]> {
    const out: { scanId: string; label: string }[] = [];
    for (const [scanId, byDim] of this.labels) {
      const label = byDim.get(dimension);
      if (label) out.push({ scanId, label });
    }
    return out;
  }

  private queue = new Map<string, Omit<QueueRow, "patientName" | "labeledCount">>();
  private hashes = new Map<string, string>(); // scanId → dHash
  async enqueueForReview(scanId: string, imageHash?: string | null): Promise<void> {
    const scan = this.rows.get(scanId);
    if (!scan || this.queue.has(scanId)) return; // idempotent
    let duplicateOf: string | null = null;
    let similarity: number | null = null;
    if (imageHash) {
      this.hashes.set(scanId, imageHash);
      for (const [otherId, otherHash] of this.hashes) {
        if (otherId === scanId) continue;
        if (this.rows.get(otherId)?.patientId !== scan.patientId) continue;
        const s = hashSimilarity(imageHash, otherHash);
        if (s > (similarity ?? 0)) {
          similarity = s;
          duplicateOf = otherId;
        }
      }
    }
    this.queue.set(scanId, {
      scanId,
      patientId: scan.patientId,
      createdAt: scan.createdAt,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      updatedAt: null,
      note: null,
      skipTraining: false,
      duplicateOf,
      similarity,
      exportedAt: null,
    });
  }
  private toQueueRow(e: Omit<QueueRow, "patientName" | "labeledCount">): QueueRow {
    return { ...e, patientName: null, labeledCount: (this.labels.get(e.scanId) ?? new Map()).size };
  }
  async listQueue(filter: QueueFilter): Promise<QueueRow[]> {
    return [...this.queue.values()]
      .filter((e) => !filter.status || e.status === filter.status)
      .filter((e) => !filter.q || e.patientId.includes(filter.q))
      .filter((e) => !filter.from || e.createdAt >= Date.parse(`${filter.from}T00:00:00`))
      .filter((e) => !filter.to || e.createdAt <= Date.parse(`${filter.to}T23:59:59`))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => this.toQueueRow(e));
  }
  async queueStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    for (const e of this.queue.values()) stats[e.status] = (stats[e.status] ?? 0) + 1;
    return stats;
  }
  async getQueueEntry(scanId: string): Promise<QueueRow | null> {
    const e = this.queue.get(scanId);
    return e ? this.toQueueRow(e) : null;
  }
  async updateReview(scanId: string, patch: ReviewPatch): Promise<boolean> {
    const e = this.queue.get(scanId);
    if (!e) return false;
    this.queue.set(scanId, {
      ...e,
      status: patch.status ?? e.status,
      note: patch.note !== undefined ? patch.note : e.note,
      reviewedBy: patch.reviewerName !== undefined ? patch.reviewerName : e.reviewedBy,
      skipTraining: patch.skipTraining ?? e.skipTraining,
      // reviewedAt marks a review decision; updatedAt marks any edit (incl. drafts).
      reviewedAt: patch.status && patch.status !== "pending" ? Date.now() : e.reviewedAt,
      updatedAt: Date.now(),
    });
    return true;
  }
  async listTrainable(dimension: string): Promise<{ scanId: string; label: string }[]> {
    const out: { scanId: string; label: string }[] = [];
    for (const [scanId, byDim] of this.labels) {
      const e = this.queue.get(scanId);
      if (!e || e.status !== "approved" || e.skipTraining) continue;
      const label = byDim.get(dimension);
      if (label) out.push({ scanId, label });
    }
    return out;
  }
  async markExported(scanIds: string[]): Promise<void> {
    for (const id of scanIds) {
      const e = this.queue.get(id);
      if (e) this.queue.set(id, { ...e, exportedAt: Date.now() });
    }
  }
  async deleteImage(scanId: string, angle: string): Promise<boolean> {
    const imgs = this.imagesByScan.get(scanId);
    if (!imgs) return false;
    const next = imgs.filter((i) => i.angle !== angle);
    if (next.length === imgs.length) return false;
    this.imagesByScan.set(scanId, next);
    return true;
  }

  private consents = new Map<string, ScanConsent>();
  private datasets: DatasetVersionRow[] = [];
  private manifests = new Map<string, unknown[]>();
  private releases: ModelReleaseRow[] = [];
  async setConsent(scanId: string, consent: ScanConsent): Promise<void> {
    this.consents.set(scanId, consent);
  }
  async getConsent(scanId: string): Promise<ScanConsent> {
    return this.consents.get(scanId) ?? { analysis: true, training: false };
  }
  async readySamples(): Promise<{ scanId: string; labels: Record<string, string> }[]> {
    const out: { scanId: string; labels: Record<string, string> }[] = [];
    for (const [scanId, e] of this.queue) {
      if (e.status !== "approved" || e.skipTraining) continue;
      if (!(await this.getConsent(scanId)).training) continue;
      out.push({ scanId, labels: Object.fromEntries(this.labels.get(scanId) ?? new Map()) });
    }
    return out;
  }
  async listDatasetVersions(): Promise<DatasetVersionRow[]> {
    return [...this.datasets].sort((a, b) => b.createdAt - a.createdAt);
  }
  async createDatasetVersion(version: string, manifest: unknown[], note: string | null): Promise<void> {
    for (const d of this.datasets) d.isCurrent = false;
    this.datasets.push({
      id: randomUUID(), version, createdAt: Date.now(),
      imageCount: manifest.length, note, isCurrent: true,
    });
    this.manifests.set(version, manifest); // frozen; never rewritten
  }
  async setCurrentDataset(version: string): Promise<boolean> {
    if (!this.datasets.some((d) => d.version === version)) return false;
    for (const d of this.datasets) d.isCurrent = d.version === version;
    return true;
  }
  async listModelReleases(): Promise<ModelReleaseRow[]> {
    return [...this.releases].sort((a, b) => b.trainedAt - a.trainedAt);
  }
  async recordModelRelease(r: Omit<ModelReleaseRow, "id">): Promise<void> {
    this.releases = this.releases.filter((x) => x.version !== r.version);
    this.releases.push({ ...r, id: randomUUID() });
  }
  async setDeployment(version: string, deployment: string): Promise<boolean> {
    const hit = this.releases.find((r) => r.version === version);
    if (!hit) return false;
    if (deployment === "production") {
      for (const r of this.releases) if (r.deployment === "production") r.deployment = "archived";
    }
    hit.deployment = deployment;
    return true;
  }
  async approvedSinceLastTraining(): Promise<number> {
    const last = this.releases
      .filter((r) => r.deployment === "production")
      .sort((a, b) => b.trainedAt - a.trainedAt)[0];
    const since = last?.trainedAt ?? 0;
    let n = 0;
    for (const e of this.queue.values()) {
      if (e.status === "approved" && (e.reviewedAt ?? e.createdAt) > since) n++;
    }
    return n;
  }
}

// ---------- PostgreSQL ----------

function rowToScan(r: Record<string, unknown>): ScanRecord {
  return {
    id: String(r.id),
    patientId: String(r.patient_id),
    mode: r.mode as "face" | "closeup",
    createdAt: new Date(r.created_at as string).getTime(),
    imageJpeg: (r.image_jpeg as Uint8Array) ?? new Uint8Array(),
    imageWidth: Number(r.image_width),
    imageHeight: Number(r.image_height),
    report: (r.report as StoredReport | null) ?? null,
    partial: Boolean(r.partial),
    classifierFindings: (r.classifier_findings as unknown[]) ?? [],
    promptVersion: (r.prompt_version as number | null) ?? null,
  };
}

function rowToQueue(r: Record<string, unknown>): QueueRow {
  return {
    scanId: String(r.scan_id),
    patientId: String(r.patient_id),
    patientName: (r.patient_name as string | null) ?? null,
    createdAt: new Date(r.created_at as string).getTime(),
    status: String(r.status),
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at as string).getTime() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at as string).getTime() : null,
    note: (r.note as string | null) ?? null,
    skipTraining: Boolean(r.skip_training),
    duplicateOf: (r.duplicate_of as string | null) ?? null,
    similarity: r.similarity === null || r.similarity === undefined ? null : Number(r.similarity),
    exportedAt: r.exported_at ? new Date(r.exported_at as string).getTime() : null,
    labeledCount: Number(r.labeled_count ?? 0),
  };
}

function rowToScanImage(r: Record<string, unknown>): FaceScanImage {
  return {
    id: String(r.id),
    scanId: String(r.scan_id),
    angle: String(r.angle),
    imageJpeg: (r.image_jpeg as Uint8Array) ?? new Uint8Array(),
    imageWidth: Number(r.image_width),
    imageHeight: Number(r.image_height),
    quality: (r.quality as unknown) ?? {},
    createdAt: new Date(r.created_at as string).getTime(),
  };
}

export class PgScanRepo implements ScanRepo {
  constructor(private pool: Pool) {}
  async create(s: Omit<ScanRecord, "id" | "createdAt">): Promise<ScanRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO scans (patient_id, mode, image_jpeg, image_width, image_height,
                          report, partial, classifier_findings, prompt_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        s.patientId,
        s.mode,
        Buffer.from(s.imageJpeg),
        s.imageWidth,
        s.imageHeight,
        s.report ? JSON.stringify(s.report) : null,
        s.partial,
        JSON.stringify(s.classifierFindings),
        s.promptVersion,
      ],
    );
    return rowToScan(rows[0]);
  }
  async get(id: string) {
    if (!isValidUuid(id)) return null;
    const { rows } = await this.pool.query(`SELECT * FROM scans WHERE id = $1`, [id]);
    return rows[0] ? rowToScan(rows[0]) : null;
  }
  async listByPatient(patientId: string) {
    if (!isValidUuid(patientId)) return [];
    const { rows } = await this.pool.query(
      `SELECT id, patient_id, mode, created_at, image_width, image_height,
              report, partial, classifier_findings, prompt_version
       FROM scans WHERE patient_id = $1 ORDER BY created_at DESC`,
      [patientId],
    );
    return rows.map((r) => {
      const { imageJpeg: _img, ...rest } = rowToScan({ ...r, image_jpeg: new Uint8Array() });
      return rest;
    });
  }
  async getImage(id: string) {
    if (!isValidUuid(id)) return null;
    const { rows } = await this.pool.query(`SELECT image_jpeg FROM scans WHERE id = $1`, [id]);
    return rows[0] ? { jpeg: rows[0].image_jpeg as Uint8Array } : null;
  }
  async updateReport(id: string, report: StoredReport, promptVersion: number | null) {
    if (!isValidUuid(id)) return false;
    const { rowCount } = await this.pool.query(
      `UPDATE scans SET report=$2, partial=false, prompt_version=$3 WHERE id=$1`,
      [id, JSON.stringify(report), promptVersion],
    );
    return (rowCount ?? 0) > 0;
  }
  async remove(id: string) {
    if (!isValidUuid(id)) return false;
    const { rowCount } = await this.pool.query(`DELETE FROM scans WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }

  async addImages(scanId: string, imgs: Omit<FaceScanImage, "id" | "scanId" | "createdAt">[]): Promise<FaceScanImage[]> {
    if (!isValidUuid(scanId) || imgs.length === 0) return [];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out: FaceScanImage[] = [];
      for (const i of imgs) {
        const { rows } = await client.query(
          `INSERT INTO scan_images (scan_id, angle, image_jpeg, image_width, image_height, quality)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [scanId, i.angle, Buffer.from(i.imageJpeg), i.imageWidth, i.imageHeight, JSON.stringify(i.quality)],
        );
        out.push(rowToScanImage(rows[0]));
      }
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listImages(scanId: string): Promise<Omit<FaceScanImage, "imageJpeg">[]> {
    if (!isValidUuid(scanId)) return [];
    const { rows } = await this.pool.query(
      `SELECT id, scan_id, angle, image_width, image_height, quality, created_at
       FROM scan_images WHERE scan_id = $1 ORDER BY created_at`,
      [scanId],
    );
    return rows.map((r) => {
      const { imageJpeg: _img, ...rest } = rowToScanImage({ ...r, image_jpeg: new Uint8Array() });
      return rest;
    });
  }

  async getScanImage(scanId: string, angle: string): Promise<{ jpeg: Uint8Array } | null> {
    if (!isValidUuid(scanId)) return null;
    const { rows } = await this.pool.query(
      `SELECT image_jpeg FROM scan_images WHERE scan_id = $1 AND angle = $2 LIMIT 1`,
      [scanId, angle],
    );
    return rows[0] ? { jpeg: rows[0].image_jpeg as Uint8Array } : null;
  }

  async setLabel(scanId: string, dimension: string, label: string, labeledBy?: string | null): Promise<boolean> {
    if (!isValidUuid(scanId)) return false;
    const { rowCount } = await this.pool.query(
      `INSERT INTO scan_labels (scan_id, dimension, label, labeled_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (scan_id, dimension) DO UPDATE SET label = EXCLUDED.label, labeled_by = EXCLUDED.labeled_by, created_at = now()`,
      [scanId, dimension, label, labeledBy ?? null],
    );
    return (rowCount ?? 0) > 0;
  }

  async getLabels(scanId: string): Promise<{ dimension: string; label: string }[]> {
    if (!isValidUuid(scanId)) return [];
    const { rows } = await this.pool.query(
      `SELECT dimension, label FROM scan_labels WHERE scan_id = $1`,
      [scanId],
    );
    return rows.map((r) => ({ dimension: String(r.dimension), label: String(r.label) }));
  }

  async listLabeled(dimension: string): Promise<{ scanId: string; label: string }[]> {
    const { rows } = await this.pool.query(
      `SELECT scan_id, label FROM scan_labels WHERE dimension = $1`,
      [dimension],
    );
    return rows.map((r) => ({ scanId: String(r.scan_id), label: String(r.label) }));
  }

  // ----- Training Queue -----

  async enqueueForReview(scanId: string, imageHash?: string | null): Promise<void> {
    if (!isValidUuid(scanId)) return;
    // Closest earlier scan of the same patient, by perceptual hash.
    let duplicateOf: string | null = null;
    let similarity: number | null = null;
    if (imageHash) {
      const { rows } = await this.pool.query(
        `SELECT q.scan_id, q.image_hash
           FROM training_queue q
           JOIN scans s ON s.id = q.scan_id
          WHERE q.image_hash IS NOT NULL
            AND q.scan_id <> $1
            AND s.patient_id = (SELECT patient_id FROM scans WHERE id = $1)`,
        [scanId],
      );
      for (const r of rows) {
        const s = hashSimilarity(imageHash, String(r.image_hash));
        if (s > (similarity ?? 0)) {
          similarity = s;
          duplicateOf = String(r.scan_id);
        }
      }
    }
    await this.pool.query(
      `INSERT INTO training_queue (scan_id, image_hash, duplicate_of, similarity)
       VALUES ($1,$2,$3,$4) ON CONFLICT (scan_id) DO NOTHING`,
      [scanId, imageHash ?? null, duplicateOf, similarity],
    );
  }

  async listQueue(filter: QueueFilter): Promise<QueueRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    if (filter.status) add("q.status = ?", filter.status);
    // Search matches patient name or either id (so a pasted scan id works too) —
    // one bound param referenced three times.
    if (filter.q) {
      params.push(`%${filter.q}%`);
      const i = `$${params.length}`;
      where.push(`(p.name ILIKE ${i} OR p.id::text ILIKE ${i} OR s.id::text ILIKE ${i})`);
    }
    if (filter.from) add("s.created_at >= ?::date", filter.from);
    if (filter.to) add("s.created_at < (?::date + INTERVAL '1 day')", filter.to);

    const { rows } = await this.pool.query(
      `SELECT q.scan_id, q.status, q.note, q.reviewed_by, q.reviewed_at, q.updated_at,
              q.skip_training, q.duplicate_of, q.similarity, q.exported_at,
              s.patient_id, s.created_at, p.name AS patient_name,
              (SELECT count(*) FROM scan_labels l WHERE l.scan_id = q.scan_id) AS labeled_count
         FROM training_queue q
         JOIN scans s ON s.id = q.scan_id
         LEFT JOIN patients p ON p.id = s.patient_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY s.created_at DESC
        LIMIT 500`,
      params,
    );
    return rows.map(rowToQueue);
  }

  async queueStats(): Promise<Record<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT status, count(*)::int AS n FROM training_queue GROUP BY status`,
    );
    return Object.fromEntries(rows.map((r) => [String(r.status), Number(r.n)]));
  }

  async getQueueEntry(scanId: string): Promise<QueueRow | null> {
    if (!isValidUuid(scanId)) return null;
    const { rows } = await this.pool.query(
      `SELECT q.scan_id, q.status, q.note, q.reviewed_by, q.reviewed_at, q.updated_at,
              q.skip_training, q.duplicate_of, q.similarity, q.exported_at,
              s.patient_id, s.created_at, p.name AS patient_name,
              (SELECT count(*) FROM scan_labels l WHERE l.scan_id = q.scan_id) AS labeled_count
         FROM training_queue q
         JOIN scans s ON s.id = q.scan_id
         LEFT JOIN patients p ON p.id = s.patient_id
        WHERE q.scan_id = $1`,
      [scanId],
    );
    return rows[0] ? rowToQueue(rows[0]) : null;
  }

  async updateReview(scanId: string, patch: ReviewPatch): Promise<boolean> {
    if (!isValidUuid(scanId)) return false;
    const { rowCount } = await this.pool.query(
      `UPDATE training_queue
          SET status        = COALESCE($2, status),
              note          = COALESCE($3, note),
              reviewed_by   = COALESCE($4, reviewed_by),
              skip_training = COALESCE($5, skip_training),
              -- reviewedAt marks a decision; updatedAt marks any edit (incl. drafts)
              reviewed_at   = CASE WHEN $2 IS NOT NULL AND $2 <> 'pending'
                                   THEN now() ELSE reviewed_at END,
              updated_at    = now()
        WHERE scan_id = $1`,
      [
        scanId,
        patch.status ?? null,
        patch.note ?? null,
        patch.reviewerName ?? null,
        patch.skipTraining ?? null,
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  async listTrainable(dimension: string): Promise<{ scanId: string; label: string }[]> {
    const { rows } = await this.pool.query(
      `SELECT l.scan_id, l.label
         FROM scan_labels l
         JOIN training_queue q ON q.scan_id = l.scan_id
        WHERE l.dimension = $1 AND q.status = 'approved' AND q.skip_training = false`,
      [dimension],
    );
    return rows.map((r) => ({ scanId: String(r.scan_id), label: String(r.label) }));
  }

  async markExported(scanIds: string[]): Promise<void> {
    const ids = scanIds.filter(isValidUuid);
    if (ids.length === 0) return;
    await this.pool.query(
      `UPDATE training_queue SET exported_at = now() WHERE scan_id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async deleteImage(scanId: string, angle: string): Promise<boolean> {
    if (!isValidUuid(scanId)) return false;
    const { rowCount } = await this.pool.query(
      `DELETE FROM scan_images WHERE scan_id = $1 AND angle = $2`,
      [scanId, angle],
    );
    return (rowCount ?? 0) > 0;
  }

  // ----- Governance -----

  async setConsent(scanId: string, consent: ScanConsent): Promise<void> {
    if (!isValidUuid(scanId)) return;
    await this.pool.query(
      `UPDATE scans SET consent_analysis = $2, consent_training = $3 WHERE id = $1`,
      [scanId, consent.analysis, consent.training],
    );
  }

  async getConsent(scanId: string): Promise<ScanConsent> {
    if (!isValidUuid(scanId)) return { analysis: false, training: false };
    const { rows } = await this.pool.query(
      `SELECT consent_analysis, consent_training FROM scans WHERE id = $1`,
      [scanId],
    );
    return rows[0]
      ? { analysis: Boolean(rows[0].consent_analysis), training: Boolean(rows[0].consent_training) }
      : { analysis: false, training: false };
  }

  async readySamples(): Promise<{ scanId: string; labels: Record<string, string> }[]> {
    const { rows } = await this.pool.query(
      `SELECT q.scan_id,
              jsonb_object_agg(l.dimension, l.label) FILTER (WHERE l.dimension IS NOT NULL) AS labels
         FROM training_queue q
         JOIN scans s ON s.id = q.scan_id
         LEFT JOIN scan_labels l ON l.scan_id = q.scan_id
        WHERE q.status = 'approved' AND q.skip_training = false AND s.consent_training = true
        GROUP BY q.scan_id`,
    );
    return rows.map((r) => ({
      scanId: String(r.scan_id),
      labels: (r.labels as Record<string, string> | null) ?? {},
    }));
  }

  async listDatasetVersions(): Promise<DatasetVersionRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, version, created_at, image_count, note, is_current
         FROM dataset_versions ORDER BY created_at DESC`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      version: String(r.version),
      createdAt: new Date(r.created_at as string).getTime(),
      imageCount: Number(r.image_count),
      note: (r.note as string | null) ?? null,
      isCurrent: Boolean(r.is_current),
    }));
  }

  async createDatasetVersion(version: string, manifest: unknown[], note: string | null): Promise<void> {
    // Previous versions are left untouched — only `is_current` moves.
    await this.pool.query(`UPDATE dataset_versions SET is_current = false`);
    await this.pool.query(
      `INSERT INTO dataset_versions (version, image_count, note, is_current, manifest)
       VALUES ($1,$2,$3,true,$4::jsonb)`,
      [version, manifest.length, note, JSON.stringify(manifest)],
    );
  }

  async setCurrentDataset(version: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE dataset_versions SET is_current = (version = $1)`,
      [version],
    );
    return (rowCount ?? 0) > 0;
  }

  async listModelReleases(): Promise<ModelReleaseRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, version, trained_at, dataset_version, macro_f1, acne_f1, skintype_f1,
              size_bytes, deployment
         FROM model_releases ORDER BY trained_at DESC`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      version: String(r.version),
      trainedAt: new Date(r.trained_at as string).getTime(),
      datasetVersion: (r.dataset_version as string | null) ?? null,
      macroF1: r.macro_f1 === null ? null : Number(r.macro_f1),
      acneF1: r.acne_f1 === null ? null : Number(r.acne_f1),
      skintypeF1: r.skintype_f1 === null ? null : Number(r.skintype_f1),
      sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
      deployment: String(r.deployment),
    }));
  }

  async recordModelRelease(r: Omit<ModelReleaseRow, "id">): Promise<void> {
    await this.pool.query(
      `INSERT INTO model_releases
         (version, trained_at, dataset_version, macro_f1, acne_f1, skintype_f1, size_bytes, deployment)
       VALUES ($1, to_timestamp($2/1000.0), $3,$4,$5,$6,$7,$8)
       ON CONFLICT (version) DO UPDATE SET
         macro_f1 = EXCLUDED.macro_f1, acne_f1 = EXCLUDED.acne_f1,
         skintype_f1 = EXCLUDED.skintype_f1, size_bytes = EXCLUDED.size_bytes,
         dataset_version = EXCLUDED.dataset_version`,
      [r.version, r.trainedAt, r.datasetVersion, r.macroF1, r.acneF1, r.skintypeF1,
       r.sizeBytes, r.deployment],
    );
  }

  async setDeployment(version: string, deployment: string): Promise<boolean> {
    // Only one production at a time — the outgoing one is archived, never deleted.
    if (deployment === "production") {
      await this.pool.query(
        `UPDATE model_releases SET deployment = 'archived' WHERE deployment = 'production'`,
      );
    }
    const { rowCount } = await this.pool.query(
      `UPDATE model_releases SET deployment = $2 WHERE version = $1`,
      [version, deployment],
    );
    return (rowCount ?? 0) > 0;
  }

  async approvedSinceLastTraining(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n
         FROM training_queue q
         JOIN scans s ON s.id = q.scan_id
        WHERE q.status = 'approved' AND s.consent_training = true
          AND COALESCE(q.reviewed_at, q.created_at) >
              COALESCE((SELECT max(trained_at) FROM model_releases WHERE deployment = 'production'),
                       to_timestamp(0))`,
    );
    return Number(rows[0]?.n ?? 0);
  }
}

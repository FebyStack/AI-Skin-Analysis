import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AnalysisReport } from "../../../shared/contract";
import type { LesionScanReport } from "../../../shared/lesion";
import type { FaceReport } from "../../../shared/face";
import { isValidUuid } from "../../shared/pg";

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
  enqueueForReview(scanId: string): Promise<void>;
  listQueue(filter: QueueFilter): Promise<QueueRow[]>;
  queueStats(): Promise<Record<string, number>>;
  getQueueEntry(scanId: string): Promise<QueueRow | null>;
  setQueueStatus(
    scanId: string,
    status: string,
    reviewedBy?: string | null,
    note?: string | null,
  ): Promise<boolean>;
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
  note: string | null;
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
  async enqueueForReview(scanId: string): Promise<void> {
    const scan = this.rows.get(scanId);
    if (!scan || this.queue.has(scanId)) return; // idempotent
    this.queue.set(scanId, {
      scanId,
      patientId: scan.patientId,
      createdAt: scan.createdAt,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      note: null,
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
  async setQueueStatus(
    scanId: string,
    status: string,
    reviewedBy?: string | null,
    note?: string | null,
  ): Promise<boolean> {
    const e = this.queue.get(scanId);
    if (!e) return false;
    this.queue.set(scanId, {
      ...e,
      status,
      reviewedBy: reviewedBy ?? null,
      reviewedAt: Date.now(),
      note: note ?? e.note,
    });
    return true;
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
    note: (r.note as string | null) ?? null,
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

  async enqueueForReview(scanId: string): Promise<void> {
    if (!isValidUuid(scanId)) return;
    await this.pool.query(
      `INSERT INTO training_queue (scan_id) VALUES ($1) ON CONFLICT (scan_id) DO NOTHING`,
      [scanId],
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
      `SELECT q.scan_id, q.status, q.note, q.reviewed_by, q.reviewed_at,
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
      `SELECT q.scan_id, q.status, q.note, q.reviewed_by, q.reviewed_at,
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

  async setQueueStatus(
    scanId: string,
    status: string,
    reviewedBy?: string | null,
    note?: string | null,
  ): Promise<boolean> {
    if (!isValidUuid(scanId)) return false;
    const { rowCount } = await this.pool.query(
      `UPDATE training_queue
          SET status = $2, reviewed_by = $3, reviewed_at = now(),
              note = COALESCE($4, note)
        WHERE scan_id = $1`,
      [scanId, status, reviewedBy ?? null, note ?? null],
    );
    return (rowCount ?? 0) > 0;
  }
}

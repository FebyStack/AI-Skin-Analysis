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
}

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AnalysisReport } from "../../../shared/contract";
import type { LesionScanReport } from "../../../shared/lesion";
import { isValidUuid } from "../../shared/pg";

// A stored report is either the face AnalysisReport or a lesion report (JSONB is
// shape-agnostic; `kind` on the lesion report disambiguates on read).
export type StoredReport = AnalysisReport | LesionScanReport;

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

export interface ScanRepo {
  create(s: Omit<ScanRecord, "id" | "createdAt">): Promise<ScanRecord>;
  get(id: string): Promise<ScanRecord | null>;
  listByPatient(patientId: string): Promise<Omit<ScanRecord, "imageJpeg">[]>;
  getImage(id: string): Promise<{ jpeg: Uint8Array } | null>;
  updateReport(id: string, report: AnalysisReport, promptVersion: number): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

// ---------- In-memory (tests + lite mode) ----------

export class MemoryScanRepo implements ScanRepo {
  private rows = new Map<string, ScanRecord>();
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
      .map(({ imageJpeg: _img, ...rest }) => rest);
  }
  async getImage(id: string) {
    const row = this.rows.get(id);
    return row ? { jpeg: row.imageJpeg } : null;
  }
  async updateReport(id: string, report: AnalysisReport, promptVersion: number) {
    const row = this.rows.get(id);
    if (!row) return false;
    row.report = report;
    row.partial = false;
    row.promptVersion = promptVersion;
    return true;
  }
  async remove(id: string) {
    return this.rows.delete(id);
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
    report: (r.report as AnalysisReport | null) ?? null,
    partial: Boolean(r.partial),
    classifierFindings: (r.classifier_findings as unknown[]) ?? [],
    promptVersion: (r.prompt_version as number | null) ?? null,
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
  async updateReport(id: string, report: AnalysisReport, promptVersion: number) {
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
}

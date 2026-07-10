import type { Pool } from "pg";
import type { AnalysisReport } from "../../shared/contract";
import type { Patient, PatientRepo, ScanRecord, ScanRepo, SettingsRepo } from "./repos";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

function rowToPatient(r: Record<string, unknown>): Patient {
  return {
    id: String(r.id),
    name: String(r.name),
    externalRef: (r.external_ref as string | null) ?? null,
    notes: String(r.notes ?? ""),
    consentVersion: (r.consent_version as number | null) ?? null,
    createdAt: new Date(r.created_at as string).getTime(),
  };
}

export class PgPatientRepo implements PatientRepo {
  constructor(private pool: Pool) {}
  async create(p: Omit<Patient, "id" | "createdAt">): Promise<Patient> {
    const { rows } = await this.pool.query(
      `INSERT INTO patients (name, external_ref, notes, consent_version)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [p.name, p.externalRef, p.notes, p.consentVersion],
    );
    return rowToPatient(rows[0]);
  }
  async get(id: string) {
    if (!isValidUuid(id)) return null;
    const { rows } = await this.pool.query(`SELECT * FROM patients WHERE id = $1`, [id]);
    return rows[0] ? rowToPatient(rows[0]) : null;
  }
  async list(search?: string) {
    const { rows } = search
      ? await this.pool.query(
          `SELECT * FROM patients WHERE name ILIKE $1 ORDER BY name`,
          [`%${search}%`],
        )
      : await this.pool.query(`SELECT * FROM patients ORDER BY name`);
    return rows.map(rowToPatient);
  }
  async update(id: string, fields: Partial<Omit<Patient, "id" | "createdAt">>) {
    if (!isValidUuid(id)) return null;
    const cur = await this.get(id);
    if (!cur) return null;
    const next = { ...cur, ...fields };
    await this.pool.query(
      `UPDATE patients SET name=$2, external_ref=$3, notes=$4, consent_version=$5 WHERE id=$1`,
      [id, next.name, next.externalRef, next.notes, next.consentVersion],
    );
    return next;
  }
  async remove(id: string) {
    if (!isValidUuid(id)) return false;
    const { rowCount } = await this.pool.query(`DELETE FROM patients WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  }
}

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

export class PgSettingsRepo implements SettingsRepo {
  constructor(private pool: Pool) {}
  async get(key: string) {
    const { rows } = await this.pool.query(`SELECT value FROM settings WHERE key = $1`, [key]);
    return rows[0]?.value ?? null;
  }
  async set(key: string, value: string) {
    await this.pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value],
    );
  }
}

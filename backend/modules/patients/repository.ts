import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { isValidUuid } from "../../shared/pg";

export interface Patient {
  id: string;
  name: string;
  externalRef: string | null;
  notes: string;
  consentVersion: number | null;
  createdAt: number;
}

export interface PatientRepo {
  create(p: Omit<Patient, "id" | "createdAt">): Promise<Patient>;
  get(id: string): Promise<Patient | null>;
  list(search?: string): Promise<Patient[]>;
  update(id: string, fields: Partial<Omit<Patient, "id" | "createdAt">>): Promise<Patient | null>;
  remove(id: string): Promise<boolean>;
}

// ---------- In-memory (tests + lite mode) ----------

export class MemoryPatientRepo implements PatientRepo {
  private rows = new Map<string, Patient>();
  async create(p: Omit<Patient, "id" | "createdAt">): Promise<Patient> {
    const row: Patient = { ...p, id: randomUUID(), createdAt: Date.now() };
    this.rows.set(row.id, row);
    return row;
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list(search?: string) {
    const all = [...this.rows.values()];
    return search
      ? all.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
      : all;
  }
  async update(id: string, fields: Partial<Omit<Patient, "id" | "createdAt">>) {
    const cur = this.rows.get(id);
    if (!cur) return null;
    const next = { ...cur, ...fields };
    this.rows.set(id, next);
    return next;
  }
  async remove(id: string) {
    return this.rows.delete(id);
  }
}

// ---------- PostgreSQL ----------

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

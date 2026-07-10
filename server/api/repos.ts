import { randomUUID } from "node:crypto";
import type { AnalysisReport } from "../../shared/contract";
import type { PipelineDeps } from "../../ai/llm/pipeline";

export interface Patient {
  id: string;
  name: string;
  externalRef: string | null;
  notes: string;
  consentVersion: number | null;
  createdAt: number;
}

export interface ScanRecord {
  id: string;
  patientId: string;
  mode: "face" | "closeup";
  createdAt: number;
  imageJpeg: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  report: AnalysisReport | null;
  partial: boolean;
  classifierFindings: unknown[];
  promptVersion: number | null;
}

export interface PatientRepo {
  create(p: Omit<Patient, "id" | "createdAt">): Promise<Patient>;
  get(id: string): Promise<Patient | null>;
  list(search?: string): Promise<Patient[]>;
  update(id: string, fields: Partial<Omit<Patient, "id" | "createdAt">>): Promise<Patient | null>;
  remove(id: string): Promise<boolean>;
}

export interface ScanRepo {
  create(s: Omit<ScanRecord, "id" | "createdAt">): Promise<ScanRecord>;
  get(id: string): Promise<ScanRecord | null>;
  listByPatient(patientId: string): Promise<Omit<ScanRecord, "imageJpeg">[]>;
  getImage(id: string): Promise<{ jpeg: Uint8Array } | null>;
  updateReport(id: string, report: AnalysisReport, promptVersion: number): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

export interface SettingsRepo {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface AppDeps {
  patients: PatientRepo;
  scans: ScanRepo;
  settings: SettingsRepo;
  pipeline: PipelineDeps;
  sessionSecret: string;
  now: () => number;
}

// ---------- In-memory fakes (tests) ----------

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

export class MemorySettingsRepo implements SettingsRepo {
  private map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
}

import goldenReport from "../../ai/evaluation/fixtures/golden-report.json";

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    patients: new MemoryPatientRepo(),
    scans: new MemoryScanRepo(),
    settings: new MemorySettingsRepo(),
    pipeline: {
      config: {
        apiKey: "sk-test",
        primaryModel: "claude-sonnet-5",
        critiqueModel: "claude-haiku-4-5-20251001",
        maxTokens: 2048,
      },
      callProvider: async (_req, model) =>
        model === "claude-sonnet-5"
          ? JSON.stringify(goldenReport)
          : '{"verdict":"approved"}',
    },
    sessionSecret: "test-secret",
    now: () => Date.now(),
    ...overrides,
  };
}

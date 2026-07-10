import type { Pool } from "pg";

export interface SettingsRepo {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

// ---------- In-memory (tests + lite mode) ----------

export class MemorySettingsRepo implements SettingsRepo {
  private map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
}

// ---------- PostgreSQL ----------

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

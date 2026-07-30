import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DEFAULT_MAX_SCANS, DEFAULT_TTL_DAYS, type Invite } from "../../../shared/invites";

export interface CreateInvite {
  label?: string | null;
  maxScans?: number;
  ttlDays?: number;
}

export interface InviteRepo {
  create(input: CreateInvite): Promise<Invite>;
  getByToken(token: string): Promise<Invite | null>;
  get(id: string): Promise<Invite | null>;
  /**
   * Spend one scan. Returns the updated invite, or null when the invite is
   * revoked, expired or already at its limit.
   *
   * MUST be atomic: two devices on the same link finishing a scan at the same
   * moment must not both get through a last remaining slot.
   */
  consume(id: string): Promise<Invite | null>;
  list(): Promise<Invite[]>;
  revoke(id: string): Promise<boolean>;
}

/** 32 bytes of base64url — long enough that guessing is not a threat model. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

function expiryFrom(ttlDays: number | undefined, now: number): number | null {
  const days = ttlDays ?? DEFAULT_TTL_DAYS;
  return days <= 0 ? null : now + days * 86_400_000;
}

export class MemoryInviteRepo implements InviteRepo {
  private rows = new Map<string, Invite>();

  constructor(private now: () => number = Date.now) {}

  async create(input: CreateInvite): Promise<Invite> {
    const invite: Invite = {
      id: randomUUID(),
      token: newInviteToken(),
      label: input.label ?? null,
      maxScans: input.maxScans ?? DEFAULT_MAX_SCANS,
      usedScans: 0,
      expiresAt: expiryFrom(input.ttlDays, this.now()),
      revokedAt: null,
      createdAt: this.now(),
    };
    this.rows.set(invite.id, invite);
    return invite;
  }

  async getByToken(token: string): Promise<Invite | null> {
    for (const r of this.rows.values()) if (r.token === token) return r;
    return null;
  }

  async get(id: string): Promise<Invite | null> {
    return this.rows.get(id) ?? null;
  }

  async consume(id: string): Promise<Invite | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    const now = this.now();
    if (r.revokedAt !== null) return null;
    if (r.expiresAt !== null && r.expiresAt <= now) return null;
    if (r.usedScans >= r.maxScans) return null;
    // Single-threaded here, so read-modify-write is already atomic.
    const next = { ...r, usedScans: r.usedScans + 1 };
    this.rows.set(id, next);
    return next;
  }

  async list(): Promise<Invite[]> {
    return [...this.rows.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async revoke(id: string): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.revokedAt !== null) return false;
    this.rows.set(id, { ...r, revokedAt: this.now() });
    return true;
  }
}

interface Row {
  id: string;
  token: string;
  label: string | null;
  max_scans: number;
  used_scans: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const toInvite = (r: Row): Invite => ({
  id: r.id,
  token: r.token,
  label: r.label,
  maxScans: r.max_scans,
  usedScans: r.used_scans,
  expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : null,
  revokedAt: r.revoked_at ? new Date(r.revoked_at).getTime() : null,
  createdAt: new Date(r.created_at).getTime(),
});

const COLS = `id, token, label, max_scans, used_scans, expires_at, revoked_at, created_at`;

export class PgInviteRepo implements InviteRepo {
  constructor(private pool: Pool) {}

  async create(input: CreateInvite): Promise<Invite> {
    const ttl = input.ttlDays ?? DEFAULT_TTL_DAYS;
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO scan_invites (token, label, max_scans, expires_at)
       VALUES ($1, $2, $3, CASE WHEN $4::int > 0 THEN now() + ($4::int * INTERVAL '1 day') ELSE NULL END)
       RETURNING ${COLS}`,
      [newInviteToken(), input.label ?? null, input.maxScans ?? DEFAULT_MAX_SCANS, ttl],
    );
    return toInvite(rows[0]);
  }

  async getByToken(token: string): Promise<Invite | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLS} FROM scan_invites WHERE token = $1`,
      [token],
    );
    return rows[0] ? toInvite(rows[0]) : null;
  }

  async get(id: string): Promise<Invite | null> {
    const { rows } = await this.pool.query<Row>(`SELECT ${COLS} FROM scan_invites WHERE id = $1`, [id]);
    return rows[0] ? toInvite(rows[0]) : null;
  }

  /**
   * One statement, so the quota check and the increment cannot be interleaved by
   * a concurrent request. No matching row → the invite had nothing left to give.
   */
  async consume(id: string): Promise<Invite | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE scan_invites
          SET used_scans = used_scans + 1
        WHERE id = $1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
          AND used_scans < max_scans
        RETURNING ${COLS}`,
      [id],
    );
    return rows[0] ? toInvite(rows[0]) : null;
  }

  async list(): Promise<Invite[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLS} FROM scan_invites ORDER BY created_at DESC`,
    );
    return rows.map(toInvite);
  }

  async revoke(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE scan_invites SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}

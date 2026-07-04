# Docker Clinic Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the local clinic backend — Express api (auth, patients/scans, analyze endpoint, QR capture sessions), Postgres storage with compressed JPEG images, and the Docker Compose stack with backup/restore — so a scan can be analyzed, stored, and moved between laptops.

**Architecture:** `createApp(deps)` builds the Express app from injected repositories and pipeline deps, so every route is supertest-tested against in-memory fakes (no Docker needed for `npm run verify`). Thin `pg` implementations of the same repo interfaces plus `schema.sql` carry production storage; a multi-stage Dockerfile builds web+api images; compose wires web(nginx)/api/db with a named volume. Sessions are HMAC-signed cookies; QR capture tokens are single-use, TTL-bound, upload-only.

**Tech Stack:** Express 4, pg, bcryptjs, sharp, supertest (dev), esbuild (server bundle), Postgres 16, nginx, Docker Compose.

**Prerequisites:** Plan 3 v2 executed (`server/analysis/*` modules exist; ~109 tests green).

---

## File Structure

- Create: `server/api/app.ts` — `createApp(deps)` with all routes
- Create: `server/api/auth.ts` (+ test) — password hashing, session tokens, middleware
- Create: `server/api/image.ts` (+ test) — sharp JPEG downscale/compress
- Create: `server/api/repos.ts` — repo interfaces + in-memory fakes (used by tests)
- Create: `server/api/capture-sessions.ts` (+ test) — QR token store
- Create: `server/api/app.test.ts` — supertest route tests (auth, patients, scans, analyze, capture)
- Create: `server/api/pg-repos.ts` — real Postgres repos (thin; integration-tested via compose)
- Create: `server/api/index.ts` — entry (env, pool, listen)
- Create: `server/db/schema.sql` — tables + indexes
- Create: `server/tsconfig.json` — server typecheck config
- Create: `Dockerfile`, `nginx.conf`, `docker-compose.yml`, `docker-compose.lan.yml`, `.env.example`, `Makefile`
- Create: `src/features/skin-analysis/api/analyze-client.ts` (+ test) — browser client for `/api/*`
- Modify: `package.json` — server deps + scripts

---

## Task 1: Server dependencies, tsconfig, and health endpoint

**Files:**
- Modify: `package.json`
- Create: `server/tsconfig.json`
- Create: `server/api/app.ts`
- Create: `server/api/app.test.ts`

- [ ] **Step 1: Install deps**

Run: `npm install express@^4.21.0 pg@^8.13.0 bcryptjs@^2.4.3 sharp@^0.33.5 && npm install -D supertest@^7.0.0 @types/express@^4.17.21 @types/supertest@^6.0.2 @types/pg@^8.11.10 @types/bcryptjs@^2.4.6 esbuild@^0.24.0`

- [ ] **Step 2: Add scripts to `package.json`**

```json
"build:server": "esbuild server/api/index.ts --bundle --platform=node --target=node20 --outfile=dist-server/index.js --external:sharp --external:pg",
"typecheck:server": "tsc -p server/tsconfig.json"
```

Append `&& npm run typecheck:server` to the existing `verify` script's typecheck stage — final verify: `"verify": "npm run typecheck && npm run typecheck:server && npm run test && npm run build"`.

- [ ] **Step 3: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["."]
}
```

- [ ] **Step 4: Failing test.** Create `server/api/app.test.ts` (grows through later tasks — start with):

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { makeTestDeps } from "./repos";

describe("health", () => {
  it("responds ok without auth", async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

- [ ] **Step 5: Run to verify failure** (cannot resolve ./app, ./repos).

- [ ] **Step 6: Implement minimal `server/api/repos.ts`** (interfaces grow in later tasks; full version below is written ONCE here and reused — it includes everything later tasks need):

```ts
import { randomUUID } from "node:crypto";
import type { AnalysisReport } from "../analysis/contract";
import type { PipelineDeps } from "../analysis/pipeline";

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

import goldenReport from "../analysis/fixtures/golden-report.json";

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
```

- [ ] **Step 7: Implement minimal `server/api/app.ts`** (routes grow per task):

```ts
import express, { type Express } from "express";
import type { AppDeps } from "./repos";

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  void deps; // consumed by routes added in later tasks
  return app;
}
```

- [ ] **Step 8: Run the app test — PASS. Full suite green. `npm run typecheck:server` clean. Commit:**

```bash
git add package.json package-lock.json server/tsconfig.json server/api/app.ts server/api/app.test.ts server/api/repos.ts
git commit -m "feat: api scaffold with injected deps and health route"
```

---

## Task 2: Image compression (sharp)

**Files:**
- Create: `server/api/image.ts`
- Create: `server/api/image.test.ts`

- [ ] **Step 1: Failing test** `server/api/image.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { compressToJpeg, MAX_EDGE_PX } from "./image";

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 140, b: 120 } },
  })
    .png()
    .toBuffer();
}

describe("compressToJpeg", () => {
  it("downscales the long edge to MAX_EDGE_PX and outputs jpeg", async () => {
    const big = await makePng(4000, 2000);
    const out = await compressToJpeg(big);
    expect(out.width).toBe(MAX_EDGE_PX);
    expect(out.height).toBe(Math.round((MAX_EDGE_PX * 2000) / 4000));
    const meta = await sharp(out.jpeg).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("does not upscale small images", async () => {
    const small = await makePng(400, 300);
    const out = await compressToJpeg(small);
    expect(out.width).toBe(400);
    expect(out.height).toBe(300);
  });

  it("produces a materially smaller file for large inputs", async () => {
    const big = await makePng(4000, 4000);
    const out = await compressToJpeg(big);
    expect(out.jpeg.byteLength).toBeLessThan(big.byteLength);
    expect(out.jpeg.byteLength).toBeLessThan(600 * 1024);
  });

  it("strips metadata by re-encoding", async () => {
    const withExif = await sharp(await makePng(800, 600))
      .withMetadata({ exif: { IFD0: { Copyright: "secret" } } })
      .jpeg()
      .toBuffer();
    const out = await compressToJpeg(withExif);
    const meta = await sharp(out.jpeg).metadata();
    expect(meta.exif).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `server/api/image.ts`:

```ts
import sharp from "sharp";

export const MAX_EDGE_PX = 1280;
export const JPEG_QUALITY = 80;

export interface CompressedImage {
  jpeg: Buffer;
  width: number;
  height: number;
}

// Re-encode to JPEG: downscale long edge to MAX_EDGE_PX (never upscale),
// quality 80, no metadata (sharp drops EXIF unless withMetadata is called).
export async function compressToJpeg(input: Buffer): Promise<CompressedImage> {
  const out = await sharp(input)
    .rotate() // apply EXIF orientation before it is discarded
    .resize(MAX_EDGE_PX, MAX_EDGE_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: out.data, width: out.info.width, height: out.info.height };
}
```

- [ ] **Step 4: Run — PASS (4 tests). Commit:**

```bash
git add server/api/image.ts server/api/image.test.ts
git commit -m "feat: sharp JPEG downscale/compress with orientation + metadata strip"
```

---

## Task 3: Auth — clinic password, sessions, middleware

**Files:**
- Create: `server/api/auth.ts`
- Modify: `server/api/app.ts`
- Modify: `server/api/app.test.ts`

- [ ] **Step 1: Failing tests.** Append to `server/api/app.test.ts`:

```ts
describe("auth", () => {
  it("bootstraps a password on first login when none is set", async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/session=/);
  });

  it("rejects a wrong password once set", async () => {
    const deps = makeTestDeps();
    const app = createApp(deps);
    await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
    const res = await request(app).post("/api/auth/login").send({ password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("blocks protected routes without a session", async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get("/api/patients");
    expect(res.status).toBe(401);
  });

  it("allows protected routes with a session cookie", async () => {
    const app = createApp(makeTestDeps());
    const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
    const cookie = login.headers["set-cookie"][0];
    const res = await request(app).get("/api/patients").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `server/api/auth.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import type { SettingsRepo } from "./repos";

const PASSWORD_KEY = "password_hash";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h shift

export async function verifyOrBootstrapPassword(
  settings: SettingsRepo,
  password: string,
): Promise<boolean> {
  if (typeof password !== "string" || password.length < 8) return false;
  const hash = await settings.get(PASSWORD_KEY);
  if (!hash) {
    // First run: the first login sets the clinic password.
    await settings.set(PASSWORD_KEY, await bcrypt.hash(password, 10));
    return true;
  }
  return bcrypt.compare(password, hash);
}

export function makeSessionToken(secret: string, nowMs: number): string {
  const expires = nowMs + SESSION_TTL_MS;
  const sig = createHmac("sha256", secret).update(String(expires)).digest("hex");
  return `${expires}.${sig}`;
}

export function isValidSession(token: string | undefined, secret: string, nowMs: number): boolean {
  if (!token) return false;
  const [expiresStr, sig] = token.split(".");
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < nowMs) return false;
  const expected = createHmac("sha256", secret).update(expiresStr).digest("hex");
  if (sig?.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export function requireSession(secret: string, now: () => number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)["session"];
    if (!isValidSession(token, secret, now())) {
      res.status(401).json({ error: "login required" });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Wire into `app.ts`.** Replace the file with:

```ts
import express, { type Express } from "express";
import type { AppDeps } from "./repos";
import { verifyOrBootstrapPassword, makeSessionToken, requireSession } from "./auth";

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/auth/login", async (req, res) => {
    const ok = await verifyOrBootstrapPassword(deps.settings, req.body?.password);
    if (!ok) {
      res.status(401).json({ error: "invalid password" });
      return;
    }
    const token = makeSessionToken(deps.sessionSecret, deps.now());
    res.setHeader(
      "Set-Cookie",
      `session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`,
    );
    res.json({ ok: true });
  });

  const auth = requireSession(deps.sessionSecret, deps.now);

  // Protected routes are added below in later tasks; placeholder list route
  // proves the middleware works end-to-end.
  app.get("/api/patients", auth, async (req, res) => {
    res.json({ patients: await deps.patients.list(req.query.q as string | undefined) });
  });

  return app;
}
```

- [ ] **Step 5: Run — auth tests PASS. Full suite green. Commit:**

```bash
git add server/api/auth.ts server/api/app.ts server/api/app.test.ts
git commit -m "feat: clinic password auth with HMAC session cookies"
```

---

## Task 4: Patients CRUD + consent recording

**Files:**
- Modify: `server/api/app.ts`
- Modify: `server/api/app.test.ts`

- [ ] **Step 1: Failing tests.** Append to `app.test.ts`:

```ts
async function loggedInAgent(depsOverride?: Parameters<typeof makeTestDeps>[0]) {
  const deps = makeTestDeps(depsOverride);
  const app = createApp(deps);
  const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
  const cookie = login.headers["set-cookie"][0];
  return { app, cookie, deps };
}

describe("patients", () => {
  it("creates, lists, updates, and deletes a patient", async () => {
    const { app, cookie } = await loggedInAgent();
    const created = await request(app)
      .post("/api/patients")
      .set("Cookie", cookie)
      .send({ name: "Maria Cruz", externalRef: "C-102", notes: "sensitive skin" });
    expect(created.status).toBe(201);
    const id = created.body.patient.id;

    const list = await request(app).get("/api/patients?q=maria").set("Cookie", cookie);
    expect(list.body.patients).toHaveLength(1);

    const updated = await request(app)
      .patch(`/api/patients/${id}`)
      .set("Cookie", cookie)
      .send({ notes: "updated" });
    expect(updated.body.patient.notes).toBe("updated");

    const del = await request(app).delete(`/api/patients/${id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);
  });

  it("rejects creation without a name", async () => {
    const { app, cookie } = await loggedInAgent();
    const res = await request(app).post("/api/patients").set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
  });

  it("records patient consent with a version", async () => {
    const { app, cookie } = await loggedInAgent();
    const created = await request(app)
      .post("/api/patients")
      .set("Cookie", cookie)
      .send({ name: "Jo" });
    const id = created.body.patient.id;
    const consent = await request(app)
      .post(`/api/patients/${id}/consent`)
      .set("Cookie", cookie)
      .send({ version: 1 });
    expect(consent.status).toBe(200);
    expect(consent.body.patient.consentVersion).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Add routes to `app.ts`** after the existing `GET /api/patients`:

```ts
  app.post("/api/patients", auth, async (req, res) => {
    const { name, externalRef, notes } = req.body ?? {};
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const patient = await deps.patients.create({
      name: name.trim(),
      externalRef: typeof externalRef === "string" ? externalRef : null,
      notes: typeof notes === "string" ? notes : "",
      consentVersion: null,
    });
    res.status(201).json({ patient });
  });

  app.patch("/api/patients/:id", auth, async (req, res) => {
    const { name, externalRef, notes } = req.body ?? {};
    const patient = await deps.patients.update(req.params.id, {
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof externalRef === "string" ? { externalRef } : {}),
      ...(typeof notes === "string" ? { notes } : {}),
    });
    if (!patient) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ patient });
  });

  app.delete("/api/patients/:id", auth, async (req, res) => {
    const ok = await deps.patients.remove(req.params.id);
    res.status(ok ? 204 : 404).end();
  });

  app.post("/api/patients/:id/consent", auth, async (req, res) => {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1) {
      res.status(400).json({ error: "version required" });
      return;
    }
    const patient = await deps.patients.update(req.params.id, { consentVersion: version });
    if (!patient) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ patient });
  });
```

- [ ] **Step 4: Run — PASS. Commit:**

```bash
git add server/api/app.ts server/api/app.test.ts
git commit -m "feat: patients CRUD with consent recording"
```

---

## Task 5: Analyze endpoint — pipeline + compression + storage

**Files:**
- Modify: `server/api/app.ts`
- Modify: `server/api/app.test.ts`

- [ ] **Step 1: Failing tests.** Append to `app.test.ts` (add these imports at the top of the file: `import sharp from "sharp";`):

```ts
async function tinyJpegB64(): Promise<string> {
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } },
  })
    .jpeg()
    .toBuffer();
  return buf.toString("base64");
}

describe("analyze", () => {
  it("analyzes, compresses, stores, and returns the scan", async () => {
    const { app, cookie, deps } = await loggedInAgent();
    const patient = await request(app)
      .post("/api/patients")
      .set("Cookie", cookie)
      .send({ name: "Ana" });
    const pid = patient.body.patient.id;

    const res = await request(app)
      .post("/api/analyze")
      .set("Cookie", cookie)
      .send({
        patientId: pid,
        image: await tinyJpegB64(),
        mime: "image/jpeg",
        mode: "face",
        classifierFindings: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.scan.report.summary).toBeTruthy();
    expect(res.body.scan.partial).toBe(false);

    const stored = await deps.scans.get(res.body.scan.id);
    expect(stored?.imageJpeg.byteLength).toBeGreaterThan(0);
    const meta = await sharp(Buffer.from(stored!.imageJpeg)).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("stores a partial scan when the pipeline fails, and can re-analyze later", async () => {
    const failing = makeTestDeps();
    failing.pipeline = {
      ...failing.pipeline,
      callProvider: async () => {
        throw new Error("offline");
      },
    };
    const app = createApp(failing);
    const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
    const cookie = login.headers["set-cookie"][0];
    const patient = await request(app).post("/api/patients").set("Cookie", cookie).send({ name: "Ben" });

    const res = await request(app)
      .post("/api/analyze")
      .set("Cookie", cookie)
      .send({
        patientId: patient.body.patient.id,
        image: await tinyJpegB64(),
        mime: "image/jpeg",
        mode: "face",
        classifierFindings: [{ id: "acne", label: "Acne", source: "classifier", confidence: 0.5, severity: "mild" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.scan.partial).toBe(true);
    expect(res.body.scan.report).toBeNull();
  });

  it("returns 404 for an unknown patient", async () => {
    const { app, cookie } = await loggedInAgent();
    const res = await request(app)
      .post("/api/analyze")
      .set("Cookie", cookie)
      .send({ patientId: "nope", image: await tinyJpegB64(), mime: "image/jpeg", mode: "face" });
    expect(res.status).toBe(404);
  });

  it("serves the stored image and scan list", async () => {
    const { app, cookie } = await loggedInAgent();
    const patient = await request(app).post("/api/patients").set("Cookie", cookie).send({ name: "Cy" });
    const pid = patient.body.patient.id;
    const analyzed = await request(app)
      .post("/api/analyze")
      .set("Cookie", cookie)
      .send({ patientId: pid, image: await tinyJpegB64(), mime: "image/jpeg", mode: "face" });

    const list = await request(app).get(`/api/patients/${pid}/scans`).set("Cookie", cookie);
    expect(list.body.scans).toHaveLength(1);
    expect(list.body.scans[0].imageJpeg).toBeUndefined();

    const img = await request(app)
      .get(`/api/scans/${analyzed.body.scan.id}/image`)
      .set("Cookie", cookie);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Add to `app.ts`.** New imports:

```ts
import { handleAnalyze } from "../analysis/pipeline";
import { compressToJpeg } from "./image";
```

New routes (after the consent route):

```ts
  app.post("/api/analyze", auth, async (req, res) => {
    const { patientId, image, mime, mode, classifierFindings } = req.body ?? {};
    const patient = await deps.patients.get(String(patientId));
    if (!patient) {
      res.status(404).json({ error: "patient not found" });
      return;
    }

    let outcome: Awaited<ReturnType<typeof handleAnalyze>>;
    try {
      outcome = await handleAnalyze({ image, mime, mode }, deps.pipeline);
    } catch {
      outcome = { ok: false, reason: "analysis-unreliable" };
    }
    if (!outcome.ok && outcome.reason === "invalid-input") {
      res.status(400).json({ error: outcome.detail ?? "invalid input" });
      return;
    }

    const compressed = await compressToJpeg(Buffer.from(String(image), "base64"));
    const scan = await deps.scans.create({
      patientId: patient.id,
      mode,
      imageJpeg: compressed.jpeg,
      imageWidth: compressed.width,
      imageHeight: compressed.height,
      report: outcome.ok ? outcome.report : null,
      partial: !outcome.ok,
      classifierFindings: Array.isArray(classifierFindings) ? classifierFindings : [],
      promptVersion: outcome.ok ? outcome.promptVersion : null,
    });
    const { imageJpeg: _img, ...scanWire } = scan;
    res.json({ scan: scanWire });
  });

  app.post("/api/scans/:id/reanalyze", auth, async (req, res) => {
    const scan = await deps.scans.get(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const image = Buffer.from(scan.imageJpeg).toString("base64");
    const outcome = await handleAnalyze({ image, mime: "image/jpeg", mode: scan.mode }, deps.pipeline);
    if (!outcome.ok) {
      res.status(502).json({ error: outcome.reason });
      return;
    }
    await deps.scans.updateReport(scan.id, outcome.report, outcome.promptVersion);
    res.json({ ok: true });
  });

  app.get("/api/patients/:id/scans", auth, async (req, res) => {
    res.json({ scans: await deps.scans.listByPatient(req.params.id) });
  });

  app.get("/api/scans/:id/image", auth, async (req, res) => {
    const img = await deps.scans.getImage(req.params.id);
    if (!img) {
      res.status(404).end();
      return;
    }
    res.setHeader("content-type", "image/jpeg");
    res.send(Buffer.from(img.jpeg));
  });

  app.delete("/api/scans/:id", auth, async (req, res) => {
    const ok = await deps.scans.remove(req.params.id);
    res.status(ok ? 204 : 404).end();
  });
```

- [ ] **Step 4: Run — PASS. Full suite + `npm run typecheck:server` green. Commit:**

```bash
git add server/api/app.ts server/api/app.test.ts
git commit -m "feat: analyze endpoint with compression, storage, partial scans, re-analyze"
```

---

## Task 6: QR capture sessions

**Files:**
- Create: `server/api/capture-sessions.ts`
- Create: `server/api/capture-sessions.test.ts`
- Modify: `server/api/app.ts`
- Modify: `server/api/app.test.ts`

- [ ] **Step 1: Failing unit test** `server/api/capture-sessions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CaptureSessionStore } from "./capture-sessions";

describe("CaptureSessionStore", () => {
  it("creates a session and accepts one upload", () => {
    const store = new CaptureSessionStore(() => 1000);
    const { token } = store.create();
    expect(store.submit(token, { image: "abc=", mime: "image/jpeg", mode: "face" })).toBe(true);
    // Single-use: a second submit fails.
    expect(store.submit(token, { image: "def=", mime: "image/jpeg", mode: "face" })).toBe(false);
    const pending = store.take(token);
    expect(pending?.image).toBe("abc=");
    // take() consumes.
    expect(store.take(token)).toBeNull();
  });

  it("expires tokens after the TTL", () => {
    let now = 0;
    const store = new CaptureSessionStore(() => now);
    const { token } = store.create();
    now = 5 * 60 * 1000 + 1;
    expect(store.submit(token, { image: "abc=", mime: "image/jpeg", mode: "face" })).toBe(false);
  });

  it("rejects unknown tokens", () => {
    const store = new CaptureSessionStore(() => 0);
    expect(store.submit("bogus", { image: "a=", mime: "image/jpeg", mode: "face" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `server/api/capture-sessions.ts`:

```ts
import { randomBytes } from "node:crypto";

export interface PendingCapture {
  image: string; // base64
  mime: string;
  mode: "face" | "closeup";
}

const TTL_MS = 5 * 60 * 1000;

interface Session {
  createdAt: number;
  capture: PendingCapture | null;
  used: boolean;
}

// In-memory is correct here (not a prototype shortcut): sessions are
// ephemeral pairing state, meaningless across api restarts.
export class CaptureSessionStore {
  private sessions = new Map<string, Session>();
  constructor(private now: () => number) {}

  create(): { token: string } {
    const token = randomBytes(16).toString("hex");
    this.sessions.set(token, { createdAt: this.now(), capture: null, used: false });
    return { token };
  }

  submit(token: string, capture: PendingCapture): boolean {
    const s = this.sessions.get(token);
    if (!s || s.used || this.now() - s.createdAt > TTL_MS) return false;
    s.capture = capture;
    s.used = true;
    return true;
  }

  take(token: string): PendingCapture | null {
    const s = this.sessions.get(token);
    if (!s?.capture) return null;
    const capture = s.capture;
    this.sessions.delete(token);
    return capture;
  }
}
```

- [ ] **Step 4: Run unit test — PASS. Then failing route tests.** Append to `app.test.ts`:

```ts
describe("capture sessions (QR)", () => {
  it("desktop creates a session; phone submits by token without auth; desktop polls it", async () => {
    const { app, cookie } = await loggedInAgent();
    const created = await request(app).post("/api/capture-sessions").set("Cookie", cookie);
    expect(created.status).toBe(201);
    const { token, path } = created.body;
    expect(path).toBe(`/capture/${token}`);

    // Phone: NO cookie.
    const submit = await request(app)
      .post(`/api/capture-sessions/${token}/image`)
      .send({ image: await tinyJpegB64(), mime: "image/jpeg", mode: "face" });
    expect(submit.status).toBe(200);

    // Desktop polls (auth required) and consumes the capture.
    const poll = await request(app)
      .get(`/api/capture-sessions/${token}`)
      .set("Cookie", cookie);
    expect(poll.status).toBe(200);
    expect(poll.body.capture.mime).toBe("image/jpeg");

    const again = await request(app)
      .get(`/api/capture-sessions/${token}`)
      .set("Cookie", cookie);
    expect(again.status).toBe(404);
  });

  it("rejects submissions with an expired/unknown token", async () => {
    const { app } = await loggedInAgent();
    const res = await request(app)
      .post("/api/capture-sessions/bogus/image")
      .send({ image: "aGVsbG8=", mime: "image/jpeg", mode: "face" });
    expect(res.status).toBe(410);
  });
});
```

- [ ] **Step 5: Wire routes in `app.ts`.** Import and instantiate:

```ts
import { CaptureSessionStore } from "./capture-sessions";
```

Inside `createApp`, before the routes: `const captures = new CaptureSessionStore(deps.now);`

Routes:

```ts
  app.post("/api/capture-sessions", auth, (_req, res) => {
    const { token } = captures.create();
    res.status(201).json({ token, path: `/capture/${token}` });
  });

  // Phone-side: token IS the authorization (single-use, 5-min TTL, upload-only).
  app.post("/api/capture-sessions/:token/image", (req, res) => {
    const { image, mime, mode } = req.body ?? {};
    if (typeof image !== "string" || typeof mime !== "string" || (mode !== "face" && mode !== "closeup")) {
      res.status(400).json({ error: "invalid capture" });
      return;
    }
    const ok = captures.submit(req.params.token, { image, mime, mode });
    res.status(ok ? 200 : 410).json(ok ? { ok: true } : { error: "session expired or used" });
  });

  app.get("/api/capture-sessions/:token", auth, (req, res) => {
    const capture = captures.take(req.params.token);
    if (!capture) {
      res.status(404).json({ error: "no capture yet" });
      return;
    }
    res.json({ capture });
  });
```

- [ ] **Step 6: Run — PASS. Commit:**

```bash
git add server/api/capture-sessions.ts server/api/capture-sessions.test.ts server/api/app.ts server/api/app.test.ts
git commit -m "feat: QR capture sessions (single-use tokens, phone upload, desktop poll)"
```

---

## Task 7: Postgres repos, schema, and entry point

**Files:**
- Create: `server/db/schema.sql`
- Create: `server/api/pg-repos.ts`
- Create: `server/api/index.ts`

Thin SQL layer — no unit tests (interfaces are already behavior-tested against the in-memory fakes; the compose smoke in Task 9 exercises the real thing).

- [ ] **Step 1: Create `server/db/schema.sql`:**

```sql
CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  external_ref TEXT,
  notes TEXT NOT NULL DEFAULT '',
  consent_version INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('face', 'closeup')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  image_jpeg BYTEA NOT NULL,
  image_width INT NOT NULL,
  image_height INT NOT NULL,
  report JSONB,
  partial BOOLEAN NOT NULL DEFAULT false,
  classifier_findings JSONB NOT NULL DEFAULT '[]',
  prompt_version INT
);

CREATE INDEX IF NOT EXISTS scans_patient_created ON scans (patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 2: Create `server/api/pg-repos.ts`:**

```ts
import type { Pool } from "pg";
import type { AnalysisReport } from "../analysis/contract";
import type { Patient, PatientRepo, ScanRecord, ScanRepo, SettingsRepo } from "./repos";

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
    const { rows } = await this.pool.query(`SELECT * FROM scans WHERE id = $1`, [id]);
    return rows[0] ? rowToScan(rows[0]) : null;
  }
  async listByPatient(patientId: string) {
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
    const { rows } = await this.pool.query(`SELECT image_jpeg FROM scans WHERE id = $1`, [id]);
    return rows[0] ? { jpeg: rows[0].image_jpeg as Uint8Array } : null;
  }
  async updateReport(id: string, report: AnalysisReport, promptVersion: number) {
    const { rowCount } = await this.pool.query(
      `UPDATE scans SET report=$2, partial=false, prompt_version=$3 WHERE id=$1`,
      [id, JSON.stringify(report), promptVersion],
    );
    return (rowCount ?? 0) > 0;
  }
  async remove(id: string) {
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
```

- [ ] **Step 3: Create `server/api/index.ts`:**

```ts
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "./app";
import { PgPatientRepo, PgScanRepo, PgSettingsRepo } from "./pg-repos";
import { callClaude } from "../analysis/providers/anthropic";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://skin:skin@db:5432/skin",
  });
  // Idempotent schema apply on boot — fine for a single-writer clinic app.
  const schema = readFileSync(path.join(import.meta.dirname ?? __dirname, "../db/schema.sql"), "utf8");
  await pool.query(schema);

  const settings = new PgSettingsRepo(pool);
  let sessionSecret = await settings.get("session_secret");
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString("hex");
    await settings.set("session_secret", sessionSecret);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) console.error("WARNING: ANTHROPIC_API_KEY unset — analyses will fail (partial scans only)");

  const app = createApp({
    patients: new PgPatientRepo(pool),
    scans: new PgScanRepo(pool),
    settings,
    pipeline: {
      config: {
        apiKey,
        primaryModel: process.env.PRIMARY_MODEL ?? "claude-sonnet-5",
        critiqueModel: process.env.CRITIQUE_MODEL ?? "claude-haiku-4-5-20251001",
        maxTokens: Number(process.env.MAX_TOKENS ?? "2048"),
      },
      callProvider: async (req, model) => {
        const result = await callClaude(req, {
          apiKey,
          model,
          maxTokens: Number(process.env.MAX_TOKENS ?? "2048"),
        });
        return result.text;
      },
    },
    sessionSecret,
    now: () => Date.now(),
  });

  const port = Number(process.env.PORT ?? "3001");
  app.listen(port, () => console.log(`api listening on :${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Verify** — `npm run typecheck:server` clean; `npm run build:server` produces `dist-server/index.js`; full test suite still green. Add `dist-server/` to `.gitignore`. Commit:

```bash
git add server/db/schema.sql server/api/pg-repos.ts server/api/index.ts .gitignore
git commit -m "feat: Postgres repos, schema, and api entry point"
```

---

## Task 8: Docker stack + backup/restore

**Files:**
- Create: `Dockerfile`
- Create: `nginx.conf`
- Create: `docker-compose.yml`
- Create: `docker-compose.lan.yml`
- Create: `.env.example`
- Create: `Makefile`

- [ ] **Step 1: Create `Dockerfile`** (multi-stage: build both, ship two targets):

```dockerfile
# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

# --- web (nginx) ---
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# --- api (node) ---
FROM node:20-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist-server ./dist-server
COPY server/db ./server/db
EXPOSE 3001
CMD ["node", "dist-server/index.js"]
```

- [ ] **Step 2: Create `nginx.conf`:**

```nginx
server {
  listen 80;
  client_max_body_size 16m;

  location /api/ {
    proxy_pass http://api:3001;
    proxy_set_header X-Forwarded-For $remote_addr;
  }

  location / {
    root /usr/share/nginx/html;
    try_files $uri /index.html;
  }
}
```

- [ ] **Step 3: Create `docker-compose.yml`:**

```yaml
services:
  web:
    build:
      context: .
      target: web
    ports:
      - "127.0.0.1:8080:80"
    depends_on:
      - api

  api:
    build:
      context: .
      target: api
    environment:
      DATABASE_URL: postgres://skin:${POSTGRES_PASSWORD:-skin}@db:5432/skin
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      PRIMARY_MODEL: ${PRIMARY_MODEL:-claude-sonnet-5}
      CRITIQUE_MODEL: ${CRITIQUE_MODEL:-claude-haiku-4-5-20251001}
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: skin
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-skin}
      POSTGRES_DB: skin
    volumes:
      - skin_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U skin"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  skin_data:
```

- [ ] **Step 4: Create `docker-compose.lan.yml`** (opt-in LAN exposure for phone capture/QR):

```yaml
services:
  web:
    ports:
      - "8080:80"
```

- [ ] **Step 5: Create `.env.example`:**

```
ANTHROPIC_API_KEY=sk-ant-...
POSTGRES_PASSWORD=change-me
PRIMARY_MODEL=claude-sonnet-5
CRITIQUE_MODEL=claude-haiku-4-5-20251001
```

- [ ] **Step 6: Create `Makefile`:**

```makefile
.PHONY: up down lan build backup restore

up:
	docker compose up -d

lan:
	docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d

down:
	docker compose down

build:
	docker compose build

backup:
	docker compose exec -T db pg_dump -U skin skin > backup-$$(date +%Y%m%d-%H%M%S).sql

restore:
	@test -n "$(FILE)" || (echo "usage: make restore FILE=backup-....sql" && exit 1)
	cat $(FILE) | docker compose exec -T db psql -U skin skin
```

- [ ] **Step 7: Verify locally** — `docker compose build` succeeds (requires Docker running; if unavailable in the execution environment, report DONE_WITH_CONCERNS noting the build was not executed). Commit:

```bash
git add Dockerfile nginx.conf docker-compose.yml docker-compose.lan.yml .env.example Makefile
git commit -m "feat: docker compose clinic stack with backup/restore"
```

---

## Task 9: Browser analyze client

**Files:**
- Create: `src/features/skin-analysis/api/analyze-client.ts`
- Create: `src/features/skin-analysis/api/analyze-client.test.ts`

- [ ] **Step 1: Failing test** `src/features/skin-analysis/api/analyze-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { analyzeCapture, AnalyzeAuthError, AnalyzeFailedError } from "./analyze-client";
import type { CaptureResult } from "../types";

const capture: CaptureResult = {
  blob: new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" }),
  mimeType: "image/jpeg",
  mode: "face",
  source: "camera",
  width: 640,
  height: 480,
};

const scanWire = {
  id: "scan-1",
  patientId: "p-1",
  mode: "face",
  createdAt: 1,
  imageWidth: 640,
  imageHeight: 480,
  report: null,
  partial: true,
  classifierFindings: [],
  promptVersion: null,
};

describe("analyzeCapture", () => {
  it("posts base64 JSON with credentials and returns the scan", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ scan: scanWire }), { status: 200 }));
    const scan = await analyzeCapture(capture, "p-1", [], fetchFn);
    expect(scan.id).toBe("scan-1");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/analyze");
    expect(init.credentials).toBe("include");
    const body = JSON.parse(init.body as string);
    expect(body.patientId).toBe("p-1");
    expect(body.mime).toBe("image/jpeg");
    expect(typeof body.image).toBe("string");
  });

  it("throws AnalyzeAuthError on 401", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(analyzeCapture(capture, "p-1", [], fetchFn)).rejects.toThrow(AnalyzeAuthError);
  });

  it("throws AnalyzeFailedError on other failures", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 502 }));
    await expect(analyzeCapture(capture, "p-1", [], fetchFn)).rejects.toThrow(AnalyzeFailedError);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `src/features/skin-analysis/api/analyze-client.ts`:

```ts
import type { CaptureResult, Finding } from "../types";
import type { AnalysisReport } from "./contract";

export class AnalyzeAuthError extends Error {
  constructor() {
    super("Please log in again.");
    this.name = "AnalyzeAuthError";
  }
}
export class AnalyzeFailedError extends Error {
  constructor(message = "The analysis could not be completed. Please try again.") {
    super(message);
    this.name = "AnalyzeFailedError";
  }
}

export interface ScanWire {
  id: string;
  patientId: string;
  mode: "face" | "closeup";
  createdAt: number;
  imageWidth: number;
  imageHeight: number;
  report: AnalysisReport | null;
  partial: boolean;
  classifierFindings: unknown[];
  promptVersion: number | null;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export async function analyzeCapture(
  capture: CaptureResult,
  patientId: string,
  classifierFindings: Finding[],
  fetchFn: FetchFn = fetch,
): Promise<ScanWire> {
  const image = await blobToBase64(capture.blob);
  const res = await fetchFn("/api/analyze", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      patientId,
      image,
      mime: capture.mimeType,
      mode: capture.mode,
      classifierFindings,
    }),
  });

  if (res.status === 401) throw new AnalyzeAuthError();
  if (!res.ok) throw new AnalyzeFailedError();
  const data = (await res.json()) as { scan?: ScanWire };
  if (!data.scan) throw new AnalyzeFailedError("Malformed server response.");
  return data.scan;
}
```

NOTE: if jsdom's `FileReader.readAsDataURL` fails on Blob in this environment, add a guarded polyfill to `src/test/setup.ts` following the established pattern (localStorage, Blob.text, Worker) — report it as a deviation.

- [ ] **Step 4: Run — PASS. `npm run verify` fully green. Commit:**

```bash
git add src/features/skin-analysis/api/analyze-client.ts src/features/skin-analysis/api/analyze-client.test.ts
git commit -m "feat: browser analyze client for the local api"
```

---

## Task 10: Compose smoke test

**Files:** none (manual verification; requires Docker + a real or placeholder ANTHROPIC_API_KEY)

- [ ] **Step 1:** `cp .env.example .env` (fill `ANTHROPIC_API_KEY` if available), `make build && make up`.
- [ ] **Step 2:** Open `http://localhost:8080` → app loads through nginx.
- [ ] **Step 3:** `curl -s localhost:8080/api/health` → `{"ok":true}`.
- [ ] **Step 4:** Login flow: `curl -s -c /tmp/cj -X POST localhost:8080/api/auth/login -H 'content-type: application/json' -d '{"password":"clinic-pass-123"}'` → `{"ok":true}` (first login sets the password). Create a patient with the cookie jar; list it back.
- [ ] **Step 5:** `make backup` → a `backup-*.sql` file appears and contains `CREATE TABLE`… content. (Restore drill: `make restore FILE=<that file>` completes without error.)
- [ ] **Step 6:** `make down`. Report results honestly — if Docker isn't available, mark the task incomplete rather than claiming success.

---

## Definition of Done

- `npm run verify` green (typecheck app + server, all tests, frontend build); `npm run build:server` bundles.
- Every route behavior-tested via supertest against in-memory repos: auth (bootstrap/reject/protect), patients CRUD + consent, analyze (store + compress + partial + re-analyze + image serving), capture sessions (create/submit-no-auth/poll-consume/expiry).
- Images stored as compressed JPEG ≤1280px (verified by test), EXIF-free, orientation applied.
- Compose stack builds; smoke test (Task 10) passes where Docker is available; `make backup`/`restore` work.
- No image data or API keys logged.

## What this plan intentionally defers

- Login UI, patients UI, history/thumbnails, before/after compare — Plan 6.
- Wiring CaptureFlow → analyze-client + loading screen + results rendering — Plan 5.
- QR display + phone capture page (frontend of capture sessions) — Plan 6.
- Verdict merge (classifier × LLM report) — Plan 5.

// @vitest-environment node
//
// Full upload → promote → download → rollback loop against a REAL Postgres.
//
// Deliberately gated: runs ONLY when TEST_DATABASE_URL is set (never falls back
// to DATABASE_URL, so it can never touch the dev database by accident):
//
//   TEST_DATABASE_URL=postgres://localhost:5432/skin_test npx vitest run backend/modules/models/models-flow.integration.test.ts
//
// The database must exist; the schema self-applies. Uses a unique model id per
// run and removes its rows + uploaded files afterwards.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { createModelsRoutes } from "./routes";
import { createModelUploadRouter } from "./upload-route";
import { requireSession } from "../../middleware/require-session";
import { makeSessionToken } from "../auth/service";
import type { AppDeps } from "../../shared/deps";

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("models upload→promote→download→rollback (integration, pg)", () => {
  const MODEL_ID = `itest-model-${Date.now().toString(36)}`;
  const SECRET = "itest-secret";
  const cookie = `session=${makeSessionToken(SECRET, Date.now())}`;
  const modelsDir = path.resolve(process.cwd(), "backend/public/models");

  let pool: Pool;
  let app: express.Express;
  let v1Id = "";
  let v2Id = "";
  const V1_BYTES = Buffer.from("model-weights-v1-payload");
  const V2_BYTES = Buffer.from("model-weights-v2-payload-longer");

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    const schema = readFileSync(path.resolve(process.cwd(), "database/schema/schema.sql"), "utf8");
    await pool.query(schema);

    const deps = { pool } as unknown as AppDeps;
    const auth = requireSession(SECRET, () => Date.now());
    app = express();
    app.use(express.json());
    mkdirSync(modelsDir, { recursive: true });
    app.use("/models", express.static(modelsDir)); // mirrors app.ts static mount
    app.use("/api/models", createModelsRoutes(deps, auth));
    app.use("/api/models", createModelUploadRouter(deps, auth));
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM model_versions WHERE model_id = $1`, [MODEL_ID]).catch(() => undefined);
    await pool.query(`DELETE FROM model_registry WHERE id = $1`, [MODEL_ID]).catch(() => undefined);
    rmSync(path.join(modelsDir, MODEL_ID), { recursive: true, force: true });
    await pool.end();
  });

  it("registers the model", async () => {
    const res = await request(app)
      .post("/api/models")
      .set("Cookie", cookie)
      .send({ id: MODEL_ID, name: "Integration Test Model", type: "classifier" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("uploads v1 (stable + current) and reports a correct checksum", async () => {
    const res = await request(app)
      .post(`/api/models/${MODEL_ID}/upload`)
      .set("Cookie", cookie)
      .field("version", "1.0.0")
      .field("isStable", "true")
      .field("setCurrent", "true")
      .attach("file", V1_BYTES, "weights-v1.onnx");
    expect(res.status).toBe(201);
    v1Id = res.body.data.id;
    expect(res.body.data.checksum).toBe(createHash("sha256").update(V1_BYTES).digest("hex"));
    expect(res.body.data.is_current).toBe(true);
  });

  it("uploads v2 and promotes it to current", async () => {
    const upload = await request(app)
      .post(`/api/models/${MODEL_ID}/upload`)
      .set("Cookie", cookie)
      .field("version", "2.0.0")
      .field("isStable", "true")
      .attach("file", V2_BYTES, "weights-v2.onnx");
    expect(upload.status).toBe(201);
    v2Id = upload.body.data.id;

    const promote = await request(app)
      .post(`/api/models/${MODEL_ID}/promote/${v2Id}`)
      .set("Cookie", cookie);
    expect(promote.status).toBe(200);
  });

  it("manifest shows v2 as the current version", async () => {
    const res = await request(app).get("/api/models/manifest");
    expect(res.status).toBe(200);
    const entry = (res.body.data as { id: string; currentVersion?: { version?: string } }[]).find(
      (m) => m.id === MODEL_ID,
    );
    expect(entry).toBeTruthy();
    expect(JSON.stringify(entry)).toContain("2.0.0");
  });

  it("download info + static bytes round-trip with a matching checksum (client-verification path)", async () => {
    const info = await request(app).get(`/api/models/${MODEL_ID}/download/${v2Id}`);
    expect(info.status).toBe(200);
    const { filePath, checksum } = info.body.data;
    expect(checksum).toBe(createHash("sha256").update(V2_BYTES).digest("hex"));

    const bytes = await request(app).get(filePath); // served by the /models static mount
    expect(bytes.status).toBe(200);
    expect(createHash("sha256").update(bytes.body).digest("hex")).toBe(checksum);
  });

  it("rollback returns to the previous stable version (v1)", async () => {
    const res = await request(app).post(`/api/models/${MODEL_ID}/rollback`).set("Cookie", cookie);
    expect(res.status).toBe(200);

    const model = await request(app).get(`/api/models/${MODEL_ID}`);
    const current = (model.body.data.versions as { id: string; isCurrent: boolean }[]).find((v) => v.isCurrent);
    expect(current?.id).toBe(v1Id);
  });
});

import { describe, test, expect } from "vitest";
import request from "supertest";
import express from "express";
import { createModelsRoutes } from "./routes";
import { createModelUploadRouter } from "./upload-route";
import { requireSession } from "../../middleware/require-session";
import type { AppDeps } from "../../shared/deps";

describe("models routes auth guards", () => {
  test("POST /api/models (register) requires auth when auth provided", async () => {
    const app = express();
    app.use(express.json());

    // pool truthy (but not a real Pool) to avoid the 503 no-database guard in these
    // auth-only tests, which never touch the database.
    const deps = { pool: {} } as unknown as AppDeps;
    const auth = requireSession("test-secret", () => Date.now());
    app.use("/api/models", createModelsRoutes(deps, auth));

    const res = await request(app).post(`/api/models`).send({ id: "m1", name: "M1", type: "classifier" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  test("POST /api/models/:modelId/upload requires auth when auth provided", async () => {
    const app = express();
    const deps = { pool: {} } as unknown as AppDeps;
    const auth = requireSession("test-secret", () => Date.now());
    app.use("/api/models", createModelUploadRouter(deps, auth));

    const res = await request(app).post(`/api/models/face-landmarker/upload`).send();
    expect(res.status).toBe(401);
  });
});

import request from "supertest";
import express from "express";
import { createModelsRoutes } from "./routes";
import { createModelUploadRouter } from "./upload-route";
import { requireSession } from "../../middleware/require-session";

describe("models routes auth guards", () => {
  test("POST /api/models (register) requires auth when auth provided", async () => {
    const app = express();
    app.use(express.json());

    const deps: any = { pool: {} }; // pool truthy to avoid 503 guard
    const auth = requireSession("test-secret", () => Date.now());
    app.use("/api/models", createModelsRoutes(deps, auth));

    const res = await request(app).post(`/api/models`).send({ id: "m1", name: "M1", type: "classifier" });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  test("POST /api/models/:modelId/upload requires auth when auth provided", async () => {
    const app = express();
    const deps: any = { pool: {} };
    const auth = requireSession("test-secret", () => Date.now());
    app.use("/api/models", createModelUploadRouter(deps, auth));

    const res = await request(app).post(`/api/models/face-landmarker/upload`).send();
    expect(res.status).toBe(401);
  });
});

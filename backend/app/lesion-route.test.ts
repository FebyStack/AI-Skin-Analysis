// @vitest-environment node
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { makeTestDeps } from "../shared/testing";
import { LesionUnavailableError, type LesionProvider } from "../modules/analysis/lesion-client";

async function login(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/auth/login").send({ password: "testpass123" });
  return res.headers["set-cookie"];
}

describe("POST /api/lesion", () => {
  it("returns the analysis for an authenticated request (fake provider)", async () => {
    const app = createApp(makeTestDeps());
    const cookie = await login(app);
    const res = await request(app).post("/api/lesion").set("Cookie", cookie).send({ image: "aGk=", mime: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.analysis.lesions[0].classification.predicted).toBe("MEL");
    expect(res.body.analysis.model.classifier).toBe("efficientnet_b1-isic2019");
  });

  it("401 without a session", async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).post("/api/lesion").send({ image: "aGk=" });
    expect(res.status).toBe(401);
  });

  it("400 when image is missing", async () => {
    const app = createApp(makeTestDeps());
    const cookie = await login(app);
    const res = await request(app).post("/api/lesion").set("Cookie", cookie).send({ mime: "image/png" });
    expect(res.status).toBe(400);
  });

  it("503 when the lesion service is unavailable", async () => {
    const unavailable: LesionProvider = {
      analyze: async () => {
        throw new LesionUnavailableError("connection refused");
      },
    };
    const app = createApp(makeTestDeps({ lesion: unavailable }));
    const cookie = await login(app);
    const res = await request(app).post("/api/lesion").set("Cookie", cookie).send({ image: "aGk=" });
    expect(res.status).toBe(503);
  });
});

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
  it("returns analysis + builtin explanation when no online explainer is wired", async () => {
    const app = createApp(makeTestDeps());
    const cookie = await login(app);
    const res = await request(app).post("/api/lesion").set("Cookie", cookie).send({ image: "aGk=", mime: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.analysis.lesions[0].classification.predicted).toBe("MEL");
    // golden fixture is MEL → builtin explanation must force referral
    expect(res.body.explanation.source).toBe("builtin");
    expect(res.body.explanation.referral.recommended).toBe(true);
    expect(res.body.explanation.disclaimer).toMatch(/not a diagnosis/i);
  });

  it("uses the online explainer when it succeeds", async () => {
    const geminiExplanation = {
      patientSummary: "The analysis suggests melanoma features; a professional must confirm.",
      education: "Melanoma education.",
      referral: { recommended: true, urgency: "urgent" as const, reason: "possible melanoma" },
      disclaimer: "This is not a diagnosis.",
      source: "gemini" as const,
      promptVersion: 1,
    };
    const app = createApp(makeTestDeps({ lesionExplain: async () => geminiExplanation }));
    const cookie = await login(app);
    const res = await request(app).post("/api/lesion").set("Cookie", cookie).send({ image: "aGk=" });
    expect(res.body.explanation.source).toBe("gemini");
  });

  it("falls back to builtin when the online explainer fails", async () => {
    const app = createApp(makeTestDeps({ lesionExplain: async () => { throw new Error("offline"); } }));
    const cookie = await login(app);
    const res = await request(app).post("/api/lesion").set("Cookie", cookie).send({ image: "aGk=" });
    expect(res.status).toBe(200);
    expect(res.body.explanation.source).toBe("builtin");
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

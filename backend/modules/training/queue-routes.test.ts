// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import { goldenFaceReport } from "../../../shared/testing/face-fixtures";

const app = createApp(makeTestDeps());
let cookie = "";
let scanId = "";

async function jpegB64(): Promise<string> {
  const buf = await sharp({
    create: { width: 640, height: 640, channels: 3, background: { r: 200, g: 170, b: 150 } },
  })
    .jpeg()
    .toBuffer();
  return buf.toString("base64");
}

beforeAll(async () => {
  const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
  cookie = login.headers["set-cookie"][0];
  const image = await jpegB64();
  const save = await request(app)
    .post("/api/face-scans")
    .set("Cookie", cookie)
    .send({ report: goldenFaceReport(), images: [{ angle: "front", image, mime: "image/jpeg" }] });
  expect(save.status).toBe(200);
  scanId = save.body.scan.id;
});

describe("training queue", () => {
  it("auto-enqueues a completed scan as pending", async () => {
    const res = await request(app).get("/api/training-queue?status=pending").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { scanId: string }) => e.scanId)).toContain(scanId);
  });

  it("reports stats across statuses", async () => {
    const res = await request(app).get("/api/training-queue/stats").set("Cookie", cookie);
    expect(res.body.pending).toBeGreaterThanOrEqual(1);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it("detail returns the AI report plus reasoning bullets", async () => {
    const res = await request(app).get(`/api/training-queue/${scanId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.report).toBeTruthy();
    expect(res.body.reasoning.length).toBeGreaterThan(0);
    expect(["gemini", "derived"]).toContain(res.body.reasoningSource);
  });

  it("stores the human label WITHOUT touching the AI prediction", async () => {
    const before = await request(app).get(`/api/training-queue/${scanId}`).set("Cookie", cookie);
    const aiAcne = before.body.report.dimensions.acne;

    const put = await request(app)
      .post(`/api/scans/${scanId}/label`)
      .set("Cookie", cookie)
      .send({ dimension: "acne", label: "severe" });
    expect(put.status).toBe(200);

    const after = await request(app).get(`/api/training-queue/${scanId}`).set("Cookie", cookie);
    expect(after.body.labels).toContainEqual({ dimension: "acne", label: "severe" });
    // The AI prediction is untouched — the two are stored separately.
    expect(after.body.report.dimensions.acne).toEqual(aiAcne);
  });

  it("accepts severity labels for the continuous dimensions", async () => {
    for (const dim of ["redness", "oiliness", "fine-lines"]) {
      const res = await request(app)
        .post(`/api/scans/${scanId}/label`)
        .set("Cookie", cookie)
        .send({ dimension: dim, label: "moderate" });
      expect(res.status).toBe(200);
    }
  });

  it("rejects a label outside the field's vocabulary", async () => {
    const res = await request(app)
      .post(`/api/scans/${scanId}/label`)
      .set("Cookie", cookie)
      .send({ dimension: "redness", label: "very-severe" });
    expect(res.status).toBe(400);
  });

  it("moves a sample through review and filters by the new status", async () => {
    const res = await request(app)
      .post(`/api/training-queue/${scanId}/status`)
      .set("Cookie", cookie)
      .send({ status: "approved", note: "verified" });
    expect(res.status).toBe(200);

    const approved = await request(app).get("/api/training-queue?status=approved").set("Cookie", cookie);
    expect(approved.body.entries.map((e: { scanId: string }) => e.scanId)).toContain(scanId);

    const pending = await request(app).get("/api/training-queue?status=pending").set("Cookie", cookie);
    expect(pending.body.entries.map((e: { scanId: string }) => e.scanId)).not.toContain(scanId);
  });

  it("rejects an unknown status", async () => {
    const res = await request(app)
      .post(`/api/training-queue/${scanId}/status`)
      .set("Cookie", cookie)
      .send({ status: "maybe" });
    expect(res.status).toBe(400);
  });

  it("requires auth", async () => {
    expect((await request(app).get("/api/training-queue")).status).toBe(401);
  });
});

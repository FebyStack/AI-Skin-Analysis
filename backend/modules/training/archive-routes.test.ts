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

beforeAll(async () => {
  const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
  cookie = login.headers["set-cookie"][0];
  const image = (
    await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 200, g: 170, b: 150 } },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64");
  const save = await request(app)
    .post("/api/face-scans")
    .set("Cookie", cookie)
    .send({
      report: goldenFaceReport(),
      images: [
        { angle: "front", image, mime: "image/jpeg" },
        { angle: "left-45", image, mime: "image/jpeg" },
      ],
      consent: { analysis: true, training: true },
    });
  scanId = save.body.scan.id;
});

describe("image archive", () => {
  it("deleting an angle archives it instead of destroying it", async () => {
    const del = await request(app)
      .delete(`/api/training-queue/${scanId}/images/left-45`)
      .set("Cookie", cookie);
    expect(del.status).toBe(200);
    expect(del.body.archived).toBe(true);

    // Gone from the scan...
    const detail = await request(app).get(`/api/training-queue/${scanId}`).set("Cookie", cookie);
    expect(detail.body.angles.map((a: { angle: string }) => a.angle)).not.toContain("left-45");

    // ...but recoverable from the archive.
    const arc = await request(app).get("/api/archive").set("Cookie", cookie);
    expect(arc.body.images).toContainEqual(expect.objectContaining({ scanId, angle: "left-45" }));
    expect(arc.body.stats.retentionDays).toBe(30);
  });

  it("restores an archived angle back onto the scan", async () => {
    const r = await request(app)
      .post(`/api/archive/${scanId}/left-45/restore`)
      .set("Cookie", cookie);
    expect(r.status).toBe(200);

    const detail = await request(app).get(`/api/training-queue/${scanId}`).set("Cookie", cookie);
    expect(detail.body.angles.map((a: { angle: string }) => a.angle)).toContain("left-45");
  });

  it("permanent delete removes the image but keeps the audit trail", async () => {
    await request(app).delete(`/api/training-queue/${scanId}/images/left-45`).set("Cookie", cookie);
    const purge = await request(app).delete(`/api/archive/${scanId}/left-45`).set("Cookie", cookie);
    expect(purge.status).toBe(200);

    const arc = await request(app).get("/api/archive").set("Cookie", cookie);
    expect(arc.body.images).not.toContainEqual(expect.objectContaining({ angle: "left-45" }));

    const ev = await request(app).get(`/api/training-queue/${scanId}/events`).set("Cookie", cookie);
    expect(ev.body.events.map((e: { kind: string }) => e.kind)).toContain("purged");
  });
});

describe("lifecycle + analytics", () => {
  it("records capture and analysis the moment a scan is saved", async () => {
    const res = await request(app).get(`/api/training-queue/${scanId}/events`).set("Cookie", cookie);
    const kinds = res.body.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain("captured");
    expect(kinds).toContain("analyzed");
  });

  it("logs the review decision with the reviewer's name", async () => {
    await request(app)
      .post(`/api/training-queue/${scanId}/status`)
      .set("Cookie", cookie)
      .send({ status: "approved", reviewerName: "Dr. Amara Osei" });

    const res = await request(app).get(`/api/training-queue/${scanId}/events`).set("Cookie", cookie);
    expect(res.body.events).toContainEqual(
      expect.objectContaining({ kind: "approved", actor: "Dr. Amara Osei" }),
    );
  });

  it("summarises the clinic", async () => {
    const res = await request(app).get("/api/analytics").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalVisits).toBeGreaterThanOrEqual(1);
    expect(res.body.approved).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.datasetGrowth)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import { goldenFaceReport } from "../../../shared/testing/face-fixtures";
import type { FaceReport } from "../../../shared/face";

export async function setupMarkedScan(report: FaceReport = goldenFaceReport()) {
  const deps = makeTestDeps();
  const app = createApp(deps);
  const cookie = (await request(app).post("/api/auth/login").send({ password: "clinic-pass" })).headers["set-cookie"][0];
  const image = (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } })
    .jpeg().toBuffer()).toString("base64");
  const save = await request(app).post("/api/face-scans").set("Cookie", cookie)
    .send({ report, images: [{ angle: "front", image, mime: "image/jpeg" }] });
  expect(save.status).toBe(200);
  return { deps, app, cookie, scanId: save.body.scan.id as string };
}

describe("manual marks", () => {
  it("stores staff taps on an image and returns them with the scan", async () => {
    const { app, cookie, scanId } = await setupMarkedScan();
    const put = await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).set("Cookie", cookie)
      .send({ points: [{ kind: "acne", x: 0.4, y: 0.5 }] });
    expect(put.body).toEqual({ ok: true, count: 1 });
    const got = await request(app).get(`/api/face-scans/${scanId}`).set("Cookie", cookie);
    expect(got.body.angles[0].manualMarks).toEqual([{ kind: "acne", x: 0.4, y: 0.5 }]);
  });

  it("rejects malformed points and images that do not exist", async () => {
    const { app, cookie, scanId } = await setupMarkedScan();
    const bad = await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).set("Cookie", cookie)
      .send({ points: [{ kind: "acne", x: 2, y: 0 }] });
    expect(bad.status).toBe(400);
    const missing = await request(app).put(`/api/face-scans/${scanId}/images/left-45/marks`).set("Cookie", cookie)
      .send({ points: [] });
    expect(missing.status).toBe(404);
  });

  it("is closed to logged-out users", async () => {
    const { app, scanId } = await setupMarkedScan();
    const res = await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).send({ points: [] });
    expect(res.status).toBe(401);
  });

  it("refuses patient invite sessions", async () => {
    const { app, cookie, scanId } = await setupMarkedScan();
    const made = await request(app).post("/api/invites").set("Cookie", cookie).send({ label: "Remote patient", maxScans: 2 });
    const claimed = await request(app).post("/api/auth/invite").send({ token: made.body.token });
    const res = await request(app).put(`/api/face-scans/${scanId}/images/front/marks`)
      .set("Cookie", claimed.headers["set-cookie"][0]).send({ points: [] });
    expect(res.status).toBe(403);
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import { goldenFaceReport } from "../../../shared/testing/face-fixtures";
import type { FaceReport } from "../../../shared/face";

export async function setupMarkedScan(report: FaceReport = goldenFaceReport(), training = true) {
  const deps = makeTestDeps();
  const app = createApp(deps);
  const cookie = (await request(app).post("/api/auth/login").send({ password: "clinic-pass" })).headers["set-cookie"][0];
  const image = (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } })
    .jpeg().toBuffer()).toString("base64");
  const save = await request(app).post("/api/face-scans").set("Cookie", cookie)
    .send({ report, images: [{ angle: "front", image, mime: "image/jpeg" }], consent: { training } });
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

  it("strips manualMarks from an invite session's own scan, but keeps them for staff", async () => {
    const { app, cookie } = await setupMarkedScan();
    const made = await request(app).post("/api/invites").set("Cookie", cookie).send({ label: "Remote patient", maxScans: 2 });
    const claimedCookie = (await request(app).post("/api/auth/invite").send({ token: made.body.token }))
      .headers["set-cookie"][0];
    const image = (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } })
      .jpeg().toBuffer()).toString("base64");
    const save = await request(app).post("/api/face-scans").set("Cookie", claimedCookie)
      .send({ report: goldenFaceReport(), images: [{ angle: "front", image, mime: "image/jpeg" }] });
    const scanId = save.body.scan.id as string;
    // Staff can mark ground truth on any scan, including one an invite link created.
    await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).set("Cookie", cookie)
      .send({ points: [{ kind: "acne", x: 0.4, y: 0.5 }] });

    const asInvite = await request(app).get(`/api/face-scans/${scanId}`).set("Cookie", claimedCookie);
    expect(asInvite.body.angles[0].manualMarks).toBeUndefined();

    const asStaff = await request(app).get(`/api/face-scans/${scanId}`).set("Cookie", cookie);
    expect(asStaff.body.angles[0].manualMarks).toEqual([{ kind: "acne", x: 0.4, y: 0.5 }]);
  });
});

describe("localization exam export", () => {
  it("writes each marked photo with staff points, the model's saved predictions, and its model id", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "loc-exam-"));
    process.env.DATASETS_DIR = dir;
    try {
      const report: FaceReport = {
        ...goldenFaceReport(),
        marks: [{ kind: "acne", angle: "front", confidence: 0.9, source: "model", shape: { type: "box", x: 0.3, y: 0.4, w: 0.1, h: 0.1 } }],
        markedAngles: ["front"],
        modelVersions: { ...goldenFaceReport().modelVersions, acneMarks: "yolo11n-acne" },
      };
      const { app, cookie, scanId } = await setupMarkedScan(report);
      await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).set("Cookie", cookie)
        .send({ points: [{ kind: "acne", x: 0.35, y: 0.45 }] });
      const res = await request(app).post("/api/localization-exam/export").set("Cookie", cookie);
      expect(res.body.exported).toBe(1);
      const out = path.join(dir, "localization", "clinic");
      expect(existsSync(path.join(out, `${scanId}_front.jpg`))).toBe(true);
      const line = JSON.parse(readFileSync(path.join(out, "marks.jsonl"), "utf8").trim());
      expect(line.points).toEqual([{ kind: "acne", x: 0.35, y: 0.45 }]);
      expect(line.predictions).toEqual([{ x: 0.3, y: 0.4, w: 0.1, h: 0.1, confidence: 0.9 }]);
      expect(line.model).toBe("yolo11n-acne");
    } finally {
      delete process.env.DATASETS_DIR;
    }
  });

  it("skips scans without training consent, without a marks array, or with an unexamined angle", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "loc-exam-"));
    process.env.DATASETS_DIR = dir;
    try {
      const deps = makeTestDeps();
      const app = createApp(deps);
      const cookie = (await request(app).post("/api/auth/login").send({ password: "clinic-pass" })).headers["set-cookie"][0];
      const image = (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } })
        .jpeg().toBuffer()).toString("base64");

      async function scanAndMark(report: FaceReport, training: boolean): Promise<string> {
        const save = await request(app).post("/api/face-scans").set("Cookie", cookie)
          .send({ report, images: [{ angle: "front", image, mime: "image/jpeg" }], consent: { training } });
        const scanId = save.body.scan.id as string;
        await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).set("Cookie", cookie)
          .send({ points: [{ kind: "acne", x: 0.3, y: 0.3 }] });
        return scanId;
      }

      const included = await scanAndMark(
        { ...goldenFaceReport(), marks: [], markedAngles: ["front"], modelVersions: { acneMarks: "yolo11n-acne" } },
        true,
      );
      await scanAndMark({ ...goldenFaceReport(), marks: [], markedAngles: ["front"] }, false); // no training consent
      await scanAndMark(goldenFaceReport(), true); // marks is undefined — detector never ran
      await scanAndMark({ ...goldenFaceReport(), marks: [], markedAngles: ["left-45"] }, true); // front not examined

      const res = await request(app).post("/api/localization-exam/export").set("Cookie", cookie);
      expect(res.body.exported).toBe(1);
      const line = JSON.parse(
        readFileSync(path.join(dir, "localization", "clinic", "marks.jsonl"), "utf8").trim(),
      );
      expect(line.image).toBe(`${included}_front.jpg`);
    } finally {
      delete process.env.DATASETS_DIR;
    }
  });

  it("clears a stale export before writing the new one", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "loc-exam-"));
    process.env.DATASETS_DIR = dir;
    try {
      const report: FaceReport = { ...goldenFaceReport(), marks: [], markedAngles: ["front"] };
      const { app, deps, cookie, scanId } = await setupMarkedScan(report);
      await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).set("Cookie", cookie)
        .send({ points: [{ kind: "acne", x: 0.3, y: 0.3 }] });
      const first = await request(app).post("/api/localization-exam/export").set("Cookie", cookie);
      expect(first.body.exported).toBe(1);
      const out = path.join(dir, "localization", "clinic");
      expect(existsSync(path.join(out, `${scanId}_front.jpg`))).toBe(true);

      // Archiving removes the only marked image — the next export must not still
      // contain yesterday's photo and jsonl row.
      await deps.scans.deleteImage(scanId, "front");
      const second = await request(app).post("/api/localization-exam/export").set("Cookie", cookie);
      expect(second.body.exported).toBe(0);
      expect(existsSync(path.join(out, `${scanId}_front.jpg`))).toBe(false);
      expect(readFileSync(path.join(out, "marks.jsonl"), "utf8")).toBe("");
    } finally {
      delete process.env.DATASETS_DIR;
    }
  });

  it("requires a clinician session (401 logged out, 403 for an invite session)", async () => {
    const { app, cookie } = await setupMarkedScan();
    const anon = await request(app).post("/api/localization-exam/export");
    expect(anon.status).toBe(401);

    const made = await request(app).post("/api/invites").set("Cookie", cookie).send({ label: "Remote patient", maxScans: 2 });
    const claimed = await request(app).post("/api/auth/invite").send({ token: made.body.token });
    const res = await request(app).post("/api/localization-exam/export").set("Cookie", claimed.headers["set-cookie"][0]);
    expect(res.status).toBe(403);
  });
});

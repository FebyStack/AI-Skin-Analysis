import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import { goldenFaceReport } from "../../../shared/testing/face-fixtures";

const acneBox = (x: number) => ({
  kind: "acne", angle: "front", confidence: 0.9, source: "model",
  shape: { type: "box", x, y: 0.1, w: 0.05, h: 0.05 },
});

async function post(marks: unknown[]) {
  const app = createApp(makeTestDeps());
  const cookie = (await request(app).post("/api/auth/login").send({ password: "clinic-pass" })).headers["set-cookie"][0];
  const image = (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } })
    .jpeg().toBuffer()).toString("base64");
  const res = await request(app).post("/api/face-scans").set("Cookie", cookie)
    .send({ report: { ...goldenFaceReport(), marks }, images: [{ angle: "front", image, mime: "image/jpeg" }] });
  return { app, cookie, res };
}

describe("face reports carrying marks", () => {
  it("stores valid marks with the report", async () => {
    const { app, cookie, res } = await post([acneBox(0.3)]);
    expect(res.status).toBe(200);
    const got = await request(app).get(`/api/face-scans/${res.body.scan.id}`).set("Cookie", cookie);
    expect(got.body.scan.report.marks).toEqual([acneBox(0.3)]);
  });
  it("rejects the whole report when a mark is malformed", async () => {
    const { res } = await post([acneBox(0.99)]);
    expect(res.status).toBe(400);
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import { goldenFaceReport } from "../../../shared/testing/face-fixtures";
import { parseCapture } from "./face-routes";

async function jpegB64(): Promise<string> {
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } })
    .jpeg()
    .toBuffer();
  return buf.toString("base64");
}

describe("face scan capture info", () => {
  it("stores the capturing device per image", async () => {
    const deps = makeTestDeps();
    const app = createApp(deps);
    const cookie = (await request(app).post("/api/auth/login").send({ password: "clinic-pass" })).headers["set-cookie"][0];
    const capture = { device: "Clinic iPad 1", platform: "iPad iPadOS 17.4", camera: "Front Camera", width: 1280, height: 720 };
    const save = await request(app)
      .post("/api/face-scans")
      .set("Cookie", cookie)
      .send({ report: goldenFaceReport(), images: [{ angle: "front", image: await jpegB64(), mime: "image/jpeg", capture }] });
    expect(save.status).toBe(200);
    const [img] = await deps.scans.listImages(save.body.scan.id);
    expect(img.capture).toEqual(capture);
  });

  it("keeps only known, bounded fields from the client", () => {
    expect(parseCapture(null)).toBeNull();
    expect(parseCapture("x")).toBeNull();
    const c = parseCapture({ device: "a".repeat(500), platform: 7, camera: "Back", width: -1, height: 1.5, extra: "drop" });
    expect(c).toEqual({ device: "a".repeat(80), platform: "", camera: "Back", width: 0, height: 0 });
  });
});

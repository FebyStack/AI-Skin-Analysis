// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import { goldenFaceReport } from "../../../shared/testing/face-fixtures";

/**
 * The export rebuilds a derived directory from the database, which means it
 * DELETES files. These tests pin the two things that makes safe: it removes only
 * what the database no longer justifies, and it never reaches outside the
 * directory it owns.
 */
const root = mkdtempSync(path.join(tmpdir(), "skin-export-"));
process.env.DATASETS_DIR = root;

// Rebuilt per test: the in-memory repo is stateful, so a shared app would let
// each test see every previous test's labels and the desired-state counts would
// be cumulative rather than what the test set up.
let app: ReturnType<typeof createApp>;
let cookie = "";
let jpeg = "";

const scansDir = (dim: string) => path.join(root, dim, "scans");

/** Every exported file as "<label>/<file>", so placement is asserted, not just count. */
function onDisk(dim: string): string[] {
  const base = scansDir(dim);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .flatMap((label) => readdirSync(path.join(base, label)).map((f) => `${label}/${f}`))
    .sort();
}

async function newScan(): Promise<string> {
  const res = await request(app)
    .post("/api/face-scans")
    .set("Cookie", cookie)
    .send({
      report: goldenFaceReport(),
      images: [{ angle: "front", image: jpeg, mime: "image/jpeg" }],
      consent: { analysis: true, training: true },
    });
  const id = res.body.scan.id as string;
  // Only approved scans reach the export.
  await request(app).post(`/api/training-queue/${id}/status`).set("Cookie", cookie).send({ status: "approved" });
  return id;
}

const label = (id: string, dimension: string, value: string) =>
  request(app).post(`/api/scans/${id}/label`).set("Cookie", cookie).send({ dimension, label: value });

const rebuild = (dim: string, dryRun = false) =>
  request(app).post(`/api/training/${dim}/export${dryRun ? "?dryRun=1" : ""}`).set("Cookie", cookie);

beforeEach(async () => {
  jpeg ||= (
    await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 200, g: 170, b: 150 } } })
      .jpeg()
      .toBuffer()
  ).toString("base64");

  app = createApp(makeTestDeps());
  const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
  cookie = login.headers["set-cookie"][0];

  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("training export rebuild", () => {
  it("removes a file whose scan no longer carries the label", async () => {
    const id = await newScan();
    await label(id, "redness", "present");
    await rebuild("redness");
    expect(onDisk("redness")).toEqual([`present/${id}.jpg`]);

    // Simulate the orphan case: the scan goes, its label cascades away, but the
    // exported JPEG used to survive forever. 29 of 36 files were like this.
    await request(app).delete(`/api/training-queue/${id}`).set("Cookie", cookie);

    const res = await rebuild("redness");
    expect(res.body.removed).toBe(1);
    expect(onDisk("redness")).toEqual([]);

    // Quarantined, NOT destroyed. The scan is gone, so scan_images is gone with
    // it — this JPEG may be the only surviving copy of that image.
    const orphan = path.join(root, "redness", "_orphaned", "present", `${id}.jpg`);
    expect(existsSync(orphan)).toBe(true);
  });

  it("keeps quarantine out of the trainer's read path", async () => {
    const id = await newScan();
    await label(id, "redness", "present");
    await rebuild("redness");
    await request(app).delete(`/api/training-queue/${id}`).set("Cookie", cookie);
    await rebuild("redness");

    // The Python ingest reads <dim>/<source>/<label>/ and only permits the
    // `scans` source, so `_orphaned` cannot re-enter training by accident.
    expect(onDisk("redness")).toEqual([]);
    expect(existsSync(path.join(root, "redness", "_orphaned"))).toBe(true);
  });

  it("moves a file instead of leaving both copies when a grade changes", async () => {
    const id = await newScan();
    await label(id, "redness", "present");
    await rebuild("redness");

    await label(id, "redness", "absent");
    const res = await rebuild("redness");

    expect(res.body.relabelled).toBe(1);
    // Appending left the scan in BOTH folders — two contradictory training rows.
    expect(onDisk("redness")).toEqual([`absent/${id}.jpg`]);
  });

  it("retires folders from the old severity vocabulary", async () => {
    const id = await newScan();
    await label(id, "redness", "present");
    // A leftover directory from the retired 4-level scale, holding a file whose
    // scan does not exist.
    mkdirSync(path.join(scansDir("redness"), "mild"), { recursive: true });
    writeFileSync(path.join(scansDir("redness"), "mild", "00000000-dead-beef-0000-000000000000.jpg"), "x");

    const res = await rebuild("redness");

    expect(res.body.removedDirs).toContain("mild");
    expect(existsSync(path.join(scansDir("redness"), "mild"))).toBe(false);
    expect(onDisk("redness")).toEqual([`present/${id}.jpg`]);
  });

  it("keeps acne on its own 5-level vocabulary", async () => {
    const id = await newScan();
    // "moderate" is valid for acne. Normalising it would yield "present", which
    // acne does not accept — the bug this guards against.
    await label(id, "acne", "moderate");
    await rebuild("acne");
    expect(onDisk("acne")).toEqual([`moderate/${id}.jpg`]);
  });

  it("is idempotent — a second run rewrites nothing", async () => {
    const id = await newScan();
    await label(id, "redness", "present");
    await rebuild("redness");

    const second = await rebuild("redness");
    expect(second.body.written).toBe(0);
    expect(second.body.removed).toBe(0);
    expect(onDisk("redness")).toEqual([`present/${id}.jpg`]);
  });

  it("dryRun reports the plan without touching the disk", async () => {
    const id = await newScan();
    await label(id, "redness", "present");

    const plan = await rebuild("redness", true);
    expect(plan.body.dryRun).toBe(true);
    expect(plan.body.written).toBe(1);
    expect(onDisk("redness")).toEqual([]); // nothing written

    await rebuild("redness");
    expect(onDisk("redness")).toEqual([`present/${id}.jpg`]);
  });

  it("drops a deleted scan's label, matching ON DELETE CASCADE", async () => {
    // The in-memory repo used to clear images only, so a deleted scan kept its
    // label and no test could reproduce the orphaned-export bug at all.
    const id = await newScan();
    await label(id, "redness", "present");
    await request(app).delete(`/api/training-queue/${id}`).set("Cookie", cookie);

    const labels = await request(app).get(`/api/scans/${id}/labels`).set("Cookie", cookie);
    expect(labels.body.labels).toEqual([]);
  });

  it("leaves other sources alone — only <dim>/scans is owned", async () => {
    const id = await newScan();
    await label(id, "redness", "present");
    // External corpora live beside scans/ and must never be rebuilt away.
    const external = path.join(root, "redness", "multi", "absent");
    mkdirSync(external, { recursive: true });
    writeFileSync(path.join(external, "external.jpg"), "x");

    await rebuild("redness");

    expect(existsSync(path.join(external, "external.jpg"))).toBe(true);
  });
});

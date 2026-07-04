import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "./app";
import { makeTestDeps } from "./repos";

describe("health", () => {
  it("responds ok without auth", async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("auth", () => {
  it("bootstraps a password on first login when none is set", async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/session=/);
  });

  it("rejects a wrong password once set", async () => {
    const deps = makeTestDeps();
    const app = createApp(deps);
    await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
    const res = await request(app).post("/api/auth/login").send({ password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("blocks protected routes without a session", async () => {
    const app = createApp(makeTestDeps());
    const res = await request(app).get("/api/patients");
    expect(res.status).toBe(401);
  });

  it("allows protected routes with a session cookie", async () => {
    const app = createApp(makeTestDeps());
    const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
    const cookie = login.headers["set-cookie"][0];
    const res = await request(app).get("/api/patients").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});

async function loggedInAgent(depsOverride?: Parameters<typeof makeTestDeps>[0]) {
  const deps = makeTestDeps(depsOverride);
  const app = createApp(deps);
  const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
  const cookie = login.headers["set-cookie"][0];
  return { app, cookie, deps };
}

describe("patients", () => {
  it("creates, lists, updates, and deletes a patient", async () => {
    const { app, cookie } = await loggedInAgent();
    const created = await request(app)
      .post("/api/patients")
      .set("Cookie", cookie)
      .send({ name: "Maria Cruz", externalRef: "C-102", notes: "sensitive skin" });
    expect(created.status).toBe(201);
    const id = created.body.patient.id;

    const list = await request(app).get("/api/patients?q=maria").set("Cookie", cookie);
    expect(list.body.patients).toHaveLength(1);

    const updated = await request(app)
      .patch(`/api/patients/${id}`)
      .set("Cookie", cookie)
      .send({ notes: "updated" });
    expect(updated.body.patient.notes).toBe("updated");

    const del = await request(app).delete(`/api/patients/${id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);
  });

  it("rejects creation without a name", async () => {
    const { app, cookie } = await loggedInAgent();
    const res = await request(app).post("/api/patients").set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
  });

  it("records patient consent with a version", async () => {
    const { app, cookie } = await loggedInAgent();
    const created = await request(app)
      .post("/api/patients")
      .set("Cookie", cookie)
      .send({ name: "Jo" });
    const id = created.body.patient.id;
    const consent = await request(app)
      .post(`/api/patients/${id}/consent`)
      .set("Cookie", cookie)
      .send({ version: 1 });
    expect(consent.status).toBe(200);
    expect(consent.body.patient.consentVersion).toBe(1);
  });
});

async function tinyJpegB64(): Promise<string> {
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } },
  })
    .jpeg()
    .toBuffer();
  return buf.toString("base64");
}

describe("analyze", () => {
  it("analyzes, compresses, stores, and returns the scan", async () => {
    const { app, cookie, deps } = await loggedInAgent();
    const patient = await request(app)
      .post("/api/patients")
      .set("Cookie", cookie)
      .send({ name: "Ana" });
    const pid = patient.body.patient.id;

    const res = await request(app)
      .post("/api/analyze")
      .set("Cookie", cookie)
      .send({
        patientId: pid,
        image: await tinyJpegB64(),
        mime: "image/jpeg",
        mode: "face",
        classifierFindings: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.scan.report.summary).toBeTruthy();
    expect(res.body.scan.partial).toBe(false);

    const stored = await deps.scans.get(res.body.scan.id);
    expect(stored?.imageJpeg.byteLength).toBeGreaterThan(0);
    const meta = await sharp(Buffer.from(stored!.imageJpeg)).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("stores a partial scan when the pipeline fails, and can re-analyze later", async () => {
    const failing = makeTestDeps();
    failing.pipeline = {
      ...failing.pipeline,
      callProvider: async () => {
        throw new Error("offline");
      },
    };
    const app = createApp(failing);
    const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
    const cookie = login.headers["set-cookie"][0];
    const patient = await request(app).post("/api/patients").set("Cookie", cookie).send({ name: "Ben" });

    const res = await request(app)
      .post("/api/analyze")
      .set("Cookie", cookie)
      .send({
        patientId: patient.body.patient.id,
        image: await tinyJpegB64(),
        mime: "image/jpeg",
        mode: "face",
        classifierFindings: [{ id: "acne", label: "Acne", source: "classifier", confidence: 0.5, severity: "mild" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.scan.partial).toBe(true);
    expect(res.body.scan.report).toBeNull();
  });

  it("returns 404 for an unknown patient", async () => {
    const { app, cookie } = await loggedInAgent();
    const res = await request(app)
      .post("/api/analyze")
      .set("Cookie", cookie)
      .send({ patientId: "nope", image: await tinyJpegB64(), mime: "image/jpeg", mode: "face" });
    expect(res.status).toBe(404);
  });

  it("serves the stored image and scan list", async () => {
    const { app, cookie } = await loggedInAgent();
    const patient = await request(app).post("/api/patients").set("Cookie", cookie).send({ name: "Cy" });
    const pid = patient.body.patient.id;
    const analyzed = await request(app)
      .post("/api/analyze")
      .set("Cookie", cookie)
      .send({ patientId: pid, image: await tinyJpegB64(), mime: "image/jpeg", mode: "face" });

    const list = await request(app).get(`/api/patients/${pid}/scans`).set("Cookie", cookie);
    expect(list.body.scans).toHaveLength(1);
    expect(list.body.scans[0].imageJpeg).toBeUndefined();

    const img = await request(app)
      .get(`/api/scans/${analyzed.body.scan.id}/image`)
      .set("Cookie", cookie);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
  });
});

describe("capture sessions (QR)", () => {
  it("desktop creates a session; phone submits by token without auth; desktop polls it", async () => {
    const { app, cookie } = await loggedInAgent();
    const created = await request(app).post("/api/capture-sessions").set("Cookie", cookie);
    expect(created.status).toBe(201);
    const { token, path } = created.body;
    expect(path).toBe(`/capture/${token}`);

    // Phone: NO cookie.
    const submit = await request(app)
      .post(`/api/capture-sessions/${token}/image`)
      .send({ image: await tinyJpegB64(), mime: "image/jpeg", mode: "face" });
    expect(submit.status).toBe(200);

    // Desktop polls (auth required) and consumes the capture.
    const poll = await request(app)
      .get(`/api/capture-sessions/${token}`)
      .set("Cookie", cookie);
    expect(poll.status).toBe(200);
    expect(poll.body.capture.mime).toBe("image/jpeg");

    const again = await request(app)
      .get(`/api/capture-sessions/${token}`)
      .set("Cookie", cookie);
    expect(again.status).toBe(404);
  });

  it("rejects submissions with an expired/unknown token", async () => {
    const { app } = await loggedInAgent();
    const res = await request(app)
      .post("/api/capture-sessions/bogus/image")
      .send({ image: "aGVsbG8=", mime: "image/jpeg", mode: "face" });
    expect(res.status).toBe(410);
  });
});

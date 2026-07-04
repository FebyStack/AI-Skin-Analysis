import { describe, it, expect } from "vitest";
import request from "supertest";
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

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

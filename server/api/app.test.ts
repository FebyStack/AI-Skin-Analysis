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

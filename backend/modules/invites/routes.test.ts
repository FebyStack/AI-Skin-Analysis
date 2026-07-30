// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import { goldenFaceReport } from "../../../shared/testing/face-fixtures";

const deps = makeTestDeps();
const app = createApp(deps);
let clinic = "";
let image = "";

async function makeLink(maxScans = 2, ttlMinutes?: number) {
  const made = await request(app)
    .post("/api/invites")
    .set("Cookie", clinic)
    .send({ label: "Remote patient", maxScans, ttlMinutes });
  expect(made.status).toBe(200);
  return { token: made.body.token as string, id: made.body.invite.id as string };
}

/** Create a link and claim it, as the first device would. */
async function inviteSession(maxScans = 2): Promise<{ cookie: string; id: string; token: string }> {
  const { token, id } = await makeLink(maxScans);
  const used = await request(app).post("/api/auth/invite").send({ token });
  expect(used.status).toBe(200);
  return { cookie: used.headers["set-cookie"][0], id, token };
}

const scan = (cookie: string) =>
  request(app)
    .post("/api/face-scans")
    .set("Cookie", cookie)
    .send({
      report: goldenFaceReport(),
      images: [{ angle: "front", image, mime: "image/jpeg" }],
      consent: { analysis: true, training: false },
    });

beforeAll(async () => {
  const login = await request(app).post("/api/auth/login").send({ password: "clinic-pass" });
  clinic = login.headers["set-cookie"][0];
  image = (
    await sharp({ create: { width: 480, height: 480, channels: 3, background: { r: 200, g: 170, b: 150 } } })
      .jpeg()
      .toBuffer()
  ).toString("base64");
});

describe("invite links", () => {
  it("never returns the token again after creation", async () => {
    await request(app).post("/api/invites").set("Cookie", clinic).send({});
    const list = await request(app).get("/api/invites").set("Cookie", clinic);
    expect(list.status).toBe(200);
    expect(list.body.invites.length).toBeGreaterThan(0);
    for (const i of list.body.invites) expect(i.token).toBeUndefined();
  });

  it("allows exactly the granted number of scans, then refuses", async () => {
    const { cookie } = await inviteSession(2);

    expect((await scan(cookie)).status).toBe(200);
    expect((await scan(cookie)).status).toBe(200);

    const third = await scan(cookie);
    expect(third.status).toBe(403);
    expect(third.body.inviteState).toBe("exhausted");
  });

  it("reports the remaining allowance to the link holder", async () => {
    const { cookie } = await inviteSession(2);
    const before = await request(app).get("/api/auth/invite-status").set("Cookie", cookie);
    expect(before.body.invite).toMatchObject({ scansLeft: 2, maxScans: 2, state: "active" });

    await scan(cookie);
    const after = await request(app).get("/api/auth/invite-status").set("Cookie", cookie);
    expect(after.body.invite.scansLeft).toBe(1);
  });

  it("stops working the moment the clinic revokes it", async () => {
    const { cookie, id } = await inviteSession(5);
    expect((await scan(cookie)).status).toBe(200);

    await request(app).post(`/api/invites/${id}/revoke`).set("Cookie", clinic);

    // Same cookie, still unexpired — the invite row is what decides.
    const after = await scan(cookie);
    expect(after.status).toBe(403);
  });

  it("ends the session server-side on logout", async () => {
    const { cookie } = await inviteSession();
    expect((await request(app).get("/api/auth/status").set("Cookie", cookie)).body.role).toBe("invite");

    // The cookie is HttpOnly, so only the server can clear it — a client-side
    // document.cookie assignment (the old logout) left the session live.
    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    const cleared = out.headers["set-cookie"][0];
    expect(cleared).toMatch(/session=;/);
    expect(cleared).toMatch(/Max-Age=0/);

    const after = await request(app).get("/api/auth/status").set("Cookie", cleared);
    expect(after.body.authenticated).toBe(false);
  });

  it("binds to the first device and refuses a forwarded link", async () => {
    const { token } = await makeLink();

    const first = await request(app).post("/api/auth/invite").send({ token });
    expect(first.status).toBe(200);

    // Someone else opening the same URL — no cookie, so no claim.
    const second = await request(app).post("/api/auth/invite").send({ token });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already opened on another device/i);

    // And a stranger's own invite cookie is not a substitute for the claim.
    const other = await inviteSession();
    const third = await request(app)
      .post("/api/auth/invite")
      .set("Cookie", other.cookie)
      .send({ token });
    expect(third.status).toBe(409);
  });

  it("lets the device that claimed it re-open its own link", async () => {
    const { cookie, token } = await inviteSession();
    // Reload, or tapping the link again in the message thread.
    const again = await request(app).post("/api/auth/invite").set("Cookie", cookie).send({ token });
    expect(again.status).toBe(200);
  });

  it("refuses a link that was never opened within its window", async () => {
    // ttlMinutes 0 means "no expiry", so use a real deadline and move past it.
    const { token } = await makeLink(2, 15);
    const invite = await deps.invites!.getByToken(token);
    // Rewind the clock on the row rather than waiting 15 real minutes.
    (invite as { expiresAt: number | null }).expiresAt = Date.now() - 1;

    const res = await request(app).post("/api/auth/invite").send({ token });
    expect(res.status).toBe(403);
    expect(res.body.inviteState).toBe("expired");
  });

  it("keeps working past the open-by deadline once claimed, so a scan can finish", async () => {
    const { cookie, token } = await inviteSession();
    const invite = await deps.invites!.getByToken(token);
    // The open-by deadline has passed, but this device already claimed the link.
    (invite as { expiresAt: number | null }).expiresAt = Date.now() - 1;

    expect((await scan(cookie)).status).toBe(200);
  });

  it("expires the claimed session once its window closes", async () => {
    const { cookie, token } = await inviteSession();
    const invite = await deps.invites!.getByToken(token);
    (invite as { claimedAt: number | null }).claimedAt = Date.now() - 61 * 60_000;

    const res = await scan(cookie);
    expect(res.status).toBe(403);
    expect(res.body.inviteState).toBe("expired");
  });

  it("rejects an unknown token", async () => {
    const res = await request(app).post("/api/auth/invite").send({ token: "not-a-real-token" });
    expect(res.status).toBe(404);
  });
});

describe("invite links cannot reach clinic data", () => {
  it("is refused by every clinician-only route", async () => {
    const { cookie } = await inviteSession();
    for (const url of [
      "/api/training-queue",
      "/api/training-queue/stats",
      "/api/analytics",
      "/api/archive",
      "/api/patients",
      "/api/datasets",
      "/api/model-releases",
      "/api/training/readiness",
    ]) {
      const res = await request(app).get(url).set("Cookie", cookie);
      expect(res.status, url).toBe(403);
    }
  });

  it("cannot mint more invites for itself", async () => {
    const { cookie } = await inviteSession();
    expect((await request(app).post("/api/invites").set("Cookie", cookie).send({})).status).toBe(403);
  });

  it("sees only its own scans, not the clinic's", async () => {
    // A scan that belongs to the clinic, not to any link.
    const clinicScan = await scan(clinic);
    expect(clinicScan.status).toBe(200);

    const { cookie } = await inviteSession();
    const mine = await scan(cookie);
    const myId = mine.body.scan.id;

    const list = await request(app).get("/api/face-scans").set("Cookie", cookie);
    expect(list.body.scans.map((s: { id: string }) => s.id)).toEqual([myId]);

    // 404, not 403 — a link holder must not be able to probe which ids exist.
    const other = await request(app)
      .get(`/api/face-scans/${clinicScan.body.scan.id}`)
      .set("Cookie", cookie);
    expect(other.status).toBe(404);

    const otherImg = await request(app)
      .get(`/api/face-scans/${clinicScan.body.scan.id}/images/front`)
      .set("Cookie", cookie);
    expect(otherImg.status).toBe(404);

    // Its own scan is readable.
    expect((await request(app).get(`/api/face-scans/${myId}`).set("Cookie", cookie)).status).toBe(200);
  });

  it("still lets clinic staff read everything", async () => {
    const { cookie } = await inviteSession();
    const theirs = await scan(cookie);
    const res = await request(app)
      .get(`/api/face-scans/${theirs.body.scan.id}`)
      .set("Cookie", clinic);
    expect(res.status).toBe(200);
  });
});

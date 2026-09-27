import { describe, it, expect } from "vitest";
import { saveFaceScan, FaceRejectedError, FaceFailedError, FaceAuthError } from "./face-client";
import { goldenFaceReport } from "@shared/testing/face-fixtures";
import type { CapturedAngle } from "./face-client";

const angles: CapturedAngle[] = [
  { angle: "front", blob: new Blob(["x"], { type: "image/jpeg" }), mime: "image/jpeg" },
];

function fetchReturning(status: number, body: unknown = {}) {
  return async () =>
    ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    }) as Response;
}

describe("saveFaceScan status-code mapping", () => {
  it("throws FaceAuthError on 401", async () => {
    await expect(
      saveFaceScan(goldenFaceReport(), angles, "walk-in", fetchReturning(401)),
    ).rejects.toBeInstanceOf(FaceAuthError);
  });

  it("throws FaceRejectedError on 403 and 409 (existing invite-refusal behaviour)", async () => {
    await expect(
      saveFaceScan(goldenFaceReport(), angles, "walk-in", fetchReturning(403, { error: "used up" })),
    ).rejects.toBeInstanceOf(FaceRejectedError);
    await expect(
      saveFaceScan(goldenFaceReport(), angles, "walk-in", fetchReturning(409, { error: "conflict" })),
    ).rejects.toBeInstanceOf(FaceRejectedError);
  });

  it("throws FaceRejectedError (not FaceFailedError) on a plain 400, so it is never queued offline", async () => {
    const err: unknown = await saveFaceScan(
      goldenFaceReport(),
      angles,
      "walk-in",
      fetchReturning(400, { error: "invalid report" }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FaceRejectedError);
    expect((err as Error).message).toBe("invalid report");
  });

  it("still throws FaceFailedError on a 5xx (transient — safe to queue offline)", async () => {
    await expect(
      saveFaceScan(goldenFaceReport(), angles, "walk-in", fetchReturning(500)),
    ).rejects.toBeInstanceOf(FaceFailedError);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FaceRejectedError, FaceFailedError } from "../api/face-client";
import { goldenFaceReport } from "@shared/testing/face-fixtures";

const enqueuePending = vi.fn();
const putScan = vi.fn();
const putImage = vi.fn();
const saveFaceScan = vi.fn();

vi.mock("./local-store", () => ({
  enqueuePending: (...a: unknown[]) => enqueuePending(...a),
  putScan: (...a: unknown[]) => putScan(...a),
  putImage: (...a: unknown[]) => putImage(...a),
}));

vi.mock("../api/face-client", async () => {
  const actual = await vi.importActual<typeof import("../api/face-client")>("../api/face-client");
  return { ...actual, saveFaceScan: (...a: unknown[]) => saveFaceScan(...a) };
});

const { saveFaceScanWithFallback } = await import("./save-flow");

// A typed Blob so toJpeg() passes it straight through — jsdom's Blob has no
// arrayBuffer(), and re-encoding is not what these tests are about.
const angles = [
  {
    angle: "front" as const,
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
    mime: "image/jpeg",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("save-flow offline fallback", () => {
  it("queues the scan when the network fails", async () => {
    saveFaceScan.mockRejectedValueOnce(new FaceFailedError());

    const outcome = await saveFaceScanWithFallback(goldenFaceReport(), angles, "walk-in");

    expect(outcome.offline).toBe(true);
    expect(enqueuePending).toHaveBeenCalledOnce();
  });

  it("does NOT queue a scan the server permanently refused", async () => {
    // An invite link that is used up / expired / revoked. Queueing this would
    // tell the patient "saved, will sync later" about a scan that can never
    // sync — the bug this test exists to prevent.
    saveFaceScan.mockRejectedValueOnce(new FaceRejectedError("This link has been used up."));

    await expect(
      saveFaceScanWithFallback(goldenFaceReport(), angles, "walk-in"),
    ).rejects.toThrow(FaceRejectedError);

    expect(enqueuePending).not.toHaveBeenCalled();
    expect(putScan).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { useScanMachine } from "./scan-machine";
import type { CaptureResult, Verdict } from "../types";

const sample: CaptureResult = {
  blob: new Blob(["x"], { type: "image/jpeg" }),
  mimeType: "image/jpeg",
  mode: "face",
  source: "camera",
  width: 640,
  height: 480,
};

describe("scan machine", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("starts idle", () => {
    expect(useScanMachine.getState().state).toBe("idle");
  });

  it("grants consent → permission", () => {
    useScanMachine.getState().grantConsent();
    expect(useScanMachine.getState().state).toBe("permission");
  });

  it("permission granted → framing", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    expect(useScanMachine.getState().state).toBe("framing");
  });

  it("permission denied → error(denied) and can fall back to upload", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraDenied();
    expect(useScanMachine.getState().state).toBe("error");
    expect(useScanMachine.getState().error).toBe("denied");
    useScanMachine.getState().chooseUpload();
    expect(useScanMachine.getState().state).toBe("framing");
    expect(useScanMachine.getState().captureSource).toBe("upload");
  });

  it("captured image → analyzing carries the result", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().captured(sample);
    expect(useScanMachine.getState().state).toBe("analyzing");
    expect(useScanMachine.getState().capture).toEqual(sample);
  });

  it("reset returns to idle and clears capture", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().captured(sample);
    useScanMachine.getState().reset();
    expect(useScanMachine.getState().state).toBe("idle");
    expect(useScanMachine.getState().capture).toBeNull();
  });

  it("uploadFailed → error(upload-failed), recoverable via chooseUpload", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().chooseUpload();
    useScanMachine.getState().uploadFailed();
    expect(useScanMachine.getState().state).toBe("error");
    expect(useScanMachine.getState().error).toBe("upload-failed");
    useScanMachine.getState().chooseUpload();
    expect(useScanMachine.getState().state).toBe("framing");
    expect(useScanMachine.getState().error).toBeNull();
  });
});

describe("scan machine — camera retry", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("chooseCamera returns to the camera path from an error", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraDenied();
    useScanMachine.getState().chooseCamera();
    expect(useScanMachine.getState().state).toBe("permission");
    expect(useScanMachine.getState().captureSource).toBe("camera");
    expect(useScanMachine.getState().error).toBeNull();
  });

  it("chooseCamera switches back after choosing upload", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().chooseUpload();
    useScanMachine.getState().chooseCamera();
    expect(useScanMachine.getState().captureSource).toBe("camera");
  });
});

describe("scan machine — results", () => {
  beforeEach(() => useScanMachine.getState().reset());

  const verdict: Verdict = {
    summary: "ok",
    findings: [],
    disclaimerShown: true,
  };

  it("resultsReady carries the verdict into the results state", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().captured(sample);
    useScanMachine.getState().resultsReady(verdict, "scan-1");
    expect(useScanMachine.getState().state).toBe("results");
    expect(useScanMachine.getState().verdict?.summary).toBe("ok");
    expect(useScanMachine.getState().scanId).toBe("scan-1");
  });

  it("resultsReady clears any previous quality rejection", () => {
    useScanMachine.getState().qualityRejected({
      ok: false,
      issues: ["blur"],
      guidance: "Too blurry.",
      brightness: 0.5,
      sharpness: 0,
      regionFound: true,
      width: 640,
      height: 480,
      aspectRatio: 4 / 3,
      glareRatio: 0,
      skinCoverage: 0.2,
    });
    useScanMachine.getState().resultsReady(verdict, "scan-1");
    expect(useScanMachine.getState().quality).toBeNull();
  });

  it("reset clears the verdict and scanId", () => {
    useScanMachine.getState().resultsReady(verdict, "scan-1");
    useScanMachine.getState().reset();
    expect(useScanMachine.getState().verdict).toBeNull();
    expect(useScanMachine.getState().scanId).toBeNull();
  });
});

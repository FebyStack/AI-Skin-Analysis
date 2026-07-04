import { describe, it, expect, beforeEach } from "vitest";
import { useScanMachine } from "./scan-machine";
import type { CaptureResult } from "../types";

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

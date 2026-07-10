import { describe, it, expect, beforeEach } from "vitest";
import { useScanMachine } from "./scan-machine";

describe("scan machine — quality rejection", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("qualityRejected stores the report and maps blur to error(blur)", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
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
    expect(useScanMachine.getState().state).toBe("error");
    expect(useScanMachine.getState().error).toBe("blur");
    expect(useScanMachine.getState().quality?.guidance).toMatch(/too blurry/i);
  });

  it("qualityRejected(too-dark) maps to low-light error", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().qualityRejected({
      ok: false,
      issues: ["too-dark"],
      guidance: "Too dark.",
      brightness: 0.05,
      sharpness: 0.1,
      regionFound: true,
      width: 640,
      height: 480,
      aspectRatio: 4 / 3,
      glareRatio: 0,
      skinCoverage: 0.2,
    });
    expect(useScanMachine.getState().error).toBe("low-light");
  });
});

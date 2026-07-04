import { describe, it, expect, beforeEach } from "vitest";
import { useScanMachine } from "./scan-machine";

describe("scan machine — quality rejection", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("qualityRejected(blur) → error(blur)", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().qualityRejected("blur");
    expect(useScanMachine.getState().state).toBe("error");
    expect(useScanMachine.getState().error).toBe("blur");
  });

  it("qualityRejected(too-dark) maps to low-light error", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().qualityRejected("too-dark");
    expect(useScanMachine.getState().error).toBe("low-light");
  });
});

import { describe, it, expect } from "vitest";
import { runClassification, type ClassifyRequest } from "./worker-protocol";
import { LABELS } from "./labels";

const req: ClassifyRequest = {
  type: "classify",
  rgba: new Uint8ClampedArray(2 * 2 * 4),
  width: 2,
  height: 2,
};

describe("runClassification", () => {
  it("returns a result message with findings on success", async () => {
    const fakeInfer = async () => LABELS.map((_, i) => (i === 1 ? 6 : 0)); // acne
    const res = await runClassification(req, fakeInfer);
    expect(res.type).toBe("result");
    if (res.type === "result") {
      expect(res.findings[0].id).toBe("acne");
    }
  });

  it("returns an error message when inference throws", async () => {
    const boom = async () => {
      throw new Error("model failed to load");
    };
    const res = await runClassification(req, boom);
    expect(res.type).toBe("error");
    if (res.type === "error") {
      expect(res.message).toMatch(/model failed/);
    }
  });
});

import { describe, it, expect } from "vitest";
import { LABELS, labelAt, LESION_IDS } from "./labels";

describe("labels", () => {
  it("has a stable, non-empty ordered list", () => {
    expect(LABELS.length).toBeGreaterThan(5);
    expect(LABELS[0]).toHaveProperty("id");
    expect(LABELS[0]).toHaveProperty("severity");
  });

  it("maps an index to its label info", () => {
    expect(labelAt(0)).toEqual(LABELS[0]);
  });

  it("marks lesion classes for escalation with attention severity", () => {
    for (const id of LESION_IDS) {
      const info = LABELS.find((l) => l.id === id);
      expect(info?.lesion).toBe(true);
      expect(info?.severity).toBe("attention");
    }
  });

  it("has unique ids", () => {
    const ids = LABELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

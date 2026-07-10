import { describe, it, expect } from "vitest";
import { PROMPT_VERSION, systemPrompt, userPrompt } from "./prompts";
import { DIMENSION_KEYS, FACE_ZONES, PROXY_DIMENSIONS } from "../../shared/contract";

describe("prompts", () => {
  it("has version 2 (clinic vocabulary)", () => {
    expect(PROMPT_VERSION).toBe(2);
  });

  it("system prompt contains the safety guardrails", () => {
    const s = systemPrompt();
    expect(s).toMatch(/never diagnose/i);
    expect(s).toMatch(/consistent with/i);
    expect(s).toMatch(/not a diagnosis/i);
    expect(s).toMatch(/never.*(benign|malignan|cancer)/i);
    expect(s).toMatch(/JSON/);
  });

  it("system prompt enumerates every dimension and zone", () => {
    const s = systemPrompt();
    for (const d of DIMENSION_KEYS) expect(s).toContain(d);
    for (const z of FACE_ZONES) expect(s).toContain(z);
  });

  it("system prompt marks proxy dimensions as visual inference", () => {
    const s = systemPrompt();
    for (const d of PROXY_DIMENSIONS) {
      expect(s).toContain(d);
    }
    expect(s).toMatch(/visual (proxy|inference)/i);
  });

  it("user prompt varies by capture mode", () => {
    expect(userPrompt("face")).toMatch(/facial/i);
    expect(userPrompt("closeup")).toMatch(/close-up/i);
  });
});

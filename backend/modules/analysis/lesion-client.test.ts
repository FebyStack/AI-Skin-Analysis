// @vitest-environment node
import { describe, it, expect } from "vitest";
import golden from "../../../ai/evaluation/fixtures/golden-lesion.json";
import { HttpLesionProvider, FakeLesionProvider, LesionUnavailableError } from "./lesion-client";

describe("FakeLesionProvider", () => {
  it("returns the normalized golden analysis", async () => {
    const a = await new FakeLesionProvider().analyze();
    expect(a.wholeImageFallback).toBe(true);
    expect(a.lesions[0].classification.predicted).toBe("MEL");
    expect(a.model.classifier).toBe("efficientnet_b1-isic2019");
  });
});

describe("HttpLesionProvider", () => {
  it("classifies via fetch and normalizes snake_case", async () => {
    const fetchFn = async () => new Response(JSON.stringify(golden), { status: 200 });
    const p = new HttpLesionProvider("http://svc", 1000, fetchFn as typeof fetch);
    const a = await p.analyze("aGk=", "image/png");
    expect(a.lesions[0].detectorConfidence).toBeNull();
    expect(a.lesions[0].classification.confidence).toBeCloseTo(0.72);
  });

  it("throws LesionUnavailableError on non-200", async () => {
    const fetchFn = async () => new Response("boom", { status: 503 });
    const p = new HttpLesionProvider("http://svc", 1000, fetchFn as typeof fetch);
    await expect(p.analyze("aGk=", "image/png")).rejects.toBeInstanceOf(LesionUnavailableError);
  });

  it("throws LesionUnavailableError on malformed payload", async () => {
    const fetchFn = async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 });
    const p = new HttpLesionProvider("http://svc", 1000, fetchFn as typeof fetch);
    await expect(p.analyze("aGk=", "image/png")).rejects.toBeInstanceOf(LesionUnavailableError);
  });

  it("throws LesionUnavailableError when fetch itself fails", async () => {
    const fetchFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    const p = new HttpLesionProvider("http://svc", 1000, fetchFn as typeof fetch);
    await expect(p.analyze("aGk=", "image/png")).rejects.toBeInstanceOf(LesionUnavailableError);
  });
});

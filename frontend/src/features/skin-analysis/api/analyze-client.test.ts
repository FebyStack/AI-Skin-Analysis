import { describe, it, expect, vi } from "vitest";
import { analyzeCapture, getScan, AnalyzeAuthError, AnalyzeFailedError } from "./analyze-client";
import type { CaptureResult } from "../types";

const capture: CaptureResult = {
  blob: new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" }),
  mimeType: "image/jpeg",
  mode: "face",
  source: "camera",
  width: 640,
  height: 480,
};

const scanWire = {
  id: "scan-1",
  patientId: "p-1",
  mode: "face",
  createdAt: 1,
  imageWidth: 640,
  imageHeight: 480,
  report: null,
  partial: true,
  classifierFindings: [],
  promptVersion: null,
};

describe("analyzeCapture", () => {
  it("posts base64 JSON with credentials and returns the scan", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ scan: scanWire }), { status: 200 }));
    const scan = await analyzeCapture(capture, "p-1", [], fetchFn);
    expect(scan.id).toBe("scan-1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/analyze");
    expect(init.credentials).toBe("include");
    const body = JSON.parse(init.body as string);
    expect(body.patientId).toBe("p-1");
    expect(body.mime).toBe("image/jpeg");
    expect(typeof body.image).toBe("string");
  });

  it("throws AnalyzeAuthError on 401", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(analyzeCapture(capture, "p-1", [], fetchFn)).rejects.toThrow(AnalyzeAuthError);
  });

  it("throws AnalyzeFailedError on other failures", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 502 }));
    await expect(analyzeCapture(capture, "p-1", [], fetchFn)).rejects.toThrow(AnalyzeFailedError);
  });
});

describe("getScan", () => {
  it("fetches with credentials and returns the scan", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ scan: scanWire }), { status: 200 }));
    const scan = await getScan("scan-1", fetchFn);
    expect(scan?.id).toBe("scan-1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/scans/scan-1");
    expect(init.credentials).toBe("include");
  });

  it("returns null on 404 instead of throwing", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(getScan("missing", fetchFn)).resolves.toBeNull();
  });

  it("throws AnalyzeAuthError on 401", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(getScan("scan-1", fetchFn)).rejects.toThrow(AnalyzeAuthError);
  });

  it("throws AnalyzeFailedError on other failures", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 502 }));
    await expect(getScan("scan-1", fetchFn)).rejects.toThrow(AnalyzeFailedError);
  });
});

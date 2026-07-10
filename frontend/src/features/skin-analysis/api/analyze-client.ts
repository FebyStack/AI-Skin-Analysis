import type { CaptureResult, Finding } from "../types";
import type { AnalysisReport } from "@shared/contract";

export class AnalyzeAuthError extends Error {
  constructor() {
    super("Please log in again.");
    this.name = "AnalyzeAuthError";
  }
}
export class AnalyzeFailedError extends Error {
  constructor(message = "The analysis could not be completed. Please try again.") {
    super(message);
    this.name = "AnalyzeFailedError";
  }
}

export interface ScanWire {
  id: string;
  patientId: string;
  mode: "face" | "closeup";
  createdAt: number;
  imageWidth: number;
  imageHeight: number;
  report: AnalysisReport | null;
  partial: boolean;
  classifierFindings: unknown[];
  promptVersion: number | null;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export async function analyzeCapture(
  capture: CaptureResult,
  patientId: string,
  classifierFindings: Finding[],
  fetchFn: FetchFn = fetch,
): Promise<ScanWire> {
  const image = await blobToBase64(capture.blob);
  const res = await fetchFn("/api/analyze", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      patientId,
      image,
      mime: capture.mimeType,
      mode: capture.mode,
      classifierFindings,
    }),
  });

  if (res.status === 401) throw new AnalyzeAuthError();
  if (!res.ok) throw new AnalyzeFailedError();
  const data = (await res.json()) as { scan?: ScanWire };
  if (!data.scan) throw new AnalyzeFailedError("Malformed server response.");
  return data.scan;
}

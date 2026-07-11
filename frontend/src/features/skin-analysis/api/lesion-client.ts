import type { LesionAnalysis, LesionExplanation, LesionScanReport } from "@shared/lesion";

export class LesionAuthError extends Error {
  constructor() {
    super("Please log in again.");
    this.name = "LesionAuthError";
  }
}
export class LesionFailedError extends Error {
  constructor(message = "The lesion analysis could not be completed. Please try again.") {
    super(message);
    this.name = "LesionFailedError";
  }
}

export interface LesionScanWire {
  id: string;
  patientId: string;
  mode: "face" | "closeup";
  createdAt: number;
  imageWidth: number;
  imageHeight: number;
  report: LesionScanReport | null;
  partial: boolean;
  promptVersion: number | null;
}

export interface LesionResult {
  scan: LesionScanWire;
  analysis: LesionAnalysis;
  explanation: LesionExplanation;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export async function analyzeLesion(blob: Blob, mime: string, fetchFn: FetchFn = fetch): Promise<LesionResult> {
  const image = await blobToBase64(blob);
  const res = await fetchFn("/api/lesion", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, mime }),
  });
  if (res.status === 401) throw new LesionAuthError();
  if (res.status === 503) throw new LesionFailedError("The analysis service is offline. Try again shortly.");
  if (!res.ok) throw new LesionFailedError();
  return (await res.json()) as LesionResult;
}

// History: walk-in's scans, filtered to lesion reports (newest first from the API).
export async function listLesionScans(fetchFn: FetchFn = fetch): Promise<LesionScanWire[]> {
  const res = await fetchFn("/api/patients/walk-in/scans", { credentials: "include" });
  if (res.status === 401) throw new LesionAuthError();
  if (!res.ok) throw new LesionFailedError("Could not load history.");
  const data = (await res.json()) as { scans: LesionScanWire[] };
  return (data.scans ?? []).filter((s) => s.report?.kind === "lesion");
}

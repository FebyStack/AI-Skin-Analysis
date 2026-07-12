import type { FaceReport, FaceAngle, AngleQuality } from "@shared/face";

export class FaceAuthError extends Error {
  constructor() {
    super("Please log in again.");
    this.name = "FaceAuthError";
  }
}
export class FaceFailedError extends Error {
  constructor(message = "The face scan could not be saved. Please try again.") {
    super(message);
    this.name = "FaceFailedError";
  }
}

export interface FaceScanWire {
  id: string;
  patientId: string;
  mode: "face" | "closeup";
  createdAt: number;
  imageWidth: number;
  imageHeight: number;
  report: FaceReport;
  partial: boolean;
  promptVersion: number | null;
}

export interface CapturedAngle {
  angle: FaceAngle | "forehead" | "chin";
  blob: Blob;
  mime: string;
  quality?: AngleQuality;
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

export async function saveFaceScan(
  report: FaceReport,
  angles: CapturedAngle[],
  fetchFn: FetchFn = fetch,
): Promise<FaceScanWire> {
  const images = await Promise.all(
    angles.map(async (a) => ({
      angle: a.angle,
      image: await blobToBase64(a.blob),
      mime: a.mime,
      quality: a.quality,
    })),
  );
  const res = await fetchFn("/api/face-scans", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ report, images }),
  });
  if (res.status === 401) throw new FaceAuthError();
  if (!res.ok) throw new FaceFailedError();
  return ((await res.json()) as { scan: FaceScanWire }).scan;
}

export async function listFaceScans(fetchFn: FetchFn = fetch): Promise<FaceScanWire[]> {
  const res = await fetchFn("/api/face-scans", { credentials: "include" });
  if (res.status === 401) throw new FaceAuthError();
  if (!res.ok) throw new FaceFailedError("Could not load history.");
  const data = (await res.json()) as { scans: FaceScanWire[] };
  return data.scans ?? [];
}

export async function getFaceScan(id: string, fetchFn: FetchFn = fetch): Promise<FaceScanWire | null> {
  const res = await fetchFn(`/api/face-scans/${id}`, { credentials: "include" });
  if (res.status === 404) return null;
  if (res.status === 401) throw new FaceAuthError();
  if (!res.ok) throw new FaceFailedError();
  return ((await res.json()) as { scan: FaceScanWire }).scan;
}

export async function enhanceFaceScan(id: string, fetchFn: FetchFn = fetch): Promise<boolean> {
  const res = await fetchFn(`/api/face-scans/${id}/enhance`, {
    method: "POST",
    credentials: "include",
  });
  if (res.status === 503) return false; // still offline
  if (res.status === 401) throw new FaceAuthError();
  if (!res.ok) throw new FaceFailedError();
  return true;
}

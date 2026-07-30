import type { FaceReport, FaceAngle, AngleQuality } from "@shared/face";
import { scanConsent } from "../privacy/scan-consent";

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

/**
 * The server REFUSED the scan and always will — an invite link that is used up,
 * expired or revoked.
 *
 * Distinct from FaceFailedError on purpose. A failure is transient, so the caller
 * queues the scan for later sync; a refusal is permanent, and queueing it tells
 * the patient "saved, will sync later" about a scan that can never sync.
 */
export class FaceRejectedError extends Error {
  constructor(
    message: string,
    readonly inviteState?: string,
  ) {
    super(message);
    this.name = "FaceRejectedError";
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
  patientId = "walk-in",
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
    body: JSON.stringify({ report, images, patientId, consent: scanConsent() }),
  });
  if (res.status === 401) throw new FaceAuthError();
  if (res.status === 403 || res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; inviteState?: string };
    throw new FaceRejectedError(
      body.error ?? "This scan was not accepted.",
      body.inviteState,
    );
  }
  if (!res.ok) throw new FaceFailedError();
  return ((await res.json()) as { scan: FaceScanWire }).scan;
}

export async function listFaceScans(
  patientId = "walk-in",
  fetchFn: FetchFn = fetch,
): Promise<FaceScanWire[]> {
  const q = patientId && patientId !== "walk-in" ? `?patientId=${encodeURIComponent(patientId)}` : "";
  const res = await fetchFn(`/api/face-scans${q}`, { credentials: "include" });
  if (res.status === 401) throw new FaceAuthError();
  if (!res.ok) throw new FaceFailedError("Could not load history.");
  const data = (await res.json()) as { scans: FaceScanWire[] };
  return data.scans ?? [];
}

export async function getFaceScan(id: string, fetchFn: FetchFn = fetch): Promise<FaceScanWire | null> {
  const res = await fetchFn(`/api/face-scans/${id}`, { credentials: "include" });
  if (res.status === 404) return null;
  if (res.status === 401) throw new FaceAuthError();
  if (res.status === 403 || res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; inviteState?: string };
    throw new FaceRejectedError(
      body.error ?? "This scan was not accepted.",
      body.inviteState,
    );
  }
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

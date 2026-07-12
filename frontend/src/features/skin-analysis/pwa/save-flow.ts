// Offline-first save wrappers around the network clients. Every completed scan
// lands in IndexedDB (device "folder"); Postgres remains authoritative when
// reachable, and the queue drains any offline scans on reconnect.

import { analyzeLesion, type LesionResult, LesionFailedError } from "../api/lesion-client";
import { saveFaceScan, type CapturedAngle, type FaceScanWire, FaceFailedError } from "../api/face-client";
import type { FaceReport } from "@shared/face";
import { builtinFaceExplanation } from "@ai/llm/fallback/face-education";
import { builtinLesionExplanation } from "@ai/llm/fallback/lesion-education";
import { enqueuePending, putImage, putScan } from "./local-store";

function tmpId(): string {
  // Prefix marks it as a client-generated placeholder id; sync replaces it.
  return `tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function toJpeg(blob: Blob, mime: string): Promise<Blob> {
  // Blob is already whatever the source produced; the *server* re-encodes to JPEG.
  // Locally we keep the original type so display stays lossless. Callers still
  // ask for image/jpeg to align with the server-side storage requirement.
  return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: mime || "image/jpeg" });
}

// ---------- lesion ----------

export interface LesionSaveOutcome {
  result: LesionResult | null; // null = queued offline (no result to display yet)
  offline: boolean;
}

export async function saveLesionScan(blob: Blob, mime: string): Promise<LesionSaveOutcome> {
  try {
    const result = await analyzeLesion(blob, mime);
    await putScan({
      id: result.scan.id,
      kind: "lesion",
      createdAt: result.scan.createdAt,
      report: result.scan.report,
      synced: true,
    });
    await putImage({
      scanId: result.scan.id,
      angle: "closeup",
      jpeg: await toJpeg(blob, mime),
      createdAt: result.scan.createdAt,
    });
    return { result, offline: false };
  } catch (err) {
    if (err instanceof LesionFailedError || err instanceof TypeError) {
      // Network-shaped failure → queue for later.
      const id = tmpId();
      const jpeg = await toJpeg(blob, mime);
      await putImage({ scanId: id, angle: "closeup", jpeg, createdAt: Date.now() });
      await enqueuePending({
        kind: "lesion",
        createdAt: Date.now(),
        payload: { mime: mime || "image/jpeg" },
        imageIds: [`${id}::closeup`],
      });
      return { result: null, offline: true };
    }
    throw err;
  }
}

// ---------- face ----------

export interface FaceSaveOutcome {
  scan: FaceScanWire | null; // null = queued offline
  offline: boolean;
  localReport: FaceReport; // report we can render now (with builtin explanation)
}

export async function saveFaceScanWithFallback(
  report: FaceReport,
  angles: CapturedAngle[],
): Promise<FaceSaveOutcome> {
  const localReport: FaceReport =
    report.explanation ? report : { ...report, explanation: builtinFaceExplanation(report) };
  try {
    const scan = await saveFaceScan(localReport, angles);
    await putScan({
      id: scan.id,
      kind: "face",
      createdAt: scan.createdAt,
      report: scan.report,
      synced: true,
    });
    for (const a of angles) {
      await putImage({
        scanId: scan.id,
        angle: a.angle,
        jpeg: await toJpeg(a.blob, a.mime),
        createdAt: scan.createdAt,
      });
    }
    return { scan, offline: false, localReport: scan.report };
  } catch (err) {
    if (err instanceof FaceFailedError || err instanceof TypeError) {
      const id = tmpId();
      const now = Date.now();
      for (const a of angles) {
        await putImage({ scanId: id, angle: a.angle, jpeg: await toJpeg(a.blob, a.mime), createdAt: now });
      }
      await enqueuePending({
        kind: "face",
        createdAt: now,
        payload: {
          report: localReport,
          angles: angles.map((a) => ({ angle: `${id}::${a.angle}`, mime: a.mime, quality: a.quality })),
        },
        imageIds: angles.map((a) => `${id}::${a.angle}`),
      });
      // Also cache the offline scan locally so history shows it right away.
      await putScan({ id, kind: "face", createdAt: now, report: localReport, synced: false });
      return { scan: null, offline: true, localReport };
    }
    throw err;
  }
}

// Just the lesion builtin path, exported for symmetry (unused directly today).
export { builtinLesionExplanation };

// Sync pending scans from IndexedDB → Postgres. Called on demand + on 'online'.
import { saveFaceScan, type CapturedAngle } from "../api/face-client";
import { analyzeLesion } from "../api/lesion-client";
import type { FaceReport } from "@shared/face";
import {
  getImage,
  listPending,
  removePending,
  updatePending,
  putScan,
  putImage,
  type PendingScan,
  type StoredImage,
} from "./local-store";

interface FaceQueuedPayload {
  report: FaceReport;
  angles: { angle: string; mime: string; quality?: { ok: boolean; issues: string[] } }[];
}

interface LesionQueuedPayload {
  mime: string;
}

async function syncOneFace(item: PendingScan): Promise<void> {
  const payload = item.payload as FaceQueuedPayload;
  const angles: CapturedAngle[] = [];
  for (const a of payload.angles) {
    const [scanId, angle] = a.angle.includes("::") ? a.angle.split("::") : [String(item.id), a.angle];
    const stored = await getImage(scanId, angle);
    if (!stored) throw new Error(`missing local image for ${a.angle}`);
    angles.push({
      angle: angle as CapturedAngle["angle"],
      blob: stored.jpeg,
      mime: a.mime,
      quality: a.quality,
    });
  }
  const scan = await saveFaceScan(payload.report, angles);
  await putScan({ id: scan.id, kind: "face", createdAt: scan.createdAt, report: scan.report, synced: true });
  // Re-key local images from tmp id → server id so getImage(scanId, angle) matches.
  for (const a of payload.angles) {
    const [scanId, angle] = a.angle.includes("::") ? a.angle.split("::") : [String(item.id), a.angle];
    if (scanId !== scan.id) {
      const src = await getImage(scanId, angle);
      if (src) await putImage({ ...src, scanId: scan.id });
    }
  }
}

async function syncOneLesion(item: PendingScan): Promise<void> {
  const payload = item.payload as LesionQueuedPayload;
  const [scanId, angle] = ["closeup"].includes(item.imageIds[0]?.split("::")[1] ?? "")
    ? item.imageIds[0].split("::")
    : [String(item.id), "closeup"];
  const stored = await getImage(scanId, angle);
  if (!stored) throw new Error("missing local image for closeup");
  const result = await analyzeLesion(stored.jpeg, payload.mime || "image/jpeg");
  await putScan({
    id: result.scan.id,
    kind: "lesion",
    createdAt: result.scan.createdAt,
    report: result.scan.report,
    synced: true,
  });
  if (scanId !== result.scan.id) {
    await putImage({ ...(stored as StoredImage), scanId: result.scan.id });
  }
}

export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

// Flush the queue. Returns counts; individual failures don't abort the batch.
export async function syncPending(): Promise<SyncResult> {
  const items = await listPending();
  let succeeded = 0;
  let failed = 0;
  for (const item of items) {
    try {
      if (item.kind === "face") await syncOneFace(item);
      else await syncOneLesion(item);
      if (item.id != null) await removePending(item.id);
      succeeded++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      if (item.id != null) await updatePending({ ...item, lastError: msg });
    }
  }
  return { attempted: items.length, succeeded, failed };
}

// Attach a one-shot sync trigger on 'online'. Returns a cleanup fn.
export function installOnlineSync(): () => void {
  const handler = () => {
    void syncPending().catch(() => {
      /* logged inside; stay silent here */
    });
  };
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
}

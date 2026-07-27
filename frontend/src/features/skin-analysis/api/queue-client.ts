import type { FaceReport } from "@shared/face";
import type { QueueEntry, QueueStats, QueueStatus } from "@shared/training-queue";

export interface QueueDetail {
  entry: QueueEntry;
  report: FaceReport | null;
  labels: { dimension: string; label: string }[];
  reasoning: string[];
  reasoningSource: "gemini" | "derived";
  angles: { angle: string; quality: unknown }[];
}

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { credentials: "include" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export interface QueueQuery {
  status?: QueueStatus;
  q?: string;
  from?: string;
  to?: string;
}

export async function listQueue(query: QueueQuery = {}): Promise<QueueEntry[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const d = await getJSON<{ entries: QueueEntry[] }>(`/api/training-queue?${params}`);
  return d?.entries ?? [];
}

export async function queueStats(): Promise<QueueStats | null> {
  return getJSON<QueueStats>("/api/training-queue/stats");
}

export async function queueDetail(scanId: string): Promise<QueueDetail | null> {
  return getJSON<QueueDetail>(`/api/training-queue/${scanId}`);
}

export async function setQueueStatus(scanId: string, status: QueueStatus, note?: string): Promise<boolean> {
  const r = await fetch(`/api/training-queue/${scanId}/status`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, note }),
  });
  return r.ok;
}

/** Human-verified label for one field — stored separately from the AI prediction. */
export async function saveLabel(scanId: string, dimension: string, label: string): Promise<boolean> {
  const r = await fetch(`/api/scans/${scanId}/label`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dimension, label }),
  });
  return r.ok;
}

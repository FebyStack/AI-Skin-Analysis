import type { FaceReport } from "@shared/face";
import type { QueueEntry, QueueStats, QueueStatus } from "@shared/training-queue";
import type { QualityResult } from "@shared/image-quality";
import type { Eligibility, ScanConsent } from "@shared/training-governance";

export interface QueueDetail {
  entry: QueueEntry;
  report: FaceReport | null;
  labels: { dimension: string; label: string }[];
  reasoning: string[];
  reasoningSource: "gemini" | "derived";
  angles: { angle: string; quality: unknown; qualityScore: QualityResult | null }[];
  duplicate: { scanId: string; similarity: number } | null;
  consent: ScanConsent;
  eligibility: Eligibility;
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

export interface ReviewUpdate {
  /** Omit to save reviewer notes without moving the sample (Save Draft). */
  status?: QueueStatus;
  note?: string;
  reviewerName?: string;
  skipTraining?: boolean;
}

export async function saveReview(scanId: string, patch: ReviewUpdate): Promise<boolean> {
  const r = await fetch(`/api/training-queue/${scanId}/status`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return r.ok;
}

export async function deleteScan(scanId: string): Promise<boolean> {
  const r = await fetch(`/api/training-queue/${scanId}`, { method: "DELETE", credentials: "include" });
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

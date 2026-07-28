import type { FaceReport } from "@shared/face";
import type { QueueEntry, QueueStats, QueueStatus } from "@shared/training-queue";
import type { QualityResult } from "@shared/image-quality";
import type { Eligibility, ScanConsent } from "@shared/training-governance";
import type { LabelInconsistency } from "@shared/label-consistency";
import type { ScanEvent, ArchivedImage, ArchiveStats } from "@shared/lifecycle";

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

/**
 * Human-verified label for one field — stored separately from the AI prediction.
 * Returns any consistency warnings raised against the patient's last approved
 * visit; `null` means the save itself failed.
 */
export async function saveLabel(
  scanId: string,
  dimension: string,
  label: string,
): Promise<LabelInconsistency[] | null> {
  const r = await fetch(`/api/scans/${scanId}/label`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dimension, label }),
  });
  if (!r.ok) return null;
  const body = await r.json().catch(() => ({}));
  return Array.isArray(body.inconsistencies) ? body.inconsistencies : [];
}

/** Audit trail for one scan, oldest first. */
export async function scanEvents(scanId: string): Promise<ScanEvent[]> {
  return (await getJSON<{ events: ScanEvent[] }>(`/api/training-queue/${scanId}/events`))?.events ?? [];
}

export type ArchiveEntry = ArchivedImage;

export async function listArchive(): Promise<{ images: ArchiveEntry[]; stats: ArchiveStats } | null> {
  return getJSON(`/api/archive`);
}

export async function restoreArchived(scanId: string, angle: string): Promise<boolean> {
  const r = await fetch(`/api/archive/${scanId}/${angle}/restore`, {
    method: "POST",
    credentials: "include",
  });
  return r.ok;
}

/** Permanent — no recovery after this. */
export async function purgeArchived(scanId: string, angle: string): Promise<boolean> {
  const r = await fetch(`/api/archive/${scanId}/${angle}`, { method: "DELETE", credentials: "include" });
  return r.ok;
}

export interface ClinicAnalytics {
  totalPatients: number;
  totalVisits: number;
  totalAnalyses: number;
  topSkinType: string | null;
  topAcneSeverity: string | null;
  avgConfidence: number | null;
  avgReviewMs: number | null;
  queueSize: number;
  approved: number;
  rejected: number;
  pending: number;
  needsExpert: number;
  datasetGrowth: { version: string; at: number; imageCount: number }[];
  modelHistory: { version: string; at: number; macroF1: number | null; deployment: string }[];
}

export async function clinicAnalytics(): Promise<ClinicAnalytics | null> {
  return getJSON(`/api/analytics`);
}

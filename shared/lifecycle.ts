// shared/lifecycle.ts
// The audit trail every scan carries: what happened to it, when, and who did it.
// One append-only event log serves the lifecycle timeline, the consistency
// warnings, and the archive — so they can never tell different stories.

export const EVENT_KINDS = [
  "captured",
  "analyzed",
  "reviewed",
  "approved",
  "rejected",
  "needs_expert",
  "dataset",
  "trained",
  "warning",
  "archived",
  "restored",
  "purged",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_LABEL: Record<EventKind, string> = {
  captured: "Captured",
  analyzed: "Analyzed",
  reviewed: "Reviewed",
  approved: "Approved",
  rejected: "Rejected",
  needs_expert: "Sent for expert review",
  dataset: "Included in dataset",
  trained: "Used to train model",
  warning: "Consistency warning",
  archived: "Image archived",
  restored: "Image restored",
  purged: "Image permanently deleted",
};

export interface ScanEvent {
  id: string;
  scanId: string;
  kind: EventKind;
  detail: Record<string, unknown>;
  actor: string | null;
  at: number;
}

/** Human one-liner for a timeline row, e.g. "Included in dataset v4". */
export function describeEvent(e: ScanEvent): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "dataset":
      return `Included in dataset ${d.version ?? ""}`.trim();
    case "trained":
      return `Used to train model ${d.version ?? ""}`.trim();
    case "warning":
      return typeof d.reason === "string" ? d.reason : EVENT_LABEL.warning;
    case "archived":
    case "restored":
    case "purged":
      return `${EVENT_LABEL[e.kind]}${d.angle ? ` — ${d.angle}` : ""}`;
    default:
      return EVENT_LABEL[e.kind] ?? e.kind;
  }
}

// ---------- Archive ----------

/** Archived images are recoverable for this long, then purged. */
export const ARCHIVE_RETENTION_DAYS = 30;

export interface ArchivedImage {
  scanId: string;
  angle: string;
  archivedAt: number;
  /** Epoch ms when auto-delete becomes due. */
  expiresAt: number;
  patientName: string | null;
}

export interface ArchiveStats {
  archived: number;
  expiringSoon: number; // within 7 days
  retentionDays: number;
}

export function expiresAt(archivedAt: number): number {
  return archivedAt + ARCHIVE_RETENTION_DAYS * 86_400_000;
}

export function daysLeft(archivedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt(archivedAt) - now) / 86_400_000));
}

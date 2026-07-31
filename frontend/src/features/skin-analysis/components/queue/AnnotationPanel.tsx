import { useEffect, useMemo, useState } from "react";
import type { FaceDimension, FaceReport } from "@shared/face";
import {
  ANNOTATION_FIELDS,
  QUEUE_STATUS_LABEL,
  scoreToAcneLevel,
  scoreToPresence,
  normalizePresence,
  type QueueStatus,
} from "@shared/training-queue";
import { deleteScan, queueDetail, saveLabel, saveReview, type QueueDetail } from "../../api/queue-client";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { LoadingState } from "../ui/LoadingState";
import { ImageManager } from "./ImageManager";
import { ConfirmDialog } from "./ConfirmDialog";
import { DUPLICATE_THRESHOLD } from "@shared/training-queue";
import { ELIGIBILITY_LABEL, type Eligibility } from "@shared/training-governance";
import type { LabelInconsistency } from "@shared/label-consistency";
import { ConsistencyBanner } from "./ConsistencyBanner";
import { LifecycleTimeline } from "./LifecycleTimeline";

/**
 * A stored label may predate the presence switch ("mild"), so map it forward
 * before it is used to preselect a dropdown — otherwise the option does not
 * match and the panel silently falls back to the first choice, quietly
 * rewriting a clinician's grade.
 */
function normalizeStored(key: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  return key === "acne" || key === "skintype" ? value : normalizePresence(value);
}

/** The AI's suggested label + its confidence for one field. Never written to. */
function aiPrediction(
  report: FaceReport | null,
  key: string,
): { value: string | null; confidence: number | null; source?: "model" | "heuristic" } {
  if (!report) return { value: null, confidence: null };
  if (key === "skintype") {
    // Skin type comes from the trained multi-head model.
    return {
      value: report.skinType?.type ?? null,
      confidence: report.skinType?.confidence ?? null,
      source: "model",
    };
  }
  const d = report.dimensions[key as FaceDimension];
  if (!d) return { value: null, confidence: null };
  return {
    value: key === "acne" ? scoreToAcneLevel(d.score) : scoreToPresence(d.score),
    confidence: d.confidence,
    source: d.source ?? "heuristic",
  };
}

export function AnnotationPanel({ scanId, onClose }: { scanId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<QueueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Human-verified labels, keyed by field. Kept separate from the AI prediction.
  const [verified, setVerified] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<QueueStatus>("pending");
  const [note, setNote] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [msg, setMsg] = useState("");
  const [dupDismissed, setDupDismissed] = useState(false);
  const [angles, setAngles] = useState<QueueDetail["angles"]>([]);
  const [confirmDeleteDup, setConfirmDeleteDup] = useState(false);
  const [inconsistencies, setInconsistencies] = useState<LabelInconsistency[]>([]);
  const [focusField, setFocusField] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    queueDetail(scanId).then((d) => {
      if (!alive) return;
      setDetail(d);
      setLoading(false);
      if (!d) return;
      setStatus(d.entry.status);
      setNote(d.entry.note ?? "");
      setReviewer(d.entry.reviewedBy ?? "");
      setAngles(d.angles);
      // Pre-populate every field from the AI prediction; an existing human label wins.
      const saved = Object.fromEntries(d.labels.map((l) => [l.dimension, l.label]));
      setVerified(
        Object.fromEntries(
          ANNOTATION_FIELDS.map((f) => [
            f.key,
            normalizeStored(f.key, saved[f.key]) ?? aiPrediction(d.report, f.key).value ?? f.options[0],
          ]),
        ),
      );
    });
    return () => {
      alive = false;
    };
  }, [scanId]);

  const report = detail?.report ?? null;
  const edited = useMemo(() => {
    if (!report) return new Set<string>();
    return new Set(
      ANNOTATION_FIELDS.filter((f) => verified[f.key] && verified[f.key] !== aiPrediction(report, f.key).value)
        .map((f) => f.key),
    );
  }, [verified, report]);

  const change = async (key: string, value: string) => {
    setVerified((v) => ({ ...v, [key]: value }));
    setSaving(key);
    setMsg("");
    const warnings = await saveLabel(scanId, key, value);
    setSaving(null);
    if (!warnings) {
      setMsg(`Could not save ${key}.`);
      return;
    }
    setInconsistencies(warnings);
  };

  /** Save Draft (no status) or a review decision. Labels are persisted either way. */
  const commit = async (next?: QueueStatus, skipTraining?: boolean) => {
    setMsg("Saving…");
    for (const f of ANNOTATION_FIELDS) {
      if (verified[f.key]) await saveLabel(scanId, f.key, verified[f.key]);
    }
    const ok = await saveReview(scanId, {
      status: next,
      note,
      reviewerName: reviewer || undefined,
      skipTraining,
    });
    if (!ok) {
      setMsg("Could not save.");
      return;
    }
    if (next) setStatus(next);
    setMsg(next ? `Marked ${QUEUE_STATUS_LABEL[next]}.` : "Draft saved.");
    const fresh = await queueDetail(scanId);
    if (fresh) setDetail(fresh);
  };

  if (loading) return <LoadingState label="Opening this scan…" />;
  if (!detail) return <p className="mt-4 text-sm text-ink-secondary">Sample not found in the queue.</p>;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-serif text-lg font-semibold text-ink">
            {detail.entry.patientName ?? detail.entry.patientId}
          </h3>
          <p className="text-xs text-ink-tertiary">
            <span className="font-mono">{new Date(detail.entry.createdAt).toLocaleString()}</span>
            {report?.modelVersions?.acne && <> · model {report.modelVersions.acne}</>}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={`rounded-full border px-2 py-0.5 ${
                detail.consent?.training
                  ? "border-ok-edge bg-ok-surface text-ok"
                  : "border-urgent-edge bg-urgent-surface text-urgent"
              }`}
            >
              {detail.consent?.training ? "Training consent given" : "No training consent"}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 ${
                detail.eligibility === "ready"
                  ? "border-ok-edge bg-ok-surface text-ok"
                  : "border-hairline-strong bg-surface-raised text-ink-tertiary"
              }`}
            >
              {ELIGIBILITY_LABEL[detail.eligibility as Eligibility] ?? detail.eligibility}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {report && (
            <span className="text-xs text-ink-secondary">
              Overall <ConfidenceBadge confidence={report.overall.confidence} label="Overall" />
            </span>
          )}
          <button onClick={onClose} className="btn-secondary text-sm">Close</button>
        </div>
      </div>

      {/* Near-duplicate warning */}
      {detail.duplicate && detail.duplicate.similarity >= DUPLICATE_THRESHOLD && !dupDismissed && (
        <div className="rounded-xl border border-soon-edge bg-soon-surface p-3">
          <p className="text-sm font-medium text-soon">
            This scan is very similar to an existing approved sample.
          </p>
          <p className="mt-0.5 text-xs text-soon/80">
            {Math.round(detail.duplicate.similarity * 100)}% similar to an earlier scan of this patient.
            Near-duplicates add little to training and can bias the model.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => setDupDismissed(true)} className="btn-secondary min-h-[32px] text-xs">
              Approve Anyway
            </button>
            <button
              onClick={() => commit("approved", true)}
              className="btn-secondary min-h-[32px] text-xs"
            >
              Skip Training
            </button>
            <button
              onClick={() => setConfirmDeleteDup(true)}
              className="min-h-[32px] rounded-lg border border-urgent-edge bg-urgent-surface px-2 text-xs font-medium text-urgent"
            >
              Delete Duplicate
            </button>
          </div>
        </div>
      )}

      {/* Images: zoom / rotate / switch angle / download / delete + quality */}
      <ImageManager
        scanId={scanId}
        angles={angles}
        wasExported={Boolean(detail.entry.exportedAt)}
        onImageDeleted={(angle) => setAngles((a) => a.filter((x) => x.angle !== angle))}
        onScanDeleted={onClose}
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Editable labels — AI prediction shown read-only beside each field */}
        <section className="card p-4">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-ink">Labels</h4>
            <span className="text-[11px] text-ink-tertiary">AI suggestion · your verified label</span>
          </div>
          <ul className="mt-3 space-y-2">
            {ANNOTATION_FIELDS.map((f) => {
              const ai = aiPrediction(report, f.key);
              return (
                <li key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[7rem_1fr_auto]">
                  <span className="text-sm text-ink-secondary">{f.label}</span>
                  <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                    <span className="min-w-0 flex-1 truncate rounded-lg border border-hairline bg-surface px-2 py-1 text-xs capitalize text-ink-tertiary">
                      {ai.value ?? "—"}
                    </span>
                    <ConfidenceBadge confidence={ai.confidence} label={f.label} source={ai.source} />
                  </div>
                  <select
                    ref={(el) => {
                      // "Edit label" on a consistency warning jumps straight to the field.
                      if (el && focusField === f.key) {
                        el.focus();
                        setFocusField(null);
                      }
                    }}
                    value={verified[f.key] ?? ""}
                    onChange={(e) => change(f.key, e.target.value)}
                    disabled={saving === f.key}
                    className={`field-select capitalize sm:w-36 ${edited.has(f.key) ? "border-gold text-gold-bright" : ""}`}
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[11px] text-ink-tertiary">
            The AI prediction is stored unchanged; your selection is saved separately as the
            human-verified label. {edited.size > 0 && `${edited.size} field(s) differ from the AI.`}
          </p>
        </section>

        {/* Read-only reasoning */}
        <section className="card p-4">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-ink">Reasoning</h4>
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-tertiary">
              {detail.reasoningSource === "gemini" ? "AI written" : "On-device"}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {detail.reasoning.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-secondary">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ConsistencyBanner
        warnings={inconsistencies}
        onReview={() => setStatus("needs_expert")}
        onEdit={() => setFocusField(inconsistencies[0]?.field ?? null)}
        onDismiss={() => setInconsistencies([])}
      />

      {/* Reviewer notes — part of the training metadata */}
      <section className="card p-4">
        <h4 className="text-sm font-semibold text-ink">Reviewer Notes</h4>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What you saw, where you disagreed with the AI, anything the next reviewer needs."
          className="field mt-2 w-full resize-y"
        />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink-secondary">
            Reviewer name
            <input
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              placeholder="Your name"
              className="field mt-1 w-full"
            />
          </label>
          <dl className="grid grid-cols-2 gap-x-2 self-end text-xs">
            <dt className="text-ink-tertiary">Date reviewed</dt>
            <dd className="font-mono text-ink-secondary">
              {detail.entry.reviewedAt ? new Date(detail.entry.reviewedAt).toLocaleString() : "—"}
            </dd>
            <dt className="text-ink-tertiary">Last modified</dt>
            <dd className="font-mono text-ink-secondary">
              {detail.entry.updatedAt ? new Date(detail.entry.updatedAt).toLocaleString() : "—"}
            </dd>
          </dl>
        </div>
      </section>

      {/* Where this image has been */}
      <section className="card p-4">
        <h4 className="mb-3 text-sm font-semibold text-ink">Image lifecycle</h4>
        <LifecycleTimeline scanId={scanId} />
      </section>

      {/* Workflow */}
      <section className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => commit()} className="btn-secondary px-4">Save Draft</button>
          <button onClick={() => commit("approved")} className="btn-primary px-4">Approve</button>
          <button
            onClick={() => commit("rejected")}
            className="min-h-[40px] rounded-lg border border-urgent-edge bg-urgent-surface px-4 text-sm font-medium text-urgent"
          >
            Reject
          </button>
          <button
            onClick={() => commit("needs_expert")}
            className="min-h-[40px] rounded-lg border border-soon-edge bg-soon-surface px-4 text-sm font-medium text-soon"
          >
            Needs Expert Review
          </button>
          <span className="ml-auto text-xs text-ink-tertiary">
            Current: {QUEUE_STATUS_LABEL[status]}
            {detail.entry.skipTraining && " · excluded from training"}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-ink-tertiary">
          Approve includes this sample in the next training export. Reject removes it from future
          training. Needs Expert Review excludes it until someone re-reviews it.
        </p>
        {msg && <p className="mt-2 text-xs text-ink-secondary">{msg}</p>}
      </section>

      {confirmDeleteDup && (
        <ConfirmDialog
          title="Delete the entire scan session?"
          body="This removes all images, AI predictions and reviewer annotations."
          warning={
            detail.entry.exportedAt
              ? "This scan has already been used for training. It will be excluded from future training but cannot be removed from already-trained models."
              : null
          }
          onCancel={() => setConfirmDeleteDup(false)}
          onConfirm={async () => {
            await deleteScan(scanId);
            setConfirmDeleteDup(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}

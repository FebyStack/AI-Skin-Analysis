import { useEffect, useMemo, useState } from "react";
import type { FaceDimension, FaceReport } from "@shared/face";
import {
  ANNOTATION_FIELDS,
  QUEUE_STATUSES,
  QUEUE_STATUS_LABEL,
  scoreToAcneLevel,
  scoreToSeverity,
  type QueueStatus,
} from "@shared/training-queue";
import { queueDetail, saveLabel, setQueueStatus, type QueueDetail } from "../../api/queue-client";
import { ConfidenceBadge } from "./ConfidenceBadge";

/** The AI's suggested label + its confidence for one field. Never written to. */
function aiPrediction(report: FaceReport | null, key: string): { value: string | null; confidence: number | null } {
  if (!report) return { value: null, confidence: null };
  if (key === "skintype") {
    return { value: report.skinType?.type ?? null, confidence: report.skinType?.confidence ?? null };
  }
  const d = report.dimensions[key as FaceDimension];
  if (!d) return { value: null, confidence: null };
  return {
    value: key === "acne" ? scoreToAcneLevel(d.score) : scoreToSeverity(d.score),
    confidence: d.confidence,
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
  const [msg, setMsg] = useState("");

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
      // Pre-populate every field from the AI prediction; an existing human label wins.
      const saved = Object.fromEntries(d.labels.map((l) => [l.dimension, l.label]));
      setVerified(
        Object.fromEntries(
          ANNOTATION_FIELDS.map((f) => [
            f.key,
            saved[f.key] ?? aiPrediction(d.report, f.key).value ?? f.options[0],
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
    const ok = await saveLabel(scanId, key, value);
    setSaving(null);
    if (!ok) setMsg(`Could not save ${key}.`);
  };

  const applyStatus = async (next: QueueStatus) => {
    // Persist every field first so an approval always has a complete label set.
    for (const f of ANNOTATION_FIELDS) {
      if (verified[f.key]) await saveLabel(scanId, f.key, verified[f.key]);
    }
    const ok = await setQueueStatus(scanId, next, note);
    if (ok) {
      setStatus(next);
      setMsg(`Marked ${QUEUE_STATUS_LABEL[next]}.`);
    } else setMsg("Could not update status.");
  };

  if (loading) return <div className="skeleton mt-4 h-64" />;
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

      {/* Captured angles */}
      {detail.angles.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {detail.angles.map((a) => (
            <figure key={a.angle} className="shrink-0">
              <img
                src={`/api/face-scans/${scanId}/images/${a.angle}`}
                alt={a.angle}
                className="h-24 w-[4.5rem] rounded-lg object-cover"
              />
              <figcaption className="mt-0.5 text-center text-[10px] text-ink-tertiary">{a.angle}</figcaption>
            </figure>
          ))}
        </div>
      )}

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
                    <ConfidenceBadge confidence={ai.confidence} label={f.label} />
                  </div>
                  <select
                    value={verified[f.key] ?? ""}
                    onChange={(e) => change(f.key, e.target.value)}
                    disabled={saving === f.key}
                    className={`field capitalize sm:w-36 ${edited.has(f.key) ? "border-gold text-gold-bright" : ""}`}
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

      {/* Review actions */}
      <section className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {QUEUE_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => applyStatus(s)}
              className={`min-h-[36px] rounded-full px-3 text-sm font-medium transition-colors ${
                status === s
                  ? "bg-gold text-gold-ink"
                  : "border border-hairline-strong bg-surface-raised text-ink-secondary hover:text-ink"
              }`}
            >
              {QUEUE_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reviewer note (optional)"
          className="field mt-3 w-full"
        />
        {msg && <p className="mt-2 text-xs text-ink-secondary">{msg}</p>}
      </section>
    </div>
  );
}

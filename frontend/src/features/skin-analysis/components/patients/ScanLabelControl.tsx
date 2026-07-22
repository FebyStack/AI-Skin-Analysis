import { useEffect, useState } from "react";

// Clinician grades a saved scan on one dimension → training data for that learned
// model (POST /api/scans/:id/label). Generic over dimension so acne, skin-type,
// and future trained dimensions all reuse it. Shown on saved (online) scans.
export function ScanLabelControl({
  scanId,
  dimension,
  title,
  labels,
}: {
  scanId: string;
  dimension: string;
  title: string;
  labels: readonly string[];
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/scans/${scanId}/labels`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { labels: [] }))
      .then((d: { labels?: { dimension: string; label: string }[] }) => {
        if (!alive) return;
        setCurrent(d.labels?.find((l) => l.dimension === dimension)?.label ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [scanId, dimension]);

  const assign = async (label: string) => {
    setSaving(label);
    setError("");
    try {
      const res = await fetch(`/api/scans/${scanId}/label`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dimension, label }),
      });
      if (!res.ok) throw new Error("Could not save label.");
      setCurrent(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save label.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="card mx-auto mt-4 max-w-3xl p-4">
      <p className="text-sm font-semibold text-ink">{title} <span className="font-normal text-gold">(trains the model)</span></p>
      <p className="mt-0.5 text-xs text-ink-secondary">
        Your grading becomes training data. {current ? `Current: ${current}.` : "Not yet graded."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {labels.map((l) => (
          <button
            key={l}
            onClick={() => assign(l)}
            disabled={saving !== null}
            className={`min-h-[36px] rounded-full px-3 text-sm font-medium capitalize transition-colors disabled:opacity-50 ${
              current === l
                ? "bg-gold text-gold-ink"
                : "border border-hairline-strong bg-surface-raised text-ink-secondary hover:text-ink"
            }`}
          >
            {saving === l ? "…" : l}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-urgent">{error}</p>}
    </div>
  );
}

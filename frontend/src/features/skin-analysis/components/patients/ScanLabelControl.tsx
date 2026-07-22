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
    <div className="mx-auto mt-4 max-w-3xl rounded-xl border border-stone-200 bg-stone-50 p-4">
      <p className="text-sm font-semibold text-stone-700">{title} (trains the model)</p>
      <p className="mt-0.5 text-xs text-stone-500">
        Your grading becomes training data. {current ? `Current: ${current}.` : "Not yet graded."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {labels.map((l) => (
          <button
            key={l}
            onClick={() => assign(l)}
            disabled={saving !== null}
            className={`min-h-[36px] rounded-full px-3 text-sm font-medium capitalize disabled:opacity-50 ${
              current === l ? "bg-clinical text-white" : "bg-white text-clinical border border-clinical/40"
            }`}
          >
            {saving === l ? "…" : l}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

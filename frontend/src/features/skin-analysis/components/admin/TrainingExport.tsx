import { useState } from "react";

// One-click flywheel step: export every graded scan into the training folders
// ($DATASETS_DIR/<dim>/scans/<label>/). Admin-gated server-side; non-admins get
// a clear error instead of a hidden devtools ritual. After export: `make retrain`.
export function TrainingExport() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const exportAll = async () => {
    setBusy(true);
    setStatus("Exporting…");
    try {
      const parts: string[] = [];
      for (const dim of ["acne", "skintype"]) {
        const res = await fetch(`/api/training/${dim}/export`, {
          method: "POST",
          credentials: "include",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? `${dim} export failed (${res.status})`);
        parts.push(`${dim}: ${j.exported}/${j.labeled}`);
      }
      setStatus(`Exported — ${parts.join(" · ")}. Next: make retrain`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-4 flex max-w-3xl items-center gap-3 px-4">
      <button onClick={exportAll} disabled={busy} className="btn-secondary text-sm disabled:opacity-50">
        {busy ? "Exporting…" : "Export graded scans for training"}
      </button>
      {status && <span className="text-xs text-ink-secondary">{status}</span>}
    </div>
  );
}

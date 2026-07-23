import { useEffect, useState } from "react";
import { listScans, type StoredScan } from "../../pwa/local-store";
import { FaceHistoryDetail, type HistoryRef } from "./FaceHistoryDetail";
import { listFaceScans, type FaceScanWire } from "../../api/face-client";
import { listLesionScans, type LesionScanWire } from "../../api/lesion-client";
import { scanPatientId, usePatientStore } from "../../store/patient-store";

interface HistoryRow {
  id: string;
  kind: "face" | "lesion";
  createdAt: number;
  headline: string;
  synced: boolean;
  source: "local" | "server";
  report: unknown; // stored FaceReport / lesion report — powers the expanded detail
}

function faceHeadline(report: unknown): string {
  const r = report as { overall?: { score?: number } };
  const score = r?.overall?.score;
  return typeof score === "number" ? `Face — overall ${Math.round(score * 100)}%` : "Face scan";
}

function lesionHeadline(report: unknown): string {
  const r = report as { analysis?: { lesions?: { classification?: { predicted?: string | null } }[] } };
  const label = r?.analysis?.lesions?.[0]?.classification?.predicted;
  return `Lesion — ${label ?? "Inconclusive"}`;
}

async function loadFromDevice(patientId: string): Promise<HistoryRow[]> {
  const scans: StoredScan[] = await listScans().catch(() => []);
  return scans
    .filter((s) => (s.patientId ?? "walk-in") === patientId)
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      createdAt: s.createdAt,
      headline: s.kind === "face" ? faceHeadline(s.report) : lesionHeadline(s.report),
      synced: s.synced,
      source: "local",
      report: s.report,
    }));
}

async function loadFromServer(patientId: string): Promise<HistoryRow[]> {
  const [face, lesion] = await Promise.all([
    listFaceScans(patientId).catch(() => [] as FaceScanWire[]),
    listLesionScans(patientId).catch(() => [] as LesionScanWire[]),
  ]);
  return [
    ...face.map<HistoryRow>((s) => ({
      id: s.id,
      kind: "face",
      createdAt: s.createdAt,
      headline: faceHeadline(s.report),
      synced: true,
      source: "server",
      report: s.report,
    })),
    ...lesion.map<HistoryRow>((s) => ({
      id: s.id,
      kind: "lesion",
      createdAt: s.createdAt,
      headline: lesionHeadline(s.report),
      synced: true,
      source: "server",
      report: s.report,
    })),
  ];
}

function mergeById(a: HistoryRow[], b: HistoryRow[]): HistoryRow[] {
  const seen = new Set<string>();
  const merged: HistoryRow[] = [];
  for (const row of [...a, ...b]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged.sort((x, y) => y.createdAt - x.createdAt);
}

export function HistoryView({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Re-scope + reload whenever the selected patient changes.
  const selectedName = usePatientStore((s) => s.selectedName);
  const selectedId = usePatientStore((s) => s.selectedId);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setNote("");
    const patientId = scanPatientId();
    (async () => {
      // Show device first for immediate feedback; layer server on top.
      const local = await loadFromDevice(patientId);
      if (!alive) return;
      setRows(local);
      setLoading(false);
      try {
        const server = await loadFromServer(patientId);
        if (!alive) return;
        setRows(mergeById(server, local));
      } catch {
        if (alive) setNote("Showing device-only history — the server is unreachable.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedId]);

  return (
    <div className="mx-auto w-full max-w-3xl animate-rise px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">Scan history</h2>
          <p className="mt-0.5 text-xs text-ink-secondary">{selectedName ?? "Walk-in (no patient selected)"}</p>
        </div>
        <button onClick={onBack} className="btn-secondary">Back</button>
      </div>

      {note && (
        <p className="mb-4 rounded-xl border border-hairline bg-surface p-3 text-sm text-ink-secondary">{note}</p>
      )}

      {loading ? (
        <ul className="space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="skeleton h-[4.5rem]" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-secondary">
            No saved scans yet. Face scans and body/close-up scans will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => {
            const open = openId === r.id;
            // "Before" = this patient's next-older face scan (list is newest-first).
            // ONLY for a real selected patient: walk-in is a shared bucket holding
            // unrelated people, so comparing across it would mix different faces.
            const previous =
              r.kind === "face" && selectedId != null
                ? (rows.slice(i + 1).find((p) => p.kind === "face") as HistoryRef | undefined) ?? null
                : null;
            return (
              <li key={r.id} className="card overflow-hidden">
                <button
                  onClick={() => r.kind === "face" && setOpenId(open ? null : r.id)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between p-4 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{r.headline}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-tertiary">
                      <span className="font-mono">{new Date(r.createdAt).toLocaleString()}</span> · {r.kind}
                      {!r.synced && (
                        <span className="rounded-full border border-soon-edge bg-soon-surface px-2 py-0.5 text-soon">pending sync</span>
                      )}
                    </p>
                  </div>
                  {r.kind === "face" && (
                    <svg
                      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      className={`shrink-0 text-ink-tertiary transition-transform ${open ? "rotate-180" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  )}
                </button>
                {open && r.kind === "face" && <FaceHistoryDetail scan={r} previous={previous} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

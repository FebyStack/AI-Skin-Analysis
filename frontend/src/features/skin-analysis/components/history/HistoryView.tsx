import { useEffect, useState } from "react";
import { listScans, type StoredScan } from "../../pwa/local-store";
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
    })),
    ...lesion.map<HistoryRow>((s) => ({
      id: s.id,
      kind: "lesion",
      createdAt: s.createdAt,
      headline: lesionHeadline(s.report),
      synced: true,
      source: "server",
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
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Scan history</h2>
          <p className="text-xs text-stone-500">{selectedName ?? "Walk-in (no patient selected)"}</p>
        </div>
        <button
          onClick={onBack}
          className="min-h-[44px] rounded-lg bg-clinical px-4 text-sm font-semibold text-white"
        >
          Back
        </button>
      </div>

      {note && (
        <p className="mb-3 rounded-lg bg-stone-100 p-3 text-sm text-stone-600">{note}</p>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-stone-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-stone-500">
          No saved scans yet. Face scans and body/close-up scans will appear here.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-xl border border-stone-200 p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-stone-800">{r.headline}</p>
                <p className="text-xs text-stone-400">
                  {new Date(r.createdAt).toLocaleString()} · {r.kind}
                  {!r.synced && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">pending sync</span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

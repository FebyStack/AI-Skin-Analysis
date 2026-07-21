import { useCallback, useEffect, useState } from "react";
import { usePatientStore } from "../../store/patient-store";
import { listPatients, createPatient, type Patient } from "../../api/patients-client";

// A slim bar at the top of the app: shows the active patient and opens a panel to
// search/select an existing patient or create a new one. The selection persists
// (patient-store) and scopes every scan + history view.
export function PatientBar() {
  const selectedId = usePatientStore((s) => s.selectedId);
  const selectedName = usePatientStore((s) => s.selectedName);
  const select = usePatientStore((s) => s.select);
  const clear = usePatientStore((s) => s.clear);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const search = useCallback(async (q: string) => {
    setError("");
    try {
      setResults(await listPatients(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load patients.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void search(query), 200);
    return () => clearTimeout(t);
  }, [open, query, search]);

  const choose = (p: Patient) => {
    select(p.id, p.name);
    setOpen(false);
    setQuery("");
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const p = await createPatient({ name });
      select(p.id, p.name);
      setNewName("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the patient.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mb-4 w-full max-w-2xl">
      <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-stone-400">Patient</p>
          <p className="truncate text-sm font-semibold text-stone-800">
            {selectedName ?? "Walk-in (none selected)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedId && (
            <button
              onClick={clear}
              className="text-xs font-medium text-stone-500 underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="min-h-[36px] rounded-lg bg-clinical px-3 text-sm font-semibold text-white"
          >
            {selectedId ? "Switch" : "Select"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <label className="text-xs font-medium text-stone-600">Find a patient</label>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />

          {results.length > 0 && (
            <ul className="mt-2 max-h-48 divide-y divide-stone-100 overflow-y-auto rounded-lg border border-stone-100">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => choose(p)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-stone-50"
                  >
                    <span className="truncate text-stone-800">{p.name}</span>
                    {p.externalRef && <span className="ml-2 shrink-0 text-xs text-stone-400">{p.externalRef}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-stone-100 pt-3">
            <label className="text-xs font-medium text-stone-600">Or add a new patient</label>
            <div className="mt-1 flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void create()}
                placeholder="Full name"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
              <button
                onClick={create}
                disabled={busy || !newName.trim()}
                className="min-h-[40px] shrink-0 rounded-lg bg-clinical px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

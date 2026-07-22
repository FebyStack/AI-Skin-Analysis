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
    <div className="mx-auto w-full max-w-2xl">
      <div className="card flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-ink-tertiary">Patient</p>
          <p className="truncate text-sm font-semibold text-ink">
            {selectedName ?? "Walk-in (none selected)"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedId && (
            <button
              onClick={clear}
              className="text-xs font-medium text-ink-secondary underline-offset-2 hover:text-ink hover:underline"
            >
              Clear
            </button>
          )}
          <button onClick={() => setOpen((v) => !v)} className="btn-primary min-h-[36px] px-4">
            {selectedId ? "Switch" : "Select"}
          </button>
        </div>
      </div>

      {open && (
        <div className="card mt-2 animate-rise p-4">
          <label className="field-label">Find a patient</label>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="field mt-1.5"
          />

          {results.length > 0 && (
            <ul className="mt-3 max-h-48 divide-y divide-hairline overflow-y-auto rounded-xl border border-hairline">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => choose(p)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-surface-raised"
                  >
                    <span className="truncate">{p.name}</span>
                    {p.externalRef && <span className="ml-2 shrink-0 text-xs text-ink-tertiary">{p.externalRef}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-hairline pt-4">
            <label className="field-label">Or add a new patient</label>
            <div className="mt-1.5 flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void create()}
                placeholder="Full name"
                className="field"
              />
              <button onClick={create} disabled={busy || !newName.trim()} className="btn-primary shrink-0 px-5">
                Add
              </button>
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-urgent">{error}</p>}
        </div>
      )}
    </div>
  );
}

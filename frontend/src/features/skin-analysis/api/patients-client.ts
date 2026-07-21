export interface Patient {
  id: string;
  name: string;
  externalRef: string | null;
  notes: string;
  consentVersion: number | null;
  createdAt: number;
}

export class PatientAuthError extends Error {
  constructor() {
    super("Please log in again.");
    this.name = "PatientAuthError";
  }
}
export class PatientFailedError extends Error {
  constructor(message = "Patient request failed.") {
    super(message);
    this.name = "PatientFailedError";
  }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function listPatients(search = "", fetchFn: FetchFn = fetch): Promise<Patient[]> {
  const q = search ? `?q=${encodeURIComponent(search)}` : "";
  const res = await fetchFn(`/api/patients${q}`, { credentials: "include" });
  if (res.status === 401) throw new PatientAuthError();
  if (!res.ok) throw new PatientFailedError("Could not load patients.");
  return ((await res.json()) as { patients: Patient[] }).patients ?? [];
}

export async function createPatient(
  input: { name: string; externalRef?: string | null; notes?: string },
  fetchFn: FetchFn = fetch,
): Promise<Patient> {
  const res = await fetchFn("/api/patients", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new PatientAuthError();
  if (res.status === 400) throw new PatientFailedError("A patient name is required.");
  if (!res.ok) throw new PatientFailedError("Could not create the patient.");
  return ((await res.json()) as { patient: Patient }).patient;
}

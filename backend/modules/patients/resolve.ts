import type { AppDeps } from "../../shared/deps";
import type { Patient } from "./repository";

// Resolve the patient a scan belongs to. A real patientId wins; when omitted (or
// the legacy "walk-in" sentinel), fall back to the shared walk-in patient so
// existing single-patient flows keep working unchanged.
export async function resolveScanPatient(
  deps: AppDeps,
  patientId?: unknown,
): Promise<Patient | null> {
  if (typeof patientId === "string" && patientId.length > 0 && patientId !== "walk-in") {
    return deps.patients.get(patientId); // null if not found → caller 404s
  }
  return walkInPatient(deps);
}

export async function walkInPatient(deps: AppDeps): Promise<Patient> {
  const list = await deps.patients.list();
  return (
    list.find((p) => p.externalRef === "walk-in") ??
    (await deps.patients.create({
      name: "Walk-in Patient",
      externalRef: "walk-in",
      notes: "Auto-created placeholder for walk-in scans",
      consentVersion: 1,
    }))
  );
}

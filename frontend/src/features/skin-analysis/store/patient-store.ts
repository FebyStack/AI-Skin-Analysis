import { create } from "zustand";
import { persist } from "zustand/middleware";

// The currently-selected patient. Persisted to localStorage so the clinician's
// active patient survives reloads (and PWA relaunches) within a session.
interface PatientState {
  selectedId: string | null;
  selectedName: string | null;
  select: (id: string, name: string) => void;
  clear: () => void;
}

export const usePatientStore = create<PatientState>()(
  persist(
    (set) => ({
      selectedId: null,
      selectedName: null,
      select: (id, name) => set({ selectedId: id, selectedName: name }),
      clear: () => set({ selectedId: null, selectedName: null }),
    }),
    { name: "skin-selected-patient" },
  ),
);

// The patientId to send with a scan. Falls back to the "walk-in" sentinel when no
// patient is chosen, so scans never fail — they just land on the shared walk-in.
export function scanPatientId(): string {
  return usePatientStore.getState().selectedId ?? "walk-in";
}

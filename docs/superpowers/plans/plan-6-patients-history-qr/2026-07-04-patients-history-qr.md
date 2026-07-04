# Patients, History & QR Capture UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The clinic app shell — login, patient profiles, per-patient scan history with thumbnails, full stored-report viewing, before/after comparison with per-dimension deltas and trends, the patient consent workflow, and QR remote capture from a phone.

**Architecture:** `react-router-dom` provides routes (`/login`, `/patients`, `/patients/:id`, `/patients/:id/scan`, `/patients/:id/compare`, `/capture/:token`). A thin typed `api/client.ts` wraps fetch with credentials and 401→login redirection (injectable fetch for tests). All computation-bearing pieces (dimension deltas/trends, QR polling loop, capture-session URL building) are pure and unit-tested; pages are thin compositions tested for their key behaviors with fakes. The phone capture page reuses the existing CameraFeed/UploadDropzone and posts to the token endpoint — no login, no patient data.

**Tech Stack:** react-router-dom ^6, qrcode ^1 (client-side QR rendering), existing stack.

**Prerequisites:** Plans 3–5 merged; Plan 4's api running for manual verification (`docker compose up` or `node dist-server`). Tests need no server.

**Test counts approximate; all-passing is the requirement.**

---

## File Structure

- Modify: `package.json` — add react-router-dom, qrcode (+ @types/qrcode)
- Create: `src/features/skin-analysis/api/client.ts` (+ test) — typed api wrapper (login, patients, scans, capture sessions)
- Create: `src/features/skin-analysis/pages/LoginPage.tsx` (+ test)
- Create: `src/features/skin-analysis/pages/PatientsPage.tsx` (+ test)
- Create: `src/features/skin-analysis/pages/PatientDetailPage.tsx` (+ test) — profile, consent gate, history timeline
- Create: `src/features/skin-analysis/pages/ScanPage.tsx` — consent check + CaptureFlow with real patientId
- Create: `src/features/skin-analysis/pages/ComparePage.tsx` (+ test) — before/after + deltas
- Create: `src/features/skin-analysis/ml/trends.ts` (+ test) — dimension deltas/trends (pure)
- Create: `src/features/skin-analysis/components/capture/RemoteCaptureDialog.tsx` (+ test) — QR + polling
- Create: `src/features/skin-analysis/qr/poll.ts` (+ test) — pure polling loop
- Create: `src/features/skin-analysis/pages/PhoneCapturePage.tsx` (+ test) — `/capture/:token`
- Modify: `src/App.tsx` — router
- Modify: `src/features/skin-analysis/SkinAnalysisPage.tsx` — becomes ScanPage content (or is removed in favor of it)

---

## Task 1: Router + typed api client

**Files:**
- Modify: `package.json`
- Create: `src/features/skin-analysis/api/client.ts`
- Create: `src/features/skin-analysis/api/client.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Install**

Run: `npm install react-router-dom@^6.28.0 qrcode@^1.5.4 && npm install -D @types/qrcode@^1.5.5`

- [ ] **Step 2: Failing test** `src/features/skin-analysis/api/client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ApiClient, UnauthorizedError } from "./client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("ApiClient", () => {
  it("logs in and lists patients with credentials", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ patients: [{ id: "p1", name: "Ana" }] }));
    const api = new ApiClient(fetchFn);
    await api.login("secret-password");
    const patients = await api.listPatients("an");
    expect(patients[0].name).toBe("Ana");
    const [loginCall, listCall] = fetchFn.mock.calls;
    expect(loginCall[0]).toBe("/api/auth/login");
    expect(listCall[0]).toBe("/api/patients?q=an");
    expect(listCall[1].credentials).toBe("include");
  });

  it("throws UnauthorizedError on 401 so the UI can redirect to login", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const api = new ApiClient(fetchFn);
    await expect(api.listPatients()).rejects.toThrow(UnauthorizedError);
  });

  it("creates patients, records consent, lists scans, creates capture sessions", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ patient: { id: "p1", name: "Ana" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ patient: { id: "p1", consentVersion: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ scans: [{ id: "s1", partial: false }] }))
      .mockResolvedValueOnce(jsonResponse({ token: "tok", path: "/capture/tok" }, 201));
    const api = new ApiClient(fetchFn);
    const p = await api.createPatient({ name: "Ana" });
    expect(p.id).toBe("p1");
    const consented = await api.recordConsent("p1", 1);
    expect(consented.consentVersion).toBe(1);
    const scans = await api.listScans("p1");
    expect(scans[0].id).toBe("s1");
    const session = await api.createCaptureSession();
    expect(session.token).toBe("tok");
  });
});
```

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement** `src/features/skin-analysis/api/client.ts`:

```ts
import type { ScanWire } from "./analyze-client";

export class UnauthorizedError extends Error {
  constructor() {
    super("Login required");
    this.name = "UnauthorizedError";
  }
}

export interface PatientWire {
  id: string;
  name: string;
  externalRef: string | null;
  notes: string;
  consentVersion: number | null;
  createdAt: number;
}

export type ScanSummary = Omit<ScanWire, "classifierFindings"> & {
  classifierFindings: unknown[];
};

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class ApiClient {
  constructor(private fetchFn: FetchFn = fetch) {}

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(url, {
      credentials: "include",
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  login(password: string): Promise<{ ok: boolean }> {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  }

  async listPatients(q?: string): Promise<PatientWire[]> {
    const url = q ? `/api/patients?q=${encodeURIComponent(q)}` : "/api/patients";
    const data = await this.request<{ patients: PatientWire[] }>(url);
    return data.patients;
  }

  async getPatient(id: string): Promise<PatientWire | null> {
    const patients = await this.listPatients();
    return patients.find((p) => p.id === id) ?? null;
  }

  async createPatient(fields: { name: string; externalRef?: string; notes?: string }): Promise<PatientWire> {
    const data = await this.request<{ patient: PatientWire }>("/api/patients", {
      method: "POST",
      body: JSON.stringify(fields),
    });
    return data.patient;
  }

  async recordConsent(patientId: string, version: number): Promise<PatientWire> {
    const data = await this.request<{ patient: PatientWire }>(
      `/api/patients/${patientId}/consent`,
      { method: "POST", body: JSON.stringify({ version }) },
    );
    return data.patient;
  }

  async deletePatient(id: string): Promise<void> {
    await this.request(`/api/patients/${id}`, { method: "DELETE" });
  }

  async listScans(patientId: string): Promise<ScanSummary[]> {
    const data = await this.request<{ scans: ScanSummary[] }>(`/api/patients/${patientId}/scans`);
    return data.scans;
  }

  async deleteScan(id: string): Promise<void> {
    await this.request(`/api/scans/${id}`, { method: "DELETE" });
  }

  async reanalyzeScan(id: string): Promise<void> {
    await this.request(`/api/scans/${id}/reanalyze`, { method: "POST" });
  }

  async createCaptureSession(): Promise<{ token: string; path: string }> {
    return this.request("/api/capture-sessions", { method: "POST" });
  }

  async pollCaptureSession(
    token: string,
  ): Promise<{ image: string; mime: string; mode: "face" | "closeup" } | null> {
    try {
      const data = await this.request<{ capture: { image: string; mime: string; mode: "face" | "closeup" } }>(
        `/api/capture-sessions/${token}`,
      );
      return data.capture;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      return null; // 404 = not captured yet
    }
  }

  scanImageUrl(scanId: string): string {
    return `/api/scans/${scanId}/image`;
  }
}

export const api = new ApiClient();
```

- [ ] **Step 5: Router in `src/App.tsx`:**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "@/features/skin-analysis/pages/LoginPage";
import { PatientsPage } from "@/features/skin-analysis/pages/PatientsPage";
import { PatientDetailPage } from "@/features/skin-analysis/pages/PatientDetailPage";
import { ScanPage } from "@/features/skin-analysis/pages/ScanPage";
import { ComparePage } from "@/features/skin-analysis/pages/ComparePage";
import { PhoneCapturePage } from "@/features/skin-analysis/pages/PhoneCapturePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/patients/:id" element={<PatientDetailPage />} />
        <Route path="/patients/:id/scan" element={<ScanPage />} />
        <Route path="/patients/:id/compare" element={<ComparePage />} />
        <Route path="/capture/:token" element={<PhoneCapturePage />} />
        <Route path="*" element={<Navigate to="/patients" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

(The page components don't exist yet — `App.tsx` won't typecheck until Tasks 2–7 create them. Commit at the END of Task 2 once LoginPage exists, using placeholder pages: create each missing page file as a minimal stub NOW so the app compiles, e.g. `export function PatientsPage() { return null; }` — later tasks replace stubs with real implementations. Stubs keep verify green between tasks.)

- [ ] **Step 6: Create the five stub pages** (each one line as above, correct names/paths). Run `npm run verify` — green. Commit:

```bash
git add package.json package-lock.json src/App.tsx src/features/skin-analysis/api/client.ts src/features/skin-analysis/api/client.test.ts src/features/skin-analysis/pages/
git commit -m "feat: router, typed api client, page stubs"
```

---

## Task 2: Login page

**Files:**
- Replace stub: `src/features/skin-analysis/pages/LoginPage.tsx`
- Create: `src/features/skin-analysis/pages/LoginPage.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { ApiClient } from "../api/client";

describe("LoginPage", () => {
  it("submits the password and navigates on success", async () => {
    const login = vi.fn(async () => ({ ok: true }));
    const client = { login } as unknown as ApiClient;
    render(
      <MemoryRouter>
        <LoginPage client={client} />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText(/clinic password/i), "secret-password");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));
    expect(login).toHaveBeenCalledWith("secret-password");
  });

  it("shows an error on rejection", async () => {
    const login = vi.fn(async () => {
      throw new Error("nope");
    });
    const client = { login } as unknown as ApiClient;
    render(
      <MemoryRouter>
        <LoginPage client={client} />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText(/clinic password/i), "bad-password");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect|failed/i);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement:**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ApiClient } from "../api/client";

export function LoginPage({ client = api }: { client?: ApiClient }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await client.login(password);
      navigate("/patients");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-center text-2xl font-bold text-stone-900">AI Skin Analysis</h1>
      <p className="mt-1 text-center text-sm text-stone-500">Clinic access</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <label className="block text-sm font-medium text-stone-700">
          Clinic password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 p-3"
            autoFocus
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            Login failed — the password is incorrect.
          </p>
        )}
        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="w-full rounded-lg bg-clinical py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Log in
        </button>
        <p className="text-xs text-stone-500">
          First run: the password you enter here (min 8 characters) becomes the clinic password.
        </p>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Run — PASS. Commit:**

```bash
git add src/features/skin-analysis/pages/LoginPage.tsx src/features/skin-analysis/pages/LoginPage.test.tsx
git commit -m "feat: clinic login page"
```

---

## Task 3: Patients list

**Files:**
- Replace stub: `src/features/skin-analysis/pages/PatientsPage.tsx`
- Create: `src/features/skin-analysis/pages/PatientsPage.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PatientsPage } from "./PatientsPage";
import type { ApiClient, PatientWire } from "../api/client";

const ana: PatientWire = {
  id: "p1",
  name: "Ana Reyes",
  externalRef: "C-1",
  notes: "",
  consentVersion: 1,
  createdAt: 1,
};

function clientWith(overrides: Partial<ApiClient>): ApiClient {
  return {
    listPatients: vi.fn(async () => [ana]),
    createPatient: vi.fn(async (f: { name: string }) => ({ ...ana, id: "p2", name: f.name })),
    ...overrides,
  } as unknown as ApiClient;
}

describe("PatientsPage", () => {
  it("lists patients with links to their pages", async () => {
    render(
      <MemoryRouter>
        <PatientsPage client={clientWith({})} />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: /ana reyes/i });
    expect(link).toHaveAttribute("href", "/patients/p1");
  });

  it("adds a patient via the form", async () => {
    const client = clientWith({});
    render(
      <MemoryRouter>
        <PatientsPage client={client} />
      </MemoryRouter>,
    );
    await userEvent.type(await screen.findByLabelText(/new patient name/i), "Ben Cruz");
    await userEvent.click(screen.getByRole("button", { name: /add patient/i }));
    expect(client.createPatient).toHaveBeenCalledWith({ name: "Ben Cruz" });
  });

  it("filters via the search box", async () => {
    const client = clientWith({});
    render(
      <MemoryRouter>
        <PatientsPage client={client} />
      </MemoryRouter>,
    );
    await screen.findByRole("link", { name: /ana reyes/i });
    await userEvent.type(screen.getByLabelText(/search patients/i), "an");
    expect(client.listPatients).toHaveBeenLastCalledWith("an");
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement:**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, UnauthorizedError, type ApiClient, type PatientWire } from "../api/client";

export function PatientsPage({ client = api }: { client?: ApiClient }) {
  const [patients, setPatients] = useState<PatientWire[]>([]);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const navigate = useNavigate();

  const refresh = useCallback(
    async (q: string) => {
      try {
        setPatients(await client.listPatients(q || undefined));
      } catch (err) {
        if (err instanceof UnauthorizedError) navigate("/login");
      }
    },
    [client, navigate],
  );

  useEffect(() => {
    void refresh(query);
  }, [refresh, query]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const p = await client.createPatient({ name: newName.trim() });
    setNewName("");
    navigate(`/patients/${p.id}`);
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-stone-900">Patients</h1>
      <label className="mt-4 block text-sm text-stone-700">
        <span className="sr-only">Search patients</span>
        <input
          aria-label="Search patients"
          placeholder="Search patients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-stone-300 p-3"
        />
      </label>
      <ul className="mt-4 divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
        {patients.map((p) => (
          <li key={p.id}>
            <Link to={`/patients/${p.id}`} className="flex justify-between p-4 hover:bg-stone-50">
              <span className="font-medium text-stone-900">{p.name}</span>
              <span className="text-sm text-stone-400">{p.externalRef ?? ""}</span>
            </Link>
          </li>
        ))}
        {patients.length === 0 && <li className="p-4 text-sm text-stone-500">No patients yet.</li>}
      </ul>
      <form onSubmit={add} className="mt-6 flex gap-2">
        <input
          aria-label="New patient name"
          placeholder="New patient name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 rounded-lg border border-stone-300 p-3"
        />
        <button
          type="submit"
          className="rounded-lg bg-clinical px-5 py-3 text-sm font-semibold text-white"
        >
          Add patient
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Run — PASS. Commit:**

```bash
git add src/features/skin-analysis/pages/PatientsPage.tsx src/features/skin-analysis/pages/PatientsPage.test.tsx
git commit -m "feat: patients list with search and add"
```

---

## Task 4: Trends/deltas (pure) + Patient detail page with history

**Files:**
- Create: `src/features/skin-analysis/ml/trends.ts` (+ test)
- Replace stub: `src/features/skin-analysis/pages/PatientDetailPage.tsx` (+ test)

- [ ] **Step 1: Failing trends test** `src/features/skin-analysis/ml/trends.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dimensionDeltas, trendFor } from "./trends";
import golden from "../../../../server/analysis/fixtures/golden-report.json";
import type { AnalysisReport } from "../api/contract";

const before = golden as unknown as AnalysisReport;
const after: AnalysisReport = structuredClone(before);
after.dimensions.acne.score = 0.2; // improved from 0.45
after.dimensions.oiliness.score = 0.7; // worsened from 0.5

describe("dimensionDeltas", () => {
  it("computes per-dimension deltas (after - before)", () => {
    const deltas = dimensionDeltas(before, after);
    expect(deltas.acne).toBeCloseTo(-0.25, 5);
    expect(deltas.oiliness).toBeCloseTo(0.2, 5);
    expect(deltas.pores).toBeCloseTo(0, 5);
  });
});

describe("trendFor", () => {
  it("classifies deltas into improving/stable/worsening", () => {
    expect(trendFor(-0.25)).toBe("improving");
    expect(trendFor(0.2)).toBe("worsening");
    expect(trendFor(0.03)).toBe("stable");
  });
});
```

- [ ] **Step 2: Run to verify failure; implement** `src/features/skin-analysis/ml/trends.ts`:

```ts
import { DIMENSION_KEYS, type AnalysisReport, type DimensionKey } from "../api/contract";

export type Trend = "improving" | "stable" | "worsening";

const STABLE_BAND = 0.05;

// Positive delta = dimension more pronounced = worse (scores are severity-like).
export function dimensionDeltas(
  before: AnalysisReport,
  after: AnalysisReport,
): Record<DimensionKey, number> {
  const out = {} as Record<DimensionKey, number>;
  for (const key of DIMENSION_KEYS) {
    out[key] = after.dimensions[key].score - before.dimensions[key].score;
  }
  return out;
}

export function trendFor(delta: number): Trend {
  if (delta <= -STABLE_BAND) return "improving";
  if (delta >= STABLE_BAND) return "worsening";
  return "stable";
}
```

- [ ] **Step 3: Failing page test** `PatientDetailPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PatientDetailPage } from "./PatientDetailPage";
import type { ApiClient } from "../api/client";

const patient = {
  id: "p1",
  name: "Ana Reyes",
  externalRef: null,
  notes: "",
  consentVersion: null,
  createdAt: 1,
};
const consented = { ...patient, consentVersion: 1 };
const scans = [
  { id: "s1", patientId: "p1", mode: "face", createdAt: 10, imageWidth: 100, imageHeight: 100, report: null, partial: true, classifierFindings: [], promptVersion: null },
];

function renderPage(client: ApiClient) {
  return render(
    <MemoryRouter initialEntries={["/patients/p1"]}>
      <Routes>
        <Route path="/patients/:id" element={<PatientDetailPage client={client} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PatientDetailPage", () => {
  it("gates scanning behind patient consent and records it", async () => {
    const recordConsent = vi.fn(async () => consented);
    const client = {
      getPatient: vi.fn(async () => patient),
      listScans: vi.fn(async () => []),
      recordConsent,
      scanImageUrl: (id: string) => `/api/scans/${id}/image`,
    } as unknown as ApiClient;
    renderPage(client);
    expect(await screen.findByText(/consent required/i)).toBeInTheDocument();
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: /record consent/i }));
    expect(recordConsent).toHaveBeenCalledWith("p1", 1);
  });

  it("shows the scan history with thumbnails and partial badges", async () => {
    const client = {
      getPatient: vi.fn(async () => consented),
      listScans: vi.fn(async () => scans),
      scanImageUrl: (id: string) => `/api/scans/${id}/image`,
    } as unknown as ApiClient;
    renderPage(client);
    const thumb = await screen.findByRole("img", { name: /scan/i });
    expect(thumb).toHaveAttribute("src", "/api/scans/s1/image");
    expect(screen.getByText(/partial/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new scan/i })).toHaveAttribute(
      "href",
      "/patients/p1/scan",
    );
  });
});
```

- [ ] **Step 4: Run to verify failure; implement** `PatientDetailPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, UnauthorizedError, type ApiClient, type PatientWire, type ScanSummary } from "../api/client";

export const CONSENT_TEXT_VERSION = 1;

export function PatientDetailPage({ client = api }: { client?: ApiClient }) {
  const { id = "" } = useParams();
  const [patient, setPatient] = useState<PatientWire | null>(null);
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      setPatient(await client.getPatient(id));
      setScans(await client.listScans(id));
    } catch (err) {
      if (err instanceof UnauthorizedError) navigate("/login");
    }
  }, [client, id, navigate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!patient) return null;

  const needsConsent =
    patient.consentVersion === null || patient.consentVersion < CONSENT_TEXT_VERSION;

  const recordConsent = async () => {
    const updated = await client.recordConsent(patient.id, CONSENT_TEXT_VERSION);
    setPatient(updated);
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/patients" className="text-sm text-clinical">
        ← Patients
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-stone-900">{patient.name}</h1>
      {patient.externalRef && <p className="text-sm text-stone-500">{patient.externalRef}</p>}

      {needsConsent ? (
        <section className="mt-6 rounded-2xl border border-warm-border bg-warm-surface p-5">
          <h2 className="font-bold text-stone-900">Consent required</h2>
          <ul className="mt-2 space-y-1 text-sm text-stone-600">
            <li>Photos and analysis results are stored in this clinic's local database only.</li>
            <li>Each photo is sent once, securely, to the AI service for analysis and is not retained there.</li>
            <li>The result is not a diagnosis; it supports a professional assessment.</li>
            <li>Records can be deleted at any time on request.</li>
          </ul>
          <button
            onClick={recordConsent}
            className="mt-4 rounded-lg bg-clinical px-5 py-3 text-sm font-semibold text-white"
          >
            Record consent
          </button>
        </section>
      ) : (
        <div className="mt-4 flex gap-3">
          <Link
            to={`/patients/${patient.id}/scan`}
            className="rounded-lg bg-clinical px-5 py-3 text-sm font-semibold text-white"
          >
            New scan
          </Link>
          {scans.length >= 2 && (
            <Link
              to={`/patients/${patient.id}/compare`}
              className="rounded-lg border border-clinical px-5 py-3 text-sm font-semibold text-clinical"
            >
              Compare
            </Link>
          )}
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold text-stone-900">Scan history</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {scans.map((s) => (
            <li key={s.id} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              <img
                src={client.scanImageUrl(s.id)}
                alt={`Scan from ${new Date(s.createdAt).toLocaleDateString()}`}
                className="aspect-square w-full object-cover"
              />
              <div className="p-2 text-xs text-stone-600">
                {new Date(s.createdAt).toLocaleDateString()}
                {s.partial && (
                  <span className="ml-1 rounded bg-amber-50 px-1 font-semibold text-amber-700">
                    partial
                  </span>
                )}
              </div>
            </li>
          ))}
          {scans.length === 0 && (
            <li className="col-span-full text-sm text-stone-500">No scans yet.</li>
          )}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Run — PASS. Commit:**

```bash
git add src/features/skin-analysis/ml/trends.ts src/features/skin-analysis/ml/trends.test.ts src/features/skin-analysis/pages/PatientDetailPage.tsx src/features/skin-analysis/pages/PatientDetailPage.test.tsx
git commit -m "feat: patient detail with consent gate, history thumbnails, trends math"
```

---

## Task 5: Scan page + before/after compare

**Files:**
- Replace stubs: `src/features/skin-analysis/pages/ScanPage.tsx`, `src/features/skin-analysis/pages/ComparePage.tsx` (+ test)
- Delete: `src/features/skin-analysis/SkinAnalysisPage.tsx` (superseded by ScanPage; remove its walk-in TODO)

- [ ] **Step 1: `ScanPage.tsx`** (thin composition — no unit test; behavior lives in CaptureFlow tests):

```tsx
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConsentGate } from "../components/consent/ConsentGate";
import { CaptureFlow } from "../components/capture/CaptureFlow";
import type { CaptureMode } from "../types";

export function ScanPage() {
  const { id = "" } = useParams();
  const [mode, setMode] = useState<CaptureMode>("face");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link to={`/patients/${id}`} className="text-sm text-clinical">
        ← Back to patient
      </Link>
      <h1 className="mt-2 text-center text-2xl font-bold text-stone-900">New scan</h1>
      <div className="mt-6">
        <ConsentGate>
          <div className="flex justify-center gap-2">
            {(["face", "closeup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                  mode === m ? "bg-clinical text-white" : "bg-clinical-soft text-clinical"
                }`}
              >
                {m === "face" ? "Face" : "Body / close-up"}
              </button>
            ))}
          </div>
          <div className="mt-6 flex justify-center">
            <CaptureFlow mode={mode} patientId={id} />
          </div>
        </ConsentGate>
      </div>
    </main>
  );
}
```

Update `src/App.tsx` if it still imports SkinAnalysisPage anywhere (it shouldn't after Task 1). Delete `SkinAnalysisPage.tsx` and remove/update any test referencing it.

- [ ] **Step 2: Failing compare test** `ComparePage.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ComparePage } from "./ComparePage";
import golden from "../../../../server/analysis/fixtures/golden-report.json";
import type { AnalysisReport } from "../api/contract";
import type { ApiClient } from "../api/client";

const before = golden as unknown as AnalysisReport;
const after = structuredClone(before);
after.dimensions.acne.score = 0.2;

const scans = [
  { id: "s1", patientId: "p1", mode: "face", createdAt: 1000, imageWidth: 1, imageHeight: 1, report: before, partial: false, classifierFindings: [], promptVersion: 2 },
  { id: "s2", patientId: "p1", mode: "face", createdAt: 2000, imageWidth: 1, imageHeight: 1, report: after, partial: false, classifierFindings: [], promptVersion: 2 },
];

describe("ComparePage", () => {
  it("shows both images side by side and per-dimension trends", async () => {
    const client = {
      listScans: vi.fn(async () => scans),
      scanImageUrl: (id: string) => `/api/scans/${id}/image`,
    } as unknown as ApiClient;
    render(
      <MemoryRouter initialEntries={["/patients/p1/compare"]}>
        <Routes>
          <Route path="/patients/:id/compare" element={<ComparePage client={client} />} />
        </Routes>
      </MemoryRouter>,
    );
    const imgs = await screen.findAllByRole("img");
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/improving/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify failure; implement** `ComparePage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ApiClient, type ScanSummary } from "../api/client";
import { dimensionDeltas, trendFor } from "../ml/trends";
import { DIMENSION_KEYS } from "../api/contract";

const TREND_ICON = { improving: "▼", stable: "•", worsening: "▲" } as const;
const TREND_CLS = {
  improving: "text-clinical",
  stable: "text-stone-400",
  worsening: "text-amber-600",
} as const;

export function ComparePage({ client = api }: { client?: ApiClient }) {
  const { id = "" } = useParams();
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [beforeId, setBeforeId] = useState<string>("");
  const [afterId, setAfterId] = useState<string>("");

  useEffect(() => {
    void client.listScans(id).then((all) => {
      const full = all.filter((s) => s.report);
      setScans(full);
      if (full.length >= 2) {
        setBeforeId(full[full.length - 1].id); // oldest (list is newest-first)
        setAfterId(full[0].id); // newest
      }
    });
  }, [client, id]);

  const before = scans.find((s) => s.id === beforeId);
  const after = scans.find((s) => s.id === afterId);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link to={`/patients/${id}`} className="text-sm text-clinical">
        ← Back to patient
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-stone-900">Before / after</h1>

      {before && after && before.report && after.report ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4">
            {[before, after].map((s, i) => (
              <figure key={s.id}>
                <img
                  src={client.scanImageUrl(s.id)}
                  alt={`${i === 0 ? "Before" : "After"} scan`}
                  className="w-full rounded-xl border border-stone-200 object-cover"
                />
                <figcaption className="mt-1 text-center text-xs text-stone-500">
                  {i === 0 ? "Before" : "After"} · {new Date(s.createdAt).toLocaleDateString()}
                </figcaption>
              </figure>
            ))}
          </div>

          <table className="mt-6 w-full text-sm">
            <tbody>
              {DIMENSION_KEYS.map((key) => {
                const delta = dimensionDeltas(before.report!, after.report!)[key];
                const trend = trendFor(delta);
                return (
                  <tr key={key} className="border-b border-stone-100">
                    <td className="py-2 font-medium text-stone-800">{key}</td>
                    <td className={`py-2 text-right font-semibold ${TREND_CLS[trend]}`}>
                      {TREND_ICON[trend]} {trend}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <p className="mt-6 text-sm text-stone-500">
          Two completed (non-partial) scans are needed to compare.
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run — PASS. `npm run verify` green (fix any SkinAnalysisPage references). Commit:**

```bash
git add -A src/
git commit -m "feat: scan page with real patient, before/after compare with trends"
```

---

## Task 6: QR remote capture

**Files:**
- Create: `src/features/skin-analysis/qr/poll.ts` (+ test)
- Create: `src/features/skin-analysis/components/capture/RemoteCaptureDialog.tsx` (+ test)
- Replace stub: `src/features/skin-analysis/pages/PhoneCapturePage.tsx` (+ test)
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.tsx` — "Use another device" entry

- [ ] **Step 1: Failing poll test** `src/features/skin-analysis/qr/poll.ts` — test `src/features/skin-analysis/qr/poll.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { pollUntilCapture } from "./poll";

describe("pollUntilCapture", () => {
  it("polls until a capture arrives", async () => {
    const poll = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ image: "abc=", mime: "image/jpeg", mode: "face" });
    const capture = await pollUntilCapture(poll, { intervalMs: 0, timeoutMs: 1000, sleep: async () => {} });
    expect(capture?.image).toBe("abc=");
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("returns null on timeout", async () => {
    let now = 0;
    const capture = await pollUntilCapture(async () => null, {
      intervalMs: 100,
      timeoutMs: 250,
      sleep: async () => {
        now += 100;
      },
      now: () => now,
    });
    expect(capture).toBeNull();
  });
});
```

Implement `poll.ts`:

```ts
export interface RemoteCapture {
  image: string;
  mime: string;
  mode: "face" | "closeup";
}

export interface PollOptions {
  intervalMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function pollUntilCapture(
  poll: () => Promise<RemoteCapture | null>,
  opts: PollOptions,
): Promise<RemoteCapture | null> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const start = now();
  for (;;) {
    const capture = await poll();
    if (capture) return capture;
    if (now() - start >= opts.timeoutMs) return null;
    await sleep(opts.intervalMs);
  }
}
```

- [ ] **Step 2: Failing dialog test** `RemoteCaptureDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RemoteCaptureDialog } from "./RemoteCaptureDialog";
import type { ApiClient } from "../../api/client";

describe("RemoteCaptureDialog", () => {
  it("creates a session, shows the QR link, and delivers the polled capture", async () => {
    const onCapture = vi.fn();
    const client = {
      createCaptureSession: vi.fn(async () => ({ token: "tok123", path: "/capture/tok123" })),
      pollCaptureSession: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ image: "aGk=", mime: "image/jpeg", mode: "face" }),
    } as unknown as ApiClient;
    render(
      <RemoteCaptureDialog client={client} pollIntervalMs={0} onCapture={onCapture} onClose={() => {}} />,
    );
    expect(await screen.findByText(new RegExp(`${location.host}/capture/tok123`))).toBeInTheDocument();
    await waitFor(() => expect(onCapture).toHaveBeenCalled());
    const blob: Blob = onCapture.mock.calls[0][0];
    expect(blob.type).toBe("image/jpeg");
  });
});
```

Implement `RemoteCaptureDialog.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, type ApiClient } from "../../api/client";
import { pollUntilCapture } from "../../qr/poll";

function b64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function RemoteCaptureDialog({
  client = api,
  pollIntervalMs = 2000,
  onCapture,
  onClose,
}: {
  client?: ApiClient;
  pollIntervalMs?: number;
  onCapture: (blob: Blob, mode: "face" | "closeup") => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { token, path } = await client.createCaptureSession();
      const captureUrl = `${location.protocol}//${location.host}${path}`;
      if (cancelled) return;
      setUrl(captureUrl);
      if (canvasRef.current) {
        void QRCode.toCanvas(canvasRef.current, captureUrl, { width: 220 });
      }
      const capture = await pollUntilCapture(() => client.pollCaptureSession(token), {
        intervalMs: pollIntervalMs,
        timeoutMs: 5 * 60 * 1000,
      });
      if (cancelled) return;
      if (!capture) {
        setExpired(true);
        return;
      }
      onCapture(b64ToBlob(capture.image, capture.mime), capture.mode);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, onCapture, pollIntervalMs]);

  return (
    <div
      role="dialog"
      aria-label="Capture with another device"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
        <h2 className="font-bold text-stone-900">Scan with a phone</h2>
        <p className="mt-1 text-sm text-stone-600">
          Scan this QR code with the device's camera app, then take the photo there.
        </p>
        <canvas ref={canvasRef} className="mx-auto mt-4" />
        {url && <p className="mt-2 break-all text-xs text-stone-400">{url}</p>}
        {expired && (
          <p role="alert" className="mt-2 text-sm text-amber-700">
            The code expired — close and try again.
          </p>
        )}
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-stone-300 py-2 text-sm font-medium text-stone-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Failing phone-page test** `PhoneCapturePage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PhoneCapturePage } from "./PhoneCapturePage";

describe("PhoneCapturePage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uploads a chosen photo to the token endpoint and confirms", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(
      <MemoryRouter initialEntries={["/capture/tok123"]}>
        <Routes>
          <Route path="/capture/:token" element={<PhoneCapturePage />} />
        </Routes>
      </MemoryRouter>,
    );
    const file = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText(/upload a photo/i), file);
    expect(await screen.findByText(/sent to the clinic/i)).toBeInTheDocument();
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/capture-sessions/tok123/image");
  });

  it("shows an error when the session is expired", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 410 }));
    render(
      <MemoryRouter initialEntries={["/capture/tok123"]}>
        <Routes>
          <Route path="/capture/:token" element={<PhoneCapturePage />} />
        </Routes>
      </MemoryRouter>,
    );
    const file = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText(/upload a photo/i), file);
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
  });
});
```

Implement `PhoneCapturePage.tsx` (camera + upload, EXIF-stripped, posts to the token endpoint; no login, no patient data):

```tsx
import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { CameraFeed } from "../components/capture/CameraFeed";
import { UploadDropzone } from "../components/capture/UploadDropzone";
import { stripMetadata, canvasCodec } from "../privacy/redact";
import type { CaptureResult } from "../types";

type Status = "capture" | "sending" | "sent" | "expired" | "failed";

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export function PhoneCapturePage() {
  const { token = "" } = useParams();
  const [status, setStatus] = useState<Status>("capture");
  const [cameraDown, setCameraDown] = useState(false);

  const send = useCallback(
    async (blob: Blob) => {
      setStatus("sending");
      try {
        const image = await blobToBase64(blob);
        const res = await fetch(`/api/capture-sessions/${token}/image`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image, mime: "image/jpeg", mode: "face" }),
        });
        if (res.status === 410) setStatus("expired");
        else if (!res.ok) setStatus("failed");
        else setStatus("sent");
      } catch {
        setStatus("failed");
      }
    },
    [token],
  );

  const onCapture = useCallback((r: CaptureResult) => void send(r.blob), [send]);
  const onUpload = useCallback(
    async (file: File) => {
      const clean = await stripMetadata(file, "image/jpeg", canvasCodec);
      void send(clean.blob);
    },
    [send],
  );

  return (
    <main className="mx-auto max-w-md px-4 py-8 text-center">
      <h1 className="text-xl font-bold text-stone-900">Clinic photo capture</h1>
      {status === "capture" && (
        <div className="mt-6 flex flex-col items-center gap-4">
          {!cameraDown && (
            <CameraFeed mode="face" onCapture={onCapture} onUnavailable={() => setCameraDown(true)} />
          )}
          <UploadDropzone onFile={onUpload} />
        </div>
      )}
      {status === "sending" && <p className="mt-6 text-sm text-clinical">Sending…</p>}
      {status === "sent" && (
        <p className="mt-6 text-sm font-semibold text-clinical">
          Photo sent to the clinic — you can close this page.
        </p>
      )}
      {status === "expired" && (
        <p role="alert" className="mt-6 text-sm text-amber-700">
          This capture link has expired — ask the clinic to show a new QR code.
        </p>
      )}
      {status === "failed" && (
        <p role="alert" className="mt-6 text-sm text-red-600">
          Sending failed — check the connection and try again.
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Wire "Use another device" into CaptureFlow.** Add state `const [remoteOpen, setRemoteOpen] = useState(false);`; a link-style button next to the source-switch buttons: `Use another device`; render when open:

```tsx
      {remoteOpen && (
        <RemoteCaptureDialog
          onClose={() => setRemoteOpen(false)}
          onCapture={(blob, remoteMode) => {
            setRemoteOpen(false);
            void process({
              blob,
              mimeType: blob.type,
              mode: remoteMode,
              source: "upload",
              width: 0,
              height: 0,
            });
          }}
        />
      )}
```

(The phone already EXIF-stripped via its own flow; width/height 0 is acceptable — the server re-measures during compression.)

- [ ] **Step 5: Run full suite + verify — green. Commit:**

```bash
git add src/features/skin-analysis/qr src/features/skin-analysis/components/capture/RemoteCaptureDialog.tsx src/features/skin-analysis/components/capture/RemoteCaptureDialog.test.tsx src/features/skin-analysis/pages/PhoneCapturePage.tsx src/features/skin-analysis/pages/PhoneCapturePage.test.tsx src/features/skin-analysis/components/capture/CaptureFlow.tsx
git commit -m "feat: QR remote capture (dialog, polling, phone page)"
```

---

## Task 7: Full stored-report rendering + manual E2E smoke

**Files:**
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.tsx` — pass the full report to ReportView
- Modify: `src/features/skin-analysis/store/scan-machine.ts` (+ test) — carry the report

- [ ] **Step 1: Failing test.** In `scan-machine.test.ts` results describe, extend:

```ts
  it("resultsReady can carry the full analysis report", () => {
    useScanMachine.getState().resultsReady(verdict, "scan-1", { summary: "s" } as never);
    expect(useScanMachine.getState().report).not.toBeNull();
  });
```

- [ ] **Step 2: Implement:** machine gains `report: AnalysisReport | null` (import type from `../api/contract`), `resultsReady(verdict, scanId, report?)` stores `report: report ?? null`; reset clears it. `use-analysis` passes `scan.report`. CaptureFlow's results branch becomes `<ReportView report={machine.report} verdict={machine.verdict} onNewScan={machine.reset} />` (remove the plan-6 TODO comment).

- [ ] **Step 3: Run full suite + `npm run verify` — green. Commit:**

```bash
git add src/features/skin-analysis/store/ src/features/skin-analysis/hooks/use-analysis.ts src/features/skin-analysis/components/capture/CaptureFlow.tsx
git commit -m "feat: full report rendering from live scans"
```

- [ ] **Step 4: Manual E2E smoke (needs the Plan 4 stack: `make up`, `.env` with a real key or expect partial):** login → add patient → record consent → new scan → upload a face photo → loading stages → report with dimensions/facial map → visible in history with thumbnail → second scan → compare shows trends → QR flow from a phone on the LAN (`make lan`) → phone photo lands in the desktop flow. Report results honestly.

---

## Definition of Done

- `npm run verify` fully green.
- Login gates everything; 401s bounce to /login.
- Patients: search/add/open; consent recorded per patient (versioned) before first scan.
- History: thumbnails from stored JPEGs, partial badges, full stored reports renderable.
- Compare: side-by-side images + per-dimension improving/stable/worsening.
- QR: desktop dialog with QR + polling; phone page captures/uploads by token only; capture lands in the desktop flow automatically.
- Deleted: SkinAnalysisPage walk-in placeholder.

## Deferred / follow-ups

- Trend sparklines across >2 scans (compare covers pairwise).
- Re-analyze button UI for partial scans on the patient page.
- LAN HTTPS story for phone cameras (getUserMedia on LAN IPs needs HTTPS on iOS — the upload path works regardless; document in ops).

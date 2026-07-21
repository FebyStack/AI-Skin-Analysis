// @vitest-environment node
import { describe, it, expect } from "vitest";
import { makeTestDeps } from "../../shared/testing";
import { resolveScanPatient, walkInPatient } from "./resolve";
import type { AppDeps } from "../../shared/deps";

describe("resolveScanPatient", () => {
  it("resolves a real patient by id", async () => {
    const deps: AppDeps = makeTestDeps();
    const created = await deps.patients.create({ name: "Maria", externalRef: null, notes: "", consentVersion: null });
    const resolved = await resolveScanPatient(deps, created.id);
    expect(resolved?.id).toBe(created.id);
    expect(resolved?.name).toBe("Maria");
  });

  it("falls back to walk-in when patientId is omitted", async () => {
    const deps: AppDeps = makeTestDeps();
    const resolved = await resolveScanPatient(deps, undefined);
    expect(resolved?.externalRef).toBe("walk-in");
  });

  it("falls back to walk-in for the legacy 'walk-in' sentinel", async () => {
    const deps: AppDeps = makeTestDeps();
    const resolved = await resolveScanPatient(deps, "walk-in");
    expect(resolved?.externalRef).toBe("walk-in");
  });

  it("returns null for an unknown patient id (caller 404s — never silently reassigns)", async () => {
    const deps: AppDeps = makeTestDeps();
    const resolved = await resolveScanPatient(deps, "00000000-0000-0000-0000-000000000000");
    expect(resolved).toBeNull();
  });

  it("walkInPatient is idempotent — same walk-in across calls", async () => {
    const deps: AppDeps = makeTestDeps();
    const a = await walkInPatient(deps);
    const b = await walkInPatient(deps);
    expect(a.id).toBe(b.id);
  });
});

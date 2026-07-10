import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";

export function createPatientRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  router.get("/api/patients", auth, async (req, res) => {
    res.json({ patients: await deps.patients.list(req.query.q as string | undefined) });
  });

  router.post("/api/patients", auth, async (req, res) => {
    const { name, externalRef, notes } = req.body ?? {};
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const patient = await deps.patients.create({
      name: name.trim(),
      externalRef: typeof externalRef === "string" ? externalRef : null,
      notes: typeof notes === "string" ? notes : "",
      consentVersion: null,
    });
    res.status(201).json({ patient });
  });

  router.patch("/api/patients/:id", auth, async (req, res) => {
    const { name, externalRef, notes } = req.body ?? {};
    const patient = await deps.patients.update(req.params.id, {
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof externalRef === "string" ? { externalRef } : {}),
      ...(typeof notes === "string" ? { notes } : {}),
    });
    if (!patient) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ patient });
  });

  router.delete("/api/patients/:id", auth, async (req, res) => {
    const ok = await deps.patients.remove(req.params.id);
    res.status(ok ? 204 : 404).end();
  });

  router.post("/api/patients/:id/consent", auth, async (req, res) => {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1) {
      res.status(400).json({ error: "version required" });
      return;
    }
    const patient = await deps.patients.update(req.params.id, { consentVersion: version });
    if (!patient) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ patient });
  });

  router.get("/api/patients/:id/scans", auth, async (req, res) => {
    let id = req.params.id;
    if (id === "walk-in") {
      const list = await deps.patients.list();
      const patient = list.find((p) => p.externalRef === "walk-in");
      id = patient ? patient.id : id;
    }
    res.json({ scans: await deps.scans.listByPatient(id) });
  });

  return router;
}

import express, { type Express } from "express";
import type { AppDeps } from "../shared/deps";
import { requireSession } from "../middleware/require-session";
import { CaptureSessionStore } from "../modules/capture/store";
import { createAuthRoutes } from "../modules/auth/routes";
import { createPatientRoutes } from "../modules/patients/routes";
import { createAnalysisRoutes } from "../modules/analysis/routes";
import { createLesionRoutes } from "../modules/analysis/lesion-routes";
import { createFaceScanRoutes } from "../modules/analysis/face-routes";
import { createCaptureRoutes } from "../modules/capture/routes";
import { createModelsRoutes } from "../modules/models/routes";

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Serve model weight files uploaded/admin-managed under /models/*
  // Stored on disk at backend/public/models so they are available to the browser
  const modelsDir = require("node:path").resolve(process.cwd(), "backend/public/models");
  app.use('/models', express.static(modelsDir));
  // Ensure directory exists (created at boot by the server process if missing)
  try { require('node:fs').mkdirSync(modelsDir, { recursive: true }); } catch (e) { /* ignore */ }


  const auth = requireSession(deps.sessionSecret, deps.now);
  const captures = new CaptureSessionStore(deps.now);

  app.use(createAuthRoutes(deps));
  app.use(createPatientRoutes(deps, auth));
  app.use(createAnalysisRoutes(deps, auth));
  app.use(createLesionRoutes(deps, auth));
  app.use(createFaceScanRoutes(deps, auth));
  app.use(createCaptureRoutes(captures, auth));
  app.use("/api/models", createModelsRoutes(deps, auth));
  // Upload endpoint for model files (optional in test/lite envs)
  // Use require to avoid top-level await and bundler transform issues in tests
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  try {
    const createModelUploadRouter = require("../modules/models/upload-route").createModelUploadRouter;
    if (createModelUploadRouter) app.use("/api/models", createModelUploadRouter(deps, auth));
  } catch (e) {
    // upload router missing in some lightweight test environments — continue without it
    console.debug('Model upload router not mounted:', e?.message ?? e);
  }

  return app;
}

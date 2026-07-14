import express, { type Express, type RequestHandler } from "express";
import path from "node:path";
import fs from "node:fs";

import type { AppDeps } from "../shared/deps";
import { requireSession } from "../middleware/require-session";
import { requireAdmin } from "../middleware/require-admin";

import { CaptureSessionStore } from "../modules/capture/store";
import { createAuthRoutes } from "../modules/auth/routes";
import { createPatientRoutes } from "../modules/patients/routes";
import { createLesionRoutes } from "../modules/analysis/lesion-routes";
import { createFaceScanRoutes } from "../modules/analysis/face-routes";
import { createCaptureRoutes } from "../modules/capture/routes";
import { createModelsRoutes } from "../modules/models/routes";
import { createModelUploadRouter } from "../modules/models/upload-route";

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Serve model weight files
  const modelsDir = path.resolve(process.cwd(), "backend/public/models");
  fs.mkdirSync(modelsDir, { recursive: true });
  app.use("/models", express.static(modelsDir));

  const auth = requireSession(deps.sessionSecret, deps.now);

  let admin: RequestHandler;

  try {
    admin = requireAdmin(
      deps.settings,
      deps.sessionSecret,
      deps.now,
    );
  } catch (e) {
    console.debug(
      "Admin middleware not available, admin endpoints disabled:",
      errMessage(e),
    );

    admin = (_req, res) => {
      res.status(503).json({
        error: "admin endpoints unavailable",
      });
    };
  }

  const captures = new CaptureSessionStore(deps.now);

  app.use(createAuthRoutes(deps));
  app.use(createPatientRoutes(deps, auth));
  app.use(createLesionRoutes(deps, auth));
  app.use(createFaceScanRoutes(deps, auth));
  app.use(createCaptureRoutes(captures, auth));
  app.use("/api/models", createModelsRoutes(deps, admin));

  try {
    app.use(
      "/api/models",
      createModelUploadRouter(deps, admin),
    );
  } catch (e) {
    console.debug(
      "Model upload router not mounted:",
      errMessage(e),
    );
  }

  return app;
}
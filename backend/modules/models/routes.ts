import { Router, type Request, type Response } from "express";
import type { AppDeps } from "../../shared/deps";
import { ModelsRepository } from "./repository";
import { ModelsService } from "./service";

export function createModelsRoutes(deps: AppDeps): Router {
  const router = Router();

  // Guard: models routes require a database pool
  if (!deps.pool) {
    router.use((_req: Request, res: Response) => {
      res.status(503).json({
        success: false,
        error: "Model registry unavailable (database pool not configured)",
      });
    });
    return router;
  }

  const repository = new ModelsRepository(deps.pool);
  const service = new ModelsService(repository);

  router.get("/manifest", async (req: Request, res: Response) => {
    try {
      const manifest = await service.getManifest();
      res.json({ success: true, data: manifest });
    } catch (error) {
      console.error("Failed to get model manifest:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to get manifest",
      });
    }
  });

  router.get("/:modelId", async (req: Request, res: Response) => {
    try {
      const { modelId } = req.params;
      const model = await repository.getModel(modelId);
      if (!model) {
        return res.status(404).json({ success: false, error: "Model not found" });
      }

      const versions = await repository.getModelVersions(modelId);
      res.json({
        success: true,
        data: {
          id: model.id,
          name: model.name,
          description: model.description,
          type: model.model_type,
          currentVersion: model.current_version,
          versions: versions.map((v) => ({
            id: v.id,
            version: v.version,
            filePath: v.file_path,
            fileSize: v.file_size,
            checksum: v.checksum,
            isStable: v.is_stable,
            isCurrent: v.is_current,
            createdAt: v.created_at,
          })),
          updatedAt: model.updated_at,
        },
      });
    } catch (error) {
      console.error("Failed to get model:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to get model",
      });
    }
  });

  router.get("/:modelId/download/:versionId", async (req: Request, res: Response) => {
    try {
      const { modelId, versionId } = req.params;
      const info = await service.getVersionDownloadInfo(modelId, versionId);
      res.json({ success: true, data: info });
    } catch (error) {
      console.error("Failed to get download info:", error);
      res.status(error instanceof Error && error.message.includes("not found") ? 404 : 500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to get download info",
      });
    }
  });

  router.post("/:modelId/promote/:versionId", async (req: Request, res: Response) => {
    try {
      const { modelId, versionId } = req.params;
      const promoted = await service.promoteVersion(modelId, versionId);
      res.json({
        success: true,
        message: `Promoted ${modelId} to version ${promoted.version}`,
        data: {
          modelId,
          version: promoted.version,
          isCurrent: promoted.is_current,
        },
      });
    } catch (error) {
      console.error("Failed to promote version:", error);
      res.status(error instanceof Error && error.message.includes("not found") ? 404 : 500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to promote version",
      });
    }
  });

  router.post("/:modelId/rollback", async (req: Request, res: Response) => {
    try {
      const { modelId } = req.params;
      const rolled = await service.rollback(modelId);
      if (!rolled) {
        return res.status(400).json({
          success: false,
          error: "No previous stable version available for rollback",
        });
      }

      res.json({
        success: true,
        message: `Rolled back ${modelId} to version ${rolled.version}`,
        data: {
          modelId,
          version: rolled.version,
          isCurrent: rolled.is_current,
        },
      });
    } catch (error) {
      console.error("Failed to rollback:", error);
      res.status(error instanceof Error && error.message.includes("not found") ? 404 : 500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to rollback",
      });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    try {
      const { id, name, type, description } = req.body;
      if (!id || !name || !type) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: id, name, type",
        });
      }

      const model = await service.registerModel(id, name, type as any, description);
      res.status(201).json({
        success: true,
        message: `Registered new model: ${name}`,
        data: model,
      });
    } catch (error) {
      console.error("Failed to register model:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to register model",
      });
    }
  });

  return router;
}

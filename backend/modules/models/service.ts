import { ModelsRepository, type ModelRegistry, type ModelVersion } from "./repository";
import { randomUUID } from "crypto";

export class ModelsService {
  constructor(private repo: ModelsRepository) {}

  /**
   * Get the manifest of all available models with their current versions.
   * Includes all historical versions for rollback purposes.
   */
  async getManifest() {
    const models = await this.repo.getAllModels();
    const manifest = await Promise.all(
      models.map(async (model) => {
        const versions = await this.repo.getModelVersions(model.id);
        return {
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
        };
      })
    );
    return manifest;
  }

  /**
   * Register a new model in the system.
   * This is typically called during deployment when new models become available.
   */
  async registerModel(
    id: string,
    name: string,
    modelType: "landmarker" | "segmentation" | "classifier",
    description?: string
  ): Promise<ModelRegistry> {
    return this.repo.upsertModel({
      id,
      name,
      description,
      model_type: modelType,
      current_version: "1.0.0",
    });
  }

  /**
   * Add a new version to an existing model.
   * Returns the newly added version.
   */
  async addModelVersion(
    modelId: string,
    version: string,
    filePath: string,
    options?: {
      fileSize?: number;
      checksum?: string;
      isStable?: boolean;
      setCurrent?: boolean;
    }
  ): Promise<ModelVersion> {
    // Verify the model exists
    const model = await this.repo.getModel(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    const versionId = randomUUID();
    const newVersion = await this.repo.addVersion({
      id: versionId,
      model_id: modelId,
      version,
      file_path: filePath,
      file_size: options?.fileSize,
      checksum: options?.checksum,
      is_stable: options?.isStable ?? false,
      is_current: options?.setCurrent ?? false,
    });

    // If setCurrent is true, promote this version
    if (options?.setCurrent) {
      await this.repo.promoteVersion(modelId, versionId);
    }

    return newVersion;
  }

  /**
   * Promote a specific version to be the current active version.
   * This is used for gradual rollouts or reverting to a previous version.
   */
  async promoteVersion(modelId: string, versionId: string): Promise<ModelVersion> {
    const model = await this.repo.getModel(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    return this.repo.promoteVersion(modelId, versionId);
  }

  /**
   * Rollback to the previous stable version.
   * Returns the version that was promoted (or null if no previous stable version exists).
   */
  async rollback(modelId: string): Promise<ModelVersion | null> {
    const model = await this.repo.getModel(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    // Get the current version to verify it's different
    const current = await this.repo.getCurrentVersion(modelId);
    if (!current) {
      throw new Error(`No current version found for model ${modelId}`);
    }

    // Find a previous stable version that's not the current one
    const versions = await this.repo.getModelVersions(modelId);
    const previousStable = versions.find(
      (v) => v.is_stable && v.id !== current.id
    );

    if (!previousStable) {
      throw new Error(`No previous stable version found for model ${modelId}`);
    }

    return this.repo.promoteVersion(modelId, previousStable.id);
  }

  /**
   * Mark a version as stable for production use.
   * Stable versions are eligible for rollback.
   */
  async markStable(versionId: string): Promise<ModelVersion> {
    return this.repo.markVersionStable(versionId);
  }

  /**
   * Get the download info for a specific model version.
   * Includes file path, size, and checksum for client-side verification.
   */
  async getVersionDownloadInfo(modelId: string, versionId: string) {
    const model = await this.repo.getModel(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    const versions = await this.repo.getModelVersions(modelId);
    const version = versions.find((v) => v.id === versionId);
    if (!version) {
      throw new Error(`Version ${versionId} not found for model ${modelId}`);
    }

    return {
      modelId,
      versionId,
      version: version.version,
      filePath: version.file_path,
      fileSize: version.file_size,
      checksum: version.checksum,
      isCurrent: version.is_current,
    };
  }
}

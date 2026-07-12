import type { Pool } from "pg";

export interface ModelRegistry {
  id: string;
  name: string;
  description?: string;
  model_type: "landmarker" | "segmentation" | "classifier";
  current_version: string;
  created_at: Date;
  updated_at: Date;
}

export interface ModelVersion {
  id: string;
  model_id: string;
  version: string;
  file_path: string;
  file_size?: number;
  checksum?: string;
  is_stable: boolean;
  is_current: boolean;
  created_at: Date;
}

export class ModelsRepository {
  constructor(private pool: Pool) {}

  // Get all models with their current versions
  async getAllModels(): Promise<ModelRegistry[]> {
    const result = await this.pool.query<ModelRegistry>(
      `SELECT id, name, description, model_type, current_version, created_at, updated_at
       FROM model_registry
       ORDER BY name ASC`
    );
    return result.rows;
  }

  // Get a specific model by ID
  async getModel(modelId: string): Promise<ModelRegistry | null> {
    const result = await this.pool.query<ModelRegistry>(
      `SELECT id, name, description, model_type, current_version, created_at, updated_at
       FROM model_registry
       WHERE id = $1`,
      [modelId]
    );
    return result.rows[0] || null;
  }

  // Get all versions of a model
  async getModelVersions(modelId: string): Promise<ModelVersion[]> {
    const result = await this.pool.query<ModelVersion>(
      `SELECT id, model_id, version, file_path, file_size, checksum, is_stable, is_current, created_at
       FROM model_versions
       WHERE model_id = $1
       ORDER BY created_at DESC`,
      [modelId]
    );
    return result.rows;
  }

  // Get current version of a model
  async getCurrentVersion(modelId: string): Promise<ModelVersion | null> {
    const result = await this.pool.query<ModelVersion>(
      `SELECT id, model_id, version, file_path, file_size, checksum, is_stable, is_current, created_at
       FROM model_versions
       WHERE model_id = $1 AND is_current = true`,
      [modelId]
    );
    return result.rows[0] || null;
  }

  // Create or update a model
  async upsertModel(model: Omit<ModelRegistry, "created_at" | "updated_at">): Promise<ModelRegistry> {
    const result = await this.pool.query<ModelRegistry>(
      `INSERT INTO model_registry (id, name, description, model_type, current_version)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         model_type = EXCLUDED.model_type,
         updated_at = now()
       RETURNING id, name, description, model_type, current_version, created_at, updated_at`,
      [model.id, model.name, model.description, model.model_type, model.current_version]
    );
    return result.rows[0]!;
  }

  // Add a new version to a model
  async addVersion(version: Omit<ModelVersion, "created_at">): Promise<ModelVersion> {
    const result = await this.pool.query<ModelVersion>(
      `INSERT INTO model_versions (id, model_id, version, file_path, file_size, checksum, is_stable, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, model_id, version, file_path, file_size, checksum, is_stable, is_current, created_at`,
      [
        version.id,
        version.model_id,
        version.version,
        version.file_path,
        version.file_size,
        version.checksum,
        version.is_stable,
        version.is_current,
      ]
    );
    return result.rows[0]!;
  }

  // Promote a version to current (rollback support)
  async promoteVersion(modelId: string, versionId: string): Promise<ModelVersion> {
    // Start a transaction
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Clear current flag from all versions of this model
      await client.query(
        `UPDATE model_versions SET is_current = false WHERE model_id = $1`,
        [modelId]
      );

      // Set the new current version
      const result = await client.query<ModelVersion>(
        `UPDATE model_versions SET is_current = true WHERE id = $1
         RETURNING id, model_id, version, file_path, file_size, checksum, is_stable, is_current, created_at`,
        [versionId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Version ${versionId} not found`);
      }

      const promoted = result.rows[0]!;

      // Update the model's current_version field
      await client.query(
        `UPDATE model_registry SET current_version = $1, updated_at = now() WHERE id = $2`,
        [promoted.version, modelId]
      );

      await client.query("COMMIT");
      return promoted;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // Get the previous stable version for rollback
  async getPreviousStableVersion(modelId: string): Promise<ModelVersion | null> {
    const result = await this.pool.query<ModelVersion>(
      `SELECT id, model_id, version, file_path, file_size, checksum, is_stable, is_current, created_at
       FROM model_versions
       WHERE model_id = $1 AND is_stable = true
       ORDER BY created_at DESC
       LIMIT 1`,
      [modelId]
    );
    return result.rows[0] || null;
  }

  // Mark a version as stable
  async markVersionStable(versionId: string): Promise<ModelVersion> {
    const result = await this.pool.query<ModelVersion>(
      `UPDATE model_versions SET is_stable = true WHERE id = $1
       RETURNING id, model_id, version, file_path, file_size, checksum, is_stable, is_current, created_at`,
      [versionId]
    );
    if (result.rows.length === 0) {
      throw new Error(`Version ${versionId} not found`);
    }
    return result.rows[0]!;
  }
}

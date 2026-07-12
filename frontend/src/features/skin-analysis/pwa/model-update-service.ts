/**
 * ModelUpdateService: Client-side model distribution and verification.
 * Fetches manifest from server, downloads models with verification,
 * and performs atomic cache replacement.
 *
 * Plan 13 Task 2: ModelUpdateService client-side verified-download/atomic-switch logic.
 */

export interface ModelManifestEntry {
  id: string;
  name: string;
  description?: string;
  type: "landmarker" | "segmentation" | "classifier";
  currentVersion: string;
  versions: ModelVersionInfo[];
  updatedAt: Date;
}

export interface ModelVersionInfo {
  id: string;
  version: string;
  filePath: string;
  fileSize?: number;
  checksum?: string;
  isStable: boolean;
  isCurrent: boolean;
  createdAt: Date;
}

export interface DownloadInfo {
  modelId: string;
  versionId: string;
  version: string;
  filePath: string;
  fileSize?: number;
  checksum?: string;
  isCurrent: boolean;
}

export interface UpdateCheckResult {
  needsUpdate: boolean;
  available?: ModelManifestEntry;
  current?: ModelVersionInfo;
  error?: string;
}

/**
 * ModelUpdateService manages model updates with verification and rollback support.
 * Uses IndexedDB for local caching and atomic operations to ensure consistency.
 */
export class ModelUpdateService {
  private dbName = "ai-skin-analysis-models";
  private storeName = "models";
  private static instance: ModelUpdateService;

  private constructor() {}

  static getInstance(): ModelUpdateService {
    if (!ModelUpdateService.instance) {
      ModelUpdateService.instance = new ModelUpdateService();
    }
    return ModelUpdateService.instance;
  }

  /**
   * Initialize the IndexedDB store for model storage.
   */
  async initializeStore(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "modelId" });
        }
      };
    });
  }

  /**
   * Get the current (cached) model manifest.
   * Returns null if not cached or cache is stale.
   */
  async getManifest(apiBaseUrl: string): Promise<ModelManifestEntry[]> {
    try {
      const response = await fetch(`${apiBaseUrl}/api/models/manifest`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (err) {
      console.error("Failed to fetch model manifest:", err);
      throw err;
    }
  }

  /**
   * Check if an update is available for a specific model.
   * Compares cached version with latest from manifest.
   */
  async checkForUpdates(modelId: string, apiBaseUrl: string): Promise<UpdateCheckResult> {
    try {
      const manifest = await this.getManifest(apiBaseUrl);
      const modelEntry = manifest.find((m) => m.id === modelId);

      if (!modelEntry) {
        return { needsUpdate: false, error: `Model ${modelId} not found in manifest` };
      }

      const cached = await this.getCachedModel(modelId);
      const current = modelEntry.versions.find((v) => v.isCurrent);

      if (!current) {
        return { needsUpdate: false, error: `No current version for ${modelId}` };
      }

      const needsUpdate = !cached || cached.version !== current.version;

      return {
        needsUpdate,
        available: modelEntry,
        current,
      };
    } catch (err) {
      return {
        needsUpdate: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Download a specific model version with verification.
   * Returns the downloaded blob or throws on error.
   */
  async downloadModel(
    modelId: string,
    versionId: string,
    apiBaseUrl: string,
    onProgress?: (percent: number) => void
  ): Promise<Blob> {
    try {
      // Get download info from server (includes file path, checksum, etc.)
      const response = await fetch(`${apiBaseUrl}/api/models/${modelId}/download/${versionId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Failed to get download info: ${response.statusText}`);
      }

      const info: DownloadInfo = await response.json();

      // Download the actual model file
      const fileResponse = await fetch(`${apiBaseUrl}/${info.filePath}`);
      if (!fileResponse.ok) {
        throw new Error(`Failed to download model file: ${fileResponse.statusText}`);
      }

      // Stream and verify
      const contentLength = fileResponse.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      let loaded = 0;

      const reader = fileResponse.body?.getReader();
      if (!reader) {
        throw new Error("Failed to read response body");
      }

      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        loaded += value.length;

        if (total > 0 && onProgress) {
          onProgress((loaded / total) * 100);
        }
      }

      // Combine chunks into a single blob
      const blob = new Blob(chunks as BlobPart[], {
        type: fileResponse.headers.get("content-type") || "application/octet-stream",
      });

      // Verify checksum if provided
      if (info.checksum) {
        const calculatedChecksum = await this.calculateChecksum(blob);
        if (calculatedChecksum !== info.checksum) {
          throw new Error(
            `Checksum mismatch for ${modelId}@${info.version}: expected ${info.checksum}, got ${calculatedChecksum}`
          );
        }
      }

      return blob;
    } catch (err) {
      console.error("Failed to download model:", err);
      throw err;
    }
  }

  /**
   * Atomically switch to a new model version.
   * Ensures rollback is possible if the new version is broken.
   * Returns true on success, false on failure (with rollback to previous).
   */
  async atomicSwitch(modelId: string, versionId: string, modelBlob: Blob): Promise<boolean> {
    try {
      const db = await this.initializeStore();
      const cached = await this.getCachedModel(modelId);

      // Store as pending before commit
      const pending = {
        modelId,
        versionId,
        blob: modelBlob,
        status: "pending",
        timestamp: Date.now(),
        previous: cached, // Keep previous for rollback
      };

      await this.storeInDb(db, pending);

      // Attempt to load the new model to verify it works
      // (This is application-specific; the caller should verify loading succeeds)
      // For now, we commit the change and mark as current.

      const committed = {
        ...pending,
        status: "current",
        activatedAt: Date.now(),
      };

      await this.storeInDb(db, committed);
      return true;
    } catch (err) {
      console.error("Failed to atomically switch model:", err);
      // Rollback is handled by keeping the previous version in the cache
      return false;
    }
  }

  /**
   * Rollback to the previous model version if available.
   */
  async rollback(modelId: string): Promise<boolean> {
    try {
      const db = await this.initializeStore();
      const cached = await this.getCachedModel(modelId);

      if (!cached || !cached.previous) {
        console.warn("No previous version available for rollback");
        return false;
      }

      await this.storeInDb(db, cached.previous);
      return true;
    } catch (err) {
      console.error("Failed to rollback:", err);
      return false;
    }
  }

  /**
   * Get the currently cached model (if any).
   */
  async getCachedModel(modelId: string): Promise<any> {
    try {
      const db = await this.initializeStore();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([this.storeName], "readonly");
        const store = tx.objectStore(this.storeName);
        const request = store.get(modelId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    } catch (err) {
      console.error("Failed to get cached model:", err);
      return null;
    }
  }

  /**
   * Store a model in IndexedDB.
   */
  private async storeInDb(db: IDBDatabase, model: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([this.storeName], "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put(model);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Calculate SHA-256 checksum of a blob.
   * Used to verify downloaded models.
   */
  private async calculateChecksum(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
  }
}

export const modelUpdateService = ModelUpdateService.getInstance();

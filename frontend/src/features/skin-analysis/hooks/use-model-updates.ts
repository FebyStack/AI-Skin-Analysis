import { useEffect, useState, useCallback } from "react";
import { modelUpdateService } from "../pwa/model-update-service";

export interface ModelUpdateStatus {
  checking: boolean;
  downloading: boolean;
  progress: number;
  needsUpdate: boolean;
  error?: string;
  available?: {
    modelId: string;
    version: string;
  };
}

/**
 * Hook for managing model updates.
 * Checks for updates periodically and provides controls for download/switch.
 */
export function useModelUpdates(apiBaseUrl: string, models: string[] = []) {
  const [status, setStatus] = useState<ModelUpdateStatus>({
    checking: false,
    downloading: false,
    progress: 0,
    needsUpdate: false,
  });

  // Check for updates on mount and periodically thereafter
  useEffect(() => {
    const checkUpdates = async () => {
      setStatus((prev) => ({ ...prev, checking: true }));
      try {
        const updates: string[] = [];
        for (const modelId of models) {
          const result = await modelUpdateService.checkForUpdates(modelId, apiBaseUrl);
          if (result.needsUpdate && result.current) {
            updates.push(modelId);
          }
        }

        setStatus((prev) => ({
          ...prev,
          checking: false,
          needsUpdate: updates.length > 0,
          available: updates.length > 0 ? { modelId: updates[0], version: "" } : undefined,
        }));
      } catch (err) {
        setStatus((prev) => ({
          ...prev,
          checking: false,
          error: err instanceof Error ? err.message : "Failed to check for updates",
        }));
      }
    };

    checkUpdates();

    // Re-check every 24 hours
    const interval = setInterval(checkUpdates, 24 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [apiBaseUrl, models]);

  // Download a specific model update
  const downloadUpdate = useCallback(
    async (modelId: string, versionId: string) => {
      setStatus((prev) => ({ ...prev, downloading: true, progress: 0 }));
      try {
        const blob = await modelUpdateService.downloadModel(
          modelId,
          versionId,
          apiBaseUrl,
          (percent) => {
            setStatus((prev) => ({ ...prev, progress: percent }));
          }
        );

        // Atomically switch to the new version
        const success = await modelUpdateService.atomicSwitch(modelId, versionId, blob);

        if (success) {
          setStatus((prev) => ({
            ...prev,
            downloading: false,
            progress: 100,
            needsUpdate: false,
          }));
          // Page reload to pick up the new model
          window.location.reload();
        } else {
          throw new Error("Failed to activate new model version");
        }
      } catch (err) {
        setStatus((prev) => ({
          ...prev,
          downloading: false,
          progress: 0,
          error: err instanceof Error ? err.message : "Download failed",
        }));
      }
    },
    [apiBaseUrl]
  );

  // Rollback to the previous version
  const performRollback = useCallback(async (modelId: string) => {
    try {
      const success = await modelUpdateService.rollback(modelId);
      if (success) {
        window.location.reload();
      } else {
        setStatus((prev) => ({
          ...prev,
          error: "Failed to rollback model",
        }));
      }
    } catch (err) {
      setStatus((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : "Rollback failed",
      }));
    }
  }, []);

  return {
    status,
    downloadUpdate,
    performRollback,
  };
}

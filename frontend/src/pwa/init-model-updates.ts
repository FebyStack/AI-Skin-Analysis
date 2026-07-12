import { modelUpdateService } from '@/features/skin-analysis/pwa/model-update-service';

// Auto-check and auto-download current model versions in background (production-only)
export async function initModelUpdates(apiBaseUrl: string) {
  try {
    const manifest = await modelUpdateService.getManifest(apiBaseUrl);
    for (const entry of manifest) {
      const modelId = entry.id;
      const current = entry.versions.find((v: any) => v.isCurrent);
      if (!current) continue;
      const cached = await modelUpdateService.getCachedModel(modelId);
      if (!cached || cached.version !== current.version) {
        // download and switch in background (no UI)
        try {
          const blob = await modelUpdateService.downloadModel(modelId, current.id, apiBaseUrl, () => {});
          await modelUpdateService.atomicSwitch(modelId, current.id, blob);
          console.log(`Auto-updated model ${modelId} to ${current.version}`);
        } catch (e) {
          console.warn('Auto model update failed for', modelId, e);
        }
      }
    }
  } catch (err) {
    console.warn('Model update init failed:', err);
  }
}

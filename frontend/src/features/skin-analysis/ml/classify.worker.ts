import { createOnnxInference, type InferenceFn } from "@ai/classifier/classifier";
import { runClassification, type ClassifyRequest } from "@ai/classifier/worker-protocol";
import { modelUpdateService } from "../pwa/model-update-service";

let inferPromise: Promise<InferenceFn> | null = null;

async function createInferWithCache(): Promise<InferenceFn> {
  // Prefer cached classifier model if available in IndexedDB (downloaded via model-update-service)
  try {
    const cached = await modelUpdateService.getCachedModel("skin-classifier");
    if (cached && cached.blob) {
      const objUrl = URL.createObjectURL(cached.blob as Blob);
      try {
        return await createOnnxInference(objUrl);
      } finally {
        // keep object URL alive — do not revoke immediately; runtime may still fetch it
      }
    }
  } catch (e) {
    // ignore cache errors and fall back to network URL
    console.debug("Classifier cache check failed:", e);
  }

  return createOnnxInference();
}

function getInfer(): Promise<InferenceFn> {
  if (!inferPromise) inferPromise = createInferWithCache();
  return inferPromise;
}

self.onmessage = async (e: MessageEvent<ClassifyRequest>) => {
  if (e.data?.type !== "classify") return;
  try {
    const infer = await getInfer();
    const res = await runClassification(e.data, infer);
    self.postMessage(res);
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

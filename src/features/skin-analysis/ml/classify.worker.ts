import { createOnnxInference, type InferenceFn } from "./classifier";
import { runClassification, type ClassifyRequest } from "./worker-protocol";

let inferPromise: Promise<InferenceFn> | null = null;

function getInfer(): Promise<InferenceFn> {
  if (!inferPromise) inferPromise = createOnnxInference();
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

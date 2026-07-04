import { useCallback, useEffect, useRef } from "react";
import type { Finding } from "../types";
import type { ClassifyRequest, ClassifyResponse } from "../ml/worker-protocol";

async function pixelsFromBlob(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { rgba: data, width: bitmap.width, height: bitmap.height };
}

export function useClassifier() {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("../ml/classify.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  return useCallback(async (blob: Blob): Promise<Finding[]> => {
    const worker = workerRef.current;
    if (!worker) throw new Error("Classifier worker not ready");
    const { rgba, width, height } = await pixelsFromBlob(blob);
    const request: ClassifyRequest = { type: "classify", rgba, width, height };
    return new Promise<Finding[]>((resolve, reject) => {
      const onMessage = (e: MessageEvent<ClassifyResponse>) => {
        worker.removeEventListener("message", onMessage);
        if (e.data.type === "result") resolve(e.data.findings);
        else reject(new Error(e.data.message));
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage(request);
    });
  }, []);
}

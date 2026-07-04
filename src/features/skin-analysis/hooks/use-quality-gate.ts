import { useCallback } from "react";
import type { QualityReport } from "../types";
import { assessQuality, meanLuma, estimateSharpness } from "../ml/quality";

export function reportFromPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  regionFound: boolean,
): QualityReport {
  const brightness = meanLuma(rgba);
  const gray: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    gray.push((0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255);
  }
  const sharpness = estimateSharpness(gray, width, height);
  return assessQuality({ brightness, sharpness, regionFound });
}

async function pixelsFromBlob(
  blob: Blob,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
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

// Region detection is deferred to MediaPipe; for the prototype we treat any
// captured frame as region-present (true) and rely on exposure/sharpness gates.
// Swap this for a MediaPipe FaceDetector/ImageSegmenter call in a later pass.
export function useQualityGate() {
  return useCallback(async (blob: Blob): Promise<QualityReport> => {
    const { rgba, width, height } = await pixelsFromBlob(blob);
    return reportFromPixels(rgba, width, height, true);
  }, []);
}

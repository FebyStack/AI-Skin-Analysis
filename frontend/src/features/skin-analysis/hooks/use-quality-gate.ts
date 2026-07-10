import { useCallback } from "react";
import type { QualityReport } from "../types";
import {
  assessQuality,
  estimateGlareRatio,
  estimateSharpness,
  estimateSkinCoverage,
  meanLuma,
  QUALITY_THRESHOLDS,
} from "@ai/shared/quality";

export function reportFromPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  regionFound: boolean,
  sourceWidth = width,
  sourceHeight = height,
): QualityReport {
  const brightness = meanLuma(rgba);
  const gray: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    gray.push((0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255);
  }
  const sharpness = estimateSharpness(gray, width, height);
  const skinCoverage = estimateSkinCoverage(rgba);
  const regionDetected = regionFound && skinCoverage >= QUALITY_THRESHOLDS.minSkinCoverage;
  return assessQuality({
    brightness,
    sharpness,
    regionFound: regionDetected,
    width: sourceWidth,
    height: sourceHeight,
    glareRatio: estimateGlareRatio(rgba),
    skinCoverage,
  });
}

async function pixelsFromBlob(
  blob: Blob,
): Promise<{
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}> {
  const bitmap = await createImageBitmap(blob);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const maxDim = 320;
  let w = sourceWidth;
  let h = sourceHeight;
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  bitmap.close?.();
  return { rgba: data, width: w, height: h, sourceWidth, sourceHeight };
}

// Region detection stays heuristic here; later plans can swap in MediaPipe.
export function useQualityGate() {
  return useCallback(async (blob: Blob): Promise<QualityReport> => {
    const { rgba, width, height, sourceWidth, sourceHeight } = await pixelsFromBlob(blob);
    return reportFromPixels(rgba, width, height, true, sourceWidth, sourceHeight);
  }, []);
}

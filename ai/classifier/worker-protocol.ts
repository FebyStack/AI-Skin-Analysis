import type { Finding } from "../../shared/types";
import type { InferenceFn } from "./classifier";
import { logitsToFindings, CLASSIFIER_THRESHOLD } from "./classifier";

export interface ClassifyRequest {
  type: "classify";
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ClassifyResponse =
  | { type: "result"; findings: Finding[] }
  | { type: "error"; message: string };

export async function runClassification(
  req: ClassifyRequest,
  infer: InferenceFn,
): Promise<ClassifyResponse> {
  try {
    const logits = await infer(req.rgba, req.width, req.height);
    return { type: "result", findings: logitsToFindings(logits, CLASSIFIER_THRESHOLD) };
  } catch (err) {
    return { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

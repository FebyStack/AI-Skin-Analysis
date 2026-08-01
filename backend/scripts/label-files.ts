import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Every `labels*.jsonl` in a staging directory, sorted.
 *
 * Parallel labelling runs shard their output (`labels-aa.jsonl`, …) so
 * concurrent appends cannot interleave. Both the manifest builder and the
 * applier must see all shards: reading only `labels.jsonl` would make the
 * manifest re-stage finished work, and would make the applier silently skip it.
 *
 * Lives in its own module because both callers are scripts that run `main()` at
 * import time — importing one from the other would execute it.
 */
export function labelFiles(outDir: string): string[] {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir)
    .filter((f) => f.startsWith("labels") && f.endsWith(".jsonl"))
    .map((f) => path.join(outDir, f))
    .sort();
}

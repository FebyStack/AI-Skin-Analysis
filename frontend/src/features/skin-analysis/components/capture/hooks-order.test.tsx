import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the hooks rule structurally.
 *
 * GuidedFaceFlow renders five different views from one component with early
 * returns. Hooks placed below those returns run on the capture render and are
 * skipped on every other one, so React throws "Rendered fewer hooks than
 * expected" and unmounts the app — which is what happened the moment a patient
 * finished their fifth capture.
 *
 * A render test cannot reach that path without a camera, so this asserts the
 * shape of the file instead.
 */
const SRC = readFileSync(
  resolve(__dirname, "GuidedFaceFlow.tsx"),
  "utf8",
).split("\n");

/** Line index of the component body, so helper functions above are ignored. */
const bodyStart = SRC.findIndex((l) => l.includes("export function GuidedFaceFlow"));

const HOOK = /(?:^|[\s=({[,])(use[A-Z]\w*)\s*\(/;
/** Top-level `if (...) { return` / `if (...) return` inside the component body. */
const EARLY_RETURN = /^ {2}if \(/;

describe("GuidedFaceFlow hook order", () => {
  it("calls every hook before the first early return", () => {
    let firstReturnLine: number | null = null;
    const offenders: string[] = [];

    for (let i = bodyStart; i < SRC.length; i++) {
      const line = SRC[i];
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;

      if (firstReturnLine === null && EARLY_RETURN.test(line)) {
        // Only counts if this branch actually returns.
        const ahead = SRC.slice(i, i + 4).join(" ");
        if (ahead.includes("return")) firstReturnLine = i;
        continue;
      }
      if (firstReturnLine !== null) {
        const m = line.match(HOOK);
        if (m) offenders.push(`line ${i + 1}: ${m[1]} — ${line.trim().slice(0, 60)}`);
      }
    }

    expect(firstReturnLine, "expected an early return to exist").not.toBeNull();
    expect(offenders, `hooks called after the early return at line ${(firstReturnLine ?? 0) + 1}`).toEqual([]);
  });
});

# Finding Pinpoints — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clinic staff see a circle on every detected acne lesion in each captured photo (with a per-photo count), can tap the real spots on clinic photos, and can measure the detector's accuracy against those taps.

**Architecture:** A one-class YOLO11n detector, trained on box-labelled public acne data, runs on-device (onnxruntime-web) on each captured angle's face crop. Its boxes become `FindingMark`s on the `FaceReport`, normalised to that angle's image. A staff-only overlay draws them; a staff tap-to-mark tool stores ground-truth points per image; an export route plus a Python script score the saved predictions against those points.

**Tech Stack:** TypeScript/React (Vite, vitest, @testing-library/react), Express + Postgres (supertest, in-memory repos), Python 3.12 (ultralytics 8.4.92, onnxruntime, pytest), onnxruntime-web.

**Spec:** `docs/superpowers/specs/2026-09-26-finding-pinpoints-design.md`

## Global Constraints

- Repo root: `~/Developer/Skin analysis`. Python: `.venv.nosync/bin/python`. One JS test file: `npx vitest run <file>`. Full check: `npm run verify`. Python tests: `.venv.nosync/bin/python -m pytest ai/training -q`.
- Face analysis stays on-device (browser). No server-side inference for the face flow.
- Pinpoints are **staff-only**; patients only when `VITE_PINPOINTS_FOR_PATIENTS === "true"` (default off).
- Counts are **per angle**, derived from `marks`; never summed across angles.
- The acne grade is unchanged in Phase 1.
- Detector training data: `walkervs/acne04-detection-v5i-yolov11` (CC0-1.0) and `osmankagankurnaz/acne-dataset-in-yolov8-format` (Apache-2.0) only. Clinic photos never enter detector training in Phase 1. Every photo whose stem or group is in `ai/training/multi/frozen_test.json` is excluded.
- Detector ONNX contract (verified 2026-09-26, ultralytics 8.4.92, `nms=True`): input `images` `[1,3,640,640]` RGB 0..1, letterbox pad grey 114; output `output0` `[1,300,6]`, rows `x1,y1,x2,y2,score,class` in 640-px letterbox space, unused rows zero.
- Shades-of-Grey (p=6) runs on the resized face crop **before** letterbox padding — in training (on whole images) and in the browser.
- Box confidence floor: `VITE_ACNE_BOX_MIN_CONF`, default `0.35`. At most 500 marks per report and 500 points per image.
- `report.marks` present (possibly `[]`) means the detector ran; absent means it did not (no model, no face geometry, or timeout).
- Initial bar for patient display: ≥ 50 marked clinic photos, recall ≥ 0.70, precision ≥ 0.70.
- Fitzpatrick type is not recorded anywhere yet, so the exam reports overall and per device only.
- `*.onnx` and `ai/models/**/*.pt` are gitignored — commit `model.json` files, never weights.
- Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Scope

One vertical slice of the spec: contract → detector → overlay → ground truth → exam. Phase 2 (measurement maps) and Phase 3 (wrinkles/eye bags, pores) get their own plans. Task 3 is a long-running training job; once Task 2 is merged it can run in parallel with Tasks 4–9, which do not need the trained model to pass their tests.

## File Structure

| File | Responsibility |
|---|---|
| `shared/face.ts` (modify) | `FindingMark`, `ManualPoint`, `FaceReport.marks`, validation helpers |
| `ai/training/localize/build_acne_detection.py` (new) | Assemble the one-class YOLO dataset: grouping, exclusion, colour constancy, split manifest |
| `ai/training/localize/train_acne_detector.py` (new) | Train, test-split metrics, ONNX export with NMS, `model.json` |
| `ai/training/localize/eval_marks.py` (new) | Score saved predictions against staff taps |
| `ai/face/analyzers/acne-detector.ts` (new) | Browser detector: letterbox, Shades-of-Grey, tensor, decode, map to frame |
| `frontend/.../capture/face-rect.ts` (new) | `faceRect` (moved from GuidedFaceFlow) + `cropForDetector` |
| `frontend/.../capture/GuidedFaceFlow.tsx` (modify) | Run the detector per angle after refine; show the overlay to staff |
| `frontend/src/features/skin-analysis/hooks/use-camera.ts` (modify) | Face capture at 1920×1080 |
| `frontend/.../results/FindingOverlay.tsx` (new) | Photo + SVG markers, per-kind toggles, per-angle counts |
| `frontend/.../history/FaceHistoryDetail.tsx` (modify) | Overlay in scan history |
| `frontend/.../queue/MarkSpots.tsx` (new) | Tap-to-mark ground truth on one photo |
| `frontend/.../queue/ImageManager.tsx` (modify) | "Mark spots" toggle |
| `backend/modules/analysis/repository.ts` (modify) | `manualMarks`, `setManualMarks`, `listManuallyMarked`; `listImages` reads `capture` + `manual_marks` |
| `backend/modules/analysis/mark-routes.ts` (new) | `PUT …/marks`, `POST /api/localization-exam/export` — clinician only |
| `backend/modules/training/governance-routes.ts` (modify) | Export `datasetsDir` |
| `backend/app/app.ts` (modify) | Mount mark routes behind `clinician` |
| `database/schema/schema.sql` (modify) | `scan_images.manual_marks JSONB` |

`frontend/...` = `frontend/src/features/skin-analysis/components`.

---

### Task 1: Finding-mark contract

**Files:**
- Modify: `shared/face.ts`
- Test: `shared/face.test.ts`, `backend/modules/analysis/face-marks.test.ts` (new)

**Interfaces:**
- Consumes: existing `FACE_ANGLES`, `FaceAngle`, `in01`, `validateFaceReport` in `shared/face.ts`.
- Produces: `MARK_KINDS`; `type MarkKind`; `MAX_MARKS = 500`; `type MarkShape = { type: "box"; x; y; w; h } | { type: "area"; polygon: [number, number][] }`; `interface FindingMark { kind: MarkKind; angle: FaceAngle; shape: MarkShape; confidence: number; source: "model" | "measurement" }`; `interface ManualPoint { kind: MarkKind; x: number; y: number }`; `FaceReport.marks?: FindingMark[]`; `markErrors(marks: unknown): string[]`; `parseManualPoints(raw: unknown): ManualPoint[] | null`.

- [ ] **Step 1: Write the failing unit tests** — in `shared/face.test.ts`, add `markErrors, parseManualPoints, MAX_MARKS, type FindingMark` to the existing `import { … } from "./face";`, then append:

```ts
const box = (over: Partial<FindingMark> = {}): FindingMark => ({
  kind: "acne", angle: "front", shape: { type: "box", x: 0.2, y: 0.3, w: 0.05, h: 0.05 },
  confidence: 0.8, source: "model", ...over,
});

describe("finding marks", () => {
  it("accepts reports without marks, with empty marks, and with valid marks", () => {
    expect(validateFaceReport(goldenFaceReport()).ok).toBe(true);
    expect(validateFaceReport({ ...goldenFaceReport(), marks: [] }).ok).toBe(true);
    expect(validateFaceReport({ ...goldenFaceReport(), marks: [box()] }).ok).toBe(true);
  });
  it("rejects boxes outside the image, unknown kinds and angles, bad confidence", () => {
    expect(markErrors([box({ shape: { type: "box", x: 0.98, y: 0.1, w: 0.05, h: 0.05 } })])).toHaveLength(1);
    expect(markErrors([box({ kind: "freckle" as never })])).toHaveLength(1);
    expect(markErrors([box({ angle: "back" as never })])).toHaveLength(1);
    expect(validateFaceReport({ ...goldenFaceReport(), marks: [box({ confidence: 2 })] }).ok).toBe(false);
  });
  it("caps the number of marks", () => {
    expect(markErrors(Array.from({ length: MAX_MARKS + 1 }, () => box()))).toEqual([`at most ${MAX_MARKS} marks`]);
  });
  it("parses staff points strictly", () => {
    expect(parseManualPoints([{ kind: "acne", x: 0.5, y: 0.5 }])).toEqual([{ kind: "acne", x: 0.5, y: 0.5 }]);
    expect(parseManualPoints([{ kind: "acne", x: 1.5, y: 0.5 }])).toBeNull();
    expect(parseManualPoints("x")).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing route test** — `backend/modules/analysis/face-marks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import { goldenFaceReport } from "../../../shared/testing/face-fixtures";

const acneBox = (x: number) => ({
  kind: "acne", angle: "front", confidence: 0.9, source: "model",
  shape: { type: "box", x, y: 0.1, w: 0.05, h: 0.05 },
});

async function post(marks: unknown[]) {
  const app = createApp(makeTestDeps());
  const cookie = (await request(app).post("/api/auth/login").send({ password: "clinic-pass" })).headers["set-cookie"][0];
  const image = (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } })
    .jpeg().toBuffer()).toString("base64");
  const res = await request(app).post("/api/face-scans").set("Cookie", cookie)
    .send({ report: { ...goldenFaceReport(), marks }, images: [{ angle: "front", image, mime: "image/jpeg" }] });
  return { app, cookie, res };
}

describe("face reports carrying marks", () => {
  it("stores valid marks with the report", async () => {
    const { app, cookie, res } = await post([acneBox(0.3)]);
    expect(res.status).toBe(200);
    const got = await request(app).get(`/api/face-scans/${res.body.scan.id}`).set("Cookie", cookie);
    expect(got.body.scan.report.marks).toEqual([acneBox(0.3)]);
  });
  it("rejects the whole report when a mark is malformed", async () => {
    const { res } = await post([acneBox(0.99)]);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `npx vitest run shared/face.test.ts backend/modules/analysis/face-marks.test.ts`
Expected: FAIL — `markErrors` / `parseManualPoints` not exported; the malformed-mark report is accepted (200 instead of 400).

- [ ] **Step 4: Implement** in `shared/face.ts`.

Directly after the `CaptureInfo` interface, add:

```ts
export const MARK_KINDS = ["acne", "dark-spot", "redness", "shine", "under-eye", "wrinkle", "eye-bag"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export const MAX_MARKS = 500;

/** Position in the captured image of `angle`, normalised to 0..1 (resolution-independent). */
export type MarkShape =
  | { type: "box"; x: number; y: number; w: number; h: number }
  | { type: "area"; polygon: [number, number][] };

/** Where one finding is. Counts are per angle — one lesion shows in several photos. */
export interface FindingMark {
  kind: MarkKind;
  angle: FaceAngle;
  shape: MarkShape;
  confidence: number;                 // 0..1; 1 for measurements
  source: "model" | "measurement";
}

/** A staff-tapped ground-truth point, normalised to the stored image. */
export interface ManualPoint { kind: MarkKind; x: number; y: number }
```

In `interface FaceReport`, after `modelVersions: Record<string, string>;` add:

```ts
  /** Where findings are, per captured angle. Present (maybe empty) only when a locator ran. */
  marks?: FindingMark[];
```

Directly above `export function validateFaceReport` (below `const in01 = …`), add:

```ts
function validBox(s: Record<string, unknown>): boolean {
  const { x, y, w, h } = s;
  return in01(x) && in01(y) && in01(w) && in01(h) && w > 0 && h > 0 && x + w <= 1 + 1e-6 && y + h <= 1 + 1e-6;
}

function validPolygon(p: unknown): boolean {
  return Array.isArray(p) && p.length >= 3
    && p.every((pt) => Array.isArray(pt) && pt.length === 2 && in01(pt[0]) && in01(pt[1]));
}

export function markErrors(marks: unknown): string[] {
  if (!Array.isArray(marks)) return ["marks must be an array"];
  if (marks.length > MAX_MARKS) return [`at most ${MAX_MARKS} marks`];
  const errors: string[] = [];
  marks.forEach((m, i) => {
    const r = (m ?? {}) as Record<string, unknown>;
    const s = (r.shape ?? {}) as Record<string, unknown>;
    const shapeOk = s.type === "box" ? validBox(s) : s.type === "area" ? validPolygon(s.polygon) : false;
    if (!MARK_KINDS.includes(r.kind as MarkKind) || !FACE_ANGLES.includes(r.angle as FaceAngle)
      || !shapeOk || !in01(r.confidence) || (r.source !== "model" && r.source !== "measurement")) {
      errors.push(`mark ${i} malformed`);
    }
  });
  return errors;
}

export function parseManualPoints(raw: unknown): ManualPoint[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_MARKS) return null;
  const out: ManualPoint[] = [];
  for (const p of raw) {
    const r = (p ?? {}) as Record<string, unknown>;
    if (!MARK_KINDS.includes(r.kind as MarkKind) || !in01(r.x) || !in01(r.y)) return null;
    out.push({ kind: r.kind as MarkKind, x: r.x, y: r.y });
  }
  return out;
}
```

In `validateFaceReport`, directly before its final `return`, add:

```ts
  if (r.marks !== undefined) errors.push(...markErrors(r.marks));
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run shared/face.test.ts backend/modules/analysis/face-marks.test.ts`
Expected: PASS (existing face contract tests + 4 new; 2 route tests).

- [ ] **Step 6: Commit**

```bash
git add shared/face.ts shared/face.test.ts backend/modules/analysis/face-marks.test.ts
git commit -m "feat(contract): FindingMark + ManualPoint with strict validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Detection dataset assembly

**Files:**
- Create: `ai/training/localize/__init__.py` (empty)
- Create: `ai/training/localize/build_acne_detection.py`
- Test: `ai/training/tests/test_build_acne_detection.py`

**Interfaces:**
- Consumes: `ai.training.transforms.shades_of_gray(img: np.ndarray) -> np.ndarray`; `ai/training/multi/frozen_test.json` (`{"paths": [...], "groups": [...]}`).
- Produces: CLI `python -m ai.training.localize.build_acne_detection RAW [RAW ...] OUT` → `OUT/{images,labels}/{train,val,test}/`, `OUT/data.yaml` (class `0: acne`), `OUT/split_manifest.json` (`{"sha256": str, "images": [...]}` of the test split). Functions: `source_stem(stem) -> str`, `merge_label_lines(text) -> list[str]`, `split_of(group) -> "train"|"val"|"test"`, `frozen_exclusions(path=None) -> set[str]`, `collect(raw, excluded) -> list[tuple[Path, list[str], str]]`, `split_manifest(out) -> dict`, `main(argv) -> int`.

- [ ] **Step 1: Write the failing tests** — `ai/training/tests/test_build_acne_detection.py`:

```python
import json
from pathlib import Path

from PIL import Image

from ai.training.localize import build_acne_detection as bad


def test_source_stem_strips_roboflow_suffix():
    assert bad.source_stem("levle0_163_jpg.rf.0a1b2c") == "levle0_163"
    assert bad.source_stem("plain_name") == "plain_name"


def test_merge_label_lines_merges_classes_and_polygons():
    lines = bad.merge_label_lines("2 0.5 0.5 0.1 0.2\n0 0.1 0.1 0.3 0.1 0.3 0.3 0.1 0.3\nbad")
    assert lines == ["0 0.500000 0.500000 0.100000 0.200000",
                     "0 0.200000 0.200000 0.200000 0.200000"]


def test_split_is_per_group_and_stable():
    assert bad.split_of("levle0_1") == bad.split_of("levle0_1")
    assert {bad.split_of(f"g{i}") for i in range(200)} == {"train", "val", "test"}


def test_frozen_exclusions_cover_stems_and_groups(tmp_path):
    f = tmp_path / "frozen.json"
    f.write_text(json.dumps({"paths": ["acne/acne04/mild/levle0_9"], "groups": ["e589522b7afbd6719019"]}))
    assert bad.frozen_exclusions(f) == {"levle0_9", "e589522b7afbd6719019"}


def _write(root: Path, split: str, stem: str, label: str) -> None:
    (root / split / "images").mkdir(parents=True, exist_ok=True)
    (root / split / "labels").mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (32, 32), (180, 140, 120)).save(root / split / "images" / f"{stem}.jpg")
    (root / split / "labels" / f"{stem}.txt").write_text(label)


def test_collect_groups_roboflow_copies_and_excludes_frozen(tmp_path):
    _write(tmp_path, "train", "levle0_1_jpg.rf.aa", "0 0.5 0.5 0.1 0.1")
    _write(tmp_path, "valid", "levle0_1_jpg.rf.bb", "0 0.5 0.5 0.1 0.1")
    _write(tmp_path, "train", "levle0_2_jpg.rf.cc", "0 0.5 0.5 0.1 0.1")
    rows = bad.collect(tmp_path, excluded={"levle0_2"})
    assert sorted(group for _, _, group in rows) == ["levle0_1", "levle0_1"]


def test_main_writes_one_class_tree_and_a_split_manifest(tmp_path, monkeypatch):
    raw, out = tmp_path / "raw", tmp_path / "out"
    for i in range(30):
        _write(raw, "train", f"p{i}_jpg.rf.aa", "3 0.5 0.5 0.2 0.2")
    monkeypatch.setattr(bad, "FROZEN", tmp_path / "missing.json")
    assert bad.main([str(raw), str(out)]) == 0
    labels = list((out / "labels").rglob("*.txt"))
    assert len(labels) == 30 and all(p.read_text().startswith("0 ") for p in labels)
    assert "names:\n  0: acne" in (out / "data.yaml").read_text()
    manifest = json.loads((out / "split_manifest.json").read_text())
    assert len(manifest["sha256"]) == 64
    assert manifest["images"] == sorted(p.name for p in (out / "images" / "test").glob("*.jpg"))
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv.nosync/bin/python -m pytest ai/training/tests/test_build_acne_detection.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'ai.training.localize'`.

- [ ] **Step 3: Implement** — create empty `ai/training/localize/__init__.py`, then `ai/training/localize/build_acne_detection.py`:

```python
"""Assemble the one-class acne-lesion detection dataset (YOLO format) from public sources.

    .venv.nosync/bin/python -m ai.training.localize.build_acne_detection RAW [RAW ...] OUT

Sources are Roboflow YOLO exports: any `<split>/images` dir with a sibling `labels` dir.
- Every lesion subclass becomes class 0 "acne"; polygon labels become their bounding box.
- Roboflow copies of one photo share a source stem and stay on one side of the split —
  `subject_group` does not group `levle0_163_jpg.rf.<hash>` names, so `source_stem` does.
- Photos in the classification frozen exam (by stem or group) are excluded.
- Shades-of-Grey is applied here, so training sees what the browser feeds the detector.
- The test split is recorded by hash (split_manifest.json), like build_master's frozen test set.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from ai.training.transforms import shades_of_gray

FROZEN = Path("ai/training/multi/frozen_test.json")
EXTS = {".jpg", ".jpeg", ".png"}
_ROBOFLOW = re.compile(r"_(jpg|jpeg|png)\.rf\.[0-9a-f]+$", re.I)


def source_stem(stem: str) -> str:
    """'levle0_163_jpg.rf.ab12' -> 'levle0_163': every Roboflow copy of one photo maps here."""
    return _ROBOFLOW.sub("", stem)


def merge_label_lines(text: str) -> list[str]:
    """YOLO lines of any class (box or polygon) -> '0 cx cy w h' lines."""
    out = []
    for line in text.splitlines():
        v = line.split()
        if len(v) < 5:
            continue
        nums = [float(n) for n in v[1:]]
        if len(nums) == 4:
            cx, cy, w, h = nums
        else:
            xs, ys = nums[0::2], nums[1::2]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            w, h = max(xs) - min(xs), max(ys) - min(ys)
        if w > 0 and h > 0:
            out.append(f"0 {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    return out


def split_of(group: str) -> str:
    """Deterministic, group-level 70/15/15 split."""
    bucket = int(hashlib.sha256(group.encode()).hexdigest(), 16) % 100
    return "train" if bucket < 70 else "val" if bucket < 85 else "test"


def frozen_exclusions(path: Path | None = None) -> set[str]:
    """Stems and groups of the classification frozen exam."""
    path = path or FROZEN
    if not path.exists():
        return set()
    frozen = json.loads(path.read_text())
    return {Path(p).name for p in frozen["paths"]} | set(frozen.get("groups", []))


def collect(raw: Path, excluded: set[str]) -> list[tuple[Path, list[str], str]]:
    """(image, merged label lines, group) for every labelled image under `raw`."""
    rows = []
    for images in sorted(raw.rglob("images")):
        labels = images.parent / "labels"
        if not labels.is_dir():
            continue
        for img in sorted(images.iterdir()):
            if img.suffix.lower() not in EXTS or img.name.startswith("."):
                continue
            label = labels / f"{img.stem}.txt"
            group = source_stem(img.stem)
            if not label.exists() or group in excluded:
                continue
            rows.append((img, merge_label_lines(label.read_text()), group))
    return rows


def split_manifest(out: Path) -> dict:
    names = sorted(p.name for p in (out / "images" / "test").glob("*.jpg"))
    return {"sha256": hashlib.sha256("\n".join(names).encode()).hexdigest(), "images": names}


def main(argv: list[str]) -> int:
    *raws, out = [Path(a) for a in argv]
    excluded = frozen_exclusions()
    counts = {"train": 0, "val": 0, "test": 0}
    for k, raw in enumerate(raws):
        for img, lines, group in collect(raw, excluded):
            split = split_of(group)
            name = f"{k}_{img.stem}"  # sources may reuse stems
            dst = out / "images" / split / f"{name}.jpg"
            dst.parent.mkdir(parents=True, exist_ok=True)
            rgb = np.asarray(Image.open(img).convert("RGB"))
            Image.fromarray(shades_of_gray(rgb)).save(dst, "JPEG", quality=95)
            lab = out / "labels" / split / f"{name}.txt"
            lab.parent.mkdir(parents=True, exist_ok=True)
            lab.write_text("\n".join(lines) + ("\n" if lines else ""))  # empty = no lesions (a true negative)
            counts[split] += 1
    (out / "data.yaml").write_text(
        f"path: {out.resolve()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: acne\n")
    manifest = split_manifest(out)
    (out / "split_manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"{sum(counts.values())} images -> {out}  {counts}  test sha256={manifest['sha256'][:12]}  "
          f"(frozen-exam exclusions: {len(excluded)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv.nosync/bin/python -m pytest ai/training/tests/test_build_acne_detection.py -q`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add ai/training/localize/__init__.py ai/training/localize/build_acne_detection.py ai/training/tests/test_build_acne_detection.py
git commit -m "feat(localize): assemble one-class acne detection dataset with hashed test split

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Train and ship the acne detector

**Files:**
- Create: `ai/training/localize/train_acne_detector.py`
- Test: `ai/training/tests/test_train_acne_detector.py`
- Artifacts: `ai/models/acne-detector/candidate/{best.pt,model.onnx,model.json}`, `frontend/public/models/acne-detector/{model.onnx,model.json}`

**Interfaces:**
- Consumes: Task 2 CLI and `OUT/data.yaml`.
- Produces: `/models/acne-detector/model.onnx` matching the Global Constraints ONNX contract; `model_json(version: str, metrics: dict[str, float]) -> dict`.

- [ ] **Step 1: Write the failing test** — `ai/training/tests/test_train_acne_detector.py`:

```python
from ai.training.localize.train_acne_detector import model_json


def test_model_json_records_contract_and_metrics():
    j = model_json("v1", {"test_map50": 0.61234, "test_recall": 0.5})
    assert j["preprocess"] == {"color_constancy": True, "letterbox_pad": 114}
    assert j["output"] == {"name": "output0", "rows": "x1,y1,x2,y2,score,class", "nms": True}
    assert j["metrics"] == {"test_map50": 0.6123, "test_recall": 0.5}
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv.nosync/bin/python -m pytest ai/training/tests/test_train_acne_detector.py -q`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Implement** `ai/training/localize/train_acne_detector.py`:

```python
"""Train the one-class acne-lesion detector and export it for the browser.

    .venv.nosync/bin/python -m ai.training.localize.train_acne_detector DATA_YAML [--epochs 60]

Output: ai/models/acne-detector/candidate/{best.pt, model.onnx, model.json}.
ONNX contract (verified 2026-09-26, ultralytics 8.4.92, nms=True): input `images` [1,3,640,640]
RGB 0..1 letterboxed with grey 114; output `output0` [1,300,6] rows x1,y1,x2,y2,score,class in
640-px letterbox space, unused rows zero. The browser applies the confidence floor.
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

OUT = Path("ai/models/acne-detector/candidate")
BASE = Path("ai/models/detector/yolo11n.pt")


def model_json(version: str, metrics: dict[str, float]) -> dict:
    return {
        "name": "yolo11n-acne", "version": version, "classes": ["acne"], "img_size": 640,
        "preprocess": {"color_constancy": True, "letterbox_pad": 114},
        "output": {"name": "output0", "rows": "x1,y1,x2,y2,score,class", "nms": True},
        "metrics": {k: round(float(v), 4) for k, v in metrics.items()},
    }


def main(argv: list[str] | None = None) -> int:
    from ultralytics import YOLO  # heavy import kept out of the unit tests

    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("--epochs", type=int, default=60)
    args = ap.parse_args(argv)
    version = f"acne-det-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"

    model = YOLO(str(BASE))
    # Mild colour augmentation only: redness is part of the signal (see ai/training/transforms.py).
    model.train(data=args.data, imgsz=640, epochs=args.epochs, patience=15, batch=16, device="mps",
                hsv_h=0.0, hsv_s=0.3, hsv_v=0.3, project="ai/models/acne-detector/runs", name=version)
    weights = Path(model.trainer.save_dir) / "weights" / "best.pt"
    best = YOLO(str(weights))
    m = best.val(data=args.data, split="test", imgsz=640, verbose=False)
    metrics = {"test_map50": m.box.map50, "test_precision": m.box.mp, "test_recall": m.box.mr}

    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copy(weights, OUT / "best.pt")
    onnx = best.export(format="onnx", imgsz=640, nms=True, conf=0.10, simplify=True)
    shutil.move(onnx, OUT / "model.onnx")
    (OUT / "model.json").write_text(json.dumps(model_json(version, metrics), indent=2))
    print(f"{version}: {metrics} -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the unit test**

Run: `.venv.nosync/bin/python -m pytest ai/training/tests/test_train_acne_detector.py -q`
Expected: `1 passed`.

- [ ] **Step 5: Download the two licensed datasets to the SSD** (per `ai/datasets/README.md`, never Kaggle's `--unzip`):

```bash
K=.venv.nosync/bin/kaggle; R=/Volumes/PortableSSD/Bong/skin-datasets/raw
for spec in "walkervs/acne04-detection-v5i-yolov11|CC0-1.0 (ACNE04 origin: research release)" \
            "osmankagankurnaz/acne-dataset-in-yolov8-format|Apache-2.0"; do
  d=${spec%%|*}; lic=${spec#*|}; o="$R/kaggle_$(echo "$d" | tr / _)"; mkdir -p "$o"
  $K datasets download -d "$d" -p "$o" --force && unzip -q -o "$o"/*.zip -d "$o/files" && rm -f "$o"/*.zip
  printf 'source: https://www.kaggle.com/datasets/%s\nlicense: %s\ndownloaded: %s\n' "$d" "$lic" "$(date +%F)" > "$o/LICENSE_NOTE.txt"
done
dot_clean -m "$R"
find "$R"/kaggle_walkervs_acne04-detection-v5i-yolov11/files "$R"/kaggle_osmankagankurnaz_acne-dataset-in-yolov8-format/files -type d -name labels
```

Expected: at least one `labels` directory printed per dataset.

- [ ] **Step 6: Assemble locally** (the repo is off iCloud; local disk avoids USB drop-outs during training):

```bash
R=/Volumes/PortableSSD/Bong/skin-datasets/raw
.venv.nosync/bin/python -m ai.training.localize.build_acne_detection \
  "$R/kaggle_walkervs_acne04-detection-v5i-yolov11/files" \
  "$R/kaggle_osmankagankurnaz_acne-dataset-in-yolov8-format/files" \
  ai/datasets/localization/acne-det
```

Expected: `N images -> ai/datasets/localization/acne-det  {'train': …, 'val': …, 'test': …}  test sha256=…` with all three splits non-zero and a non-zero exclusion count.

- [ ] **Step 7: Train (1–3 h on the M4; keep the lid open and the charger in)**

```bash
nohup caffeinate -ims .venv.nosync/bin/python -u -m ai.training.localize.train_acne_detector \
  ai/datasets/localization/acne-det/data.yaml --epochs 60 > /tmp/acne-det-train.log 2>&1 &
```

Check with `tail -3 /tmp/acne-det-train.log`. Expected final line: `acne-det-…: {'test_map50': …, 'test_precision': …, 'test_recall': …} -> ai/models/acne-detector/candidate`. Record the numbers; there is no pass bar here — the clinic exam (Task 9) is the bar.

- [ ] **Step 8: Verify the exported contract**

```bash
.venv.nosync/bin/python -c "import onnxruntime as o; s=o.InferenceSession('ai/models/acne-detector/candidate/model.onnx'); i,t=s.get_inputs()[0],s.get_outputs()[0]; print(i.name,i.shape,t.name,t.shape)"
```

Expected: `images [1, 3, 640, 640] output0 [1, 300, 6]`.

- [ ] **Step 9: Ship the model file to the app** (staff-visible only; patients stay off by default):

```bash
mkdir -p frontend/public/models/acne-detector
cp ai/models/acne-detector/candidate/model.onnx ai/models/acne-detector/candidate/model.json frontend/public/models/acne-detector/
git check-ignore -q frontend/public/models/acne-detector/model.onnx && echo "model.onnx is gitignored (expected)"
```

- [ ] **Step 10: Commit** (scripts, test, metadata — never weights):

```bash
git add ai/training/localize/train_acne_detector.py ai/training/tests/test_train_acne_detector.py \
        ai/models/acne-detector/candidate/model.json frontend/public/models/acne-detector/model.json
git commit -m "feat(localize): train + export one-class acne detector (ONNX with NMS)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Browser detector core

**Files:**
- Create: `ai/face/analyzers/acne-detector.ts`
- Test: `ai/face/analyzers/acne-detector.test.ts`

**Interfaces:**
- Consumes: `FindingMark`, `FaceAngle` (Task 1); `configureOrt`, `pickExecutionProviders` from `ai/classifier/classifier.ts`; `Pixels` from `ai/face/types.ts`.
- Produces: `interface DetectorInput { angle: FaceAngle; crop: Pixels; rect: { x: number; y: number; w: number; h: number }; frame: { w: number; h: number } }`; `interface Letterbox { scale: number; padX: number; padY: number }`; `letterbox(w: number, h: number): Letterbox`; `shadesOfGrey(px: Pixels, p?: number): void`; `toTensorData(crop: Pixels, lb: Letterbox): Float32Array`; `rowsToMarks(rows: Float32Array, input: DetectorInput, lb: Letterbox, minConf?: number): FindingMark[]`; `ensureAcneDetector()`; `detectAcne(inputs: DetectorInput[]): Promise<FindingMark[] | null>` (`null` = no detector); `DETECTOR_VERSION = "yolo11n-acne"`.

- [ ] **Step 1: Write the failing tests** — `ai/face/analyzers/acne-detector.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { letterbox, shadesOfGrey, toTensorData, rowsToMarks, detectAcne, type DetectorInput } from "./acne-detector";

const tiny = { data: new Uint8ClampedArray(4), width: 1, height: 1 };

describe("detectAcne without a shipped model", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns null (detector absent) rather than an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await detectAcne([])).toBeNull();
  });
});

describe("acne detector geometry", () => {
  it("letterboxes like ultralytics", () => {
    expect(letterbox(400, 500)).toEqual({ scale: 1.28, padX: 64, padY: 0 });
  });

  it("maps a 640-space box back to normalised full-frame coordinates", () => {
    const input: DetectorInput = { angle: "front", crop: tiny, rect: { x: 100, y: 50, w: 400, h: 500 }, frame: { w: 1280, h: 720 } };
    const [m] = rowsToMarks(new Float32Array([192, 64, 320, 192, 0.9, 0, 0, 0, 0, 0, 0, 0]), input, letterbox(400, 500), 0.35);
    const b = m.shape as { x: number; y: number; w: number; h: number };
    expect(m).toMatchObject({ kind: "acne", angle: "front", source: "model" });
    expect(b.x).toBeCloseTo(200 / 1280);
    expect(b.y).toBeCloseTo(100 / 720);
    expect(b.w).toBeCloseTo(100 / 1280);
    expect(b.h).toBeCloseTo(100 / 720);
  });

  it("drops zero-padded rows and low scores", () => {
    const input: DetectorInput = { angle: "front", crop: tiny, rect: { x: 0, y: 0, w: 640, h: 640 }, frame: { w: 640, h: 640 } };
    expect(rowsToMarks(new Float32Array([10, 10, 20, 20, 0.2, 0, 0, 0, 0, 0, 0, 0]), input, letterbox(640, 640), 0.35)).toEqual([]);
  });

  it("pads with ultralytics grey outside the crop", () => {
    const t = toTensorData({ data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 }, { scale: 1, padX: 0, padY: 0 });
    expect(t[0]).toBe(1);
    expect(t[1]).toBeCloseTo(114 / 255);
  });
});

describe("Shades-of-Grey parity with ai/training/transforms.py", () => {
  it("matches the Python fixture within one level", () => {
    // shades_of_gray() output for this 2x3 RGB image, generated 2026-09-26.
    const input = [[200, 150, 100], [180, 140, 90], [220, 170, 120], [90, 70, 50], [250, 200, 150], [120, 100, 70]];
    const expected = [[161, 153, 140], [144, 143, 126], [177, 174, 168], [72, 71, 70], [201, 204, 211], [96, 102, 98]];
    const px = { data: new Uint8ClampedArray(input.flatMap((p) => [...p, 255])), width: 3, height: 2 };
    shadesOfGrey(px);
    input.forEach((_, i) => {
      for (let c = 0; c < 3; c++) expect(Math.abs(px.data[i * 4 + c] - expected[i][c])).toBeLessThanOrEqual(1);
    });
  });

  it("leaves a grey image unchanged", () => {
    const px = { data: new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]), width: 2, height: 1 };
    shadesOfGrey(px);
    expect(Array.from(px.data)).toEqual([128, 128, 128, 255, 128, 128, 128, 255]);
  });
});
```

(The null test is first on purpose: `ensureAcneDetector` caches its result for the module's lifetime.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run ai/face/analyzers/acne-detector.test.ts`
Expected: FAIL — cannot resolve `./acne-detector`.

- [ ] **Step 3: Implement** `ai/face/analyzers/acne-detector.ts`:

```ts
// Acne-lesion detector (YOLO11n, one class) — pinpoints for the staff overlay.
// ONNX contract (verified 2026-09-26, ultralytics 8.4.92, nms=True): input `images`
// [1,3,640,640] RGB 0..1 letterboxed with grey 114; output `output0` [1,300,6] rows
// x1,y1,x2,y2,score,class in 640-px letterbox space; unused rows are zero.
// No shipped model → detectAcne returns null and the report carries no `marks`.
import { pickExecutionProviders, configureOrt } from "../../classifier/classifier";
import type { FaceAngle, FindingMark } from "../../../shared/face";
import type { Pixels } from "../types";

export const DETECTOR_URL =
  import.meta.env?.VITE_ACNE_DETECTOR_URL ?? "/models/acne-detector/model.onnx";
export const DETECTOR_VERSION = "yolo11n-acne";
const SIZE = 640;
const PAD = 114;
const MIN_CONF = Number(import.meta.env?.VITE_ACNE_BOX_MIN_CONF ?? "0.35");

/** The face region of one captured frame, resized so its longer side is 640. */
export interface DetectorInput {
  angle: FaceAngle;
  crop: Pixels;                                         // RGBA
  rect: { x: number; y: number; w: number; h: number }; // face rect in full-frame pixels
  frame: { w: number; h: number };                      // full captured frame size
}

export interface Letterbox { scale: number; padX: number; padY: number }

/** Scale that fits a w×h rect into 640, and the centring padding (as ultralytics does). */
export function letterbox(w: number, h: number): Letterbox {
  const scale = SIZE / Math.max(w, h);
  return {
    scale,
    padX: Math.floor((SIZE - Math.round(w * scale)) / 2),
    padY: Math.floor((SIZE - Math.round(h * scale)) / 2),
  };
}

/** Shades-of-Grey (p=6), in place on RGBA — mirrors ai/training/transforms.py shades_of_gray. */
export function shadesOfGrey(px: Pixels, p = 6): void {
  const d = px.data;
  const n = px.width * px.height;
  const acc = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) acc[c] += Math.pow(d[i * 4 + c], p);
  const illum = acc.map((a) => Math.pow(a / n, 1 / p));
  const norm = Math.hypot(illum[0], illum[1], illum[2]) + 1e-6;
  const k = illum.map((v) => (v / norm) * Math.sqrt(3));
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.min(255, Math.floor(d[i * 4 + c] / k[c]));
  }
}

/** RGBA crop → NCHW float32 640×640, crop placed at the letterbox offset on grey 114. */
export function toTensorData(crop: Pixels, lb: Letterbox): Float32Array {
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane).fill(PAD / 255);
  for (let y = 0; y < crop.height && y + lb.padY < SIZE; y++) {
    for (let x = 0; x < crop.width && x + lb.padX < SIZE; x++) {
      const s = (y * crop.width + x) * 4;
      const t = (y + lb.padY) * SIZE + (x + lb.padX);
      out[t] = crop.data[s] / 255;
      out[plane + t] = crop.data[s + 1] / 255;
      out[2 * plane + t] = crop.data[s + 2] / 255;
    }
  }
  return out;
}

/** Detector rows → acne marks in normalised full-frame coordinates (score ≥ minConf). */
export function rowsToMarks(rows: Float32Array, input: DetectorInput, lb: Letterbox, minConf = MIN_CONF): FindingMark[] {
  const toFrame = (v: number, pad: number, offset: number) => (v - pad) / lb.scale + offset;
  const marks: FindingMark[] = [];
  for (let i = 0; i + 5 < rows.length; i += 6) {
    const score = rows[i + 4];
    if (!(score >= minConf)) continue;
    const x1 = Math.max(0, toFrame(rows[i], lb.padX, input.rect.x));
    const y1 = Math.max(0, toFrame(rows[i + 1], lb.padY, input.rect.y));
    const x2 = Math.min(input.frame.w, toFrame(rows[i + 2], lb.padX, input.rect.x));
    const y2 = Math.min(input.frame.h, toFrame(rows[i + 3], lb.padY, input.rect.y));
    if (x2 <= x1 || y2 <= y1) continue;
    marks.push({
      kind: "acne", angle: input.angle, source: "model", confidence: Math.min(1, score),
      shape: {
        type: "box",
        x: x1 / input.frame.w, y: y1 / input.frame.h,
        w: (x2 - x1) / input.frame.w, h: (y2 - y1) / input.frame.h,
      },
    });
  }
  return marks;
}

type OrtSession = import("onnxruntime-web").InferenceSession;
let sessionPromise: Promise<OrtSession | null> | null = null;

export function ensureAcneDetector(): Promise<OrtSession | null> {
  sessionPromise ??= (async () => {
    try {
      const probe = await fetch(DETECTOR_URL, { method: "HEAD" });
      if (!probe.ok || (probe.headers.get("content-type") ?? "").includes("text/html")) return null;
      const ort = await import("onnxruntime-web");
      configureOrt(ort);
      return await ort.InferenceSession.create(DETECTOR_URL, {
        executionProviders: pickExecutionProviders(typeof navigator !== "undefined" && "gpu" in navigator),
        logSeverityLevel: 3,
      });
    } catch {
      return null; // not shipped yet, or unreadable
    }
  })();
  return sessionPromise;
}

/** Acne marks for the inputs, one view at a time (iOS memory). Null = no detector. Never throws. */
export async function detectAcne(inputs: DetectorInput[]): Promise<FindingMark[] | null> {
  const session = await ensureAcneDetector();
  if (!session) return null;
  const ort = await import("onnxruntime-web");
  const marks: FindingMark[] = [];
  for (const input of inputs) {
    try {
      shadesOfGrey(input.crop); // before padding, as in training
      const lb = letterbox(input.rect.w, input.rect.h);
      const tensor = new ort.Tensor("float32", toTensorData(input.crop, lb), [1, 3, SIZE, SIZE]);
      const out = await session.run({ [session.inputNames[0]]: tensor });
      marks.push(...rowsToMarks(out[session.outputNames[0]].data as Float32Array, input, lb));
    } catch {
      /* skip this view */
    }
  }
  return marks;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run ai/face/analyzers/acne-detector.test.ts`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add ai/face/analyzers/acne-detector.ts ai/face/analyzers/acne-detector.test.ts
git commit -m "feat(face): on-device acne detector — letterbox, Shades-of-Grey parity, box mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Capture integration and 1080p

**Files:**
- Create: `frontend/src/features/skin-analysis/components/capture/face-rect.ts`
- Test: `frontend/src/features/skin-analysis/components/capture/face-rect.test.ts`
- Modify: `frontend/src/features/skin-analysis/components/capture/GuidedFaceFlow.tsx`
- Modify: `frontend/src/features/skin-analysis/hooks/use-camera.ts`
- Test: `frontend/src/features/skin-analysis/hooks/use-camera.test.ts`

**Interfaces:**
- Consumes: `DetectorInput`, `detectAcne`, `DETECTOR_VERSION` (Task 4); `FindingMark` (Task 1).
- Produces: `interface Rect { x; y; w; h }`; `faceRect(g: FaceGeometry, w: number, h: number): Rect`; `cropForDetector(blob: Blob, geometry: FaceGeometry | null, angle: FaceAngle): Promise<DetectorInput | null>`. Saved face reports carry `marks` (possibly `[]`) and `modelVersions.acneMarks` whenever the detector examined at least one angle.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/skin-analysis/components/capture/face-rect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { faceRect } from "./face-rect";

describe("faceRect", () => {
  it("adds a 15% margin around the landmarks and clamps to the frame", () => {
    const g = { landmarks: [{ x: 0.4, y: 0.3, z: 0 }, { x: 0.6, y: 0.7, z: 0 }], yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
    const r = faceRect(g, 1000, 1000);
    expect(r.x).toBe(370);
    expect(r.y).toBe(240);
    expect(Math.abs(r.w - 260)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.h - 520)).toBeLessThanOrEqual(1);
    const edge = faceRect({ ...g, landmarks: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }] }, 100, 100);
    expect(edge).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});
```

Append inside `describe("cameraConstraints", …)` in `use-camera.test.ts`:

```ts
  it("asks for 1080p on face scans so small lesions span enough pixels", () => {
    expect(cameraConstraints("face").video).toMatchObject({ width: { ideal: 1920 }, height: { ideal: 1080 } });
    expect(cameraConstraints("closeup").video).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 } });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run frontend/src/features/skin-analysis/components/capture/face-rect.test.ts frontend/src/features/skin-analysis/hooks/use-camera.test.ts`
Expected: FAIL — `./face-rect` missing; `ideal: 1920` mismatch.

- [ ] **Step 3: Create** `frontend/src/features/skin-analysis/components/capture/face-rect.ts` (the `faceRect` body is moved verbatim from `GuidedFaceFlow.tsx`):

```ts
import type { FaceGeometry, Pixels } from "@ai/face/types";
import type { FaceAngle } from "@shared/face";
import type { DetectorInput } from "@ai/face/analyzers/acne-detector";

export interface Rect { x: number; y: number; w: number; h: number }

// Face bbox (pixel coords, 15% margin) from normalized MediaPipe landmarks.
export function faceRect(g: FaceGeometry, w: number, h: number): Rect {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const l of g.landmarks) {
    if (l.x < minX) minX = l.x;
    if (l.y < minY) minY = l.y;
    if (l.x > maxX) maxX = l.x;
    if (l.y > maxY) maxY = l.y;
  }
  const mx = (maxX - minX) * 0.15;
  const my = (maxY - minY) * 0.15;
  const x = Math.max(0, Math.floor((minX - mx) * w));
  const y = Math.max(0, Math.floor((minY - my) * h));
  return {
    x,
    y,
    w: Math.min(w, Math.ceil((maxX + mx) * w)) - x,
    h: Math.min(h, Math.ceil((maxY + my) * h)) - y,
  };
}

const DETECTOR_SIZE = 640;

/**
 * The face region of a captured frame, scaled so its longer side is 640, for the acne
 * detector. No face geometry → null: never guess lesions on a whole frame.
 */
export async function cropForDetector(
  blob: Blob,
  geometry: FaceGeometry | null,
  angle: FaceAngle,
): Promise<DetectorInput | null> {
  if (!geometry) return null;
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(blob);
    const rect = faceRect(geometry, bmp.width, bmp.height);
    if (rect.w < 32 || rect.h < 32) return null;
    const scale = DETECTOR_SIZE / Math.max(rect.w, rect.h);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(rect.w * scale);
    canvas.height = Math.round(rect.h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const crop: Pixels = { data, width, height };
    return { angle, crop, rect, frame: { w: bmp.width, h: bmp.height } };
  } catch {
    return null;
  } finally {
    bmp?.close();
  }
}
```

- [ ] **Step 4: Wire it into `GuidedFaceFlow.tsx`**

1. Delete the local `faceRect` function (the block from `// Face bbox (pixel coords, 15% margin)` to its closing `}`).
2. Replace `import { FACE_ANGLES, type FaceReport, type FaceAngle } from "@shared/face";` with:

```ts
import { FACE_ANGLES, type FaceReport, type FaceAngle, type FindingMark } from "@shared/face";
import { faceRect, cropForDetector } from "./face-rect";
import { detectAcne, DETECTOR_VERSION } from "@ai/face/analyzers/acne-detector";
```

3. In the save effect, directly after the `if (views.length > 0) { … }` refine block and before `try { const outcome = await saveFaceScanWithFallback(…`, insert:

```ts
      // Acne pinpoints for the staff overlay: crop → detect → release, one angle at a
      // time, so only one 640px crop is alive (iOS memory). `null` = no detector shipped,
      // no face geometry on any angle, or too slow — the report then carries no `marks`.
      const detected = await withTimeout(
        (async () => {
          let all: FindingMark[] | null = null;
          for (const a of FACE_ANGLES) {
            const blob = capturedByAngle.current.get(a);
            if (!blob) continue;
            const input = await cropForDetector(blob, geometryByAngle.current.get(a) ?? null, a);
            if (!input) continue;
            const marks = await detectAcne([input]);
            if (marks === null) return null;
            all = [...(all ?? []), ...marks];
          }
          return all;
        })(),
        REFINE_TIMEOUT_MS,
        null,
      );
      if (detected !== null) {
        report = { ...report, marks: detected, modelVersions: { ...report.modelVersions, acneMarks: DETECTOR_VERSION } };
      }
```

4. In `use-camera.ts`, replace the two size lines in `cameraConstraints` with:

```ts
      // 1080p for face scans: at 720p a small lesion spans only a few pixels.
      width: { ideal: mode === "face" ? 1920 : 1280 },
      height: { ideal: mode === "face" ? 1080 : 720 },
```

- [ ] **Step 5: Run to verify they pass, with the existing capture and camera tests**

Run: `npx vitest run frontend/src/features/skin-analysis/components/capture frontend/src/features/skin-analysis/hooks`
Expected: PASS (new tests, plus `GuidedFaceScan.test.tsx`, `use-camera.hook.test.tsx` unchanged — jsdom has no `createImageBitmap`, so `cropForDetector` returns null there and no marks are added).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/skin-analysis/components/capture/face-rect.ts \
        frontend/src/features/skin-analysis/components/capture/face-rect.test.ts \
        frontend/src/features/skin-analysis/components/capture/GuidedFaceFlow.tsx \
        frontend/src/features/skin-analysis/hooks/use-camera.ts \
        frontend/src/features/skin-analysis/hooks/use-camera.test.ts
git commit -m "feat(capture): run the acne detector per angle on face crops; 1080p face capture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Staff overlay

**Files:**
- Create: `frontend/src/features/skin-analysis/components/results/FindingOverlay.tsx`
- Test: `frontend/src/features/skin-analysis/components/results/FindingOverlay.test.tsx`
- Modify: `frontend/src/features/skin-analysis/components/capture/GuidedFaceFlow.tsx`
- Modify: `frontend/src/features/skin-analysis/components/history/FaceHistoryDetail.tsx`

**Interfaces:**
- Consumes: `FaceReport.marks`, `MarkKind` (Task 1); the `marks`-present-means-detector-ran rule (Task 5).
- Produces: `FindingOverlay({ report, images }: { report: FaceReport; images: { angle: string; url: string }[] })`.

- [ ] **Step 1: Write the failing test** — `FindingOverlay.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FindingOverlay } from "./FindingOverlay";
import { goldenFaceReport } from "@shared/testing/face-fixtures";
import type { FindingMark } from "@shared/face";

const mark = (angle: "front" | "left-45", x: number): FindingMark => ({
  kind: "acne", angle, confidence: 0.9, source: "model", shape: { type: "box", x, y: 0.4, w: 0.02, h: 0.02 },
});

describe("FindingOverlay", () => {
  it("counts marks per angle, never summed across angles", () => {
    const report = { ...goldenFaceReport(), marks: [mark("front", 0.3), mark("front", 0.5), mark("left-45", 0.4)] };
    render(<FindingOverlay report={report} images={[{ angle: "front", url: "f.jpg" }, { angle: "left-45", url: "l.jpg" }]} />);
    expect(screen.getByRole("button", { name: "Acne spots: 2 on this photo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "left-45" }));
    expect(screen.getByRole("button", { name: "Acne spots: 1 on this photo" })).toBeTruthy();
  });

  it("draws a circle per mark once the photo size is known, and hides a toggled kind", () => {
    const report = { ...goldenFaceReport(), marks: [mark("front", 0.3), mark("front", 0.5)] };
    const { container } = render(<FindingOverlay report={report} images={[{ angle: "front", url: "f.jpg" }]} />);
    const img = screen.getByAltText("front photo");
    Object.defineProperty(img, "naturalWidth", { value: 1000 });
    Object.defineProperty(img, "naturalHeight", { value: 750 });
    fireEvent.load(img);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Acne spots: 2 on this photo" }));
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });

  it("says so when the detector ran and found nothing on a photo", () => {
    render(<FindingOverlay report={{ ...goldenFaceReport(), marks: [] }} images={[{ angle: "front", url: "f.jpg" }]} />);
    expect(screen.getByText("No spots marked on this photo.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/features/skin-analysis/components/results/FindingOverlay.test.tsx`
Expected: FAIL — cannot resolve `./FindingOverlay`.

- [ ] **Step 3: Implement** `FindingOverlay.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { FaceReport, MarkKind } from "@shared/face";

const LABEL: Record<MarkKind, string> = {
  acne: "Acne spots", "dark-spot": "Dark spots", redness: "Redness", shine: "Shine",
  "under-eye": "Under-eye", wrinkle: "Wrinkles", "eye-bag": "Eye bags",
};

/** Staff view: the captured photos with each finding's position drawn on top. */
export function FindingOverlay({ report, images }: { report: FaceReport; images: { angle: string; url: string }[] }) {
  const marks = report.marks ?? [];
  const [angle, setAngle] = useState(
    () => images.find((i) => marks.some((m) => m.angle === i.angle))?.angle ?? images[0]?.angle,
  );
  const [hidden, setHidden] = useState<Set<MarkKind>>(new Set());
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const kinds = useMemo(() => [...new Set(marks.map((m) => m.kind))], [marks]);
  const image = images.find((i) => i.angle === angle);
  if (!image) return null;
  const here = marks.filter((m) => m.angle === angle);
  const shown = here.filter((m) => !hidden.has(m.kind));

  const toggle = (k: MarkKind) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <section className="card mx-auto mt-6 max-w-3xl p-5" aria-label="Finding locations">
      <h3 className="text-base font-semibold text-ink">Where findings are</h3>
      <p className="mt-1 text-xs text-ink-secondary">
        Staff view. Model markers are estimates until clinic accuracy is measured.
      </p>

      {images.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Photo angle">
          {images.map((i) => (
            <button
              key={i.angle}
              type="button"
              aria-pressed={i.angle === angle}
              onClick={() => { setAngle(i.angle); setSize(null); }}
              className={`min-h-[32px] px-3 text-xs ${i.angle === angle ? "btn-primary" : "btn-secondary"}`}
            >
              {i.angle}
            </button>
          ))}
        </div>
      )}

      <div className="relative mt-3">
        <img
          src={image.url}
          alt={`${image.angle} photo`}
          className="block w-full rounded-xl"
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        {size && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full text-gold"
            viewBox={`0 0 ${size.w} ${size.h}`}
            aria-hidden="true"
          >
            {shown.map((m, i) =>
              m.shape.type === "box" ? (
                <circle
                  key={i}
                  cx={(m.shape.x + m.shape.w / 2) * size.w}
                  cy={(m.shape.y + m.shape.h / 2) * size.h}
                  r={Math.max(6, (Math.max(m.shape.w * size.w, m.shape.h * size.h) / 2) * 1.3)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={Math.max(2, size.w / 400)}
                />
              ) : null,
            )}
          </svg>
        )}
      </div>

      {here.length === 0 ? (
        <p className="mt-3 text-xs text-ink-tertiary">No spots marked on this photo.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {kinds.map((k) => (
            <li key={k}>
              <button type="button" aria-pressed={!hidden.has(k)} onClick={() => toggle(k)} className="btn-secondary min-h-[32px] px-3 text-xs">
                {LABEL[k]}: {here.filter((m) => m.kind === k).length} on this photo
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/features/skin-analysis/components/results/FindingOverlay.test.tsx`
Expected: `3 passed`.

- [ ] **Step 5: Wire it in**

`GuidedFaceFlow.tsx`:

1. Add `import { FindingOverlay } from "../results/FindingOverlay";`.
2. Directly below `const REFINE_TIMEOUT_MS = …;`, add:

```ts
// Pinpoints are staff-only until the clinic localization exam passes (spec §6.3).
const PINPOINTS_FOR_PATIENTS = import.meta.env?.VITE_PINPOINTS_FOR_PATIENTS === "true";
```

3. Directly above the comment `// When the pipeline finishes, save (local + server) and switch to result view.`, add:

```ts
  // Photo URLs for the overlay on the result screen; revoked when replaced or unmounted.
  const resultImages = useMemo(
    () =>
      view === "result"
        ? FACE_ANGLES.flatMap((a) => {
            const blob = capturedByAngle.current.get(a);
            return blob ? [{ angle: a, url: URL.createObjectURL(blob) }] : [];
          })
        : [],
    [view],
  );
  useEffect(() => () => resultImages.forEach((i) => URL.revokeObjectURL(i.url)), [resultImages]);
```

4. In the result block, directly after `</ReportBoundary>`, add:

```tsx
        {(!isInvite || PINPOINTS_FOR_PATIENTS) && saved.marks !== undefined ? (
          <FindingOverlay report={saved} images={resultImages} />
        ) : null}
```

`FaceHistoryDetail.tsx`: add `import { FindingOverlay } from "../results/FindingOverlay";` and, directly above `{/* Results */}`, add:

```tsx
      {report?.marks !== undefined ? <FindingOverlay report={report} images={images} /> : null}
```

- [ ] **Step 6: Run the component tests**

Run: `npx vitest run frontend/src/features/skin-analysis/components`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/skin-analysis/components/results/FindingOverlay.tsx \
        frontend/src/features/skin-analysis/components/results/FindingOverlay.test.tsx \
        frontend/src/features/skin-analysis/components/capture/GuidedFaceFlow.tsx \
        frontend/src/features/skin-analysis/components/history/FaceHistoryDetail.tsx
git commit -m "feat(results): staff overlay of finding locations with per-photo counts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Manual marks storage and API

**Files:**
- Modify: `database/schema/schema.sql`
- Modify: `backend/modules/analysis/repository.ts`
- Create: `backend/modules/analysis/mark-routes.ts`
- Modify: `backend/app/app.ts`
- Test: `backend/modules/analysis/mark-routes.test.ts`

**Interfaces:**
- Consumes: `ManualPoint`, `parseManualPoints`, `FACE_ANGLES` (Task 1); `clinician` (`requireClinician`) in `app.ts`.
- Produces: `FaceScanImage.manualMarks?: ManualPoint[] | null`; `ScanRepo.setManualMarks(scanId: string, angle: string, points: ManualPoint[]): Promise<boolean>`; `PUT /api/face-scans/:id/images/:angle/marks` body `{ points: ManualPoint[] }` → `{ ok: true, count }` (400 bad body, 404 unknown image, 401 no session, 403 invite); `GET /api/face-scans/:id` returns `angles[].manualMarks`; `createMarkRoutes(deps: AppDeps, clinician: RequestHandler): Router`; test helper `setupMarkedScan(report?)` exported from the test file.

- [ ] **Step 1: Write the failing test** — `backend/modules/analysis/mark-routes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";
import { goldenFaceReport } from "../../../shared/testing/face-fixtures";
import type { FaceReport } from "../../../shared/face";

export async function setupMarkedScan(report: FaceReport = goldenFaceReport()) {
  const deps = makeTestDeps();
  const app = createApp(deps);
  const cookie = (await request(app).post("/api/auth/login").send({ password: "clinic-pass" })).headers["set-cookie"][0];
  const image = (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 170, b: 150 } } })
    .jpeg().toBuffer()).toString("base64");
  const save = await request(app).post("/api/face-scans").set("Cookie", cookie)
    .send({ report, images: [{ angle: "front", image, mime: "image/jpeg" }] });
  expect(save.status).toBe(200);
  return { deps, app, cookie, scanId: save.body.scan.id as string };
}

describe("manual marks", () => {
  it("stores staff taps on an image and returns them with the scan", async () => {
    const { app, cookie, scanId } = await setupMarkedScan();
    const put = await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).set("Cookie", cookie)
      .send({ points: [{ kind: "acne", x: 0.4, y: 0.5 }] });
    expect(put.body).toEqual({ ok: true, count: 1 });
    const got = await request(app).get(`/api/face-scans/${scanId}`).set("Cookie", cookie);
    expect(got.body.angles[0].manualMarks).toEqual([{ kind: "acne", x: 0.4, y: 0.5 }]);
  });

  it("rejects malformed points and images that do not exist", async () => {
    const { app, cookie, scanId } = await setupMarkedScan();
    const bad = await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).set("Cookie", cookie)
      .send({ points: [{ kind: "acne", x: 2, y: 0 }] });
    expect(bad.status).toBe(400);
    const missing = await request(app).put(`/api/face-scans/${scanId}/images/left-45/marks`).set("Cookie", cookie)
      .send({ points: [] });
    expect(missing.status).toBe(404);
  });

  it("is closed to logged-out users", async () => {
    const { app, scanId } = await setupMarkedScan();
    const res = await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).send({ points: [] });
    expect(res.status).toBe(401);
  });

  it("refuses patient invite sessions", async () => {
    const { app, cookie, scanId } = await setupMarkedScan();
    const made = await request(app).post("/api/invites").set("Cookie", cookie).send({ label: "Remote patient", maxScans: 2 });
    const claimed = await request(app).post("/api/auth/invite").send({ token: made.body.token });
    const res = await request(app).put(`/api/face-scans/${scanId}/images/front/marks`)
      .set("Cookie", claimed.headers["set-cookie"][0]).send({ points: [] });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run backend/modules/analysis/mark-routes.test.ts`
Expected: FAIL — PUT returns 404 (no route) where 200/400/403 are expected.

- [ ] **Step 3: Implement**

`database/schema/schema.sql` — directly after the `ALTER TABLE scan_images ADD COLUMN IF NOT EXISTS capture JSONB;` line, add:

```sql
-- Staff-tapped ground truth for the localization exam (shared/face.ts ManualPoint[]).
ALTER TABLE scan_images ADD COLUMN IF NOT EXISTS manual_marks JSONB;
```

`backend/modules/analysis/repository.ts`:

1. Change `import type { CaptureInfo } from "../../../shared/face";` to `import type { CaptureInfo, ManualPoint } from "../../../shared/face";`.
2. In `interface FaceScanImage`, after `capture?: CaptureInfo | null;` add `manualMarks?: ManualPoint[] | null;`.
3. In `export interface ScanRepo`, directly after the `getScanImage(…)` line, add:

```ts
  /** Staff ground-truth taps for one image. False when the image does not exist. */
  setManualMarks(scanId: string, angle: string, points: ManualPoint[]): Promise<boolean>;
```

4. In `rowToScanImage`, after the `capture:` line, add `manualMarks: (r.manual_marks as ManualPoint[] | null) ?? null,`.
5. In `PgScanRepo.listImages`, change the column list to `SELECT id, scan_id, angle, image_width, image_height, quality, capture, manual_marks, created_at` (this also fixes `capture` never being read back from Postgres).
6. Add to `MemoryScanRepo`:

```ts
  async setManualMarks(scanId: string, angle: string, points: ManualPoint[]): Promise<boolean> {
    if (this.archived.has(this.key(scanId, angle))) return false;
    const img = (this.imagesByScan.get(scanId) ?? []).find((i) => i.angle === angle);
    if (!img) return false;
    img.manualMarks = points;
    return true;
  }
```

7. Add to `PgScanRepo`:

```ts
  async setManualMarks(scanId: string, angle: string, points: ManualPoint[]): Promise<boolean> {
    if (!isValidUuid(scanId)) return false;
    const r = await this.pool.query(
      `UPDATE scan_images SET manual_marks = $3 WHERE scan_id = $1 AND angle = $2 AND archived_at IS NULL`,
      [scanId, angle, JSON.stringify(points)],
    );
    return (r.rowCount ?? 0) > 0;
  }
```

Create `backend/modules/analysis/mark-routes.ts`:

```ts
import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { FACE_ANGLES, parseManualPoints, type FaceAngle } from "../../../shared/face";

/**
 * Staff ground truth for the localization exam. Every route here takes `clinician`, so an
 * invite (patient) session gets 403 before reaching a handler.
 */
export function createMarkRoutes(deps: AppDeps, clinician: RequestHandler): Router {
  const router = Router();

  router.put("/api/face-scans/:id/images/:angle/marks", clinician, async (req, res) => {
    if (!FACE_ANGLES.includes(req.params.angle as FaceAngle)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const points = parseManualPoints(req.body?.points);
    if (!points) {
      res.status(400).json({ error: "points must be up to 500 {kind, x, y} with x and y in 0..1" });
      return;
    }
    if (!(await deps.scans.setManualMarks(req.params.id, req.params.angle, points))) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true, count: points.length });
  });

  return router;
}
```

`backend/app/app.ts`: add `import { createMarkRoutes } from "../modules/analysis/mark-routes";` and, directly after `app.use(createFaceScanRoutes(deps, auth));`, add `app.use(createMarkRoutes(deps, clinician));`.

- [ ] **Step 4: Run to verify it passes, with the other analysis tests**

Run: `npx vitest run backend/modules/analysis`
Expected: PASS (4 new + `face-marks`, `face-capture` and lesion tests).

- [ ] **Step 5: Commit**

```bash
git add database/schema/schema.sql backend/modules/analysis/repository.ts \
        backend/modules/analysis/mark-routes.ts backend/modules/analysis/mark-routes.test.ts backend/app/app.ts
git commit -m "feat(api): staff-only manual marks per image; read capture back from Postgres

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Operator note: `manual_marks` is created by `schema.sql` on the next API boot — unapplied until the server restarts.

---

### Task 8: Tap-to-mark tool

**Files:**
- Create: `frontend/src/features/skin-analysis/components/queue/MarkSpots.tsx`
- Test: `frontend/src/features/skin-analysis/components/queue/MarkSpots.test.tsx`
- Modify: `frontend/src/features/skin-analysis/components/queue/ImageManager.tsx`

**Interfaces:**
- Consumes: `GET /api/face-scans/:id` → `angles[].manualMarks`; `PUT /api/face-scans/:id/images/:angle/marks` (Task 7); `ManualPoint` (Task 1).
- Produces: `MarkSpots({ scanId, angle, src }: { scanId: string; angle: string; src: string })`.

- [ ] **Step 1: Write the failing test** — `MarkSpots.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MarkSpots } from "./MarkSpots";

const rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect;

describe("MarkSpots", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => (init?.method === "PUT" ? { ok: true, count: 1 } : { angles: [{ angle: "front", manualMarks: [] }] }),
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("adds a point where tapped and saves it", async () => {
    render(<MarkSpots scanId="s1" angle="front" src="f.jpg" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("0 marked"));
    const surface = screen.getByTestId("mark-surface");
    surface.getBoundingClientRect = () => rect;
    fireEvent.click(surface, { clientX: 50, clientY: 50 });
    expect(screen.getByRole("status").textContent).toBe("1 marked");
    fireEvent.click(screen.getByRole("button", { name: "Save marks" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved 1 spot."));
    const put = vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({ points: [{ kind: "acne", x: 0.25, y: 0.5 }] });
  });

  it("removes a point when tapped again", async () => {
    render(<MarkSpots scanId="s1" angle="front" src="f.jpg" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("0 marked"));
    const surface = screen.getByTestId("mark-surface");
    surface.getBoundingClientRect = () => rect;
    fireEvent.click(surface, { clientX: 50, clientY: 50 });
    fireEvent.click(surface, { clientX: 51, clientY: 50 });
    expect(screen.getByRole("status").textContent).toBe("0 marked");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/features/skin-analysis/components/queue/MarkSpots.test.tsx`
Expected: FAIL — cannot resolve `./MarkSpots`.

- [ ] **Step 3: Implement** `MarkSpots.tsx`:

```tsx
import { useEffect, useState, type MouseEvent } from "react";
import type { ManualPoint } from "@shared/face";

/** Staff ground truth: tap each real acne spot on one photo. Feeds the localization exam. */
export function MarkSpots({ scanId, angle, src }: { scanId: string; angle: string; src: string }) {
  const [points, setPoints] = useState<ManualPoint[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");

  useEffect(() => {
    let live = true;
    setStatus("loading");
    fetch(`/api/face-scans/${scanId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((j: { angles?: { angle: string; manualMarks?: ManualPoint[] | null }[] }) => {
        if (!live) return;
        setPoints(j.angles?.find((a) => a.angle === angle)?.manualMarks ?? []);
        setStatus("idle");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [scanId, angle]);

  function tap(e: MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    // A tap within 3% of an existing marker removes it; otherwise it adds one.
    const near = points.findIndex((p) => Math.hypot(p.x - x, p.y - y) < 0.03);
    setPoints(near >= 0 ? points.filter((_, i) => i !== near) : [...points, { kind: "acne", x, y }]);
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    const r = await fetch(`/api/face-scans/${scanId}/images/${angle}/marks`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ points }),
    }).catch(() => null);
    setStatus(r?.ok ? "saved" : "error");
  }

  const message =
    status === "loading" ? "Loading…"
      : status === "saved" ? `Saved ${points.length} spot${points.length === 1 ? "" : "s"}.`
        : status === "error" ? "Could not load or save — try again."
          : `${points.length} marked`;

  return (
    <div>
      <p className="text-xs text-ink-secondary">
        Tap every acne spot you can see; tap a marker again to remove it. These marks test the detector's accuracy.
      </p>
      <div className="relative mt-2 cursor-crosshair touch-manipulation" onClick={tap} data-testid="mark-surface">
        <img src={src} alt={`${angle} photo to mark`} className="block w-full select-none rounded-xl" draggable={false} />
        {points.map((p, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className="btn-primary px-4" onClick={save} disabled={status === "saving" || status === "loading"}>
          Save marks
        </button>
        <span className="text-xs text-ink-secondary" role="status" aria-live="polite">{message}</span>
      </div>
    </div>
  );
}
```

`ImageManager.tsx`:

1. Add `import { MarkSpots } from "./MarkSpots";`.
2. After `const [rotation, setRotation] = useState(0);` add `const [marking, setMarking] = useState(false);`.
3. Replace the viewer block under `{/* Viewer */}` — the `<div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-hairline bg-black">…</div>` — with:

```tsx
        {marking && current ? (
          <MarkSpots scanId={scanId} angle={current.angle} src={src} />
        ) : (
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-hairline bg-black">
            <img
              src={src}
              alt={current?.angle ?? ""}
              className="h-full w-full object-contain transition-transform"
              style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
            />
          </div>
        )}
```

4. Directly before the `Rotate 90°` button, add:

```tsx
          <button
            onClick={() => setMarking((m) => !m)}
            aria-pressed={marking}
            className="btn-secondary min-h-[32px] px-2 text-xs"
          >
            {marking ? "Done marking" : "Mark spots"}
          </button>
```

- [ ] **Step 4: Run to verify it passes, with the queue tests**

Run: `npx vitest run frontend/src/features/skin-analysis/components/queue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/skin-analysis/components/queue/MarkSpots.tsx \
        frontend/src/features/skin-analysis/components/queue/MarkSpots.test.tsx \
        frontend/src/features/skin-analysis/components/queue/ImageManager.tsx
git commit -m "feat(queue): tap-to-mark acne ground truth on clinic photos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Localization exam — export and score

**Files:**
- Modify: `backend/modules/analysis/repository.ts`
- Modify: `backend/modules/analysis/mark-routes.ts`
- Modify: `backend/modules/training/governance-routes.ts`
- Test: `backend/modules/analysis/mark-routes.test.ts` (append)
- Create: `ai/training/localize/eval_marks.py`
- Test: `ai/training/tests/test_eval_marks.py`

**Interfaces:**
- Consumes: Task 7 repo, routes and `setupMarkedScan`; `FaceReport.marks`; `ai.training.paths.datasets_dir()`.
- Produces: `export interface MarkedImage { scanId: string; angle: string; points: ManualPoint[]; capture: CaptureInfo | null }`; `ScanRepo.listManuallyMarked(): Promise<MarkedImage[]>`; `export function datasetsDir(): string` (governance-routes); `POST /api/localization-exam/export` → writes `$DATASETS_DIR/localization/clinic/<scanId>_<angle>.jpg` and `marks.jsonl` lines `{ image, angle, points, predictions: {x,y,w,h,confidence}[], device }`, returns `{ exported, dir }`; CLI `python -m ai.training.localize.eval_marks [DIR]` with `match(points, predictions) -> int`, `score(rows) -> dict`, `main(argv) -> int`.

- [ ] **Step 1: Write the failing tests**

In `backend/modules/analysis/mark-routes.test.ts`, add to the imports at the top:

```ts
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
```

and append:

```ts
describe("localization exam export", () => {
  it("writes each marked photo with staff points and the model's saved predictions", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "loc-exam-"));
    process.env.DATASETS_DIR = dir;
    try {
      const report: FaceReport = {
        ...goldenFaceReport(),
        marks: [{ kind: "acne", angle: "front", confidence: 0.9, source: "model", shape: { type: "box", x: 0.3, y: 0.4, w: 0.1, h: 0.1 } }],
      };
      const { app, cookie, scanId } = await setupMarkedScan(report);
      await request(app).put(`/api/face-scans/${scanId}/images/front/marks`).set("Cookie", cookie)
        .send({ points: [{ kind: "acne", x: 0.35, y: 0.45 }] });
      const res = await request(app).post("/api/localization-exam/export").set("Cookie", cookie);
      expect(res.body.exported).toBe(1);
      const out = path.join(dir, "localization", "clinic");
      expect(existsSync(path.join(out, `${scanId}_front.jpg`))).toBe(true);
      const line = JSON.parse(readFileSync(path.join(out, "marks.jsonl"), "utf8").trim());
      expect(line.points).toEqual([{ kind: "acne", x: 0.35, y: 0.45 }]);
      expect(line.predictions).toEqual([{ x: 0.3, y: 0.4, w: 0.1, h: 0.1, confidence: 0.9 }]);
    } finally {
      delete process.env.DATASETS_DIR;
    }
  });
});
```

`ai/training/tests/test_eval_marks.py`:

```python
import json

from ai.training.localize.eval_marks import main, match, score

BOX = {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2, "confidence": 0.9}


def test_point_in_box_matches_once():
    assert match([{"x": 0.2, "y": 0.2}, {"x": 0.15, "y": 0.15}], [BOX]) == 1
    assert match([{"x": 0.5, "y": 0.5}], [BOX]) == 0


def test_score_recall_precision_count_error():
    rows = [{"points": [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.8}], "predictions": [BOX]}]
    s = score(rows)
    assert (s["recall"], s["precision"], s["count_mae"]) == (0.5, 1.0, 1.0)


def test_main_reports_not_yet_below_the_bar(tmp_path, capsys):
    row = {"points": [{"x": 0.2, "y": 0.2}], "predictions": [BOX], "device": "Clinic iPad 1"}
    (tmp_path / "marks.jsonl").write_text(json.dumps(row) + "\n")
    assert main([str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "recall=1.00" in out and "Clinic iPad 1" in out and "NOT YET" in out
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run backend/modules/analysis/mark-routes.test.ts`
Expected: FAIL — the export route returns 404.
Run: `.venv.nosync/bin/python -m pytest ai/training/tests/test_eval_marks.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'ai.training.localize.eval_marks'`.

- [ ] **Step 3: Implement the export**

`backend/modules/training/governance-routes.ts`: change `function datasetsDir(): string {` to `export function datasetsDir(): string {`.

`backend/modules/analysis/repository.ts`:

1. Directly after `interface FaceScanImage { … }`, add:

```ts
export interface MarkedImage { scanId: string; angle: string; points: ManualPoint[]; capture: CaptureInfo | null }
```

2. In `export interface ScanRepo`, after `setManualMarks(…)`, add `listManuallyMarked(): Promise<MarkedImage[]>;`.
3. Add to `MemoryScanRepo`:

```ts
  async listManuallyMarked(): Promise<MarkedImage[]> {
    return [...this.imagesByScan.values()].flat()
      .filter((i) => i.manualMarks?.length && !this.archived.has(this.key(i.scanId, i.angle)))
      .map((i) => ({ scanId: i.scanId, angle: i.angle, points: i.manualMarks ?? [], capture: i.capture ?? null }));
  }
```

4. Add to `PgScanRepo`:

```ts
  async listManuallyMarked(): Promise<MarkedImage[]> {
    const { rows } = await this.pool.query(
      `SELECT scan_id, angle, manual_marks, capture FROM scan_images
       WHERE manual_marks IS NOT NULL AND jsonb_array_length(manual_marks) > 0 AND archived_at IS NULL
       ORDER BY created_at`,
    );
    return rows.map((r) => ({
      scanId: String(r.scan_id),
      angle: String(r.angle),
      points: (r.manual_marks as ManualPoint[]) ?? [],
      capture: (r.capture as CaptureInfo | null) ?? null,
    }));
  }
```

`backend/modules/analysis/mark-routes.ts` — replace the imports with:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { datasetsDir } from "../training/governance-routes";
import { FACE_ANGLES, parseManualPoints, type FaceAngle, type FindingMark } from "../../../shared/face";
```

and add, inside `createMarkRoutes` before `return router;`:

```ts
  // Writes the locked clinic localization exam for ai/training/localize/eval_marks.py.
  router.post("/api/localization-exam/export", clinician, async (_req, res) => {
    const dir = path.join(datasetsDir(), "localization", "clinic");
    mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (const m of await deps.scans.listManuallyMarked()) {
      const scan = await deps.scans.get(m.scanId);
      const img = await deps.scans.getScanImage(m.scanId, m.angle);
      if (!scan || !img) continue;
      const file = `${m.scanId}_${m.angle}.jpg`;
      writeFileSync(path.join(dir, file), Buffer.from(img.jpeg));
      const saved = (scan.report as unknown as { marks?: FindingMark[] } | null)?.marks ?? [];
      const predictions = saved.flatMap((k) =>
        k.angle === m.angle && k.kind === "acne" && k.shape.type === "box"
          ? [{ x: k.shape.x, y: k.shape.y, w: k.shape.w, h: k.shape.h, confidence: k.confidence }]
          : [],
      );
      lines.push(JSON.stringify({
        image: file,
        angle: m.angle,
        points: m.points.filter((p) => p.kind === "acne"),
        predictions,
        device: m.capture?.device || m.capture?.platform || "unknown",
      }));
    }
    writeFileSync(path.join(dir, "marks.jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
    res.json({ exported: lines.length, dir });
  });
```

- [ ] **Step 4: Implement the scorer** — `ai/training/localize/eval_marks.py`:

```python
"""Score the shipped acne pinpoints against staff taps — the locked clinic localization exam.

    .venv.nosync/bin/python -m ai.training.localize.eval_marks [DIR]

DIR (default $DATASETS_DIR/localization/clinic) holds marks.jsonl written by
POST /api/localization-exam/export: per photo, staff `points` and the model's saved `predictions`.
A prediction matches a point when the point lies inside its box; one-to-one, highest confidence first.
Clinic photos are never detector training data in Phase 1, so this set stays a clean exam.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from ai.training.paths import datasets_dir

MIN_PHOTOS, MIN_RECALL, MIN_PRECISION = 50, 0.70, 0.70


def match(points: list[dict], predictions: list[dict]) -> int:
    free, hits = list(points), 0
    for p in sorted(predictions, key=lambda q: -q.get("confidence", 0.0)):
        for i, pt in enumerate(free):
            if p["x"] <= pt["x"] <= p["x"] + p["w"] and p["y"] <= pt["y"] <= p["y"] + p["h"]:
                free.pop(i)
                hits += 1
                break
    return hits


def score(rows: list[dict]) -> dict:
    points = sum(len(r["points"]) for r in rows)
    predictions = sum(len(r["predictions"]) for r in rows)
    hits = sum(match(r["points"], r["predictions"]) for r in rows)
    return {
        "photos": len(rows),
        "recall": hits / points if points else 0.0,
        "precision": hits / predictions if predictions else 0.0,
        "count_mae": sum(abs(len(r["points"]) - len(r["predictions"])) for r in rows) / len(rows) if rows else 0.0,
    }


def main(argv: list[str]) -> int:
    folder = Path(argv[0]) if argv else datasets_dir() / "localization" / "clinic"
    rows = [json.loads(line) for line in (folder / "marks.jsonl").read_text().splitlines() if line.strip()]
    s = score(rows)
    print(f"overall  photos={s['photos']}  recall={s['recall']:.2f}  precision={s['precision']:.2f}  "
          f"count error={s['count_mae']:.2f}")
    by_device: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_device[r.get("device", "unknown")].append(r)
    for device, rs in sorted(by_device.items()):
        d = score(rs)
        print(f"  {device:24} photos={d['photos']}  recall={d['recall']:.2f}  precision={d['precision']:.2f}")
    passed = s["photos"] >= MIN_PHOTOS and s["recall"] >= MIN_RECALL and s["precision"] >= MIN_PRECISION
    print("PASS — may be shown to patients" if passed
          else f"NOT YET — needs >= {MIN_PHOTOS} photos with recall and precision >= {MIN_RECALL:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run backend/modules/analysis/mark-routes.test.ts`
Expected: `5 passed`.
Run: `.venv.nosync/bin/python -m pytest ai/training/tests/test_eval_marks.py -q`
Expected: `3 passed`.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/analysis/repository.ts backend/modules/analysis/mark-routes.ts \
        backend/modules/analysis/mark-routes.test.ts backend/modules/training/governance-routes.ts \
        ai/training/localize/eval_marks.py ai/training/tests/test_eval_marks.py
git commit -m "feat(localize): clinic localization exam — export marked photos and score predictions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end verification and records

**Files:**
- Modify: `PROJECT.md`
- Update (outside the repo): `/Users/febrielotud/Obsidian/Astro/AI skin analysis MODEL REFINING/Finding Pinpoints Design.md`, `…/Repo Change Log.md`

**Interfaces:**
- Consumes: everything above; the shipped `frontend/public/models/acne-detector/model.onnx` from Task 3.
- Produces: a verified release to staff, recorded.

- [ ] **Step 1: Full automated checks**

Run: `npm run verify`
Expected: both typechecks clean, all vitest files pass, build succeeds.
Run: `.venv.nosync/bin/python -m pytest ai/training -q`
Expected: all pass (82 existing + 10 new).

- [ ] **Step 2: Live staff check** (desktop width, then the preview at iPad width)

1. Start the app: `npm run dev:server` and, in a second terminal, `npm run dev`.
2. Log in as clinic staff, run a face scan. Expected: the result screen shows **Where findings are**, with circles and `Acne spots: N on this photo` (or `No spots marked on this photo.`).
3. Training tab → **Private scan links** → create a link, open it in a private window, run a scan. Expected: no **Where findings are** section.
4. Queue → open a scan → **Mark spots** → tap 3 spots → **Save marks**. Expected: `Saved 3 spots.`
5. In the logged-in staff tab's browser console, run `await (await fetch("/api/localization-exam/export", { method: "POST" })).json()`. Expected: `{ exported: 1, dir: "…/localization/clinic" }`.
6. Run `.venv.nosync/bin/python -m ai.training.localize.eval_marks`. Expected: an `overall` line, one device line, and `NOT YET — needs >= 50 photos …`.

- [ ] **Step 3: iPad memory check at 1080p** — on a clinic iPad, complete 3 face scans in a row. If Safari reloads the tab ("A problem repeatedly occurred"), set the face size in `cameraConstraints` back to 1280×720, update the Task 5 camera test to match, note it in `PROJECT.md`, and commit that change.

- [ ] **Step 4: Records** — add a `## 2026-09-26 — finding pinpoints, Phase 1` section to `PROJECT.md` covering: the detector's test metrics from Task 3 Step 7; `VITE_PINPOINTS_FOR_PATIENTS` (off); the patient bar (≥ 50 photos, recall and precision ≥ 0.70); `manual_marks` applied on the next API boot; the iPad 1080p result. Update the Obsidian design note's status to "Phase 1 shipped to staff" and append this plan's commits to `Repo Change Log.md`.

- [ ] **Step 5: Commit**

```bash
git add PROJECT.md
git commit -m "docs(project): finding pinpoints Phase 1 shipped to staff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

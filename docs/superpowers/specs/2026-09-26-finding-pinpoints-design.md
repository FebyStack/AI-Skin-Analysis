# Finding Pinpoints — Design

**Date:** 2026-09-26 · **Status:** approved (Febriel), Phase 1 to be planned
**Goal:** show *where* each analysed finding is on the face — a marker on every acne lesion, shading on
red/shiny/dark areas — instead of only a whole-face grade, with accuracy that is measured on clinic photos
before anything is presented as reliable.

## 1. Decisions

| Question | Decision |
|---|---|
| Which findings | All analyses, phased (§3). Skin type has no location; pores deferred (capture resolution). |
| Display | Circle each individual spot + count; shade area-type findings. |
| Audience | **Clinic staff first.** Patients only after the clinic localization exam passes (§6.3). |
| Validation | Staff tap-to-mark tool on clinic photos → locked localization exam. |
| Runs where | **On-device, in the browser** (onnxruntime-web). The face pipeline's privacy invariant stands. |

## 2. Why the method differs per finding

Accurate localization needs either *location-labelled training data* (boxes/points) or a *direct pixel
measurement*. Whole-face grade labels cannot produce accurate pinpoints (heatmaps from a classifier are
fuzzy and were rejected). Lesson carried from 2026-09-21: public-data heads scored 0.98 on their own data
and 0.30–0.43 on clinic photos — so every ML pinpoint is labelled "estimate" until clinic-validated.

| Finding | Shape | Method | Source tag |
|---|---|---|---|
| Acne lesions | box → circle + count | YOLO11n detector, box-labelled public data | `model` |
| Dark spots / pigmentation | box → circle | local-darkness blobs vs the person's own skin | `measurement` |
| Redness | area | redness above the person's skin baseline, after colour constancy | `measurement` |
| Oiliness / shine | area | specular highlights (bright, low saturation) | `measurement` |
| Under-eye | area | landmark region, darkness vs cheeks | `measurement` |
| Wrinkles / eye bags | box | YOLO detector, CC0 wrinkles/eye-bags set | `model` ("estimate") |
| Pores | — | deferred: not resolvable at 720p | — |
| Skin type | — | whole-face property | — |

`measurement` marks are camera-honest (existing invariant): they state what the camera recorded, never a
diagnosis. `model` marks carry a confidence.

## 3. Phases (each gets its own plan)

1. **Phase 1 (this spec, detailed):** mark contract, photo overlay, acne detector, tap-to-mark tool,
   localization exam, 1080p face capture.
2. **Phase 2:** measurement maps — dark spots, redness, shine, under-eye. No training.
3. **Phase 3:** wrinkles/eye-bags detector with clinic validation; pores once capture resolution allows.

## 4. Data contract (`shared/face.ts`)

```ts
export const MARK_KINDS = ["acne", "dark-spot", "redness", "shine", "under-eye", "wrinkle", "eye-bag"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

/** Position in the captured image of `angle`, normalised to 0..1 (resolution-independent). */
export type MarkShape =
  | { type: "box"; x: number; y: number; w: number; h: number }
  | { type: "area"; polygon: [number, number][] };          // Phase 2

export interface FindingMark {
  kind: MarkKind;
  angle: FaceAngle;
  shape: MarkShape;
  confidence: number;                  // 0..1; 1 for measurements
  source: "model" | "measurement";
}

// FaceReport gains one OPTIONAL field (absent on reports saved before this feature):
marks?: FindingMark[];
```

- `validateFaceReport` accepts absent fields; when present, every mark must be well-formed (known kind and
  angle, coordinates in 0..1, `w,h > 0`, box inside the image) and there are at most 500 marks. A malformed
  mark rejects the report (400), consistent with the existing "server never trusts the client" rule.
- Normalised coordinates survive the server's ≤1280px re-encode unchanged.
- **Counts are per angle, derived from `marks`** — never summed across angles, because one cheek lesion
  appears in both the front and the 45° photo. No separate `counts` field.
- Phase 1 does **not** change the acne grade: the classifier keeps grading; the per-angle lesion count is
  shown beside it. Combining them is a later, separately measured decision.

## 5. Acne detector (Phase 1)

### 5.1 Training data (on the SSD, `Bong/skin-datasets/raw/`)

| Dataset | Licence | Use |
|---|---|---|
| `walkervs/acne04-detection-v5i-yolov11` | CC0-1.0 (ACNE04 origin: research release) | primary |
| `osmankagankurnaz/acne-dataset-in-yolov8-format` | Apache-2.0 | adds source diversity |

Assembly script (`ai/training/localize/build_acne_detection.py`):
- Merge lesion subclasses into one class `acne`; keep YOLO txt format.
- **Group Roboflow augmentations by source image** (`subject_group`, the killa92 lesson) so copies of one
  photo never straddle train/val/test.
- **Exclude every photo in `ai/training/multi/frozen_test.json`** (matched by stem and group), so the
  classification exam stays uncontaminated.
- Group-disjoint split 70/15/15; the public test split is frozen by hash like `build_master`.

### 5.2 Training

- `ultralytics` 8.4.92 (installed), `yolo11n.pt` start, `imgsz=640`, one class.
- Photometric robustness as in the face model: Shades-of-Grey colour constancy applied to images before
  training and at inference; ultralytics' HSV augmentation kept mild (redness is signal).
- Output `ai/models/acne-detector/candidate/` + `model.json` (metrics: mAP50, precision, recall on the
  public test split; `preprocess.color_constancy: true`).

### 5.3 Browser inference (`ai/face/analyzers/acne-detector.ts`)

- Lazy-load `/models/acne-detector/model.onnx` exactly like `face-model.ts` (HEAD probe; absent or failing
  model → no marks, report unchanged).
- Per captured angle, sequentially (iOS memory): crop the face rect from the full-resolution frame (the
  existing `faceRect`, 15% margin) → letterbox to 640 → Shades-of-Grey → run → keep boxes with
  confidence ≥ `VITE_ACNE_BOX_MIN_CONF` (default 0.35) → map back to normalised full-frame coordinates.
- NMS in the exported graph (`nms=True`) when supported; otherwise a tested TS NMS.
- Shades-of-Grey and letterbox are implemented in TS with a **parity fixture** generated by the Python
  pipeline (same input → same tensor within 1/255).

## 6. Staff tools (Phase 1)

### 6.1 Photo overlay (`results/FindingOverlay.tsx`)

- Shows each angle's photo (in-memory blob right after a scan; `/api/face-scans/:id/images/:angle` in
  history) with an SVG layer: a circle per acne box, sized from the box.
- Toggle per mark kind (buttons with `aria-pressed`), a count per kind in text (markers are never the only
  carrier of information), angle switcher. Works on iPad and desktop widths.
- Rendered only for clinic sessions (`role !== "invite"`). Patient display is off behind
  `VITE_PINPOINTS_FOR_PATIENTS` (default `false`), switched on only after §6.3 passes.

### 6.2 Tap-to-mark (`queue/MarkSpots.tsx`, in the staff Queue's image viewer)

- Tap to add an acne point, tap a point to remove it; per angle; Save. Marking is per photo, so the
  exam compares like with like (per-angle predictions vs per-angle taps).
- Storage: `ALTER TABLE scan_images ADD COLUMN IF NOT EXISTS manual_marks JSONB` — points
  `{kind:"acne", x, y}` normalised. Applied by `schema.sql` on API boot.
- API: `PUT /api/face-scans/:id/images/:angle/marks` — clinic auth only; invite sessions 403; body
  validated (known kind, 0..1 coordinates, ≤ 500 points).

### 6.3 Localization exam (`ai/training/localize/eval_marks.py`)

- Clinic photos with saved `manual_marks` form the **locked localization exam**; a photo, once marked,
  never becomes detector training data unless moved out of the exam deliberately.
- A predicted box matches a tapped point when the point lies inside it (one-to-one, greedy by confidence).
- Report: **recall** (points found), **precision** (boxes that match a point), **mean absolute count
  error**, per device (`scan_images.capture`) and per Fitzpatrick type when recorded.
- **Initial bar for showing acne pinpoints to patients:** ≥ 50 marked clinic photos, recall ≥ 0.70,
  precision ≥ 0.70. Adjustable; the decision is recorded with the numbers.

## 7. Capture resolution

Face capture requests 1920×1080 (was 1280×720) for clinic sessions: a small lesion is a few pixels wide at
720p. The classifier path is unchanged (it crops to 224). Verify on iPad for the Safari OOM documented in
PROJECT.md; fall back to 720p if the tab is killed.

## 8. Errors and fallbacks

- No detector model / inference failure → no marks; the report and grade are unaffected.
- Face not detected on an angle → that angle gets no marks (never full-frame guesses).
- Overlay with zero marks shows "No spots marked" rather than an empty photo.

## 9. Testing

- Python: dataset assembly (subclass merge, group-disjoint split, frozen-exam exclusion), point-in-box
  matching and metric maths.
- TS: mark validation; letterbox + coordinate round trip; Shades-of-Grey parity fixture; overlay renders
  markers and counts; marks API (clinic ok, invite 403, malformed 400).
- `npm run verify` + `pytest ai/training` green; manual check in the preview at iPad and desktop widths.

## 10. Risks

- **Domain gap:** ACNE04 is close-up photos from one population and camera; clinic accuracy is unknown
  until §6.3 — hence staff-first.
- **Skin-tone coverage** of public detection data is unmeasured; the exam reports per Fitzpatrick type.
- **Label granularity:** a lesion count is not a severity grade; they are shown side by side, not merged.
- **iPad memory** at 1080p with two models loaded.

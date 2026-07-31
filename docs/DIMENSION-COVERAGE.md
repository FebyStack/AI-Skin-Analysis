# Dimension coverage: what is measured vs. what is estimated

> **2026-07-31: the 9 non-acne dimensions moved from a 4-level severity scale to
> binary `absent` / `present`.** The severity scale was never groundable — no
> public dataset grades by degree, "mild vs moderate" is a judgement two
> clinicians disagree on, and the clinic's own grading produced 43 none / 23 mild
> / 4 moderate / **0 severe**. Those same labels collapse to 43/27 as presence,
> which is trainable. Degree is now carried by the model's probability, which is
> honest about its own uncertainty in a way a fabricated "moderate" is not.
> Old labels are mapped forward on read (`normalizePresence`), never rewritten.

Status as of 2026-07-31, after `make retrain-face`.

## The honest table

| Dimension | Source | Validated | Notes |
|---|---|---|---|
| **acne** | trained multi-head CNN | **macro F1 0.741** | 1,683 training rows |
| **skintype** | trained multi-head CNN | **macro F1 0.691** | 4,139 training rows |
| pigmentation | pixel heuristic | no | cross-zone luma spread |
| redness | pixel heuristic | no | channel ratio |
| texture | pixel heuristic | no | high-frequency ratio |
| pores | pixel heuristic | no | high-frequency + dark-spot ratio |
| oiliness | pixel heuristic | no | specular/bright-spot ratio |
| dryness | pixel heuristic | no | HF ratio without specular |
| fine-lines | pixel heuristic | no | HF ratio, periorbital/under-eye |
| wrinkles | pixel heuristic | no | HF ratio + luma std, forehead/periorbital |
| under-eye | pixel heuristic | no | under-eye vs cheek luma delta |
| tone-consistency | pixel heuristic | no | cross-zone luma spread |

**9 of 11 dimensions have never been validated against ground truth.** Their
thresholds (`HF_BASE = 0.008`, `HF_SPAN = 0.05` in `ai/face/analyzers/texture.ts`)
were hand-picked, not fitted. That is why a visibly wrinkled face scored
"wrinkles: none".

Three of them — `dryness`, `under-eye`, `tone-consistency` — are not even in the
annotation panel, so no ground truth is being collected for them at all.

## Clinician labels collected so far

    skintype     27      redness      10      texture      10
    acne         27      wrinkles     10      oiliness     10
                         pores        10      pigmentation 10
                         fine-lines   10

Roughly 10 per dimension. A 4-class severity model needs on the order of
500–2,000 labelled images **per class** to beat a heuristic. We are ~2 orders of
magnitude short.

## Public datasets, and why most of them are a trap

This project already lost four dimension models to source leakage (2026-07-27):
positives came from one corpus and negatives from another, so the model learned
the photographic style, not the skin. It scored 0.96–1.00 and was worthless.
**Any dataset below carries that same risk** unless positives and negatives come
from the same camera, lighting and framing distribution.

### Plausible sources

| Dimension | Candidate | Licence | Leakage risk |
|---|---|---|---|
| wrinkles, fine-lines | age-estimation corpora (UTKFace, APPA-REAL, IMDB-WIKI) | research use, check each | **Medium.** Age correlates with wrinkles but is not the label. Training on age teaches the model to guess age. |
| wrinkles | FFHQ / FFHQ-Aging | non-commercial (FFHQ is CC BY-NC-SA for images) | Medium. Needs its own wrinkle annotation pass. |
| redness | rosacea/erythema classes in DermNet, SD-198, Fitzpatrick17k | varies; several non-commercial | **High.** Clinical dermatology photography, nothing like a phone selfie. |
| pigmentation | melasma / PIH classes in the same corpora | varies | **High.** Same reason. |
| oiliness, pores, texture, dryness | no credible public labelled corpus found | — | — |

For **oiliness, pores, texture and dryness** there is no public dataset that
labels these on ordinary face photographs at severity granularity. Standardised
capture rigs (VISIA and similar) produce this data commercially and it is not
released.

### What was actually downloaded (2026-07-31)

`make fetch-dimension-datasets` → `$DATASETS_DIR/_incoming/` (293 MB, 133 images).
The trainer does NOT read `_incoming`.

| Set | Contents | Feeds |
|---|---|---|
| `trainingdatapro/skin-defects-...` | 10 subjects x 3 angles for each of acne / redness / under-eye bags = 90 images, 3456x4608 | redness, under-eye |
| `trainingdatapro/botox-injections-before-and-after` | 23 before/after pairs = 46 images | wrinkles, fine-lines |

Chosen because one publisher, one capture rig, high resolution, and front/left/
right angles matching what the app captures — so positives and negatives share a
photographic distribution.

**Rejected**, with reasons:

- `rishantrokaha/skin-wrinkles-vs-nonwrinkles` — 9-23 KB images, too compressed
  to show a fine line; wrinkled examples are press/stock photos of older people
  while smooth ones are young selfies, so the model learns style and age.
- `shijo96john/...`, `killa92/...`, `ranvijaybalbir/...` — Roboflow re-exports
  (`.rf.` hashes) from the same corpus family already in `<dim>/multi/`, i.e. the
  one that supplied 497 images reused as "none" for four dimensions at once.
- `drishyatomar/glowmix-merged-...` — 4 GB and explicitly "merged" from multiple
  sources. Merging is the leak.

**These are presence/absence, not severity-graded.** They cannot be trained on
directly; nothing in them says whether redness is mild or severe. Their value is
that they carry the moderate/severe end that the clinic's own data lacks (which
is almost entirely "mild"/"none" — and a model never shown a severe case cannot
predict one).

`make import-for-grading` loads them into the Training Queue as a dedicated
"Imported dataset" patient, with no AI report attached — inventing predictions
for the grader to "verify" would bias the very labels being collected.

Even fully graded, 133 images do not reach 160 per dimension on their own. They
are a head start, not a solution.

### Verdict

Buying accuracy off the shelf is not available for most of these labels. The
realistic paths, in order:

1. **Keep grading in the Training Queue.** It is the only source whose camera,
   lighting and framing match deployment, so it cannot leak. It is already
   running — the panel where 4 of 9 fields were corrected IS the dataset being
   built. This is slow but it is the one that works.
2. **Add the three ungradeable dimensions** (`dryness`, `under-eye`,
   `tone-consistency`) to `ANNOTATION_FIELDS`, or drop them from the report.
   Right now they are shown to patients and can never improve.
3. **Wrinkles/fine-lines via age corpora** is the single most tractable public
   option, but only as *pre-training* — fine-tune on clinic-graded scans, and
   hold out clinic scans for evaluation. Never evaluate on the public set.
4. **Until a dimension has a model, say so.** Done: `DimensionScore.source` and
   `MODELLED_DIMENSIONS` in `shared/face.ts`; the UI shows "estimate" rather
   than a confidence percentage.

## Retrain targets

`ai/training/multi/tasks.py` `TASKS` currently holds `acne` and `skintype`.
Adding a dimension = one entry there plus a source in `collect_rows()`. Do not
add one until it has enough same-source labelled data to beat the heuristic on a
held-out clinic set.

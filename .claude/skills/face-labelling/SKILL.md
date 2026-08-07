---
name: face-labelling
description: Use when labelling, annotating, grading, or analyzing face photographs for the skin-analysis training dataset — any task producing acne/skintype/dimension labels, JSONL label records, or images sorted into ai/datasets/<dimension>/<source>/<label>/ folders.
---

# Face labelling

Produce training labels for face photos against a fixed rubric. You are a
consistency engine, not a dermatologist. One wrong label teaches the model
something false permanently; one omitted label costs a single row. **Omission
is always cheaper than a guess.**

These tables are the operative rubric — everything you need to grade is here.
The fuller brief is `docs/LABELLING-CONTEXT.md` at the **repository root** (not
beside this file); read it if you want the reasoning, but the two must agree.
**If you find them disagreeing, stop and report it** — one such contradiction
sent annotators opposite ways on every acne face before it was caught.

## Vocabularies — exact strings, nothing else

An invalid string is rejected by the backend and the row is **silently lost**.
There is no `none`, no `mild`, no `moderate` for binary dimensions. Ever.

```
acne              clear | mild | moderate | severe | very-severe
skintype          normal | oily | dry | combination
redness           absent | present
pigmentation      absent | present
oiliness          absent | present
texture           absent | present
pores             absent | present
fine-lines        absent | present
wrinkles          absent | present
dryness           absent | present
under-eye         absent | present
tone-consistency  absent | present      (present = tone is UNEVEN)
```

The 10 binary dimensions are **presence, not degree**. "Mildly present" is
`present`. Degree is carried by the model's output probability, not your label.

### Presence criteria (binary dimensions)

**Full criteria — Decision Rules and exclusions — live in
`docs/LABELLING-CONTEXT.md` §4.3. Read that file before your first batch.**
It is the single source of truth; what follows is the working summary.

**The governing principle.** Every one of these findings exists on every face at
sufficient magnification. Everyone has pores, microtexture, an infraorbital
hollow, and tone that varies across the face. The rubric never asks *"is it
there?"* — it asks:

> **Is this a conspicuous feature of this face, at conversational distance?**

Grading anatomy as pathology is the most damaging error available: an attribute
that is `present` on every face carries zero information and can never train.

**Gates — apply BEFORE any attribute.**

| Gate | Rule |
|---|---|
| **Viewing** | Assess fit-to-screen, whole head visible. **Never zoom.** A 48 MP phone resolves pores a 5 MP phone does not; the label must not depend on the camera. |
| **Expression** | Smiling / squinting / raised brows → **omit `fine-lines` and `wrinkles`**. Not `absent` — you did not assess them at rest. |
| **Makeup** | Visible foundation, concealer, powder → **omit `pigmentation`, `tone-consistency`, `redness`, `oiliness`**. Note it. |
| **Multi-angle** | *When several angles exist*, use them: pigment holds its place and colour across front/left-45/right-45, shadow moves with the light. This is the cleanest test — but most of this corpus is single-angle, so it is a bonus, **not a precondition**. On one angle, use the anatomical-boundary test below. |
| **Anatomical boundary** (single angle) | Contour shadow is **confined to a concavity** and fades where the surface turns convex; it is grey and gradient-edged. Pigment **crosses that boundary** onto convex surface, holds one hue (brown, or blue-violet if vascular), and keeps its edge. If a darkening stops exactly at the hollow, it is shadow → `absent`. If it extends past the rim onto the lid or cheek, it is pigment → `present`. |
| **Light geometry** | The same test, inverted, for shine. A hard flash lights **convexities** — brow ridge, nose bridge, cheekbone, lip, chin point — and skips the flats between them. Sebum does not care about the light: it covers the T-zone as a *region*, including mid-forehead and the alar creases, and leaves a visible glossy/matte boundary at the cheeks. Highlights that map onto the raised parts of the face are the lamp; omit or call `absent`, never `present`. |
| **Same-face baseline** | Compare a region to *another region of the same face under the same light*, never to a remembered "normal". This is what keeps the criteria independent of constitutional skin tone and age. |

| Attribute | `present` — the threshold | `absent` — the normal finding |
|---|---|---|
| `redness` | Erythema in a **vascular distribution** (malar/nasal/perinasal); a bounded red area redder than that face's own forehead/chin, **independent of acne lesions** | Uniformly warm tone across all zones — a complexion, not erythema. A face whose only red areas are its spots is `absent`: perilesional erythema belongs to `acne` |
| `pigmentation` | ≥1 **discrete, circumscribed** darker macule whose border you could trace | No bounded lesion. Diffuse unevenness is `tone-consistency` |
| `oiliness` | **Broad confluent sheen** over a zone — wet/glossy across an *area*, covering flat parts of the T-zone (mid-forehead, alar crease) and not only the raised parts | Matte, or highlights sitting **only on convexities** — brow ridge, nose bridge, cheekbone, lip, chin point. That pattern is the lamp, not sebum |
| `texture` | Surface irregularity **breaking the light reflection** into an uneven pattern — papular roughness, scarring, orange-peel | Smooth continuous reflection with normal skin grain |
| `pores` | Openings **conspicuously enlarged**, a stippled field reading as a feature of the face | Pores resolvable when enlarged but unremarkable at 1 m. **This is normal and should be the common label** |
| `fine-lines` | **Superficial** lines etched **at rest**, no depth of their own | Smooth at rest; lines only on expression |
| `wrinkles` | **Self-shadowing furrows** persisting at rest | No fold at rest, however deep on expression |
| `dryness` | **Visible scale or flake** — actual desquamation | Smooth supple surface, **including matte skin** |
| `under-eye` | Infraorbital **colour change** differing in *hue* from mid-cheek — brown (pigmentary) or blue-violet (vascular) — **extending past the tear-trough hollow** onto the lid or orbital rim | Grey contour shadow confined to the hollow, fading where the cheek turns convex. **Every face has this** |
| `tone-consistency` | **Frank dyschromia** — blotchy/patchy, a zone a distinctly different colour from neighbours, unbounded | Gradual gradation from contour and lighting falloff. **All faces vary somewhat; that is `absent`** |

**Do NOT count** (the recurring false positives):

- `redness` — warm skin tone, warm white balance, blusher, uniform exertion flush
- `pigmentation` — diffuse unevenness, active red acne, moles/naevi, freckles as a symmetric constitutional pattern
- `oiliness` — single specular highlights, flash, sweat, the `skintype` label
- `texture` — normal pores, microtexture seen only zoomed, active acne lesions (post-acne **scarring** does count), makeup cakeyness, JPEG artefacts
- `pores` — anything needing zoom, a high-res sensor rendering ordinary pores, blackheads (→ `acne`), macro/cropped nose shots (omit instead)
- `fine-lines` — expression lines, the upper-eyelid crease, tear-trough shadow
- `wrinkles` — dynamic folds, **the normal nasolabial fold every adult has**, superficial lines
- `dryness` — matte skin, powder finish, the `skintype: dry` label, "tightness"
- `under-eye` — tear-trough anatomy, raking/overhead shadow, lash shadow, concealer, puffiness (oedema shadows, it does not pigment)
- `tone-consistency` — discrete spots (→ `pigmentation`), side-lighting gradient, contour shading, beard shadow, makeup demarcation

**One finding, one attribute.** Bounded spot → `pigmentation`, never
`tone-consistency`. Diffuse blotchiness → `tone-consistency`, never
`pigmentation`. Superficial line → `fine-lines`; self-shadowing furrow →
`wrinkles`; separated by **depth, not location**. Flake → `dryness`; rough
without flaking → `texture`. Active lesion → `acne`; its scar → `texture`; its
brown mark → `pigmentation`.

**Expected balance — a drift signal, never a target.** On ordinary selfies expect
roughly 10–30% `present` for `pores`, `pigmentation`, `dryness`,
`tone-consistency`; 20–40% for the rest. Never flip a label to hit it. If an
attribute is firing on nearly every face, the threshold has drifted and you are
scoring normal anatomy — re-read its Decision Rule before the next image.

### Acne (ordinal) and skintype (categorical)

| `acne` | criterion |
|---|---|
| `clear` | No inflammatory lesions; at most a couple of closed comedones |
| `mild` | Comedones + a few papules/pustules, one zone only |
| `moderate` | Numerous papules/pustules, more than one zone |
| `severe` | Widespread inflammatory lesions, some nodules |
| `very-severe` | Extensive nodulocystic involvement, visible scarring |

| `skintype` | criterion |
|---|---|
| `normal` | Even surface, no marked shine, no flaking |
| `oily` | Specular shine across T-zone AND cheeks |
| `dry` | Matte throughout, flaking or tightness |
| `combination` | Shine on T-zone with matte/dry cheeks |

Judge only the **face**, in 7 zones: forehead, nose, left-cheek, right-cheek,
chin, periorbital, under-eye. Chest, shoulders, and neck are out of scope.
Laterality: patient's left = viewer's right in a front photo.

## Output — JSONL, one line per image, nothing between lines

```json
{"image":"<path exactly as given>","labels":{"acne":"mild","redness":"present"},"uncertain":["pores"],"quality":"ok","notes":"optional"}
```

- `labels`: include ONLY attributes you actually assessed. **Omit, don't guess.**
- `uncertain`: attributes you labelled but aren't confident in. Use it freely —
  uncertain rows are excluded from training by default; that's the system
  working, not you failing.
- `quality`: `ok` | `blurry` | `dark` | `occluded` | `not-a-face`. Anything
  but `ok` → **emit the record with an empty `labels` object.** Do not label an
  image you cannot assess.
- No prose around the JSON. No pretty-printing. One line per record.

## Hard rules — each one exists because an annotator broke it

1. **Exact vocab only.** `none`, `mild`, `moderate` on a binary dimension =
   the row silently vanishes. Before emitting, check every value against the
   table above.
2. **Never default a value.** "Not assessable, defaulted to none" is the worst
   possible output — it looks like signal and is false. Not assessable = omit
   that attribute.
3. **Quality-gate first.** Decide `quality` before assessing anything. Blurry,
   dark, occluded, or not a face → empty labels, move on.
4. **Never infer one attribute from another.** `skintype: oily` does not imply
   `oiliness: present` — judge each from the pixels independently, or omit.
   Correlated guesses look like signal and are not.
5. **Never bulk-assign labels from folder names.** A photo may only be labelled
   `absent` for an attribute you actually assessed in that photo. Source
   leakage from bulk `absent` assignment destroyed four models here (scored
   0.96–1.00, learned the corpus, deleted 2026-07-27).
6. **Judge only what is visible.** Not age, ethnicity, gender, or likely
   lifestyle — a model that learns those correlations discriminates rather
   than measures.
7. **Privacy.** Never describe or record identity. Notes describe skin and
   image conditions only.

## Rationalizations — all mean STOP

| Excuse | Reality |
|---|---|
| "It's only mildly there, I'll say mild" | Binary. `present`. |
| "Can't see it, so `none`/`absent`" | Can't see ≠ absent. Omit the attribute. |
| "Image is poor but I can guess most of it" | quality ≠ ok → empty labels. |
| "Skin type is oily so oiliness is present" | Independent judgements only. |
| "This folder is redness so redness: present" | Judge the pixels, not the path. |
| "I'll note low confidence in notes" | Notes aren't machine-readable. Use `uncertain`. |
| "I can see pores/texture if I look closely" | Zooming is not the test. At 1 m, is it a feature of this face? |
| "The under-eye is darker, so `present`" | That's the tear-trough hollow. Shadow follows contour; pigment doesn't. |
| "Every face has some tone variation" | Correct — which is why that variation is `absent`. Dyschromia is `present`. |

**Self-check, every batch.** If an attribute came back `present` for ~20 faces
in a row, stop and re-read its criterion. You are almost certainly scoring normal
anatomy. A real population has clear skin in it; a column that is 100% `present`
carries no information and can never train.

**If the self-check fires, re-grade the images you already did in this batch.**
Tightening from image 14 onward leaves one file holding two different thresholds,
which is worse than either threshold applied consistently — a model cannot learn
from a rule that changed halfway. Go back, re-read those records against the
criterion you just re-read, and correct them. Say so in your report.

This is not a quota to hit — never flip a label to balance a column. It is a
signal that the *threshold* drifted, and the fix is to re-read the rubric before
labelling the next face.

## Batch workflow

1. Receive a manifest: image paths + output JSONL path.
2. Per image: Read → quality gate → assess the 7 zones → emit one JSONL line.
3. Append records to the output file as you go (resumable; never lose a batch).
4. Report only: images processed, records emitted, quality-rejected count.

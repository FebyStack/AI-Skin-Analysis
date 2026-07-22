# Skin-type analyzer — trainable, improvable from app data

A learned facial **skin-type** classifier: `normal, oily, dry, combination`
(`ai/training/skintype/labels.py`). Unlike acne this is **categorical** (no
order) — it's a new report field (`FaceReport.skinType`), not a 0–1 dimension.

Same slot pattern as acne: no model present → the report simply omits `skinType`
(offline-safe, nothing else changes); once `frontend/public/models/skintype/model.onnx`
exists the browser fills it in.

## Where data lives

`$DATASETS_DIR/skintype/` (default `ai/datasets/skintype/`, gitignored). Layouts
read by `ingest.collect_all()`:

```
$DATASETS_DIR/skintype/
  killa92/                 # external dataset, folder-per-class
    normal/*.jpg  oily/*.jpg  dry/*.jpg  combination/*.jpg
  scans/                   # written by the backend export (app-collected data)
    oily/<scanId>.jpg  ...
  my-labels.csv            # or a CSV with columns: path,label
```

**Quick start dataset:** `.venv/bin/python -m ai.training.skintype.fetch_killa92`
(needs `~/.kaggle/kaggle.json`) pulls the killa92 skin-type dataset and also seeds
the acne model's `clear` class from its clear-skin `normal` faces.

## The improvement loop

1. **Collect app data:** clinicians label a scan's skin type in the app → `scan_labels`.
2. **Export labeled scans:** `POST /api/training/skintype/export` (admin) writes each
   labeled scan's JPEG to `$DATASETS_DIR/skintype/scans/<class>/`.
3. **(Optional) add external datasets** as more `skintype/<source>/<class>/` folders.
4. **Train:** `.venv/bin/python -m ai.training.skintype.train_skintype --epochs 30`
   → `ai/models/skintype/candidate/`.
5. **Evaluate:** `.venv/bin/python -m ai.training.skintype.evaluate` — accuracy + macro-F1.
6. **Export ONNX:** `.venv/bin/python -m ai.training.skintype.export_onnx`
   → `frontend/public/models/skintype/model.onnx`. Picked up on next load.

## Note on the source

killa92 labels are dermatological **skin type** (sebum/moisture), captured as
full-face photos — which matches the app's selfie input well. It is a distinct
signal from the acne dimensions (oiliness/dryness there are 0–1 pixel metrics).
As real labeled app scans accrue, retrain to fit your own camera/lighting.

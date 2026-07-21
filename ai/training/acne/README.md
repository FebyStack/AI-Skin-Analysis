# Acne severity analyzer — trainable, improvable from app data

A learned replacement for the deterministic `acneAnalyzer`. It starts as a slot
with a **deterministic fallback** (works with no model), and gets better every
time you retrain on more data — external datasets **and** scans your own app
collected once a clinician labels them.

Severity is 5-level ordinal: `clear, mild, moderate, severe, very-severe`
(`ai/training/acne/labels.py`).

## Where data lives

Everything under `$DATASETS_DIR/acne/` (default `ai/datasets/acne/`, gitignored;
set `DATASETS_DIR` to relocate). Two layouts, both read by `ingest.collect_all()`:

```
$DATASETS_DIR/acne/
  isic-acne/                 # an external dataset, folder-per-severity
    clear/*.jpg  mild/*.jpg  moderate/*.jpg  severe/*.jpg  very-severe/*.jpg
  scans/                     # written by the backend export (app-collected data)
    mild/<scanId>.jpg  moderate/<scanId>.jpg  ...
  my-labels.csv              # or a CSV with columns: path,label
```

Folder names accept aliases (`0..4`, `comedonal`, `nodulocystic`, …) — see labels.py.

## The improvement loop

1. **Collect app data:** clinicians label scans in the app (acne severity). Each
   label is stored in Postgres (`scan_labels`).
2. **Export labeled scans → training set:** `POST /api/training/acne/export`
   (admin) writes each labeled scan's JPEG to `$DATASETS_DIR/acne/scans/<label>/`.
3. **(Optional) add external datasets** as more `acne/<source>/<severity>/` folders.
4. **Train:** `.venv/bin/python -m ai.training.acne.train_acne --epochs 30`
   → `ai/models/acne/candidate/`. Reuses the shared EfficientNet-B0 loop.
5. **Evaluate:** `.venv/bin/python -m ai.training.acne.evaluate` — macro-F1 +
   ordinal MAE on the held-out split.
6. **Export to ONNX (browser):** `.venv/bin/python -m ai.training.acne.export_onnx`
   → `frontend/public/models/acne/model.onnx`. The browser analyzer picks it up
   on next load; the acne dimension now uses the model, others unchanged.
7. **Promote / distribute** through the model registry (upload to
   `/api/models/acne/upload`, promote) so installed PWAs fetch the new version.

Re-run 1–7 as more labeled data accrues. Nothing else in the face pipeline changes.

## Safety / honesty

- No model present → deterministic `acneAnalyzer` runs (offline-safe, never blocks).
- The model only ever overrides the **acne** dimension; the other 10 are untouched.
- Weights + datasets are gitignored; the ONNX export is a distributable artifact.

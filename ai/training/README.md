# Retraining Runbook (manual)

Datasets live under `DATASETS_DIR` (default `ai/datasets/`, gitignored). To use an external disk:
`export DATASETS_DIR=/Volumes/SSD/skin-datasets`.

1. **Ingest** — run each `ai/training/ingest/<source>.py` (needs ISIC/Kaggle accounts) → downloads to
   `$DATASETS_DIR/raw/<source>/` + a `rows.csv` of {path, source_id, raw_label}. Add doctor-approved
   clinic images the same way (a `clinic` source).
2. **Dedup** — `make -C ai dedup`. pHash+ID; removals logged to `$DATASETS_DIR/duplicates/`. Never train on dupes.
3. **Build master** — `make -C ai build-master`. Dedup-before-split; patient-grouped stratified 70/15/15;
   writes `master/{train,val,test}.json` + `manifest.json` (test set frozen by hash).
4. **Train** — `make -C ai train` → `ai/models/candidate/`.
5. **Evaluate** — `make -C ai evaluate` on the frozen test set → writes candidate metrics.
6. **Compare & promote** — `make -C ai promote`. Promotes ONLY if macro-F1 improves AND melanoma
   sensitivity does not regress; else the candidate stays in `candidate/`. Old production is archived.
7. Restart the inference service (or `docker compose restart inference`) to load the new production model.

Never overwrite a model version. Never train on the test set. Never train on duplicates.

Note: `build_master`, `train`, and `evaluate` are libraries today (functions, no argparse `main`);
their Makefile targets will work once CLI entrypoints are added when the real datasets arrive.
`run_dedup` / `run_promote` are thin operator CLIs over the tested functions.

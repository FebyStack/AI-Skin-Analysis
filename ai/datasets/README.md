# Datasets — reproducible, not backed up to iCloud

All image data here is **regenerable from source**, so the fetch commands below
*are* the backup. Images are gitignored and (per 2026-07-22) kept off iCloud to
save disk; re-download when you next train. Label CSVs are small and kept in place.

Set `DATASETS_DIR` to relocate everything (e.g. an external drive).

## Active model data (kept local — small)

| Dataset | Path | Re-fetch |
|---|---|---|
| ACNE04 (acne 5-class) | `acne/acne04/` | `.venv/bin/python -m ai.training.acne.fetch_acne04` |
| killa92 (skin type 4-class) | `skintype/killa92/` | `.venv/bin/python -m ai.training.skintype.fetch_killa92` |

`fetch_killa92` also seeds `acne/clearskin/clear/`. Both need no extra disk to speak of.

## Lesion data (Track 3 — offloaded to save disk, re-fetch when needed)

Label CSVs stay under `raw/isic2019/` and `raw/ham10000/`; only the image dirs are removed.

**ISIC 2019** (~9.2 GB, 25,331 images) — public S3, no login:
```bash
curl -SL -o raw/isic2019/_in.zip \
  "https://isic-challenge-data.s3.amazonaws.com/2019/ISIC_2019_Training_Input.zip"
unzip -q raw/isic2019/_in.zip -d raw/isic2019/
mv raw/isic2019/ISIC_2019_Training_Input raw/isic2019/images   # avoids arg-list-too-long
rm raw/isic2019/_in.zip
```

**HAM10000** (~2.7 GB, 10,015 images) — via Kaggle (kaggle.json already set up):
```bash
.venv/bin/kaggle datasets download -d kmader/skin-cancer-mnist-ham10000 \
  -p raw/ham10000 --unzip
```

Run these from the repo's `ai/datasets/` directory (or adjust paths to `$DATASETS_DIR`).

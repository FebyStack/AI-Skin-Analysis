# Datasets — reproducible, not backed up to iCloud

All image data here is **regenerable from source**, so the fetch commands below
*are* the backup. Images are gitignored and (per 2026-07-22) kept off iCloud to
save disk; re-download when you next train. Label CSVs are small and kept in place.

Set `DATASETS_DIR` to relocate everything (e.g. an external drive).

## Active model data (kept local — small)

| Dataset | Path | Re-fetch |
|---|---|---|
| ACNE04 (acne 5-class) | `acne/acne04/` | `.venv/bin/python -m ai.training.acne.fetch_acne04` |
| acne-grading (more mild/moderate/severe) | `acne/acnegrading/` | Kaggle `rutviklathiyateksun/acne-grading-classificationdataset` (49MB); Level_0/1/2 → mild/moderate/severe, deduped by filename stem against acne04. No Level_3/very-severe. |
| killa92 (skin type 4-class) | `skintype/killa92/` | `.venv/bin/python -m ai.training.skintype.fetch_killa92` |
| multi-condition (redness, wrinkles, pores, pigmentation) | `<dim>/multi/{present,absent}/` | `.venv/bin/kaggle datasets download -d shijo96john/facial-skin-acne-pigmentation-pores-wrinkles -p ai/datasets/raw/_multi` then unzip (do NOT use `--unzip`, it corrupts), then `.venv/bin/python -m ai.training.dimension.fetch_multi` |

`fetch_killa92` also seeds `acne/clearskin/clear/`. Both need no extra disk to speak of.
Note: the full 1.1GB ACNE04 (`lexuanhieu131297/acne-severity-classification`, filename-encoded levels, includes very-severe) is the way to boost the weak very-severe class — retry when on a faster link (large Kaggle downloads drop on slow connections).

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

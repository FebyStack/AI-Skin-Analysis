.PHONY: share up down lan build dimension-readiness label-build label-status label-materialize fetch-dimension-datasets import-for-grading backup restore retrain retrain-acne retrain-skintype retrain-dim retrain-dims retrain-face

# Compose lives in infrastructure/docker/; --env-file keeps root .env interpolation working.
COMPOSE = docker compose -f infrastructure/docker/docker-compose.yml --env-file .env

# --- Model retrain loop -------------------------------------------------------
# Chains train -> evaluate -> export ONNX for a learned face dimension. Reads
# every image under ai/datasets/<dim>/ INCLUDING the scans/ folder that the admin
# export (POST /api/training/<dim>/export) writes — so grade scans in the app first,
# export them, then run this. Override epochs: make retrain-acne EPOCHS=20
# Long runs: prefix to keep the Mac awake — caffeinate -i make retrain
PY = .venv/bin/python
EPOCHS ?= 12

retrain-acne:
	$(PY) -m ai.training.acne.train_acne --epochs $(EPOCHS)
	-$(PY) -m ai.training.acne.evaluate
	$(PY) -m ai.training.acne.export_onnx

retrain-skintype:
	$(PY) -m ai.training.skintype.train_skintype --epochs $(EPOCHS)
	-$(PY) -m ai.training.skintype.evaluate
	$(PY) -m ai.training.skintype.export_onnx

# Any face dimension with a model registry entry (redness/wrinkles/pores/pigmentation):
#   make retrain-dim DIM=redness
retrain-dim:
	@test -n "$(DIM)" || (echo "usage: make retrain-dim DIM=redness" && exit 1)
	$(PY) -m ai.training.dimension.train_dimension --dim $(DIM) --epochs $(EPOCHS)
	-$(PY) -m ai.training.dimension.evaluate --dim $(DIM)
	$(PY) -m ai.training.dimension.export_onnx --dim $(DIM)

# WARNING: models from the multi-condition dataset are confounded (see
# ai/training/dimension/fetch_multi.py) — do not ship their exports.
retrain-dims:
	@for d in redness wrinkles pores pigmentation; do $(MAKE) retrain-dim DIM=$$d || exit 1; done

# Preferred: ONE multi-head model (acne + skin type) for the PWA — a single
# ~15MB download and one forward pass per view instead of one model per task.
retrain-face:
	$(PY) -m ai.training.multi.train_multi --epochs $(EPOCHS)
	-$(PY) -m ai.training.multi.evaluate
	$(PY) -m ai.training.multi.export_onnx

retrain: retrain-face

up:
	$(COMPOSE) up -d

lan:
	$(COMPOSE) -f infrastructure/docker/docker-compose.lan.yml up -d

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

backup:
	$(COMPOSE) exec -T db pg_dump --clean --if-exists -U skin skin > database/backups/backup-$$(date +%Y%m%d-%H%M%S).sql

restore:
	@test -n "$(FILE)" || (echo "usage: make restore FILE=database/backups/backup-....sql" && exit 1)
	cat $(FILE) | $(COMPOSE) exec -T db psql -U skin skin

# Stage the scans that still need annotating. Anything already carrying a label
# for every attribute is skipped, so re-running after new data only offers the
# new work. Partially-labelled scans come back with just their missing fields.
annotate-manifest:
	npx tsx --env-file=.env backend/scripts/annotation-manifest.ts

# Write a labelling run's JSONL into scan_labels. Uncertain fields and
# non-ok-quality images are dropped; existing human grades are never overwritten.
apply-annotations:
	npx tsx --env-file=.env backend/scripts/apply-annotations.ts --dry-run
	@echo "\nAbove is the PLAN. To apply:"
	@echo "  npx tsx --env-file=.env backend/scripts/apply-annotations.ts"

# Rebuild every <dim>/scans/ folder from the CURRENT database labels. The export
# used to append, so deleted scans left their JPEGs behind and re-graded scans
# ended up filed under both labels. Safe to re-run; images come from the DB.
rebuild-export:
	npx tsx --env-file=.env backend/scripts/rebuild-training-export.ts --dry-run
	@echo "\nAbove is the PLAN. To apply:"
	@echo "  npx tsx --env-file=.env backend/scripts/rebuild-training-export.ts"

# Download external face datasets for the severity dimensions. They land in
# $DATASETS_DIR/_incoming/, which the trainer deliberately does NOT read — they
# are presence/absence, not severity-graded, so they must be graded first.
fetch-dimension-datasets:
	$(PY) -m ai.training.dimension.fetch_datasets

# Load those images into the Training Queue so a clinician can grade them.
# Add --dry-run by hand to preview.
import-for-grading:
	npx tsx --env-file=.env backend/scripts/import-for-grading.ts

# How close each skin dimension is to having a real trained model, and what is
# still missing. Counts what is on disk, which is what the trainer reads — so
# grade scans in the queue AND hit "Export graded scans" before expecting moves.
dimension-readiness:
	$(PY) -m ai.training.dimension.readiness

# --- AI annotation of the unlabelled corpus ------------------------------
# Build the work queue once (dedupes, interleaves sources so any prefix stays
# source-balanced), then check progress between labelling sessions.
label-build:
	$(PY) -m ai.training.dimension.labelqueue build
label-status:
	$(PY) -m ai.training.dimension.labelqueue status

# Fold every completed batch into $(DATASETS_DIR)/<attr>/auto/<label>/.
# Idempotent — re-run it after each labelling session. Invalid rows are printed
# and skipped, never silently normalised.
label-materialize:
	@for f in ai/datasets/_labels/batch-*.jsonl; do \
		$(PY) -m ai.training.dimension.materialize "$$f" || true; \
	done

# Expose the local dev server on a public HTTPS URL so remote patients can use a
# private scan link. Cloudflare's quick tunnel needs no account. HTTPS matters:
# getUserMedia refuses to hand over the camera on a plain-http origin.
#
# Wrapped in `caffeinate` because this Mac idles to sleep in ~1 minute, which
# kills the tunnel while a patient is mid-scan. The assertion lasts exactly as
# long as the tunnel runs, so normal sleep behaviour returns the moment you
# Ctrl-C — no system settings are changed.
#   -i  no idle sleep (works on battery too)
#   -s  no system sleep (AC power only)
#   -m  no disk idle sleep
# The display is still allowed to sleep; that saves power and does not stop the
# server. Closing the LID is a different thing entirely and always sleeps the
# machine unless an external display is attached — the link dies with it.
#
# The URL is public. The clinic password and the invite tokens are the only gate,
# so create links with the scan count you actually want and revoke them when done.
share:
	@command -v cloudflared >/dev/null || { echo "cloudflared not found. Install it: brew install cloudflared"; exit 1; }
	@pmset -g batt | grep -q "AC Power" || echo "\n⚠  On battery. Sharing keeps the Mac awake and will drain it — plug in for anything longer than a few minutes.\n"
	@echo "Start the app first (npm run dev:all), then share the https:// URL below."
	@echo "Keep this window open: the link dies when the tunnel stops.\n"
	caffeinate -ism cloudflared tunnel --url https://localhost:5173 --no-tls-verify

# Same wake-lock, without the tunnel — for when you are testing on the LAN and
# just need the machine to stay up.
.PHONY: awake
awake:
	@echo "Holding the Mac awake. Ctrl-C to release."
	caffeinate -ism

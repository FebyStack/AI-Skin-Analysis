.PHONY: up down lan build backup restore retrain retrain-acne retrain-skintype retrain-dim retrain-dims retrain-face

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

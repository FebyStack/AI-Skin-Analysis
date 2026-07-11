.PHONY: install test serve dedup build-master train evaluate promote
PY = ../.venv/bin/python

install:
	../.venv/bin/pip install -r requirements.txt

test:
	cd .. && .venv/bin/python -m pytest ai -q

serve:
	cd .. && .venv/bin/python -m uvicorn ai.service.main:app --port 8000

dedup:
	cd .. && .venv/bin/python -m ai.training.run_dedup
build-master:
	cd .. && .venv/bin/python -m ai.training.build_master
train:
	cd .. && .venv/bin/python -m ai.training.train
evaluate:
	cd .. && .venv/bin/python -m ai.training.evaluate
promote:
	cd .. && .venv/bin/python -m ai.training.run_promote

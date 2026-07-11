.PHONY: install test serve dev-model
PY = ../.venv/bin/python

install:
	../.venv/bin/pip install -r requirements.txt

test:
	cd .. && .venv/bin/python -m pytest ai -q

serve:
	cd .. && .venv/bin/python -m uvicorn ai.service.main:app --port 8000

dev-model:
	cd .. && .venv/bin/python -m ai.training.make_dev_model

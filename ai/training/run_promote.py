"""CLI: gated candidate→production promotion. Operator glue, not unit-tested."""
import json
import sys
from pathlib import Path

from ai.training.promote import decide_promotion, promote


def main() -> None:
    candidate = Path("ai/models/candidate")
    production = Path("ai/models/production")
    cand_json = candidate / "model.json"
    if not cand_json.exists():
        print(f"No candidate model at {cand_json} — run `make -C ai train` first.")
        return
    candidate_meta = json.loads(cand_json.read_text())
    production_meta = None
    prod_json = production / "model.json"
    if prod_json.exists():
        production_meta = json.loads(prod_json.read_text())
        if not production_meta.get("metrics"):
            production_meta = None  # dev/untrained placeholder never blocks promotion
    ok, reason = decide_promotion(candidate_meta, production_meta)
    print(reason)
    if not ok:
        sys.exit(1)
    promote(candidate, production, Path("ai/models/archive"))
    version = json.loads(prod_json.read_text())["version"]
    print(f"Production is now version {version}.")


if __name__ == "__main__":
    main()

"""CLI: dedup all raw rows.csv files into master-input.csv. Operator glue, not unit-tested."""
import pandas as pd

from ai.training.dedup import find_duplicates
from ai.training.paths import datasets_dir, duplicates_dir


def main() -> None:
    csvs = sorted(datasets_dir().glob("raw/*/rows.csv"))
    if not csvs:
        print(f"No rows.csv files under {datasets_dir() / 'raw'} — run the ingest scripts first.")
        return
    rows = pd.concat([pd.read_csv(c) for c in csvs]).to_dict("records")
    keep, dropped = find_duplicates(rows)
    out = datasets_dir() / "master-input.csv"
    pd.DataFrame(keep).to_csv(out, index=False)
    duplicates_dir().mkdir(parents=True, exist_ok=True)
    pd.DataFrame(dropped).to_csv(duplicates_dir() / "duplicates.csv", index=False)
    print(f"{len(rows)} rows in → {len(keep)} kept ({out}), {len(dropped)} duplicates dropped.")


if __name__ == "__main__":
    main()

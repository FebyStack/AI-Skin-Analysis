"""How close each dimension is to having a trainable model.

Run:  make dimension-readiness

Counts what is on disk under $DATASETS_DIR/<dim>/, which is what the trainer
actually reads. Grading a scan in the queue is NOT enough on its own — the
labels have to be exported first:

    POST /api/training/<dimension>/export     (button: "Export graded scans")
"""
from __future__ import annotations

from ai.training.acne.ingest import collect_all as acne_rows
from ai.training.dimension.ingest import SEVERITY_DIMENSIONS, collect_for
from ai.training.dimension.labels import SEVERITY_CLASSES
from ai.training.multi.tasks import MIN_PER_CLASS
from ai.training.skintype.ingest import collect_all as skintype_rows


def _counts(rows: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in rows:
        out[r["label"]] = out.get(r["label"], 0) + 1
    return out


def main() -> None:
    print(f"Trainable when every class has >= {MIN_PER_CLASS} images.\n")

    for name, rows in (("acne", acne_rows()), ("skintype", skintype_rows())):
        c = _counts(rows)
        print(f"  {name:17} TRAINED   {sum(c.values()):>6} rows  {c}")

    print()
    for dim in SEVERITY_DIMENSIONS:
        c = _counts(collect_for(dim))
        total = sum(c.values())
        if total == 0:
            print(f"  {dim:17} no data   0 rows — grade scans, then export")
            continue
        short = {k: MIN_PER_CLASS - c.get(k, 0) for k in SEVERITY_CLASSES if c.get(k, 0) < MIN_PER_CLASS}
        state = "READY" if not short else "short"
        detail = "" if not short else f"  need {short}"
        print(f"  {dim:17} {state:9} {total:>6} rows  {c}{detail}")

    print(
        "\nA dimension with no trained model shows as an 'estimate' in the UI,"
        "\nnot as a confidence percentage. See ai/datasets/DIMENSION-COVERAGE.md."
    )


if __name__ == "__main__":
    main()

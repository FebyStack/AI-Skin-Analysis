"""Refuse to stage a dimension whose two classes come from different corpora.

This is §7.1 of the labelling brief, in code. In July 2026 four dimension models
scored 0.96-1.00 and were deleted as worthless: their positives came from one
corpus and their negatives from another, so the model learned which DATASET a
photo came from — lighting, camera, framing — and not the skin.

Nothing on disk prevented that recurring, and the labelled data shows the same
shape forming again. `redness` present-rate by source, measured at 220 records:

    multi 92% · acne04 63% · acne04full 58% · botox 55% · skindefects 41% · acnegrading 15%

`_multi` ships a curated Redness folder, so its enrichment is genuine rather than
a labelling error — which is exactly why this needs a guard rather than a rubric
fix. Left alone, `redness/auto/present/` fills from one corpus and
`redness/auto/absent/` from another.
"""
from __future__ import annotations

# Total-variation distance between the `present` and `absent` source mixes.
# 0 = both classes drawn from the same corpora in the same proportions.
# 1 = disjoint corpora, i.e. the failure above.
# 0.35 tolerates ordinary sampling wobble and nothing structural.
MAX_TV_DISTANCE = 0.35

# Below this many confident labels in a class, TV distance is noise: with three
# positives, the mix is whichever corpus happened to supply them, and the guard
# would block every dimension early in a run. Blocking on noise trains people to
# pass --allow-skew reflexively, which is how a guard stops working. Judge only
# once there is enough data for the number to mean something.
MIN_FOR_JUDGEMENT = 10


def tv_distance(a: dict[str, int], b: dict[str, int]) -> float:
    """Total-variation distance between two source histograms.

    An empty class returns 1.0 — "no negatives at all" is maximally skewed, not
    perfectly balanced, and must never read as a pass.
    """
    na, nb = sum(a.values()), sum(b.values())
    if not na or not nb:
        return 1.0
    return 0.5 * sum(
        abs(a.get(s, 0) / na - b.get(s, 0) / nb) for s in set(a) | set(b)
    )


def source_skew(dimension: str, records: list[dict], source_of: dict[str, str]) -> dict:
    """How differently one dimension's two classes are sourced.

    Counts only what would actually train: quality-ok rows, minus anything the
    annotator flagged uncertain. Counting the rest would hide real skew behind
    labels that never reach the model.
    """
    mix: dict[str, dict[str, int]] = {}
    for rec in records:
        if rec.get("quality") != "ok":
            continue
        if dimension in set(rec.get("uncertain") or ()):
            continue
        label = (rec.get("labels") or {}).get(dimension)
        src = source_of.get(rec.get("image"))
        if label is None or src is None:
            continue
        mix.setdefault(label, {})
        mix[label][src] = mix[label].get(src, 0) + 1
    present, absent = mix.get("present", {}), mix.get("absent", {})
    d = tv_distance(present, absent)
    thin = min(sum(present.values()), sum(absent.values())) < MIN_FOR_JUDGEMENT
    return {
        "dimension": dimension,
        "mix": mix,
        "tv_distance": round(d, 3),
        "insufficient": thin,
        # A thin class is not a pass — it is "no verdict yet". Callers that
        # enforce must treat `insufficient` as "do not judge", not "approved".
        "ok": bool(thin or d <= MAX_TV_DISTANCE),
    }

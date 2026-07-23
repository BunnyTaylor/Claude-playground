"""crochet_core -- pattern engine for the mushroom dress.

Pure, dependency-free, no I/O. ``compute_pattern(input)`` is the whole API:
give it gauges + body measurements, get back a structured pattern with
written round-by-round instructions and exact running stitch counts.

All internal maths is in CENTIMETRES. Input may be cm or inches; conversion
happens once at the boundary. Never mix units downstream.

This is a faithful port of the original ``crochet-core.mjs``. The test
contract in ``test_crochet_core.py`` locks in the same invariants as the
JavaScript original -- keep it green through any refactor.

A note on rounding: JavaScript's ``Math.round`` rounds half *up*
(``Math.round(4.5) === 5``), whereas Python's built-in ``round`` uses
banker's rounding (``round(4.5) == 4``). The engine's known-good values
depend on half-up behaviour, so we use :func:`_jsround` everywhere the
original used ``Math.round``.
"""

from __future__ import annotations

import copy
import math
from typing import Any, Dict, List

# ------------------------------------------------------------------ #
# Units
# ------------------------------------------------------------------ #

CM_PER_IN = 2.54


def to_cm(v: float, unit: str) -> float:
    """Convert a value in ``unit`` ('cm' or 'in') to centimetres."""
    return v * CM_PER_IN if unit == "in" else v


def from_cm(cm: float, unit: str) -> float:
    """Convert a value in centimetres to the display ``unit``."""
    return cm / CM_PER_IN if unit == "in" else cm


def _jsround(n: float) -> int:
    """Round half *up*, matching JavaScript's ``Math.round``.

    ``_jsround(4.5) == 5`` and ``_jsround(-1.5) == -1``, unlike Python's
    banker's-rounding built-in. The engine's reference stitch counts depend
    on this.
    """
    return math.floor(n + 0.5)


def _r1(n: float) -> float:
    """Round to one decimal place (half up)."""
    return _jsround(n * 10) / 10


def even(n: float) -> int:
    """Rib worked fpdc/bpdc must pair up, so its stitch count has to be even."""
    n = int(n)
    return n + 1 if n % 2 else n


def mult(n: float, m: int) -> int:
    """Round ``n`` to the nearest multiple of ``m`` (min one full repeat)."""
    return max(m, _jsround(n / m) * m)


# ------------------------------------------------------------------ #
# Gauge
# ------------------------------------------------------------------ #

# A gauge is a dict: {"sts", "rows", "width", "height"}. Swatches are never
# exactly 10cm in practice, and stitch gauge and row gauge may be measured
# over different distances on a non-square swatch -- so the measured width
# and height are carried explicitly rather than assumed.


def density(g: Dict[str, float], unit: str) -> Dict[str, float]:
    """Convert a gauge dict into stitches-per-cm and rows-per-cm.

    Returns ``{"st": stitches_per_cm, "row": rows_per_cm}``.
    Raises ``ValueError`` on a non-positive swatch or count.
    """
    w = to_cm(g["width"], unit)
    h = to_cm(g["height"], unit)
    if not (w > 0) or not (h > 0):
        raise ValueError("gauge swatch size must be positive")
    if not (g["sts"] > 0) or not (g["rows"] > 0):
        raise ValueError("gauge counts must be positive")
    return {"st": g["sts"] / w, "row": g["rows"] / h}


# ------------------------------------------------------------------ #
# Shaping primitives
# ------------------------------------------------------------------ #


def inc_plan(
    start: int,
    target: int,
    total_rnds: int,
    stitch: str,
    setup_rnds: int = 1,
) -> Dict[str, Any]:
    """Plan a run of increase rounds taking ``start`` sts to ``target``.

    INVARIANT: the returned ``finalCount`` equals ``target`` exactly. Naive
    "add N every M rounds" arithmetic silently under- or over-delivers by the
    rounding remainder; this distributes the remainder into the last round.

    INVARIANT: every round's written instruction consumes exactly ``before``
    stitches and produces exactly ``after``.

    Returns ``{"rounds": [...], "every": int, "finalCount": int}`` where each
    round is ``{"rnd", "before", "after", "add", "text"}``.
    """
    total = target - start
    out: Dict[str, Any] = {"rounds": [], "every": 0, "finalCount": start}
    if total <= 0:
        return out

    chunk = max(4, _jsround(start * 0.08))
    n = max(1, _jsround(total / chunk))
    usable = max(1, total_rnds - setup_rnds - 1)
    if n > usable:
        n = usable  # never schedule shaping past the end of the piece

    every = max(1, math.floor(usable / n))
    per = math.floor(total / n)
    rem = total - per * n

    cur = start
    for i in range(1, n + 1):
        add = per + (rem if i == n else 0)
        before = cur
        interval = math.floor(before / add)
        tail = before - interval * add

        if interval <= 1:
            text = f"2 {stitch} in each of first {add} sts, {stitch} in each rem st"
        else:
            text = (
                f"*{stitch} in each of next {interval - 1} sts, 2 {stitch} in next st; "
                f"rep from * {add} times"
                + (f", {stitch} in each of last {tail} sts" if tail > 0 else "")
            )

        cur += add
        out["rounds"].append(
            {"rnd": setup_rnds + i * every, "before": before, "after": cur, "add": add, "text": text}
        )

    out["every"] = every
    out["finalCount"] = cur
    return out


def even_adjust(frm: int, to: int, stitch: str) -> str:
    """Write a single round that changes the stitch count from ``frm`` to ``to``.

    WHY THIS EXISTS: pieces worked at different gauges cannot be joined
    stitch-for-stitch. Ribbing is compressed, so crocheting one hdc into every
    rib stitch produces a skirt far wider than the waistband it hangs from.
    Every gauge boundary in this garment needs one of these rounds.

    INVARIANT: consumes exactly ``frm``, produces exactly ``to``.
    """
    if to == frm:
        return f"{stitch} in each st around"

    if to < frm:
        dec = frm - to
        iv = math.floor(frm / dec)
        if iv < 3:
            return (
                f"*{stitch}2tog; rep from * {dec} times, "
                f"{stitch} in each of last {frm - 2 * dec} sts"
            )
        tail = frm - iv * dec
        return (
            f"*{stitch} in each of next {iv - 2} sts, {stitch}2tog; rep from * {dec} times"
            + (f", {stitch} in each of last {tail} sts" if tail > 0 else "")
        )

    inc = to - frm
    iv = math.floor(frm / inc)
    if iv < 1:
        return f"2 {stitch} in each st around, then {stitch} evenly to {to} sts"
    tail = frm - iv * inc
    return (
        f"*{stitch} in each of next {iv - 1} sts, 2 {stitch} in next st; rep from * {inc} times"
        + (f", {stitch} in each of last {tail} sts" if tail > 0 else "")
    )


# ------------------------------------------------------------------ #
# Colourwork chart
# ------------------------------------------------------------------ #


def spot_chart(dia_cm: float, gap_mult: float, st_per_cm: float, row_per_cm: float) -> Dict[str, Any]:
    """Build an elliptical spot chart sized to the sc gauge.

    WHY AN ELLIPSE: crochet stitches are not square. A spot specified as a
    circle in centimetres needs different stitch and row counts, or it comes
    out visibly oval. Width and height are derived independently from the
    stitch and row densities.

    INVARIANT: for every row, ``lead + w + trail == repW``.
    """
    W = max(2, _jsround(dia_cm * st_per_cm))
    H = max(2, _jsround(dia_cm * row_per_cm))
    gap_h = max(2, _jsround(dia_cm * gap_mult * st_per_cm))
    gap_v = max(2, _jsround(dia_cm * gap_mult * row_per_cm))
    rep_w = W + gap_h
    rep_h = H + gap_v

    rows = []
    for i in range(H):
        y = ((i + 0.5) / H) * 2 - 1  # normalised -1..1 through the ellipse
        w = _jsround(W * math.sqrt(max(0.0, 1 - y * y)))
        w = min(W, max(1, w))
        lead = math.floor((rep_w - w) / 2)
        rows.append({"w": w, "lead": lead, "trail": rep_w - w - lead})

    return {"W": W, "H": H, "gapH": gap_h, "gapV": gap_v, "repW": rep_w, "repH": rep_h, "rows": rows}


# ------------------------------------------------------------------ #
# Input
# ------------------------------------------------------------------ #

# Sensible starting point -- DK cotton, 3.5mm hook, average measurements.
DEFAULT_INPUT: Dict[str, Any] = {
    "unit": "cm",
    "gauges": {
        "rib": {"sts": 18, "rows": 9, "width": 10, "height": 10},
        "hdc": {"sts": 14, "rows": 11, "width": 10, "height": 10},
        "sc": {"sts": 16, "rows": 18, "width": 10, "height": 10},
    },
    "body": {
        "bust": 92, "waist": 74, "upperBust": 84, "hip": 98,
        "upperArm": 30, "wrist": 16, "skirtLen": 45, "sleeveLen": 50,
    },
    "style": {
        "waistEase": -5,   # negative ease; the band must grip
        "fullness": 2.0,   # hem circumference as a multiple of waist
        "flare": 1.8,      # flounce ruffle multiplier
        "balloon": 1.4,    # sleeve volume multiplier
        "dotDia": 2.5,
        "dotGap": 1.2,     # gap as a multiple of spot diameter
    },
    "colors": {"cap": "cap colour", "spot": "spot colour", "body": "body colour"},
}


def default_input() -> Dict[str, Any]:
    """Return a fresh deep copy of :data:`DEFAULT_INPUT`, safe to mutate."""
    return copy.deepcopy(DEFAULT_INPUT)


# ------------------------------------------------------------------ #
# The pattern
# ------------------------------------------------------------------ #


def compute_pattern(input_: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Compute the full nine-piece pattern.

    Piece order is also the recommended construction order -- the waistband is
    the fit anchor and everything else hangs off it.

    Returns ``{"pieces": [...], "meta": {...}, "warnings": [...]}``.
    """
    if input_ is None:
        input_ = DEFAULT_INPUT

    u = input_.get("unit", "cm")
    C = {**DEFAULT_INPUT["colors"], **(input_.get("colors") or {})}
    S = {**DEFAULT_INPUT["style"], **(input_.get("style") or {})}
    B = {**DEFAULT_INPUT["body"], **(input_.get("body") or {})}
    G = {**DEFAULT_INPUT["gauges"], **(input_.get("gauges") or {})}

    rib = density(G["rib"], u)
    hdc = density(G["hdc"], u)
    sc = density(G["sc"], u)

    # body measurements -> cm
    waist = to_cm(B["waist"], u)
    upper_bust = to_cm(B["upperBust"], u)
    hip = to_cm(B["hip"], u)
    upper_arm = to_cm(B["upperArm"], u)
    wrist = to_cm(B["wrist"], u)
    skirt_len = to_cm(B["skirtLen"], u)
    sleeve_len = to_cm(B["sleeveLen"], u)
    dot_dia = to_cm(S["dotDia"], u)

    warnings: List[str] = []

    def H(cm: float) -> str:
        return f"{_r1(from_cm(cm, u))} {u}"

    pieces: List[Dict[str, Any]] = []

    # --- 1. waistband (rib) ---
    wb_circ = waist + S["waistEase"]
    wb_sts = even(_jsround(wb_circ * rib["st"]))
    wb_rnds = max(4, _jsround(12 * rib["row"]))
    pieces.append({
        "id": "waistband",
        "title": "Fitted waistband",
        "stitch": "in the round · fpdc/bpdc rib",
        "counts": {"sts": wb_sts, "rounds": wb_rnds, "circumference": wb_circ},
        "steps": [
            ["Foundation", f"Ch {wb_sts}. Taking care not to twist, join with sl st to form a ring."],
            ["Rnd 1", f"Ch 1, sc in each ch around, join. ({wb_sts} sc)"],
            ["Rnd 2", f"Ch 2, *fpdc in next st, bpdc in next st; rep from * around, join. ({wb_sts} sts)"],
            [f"Rnds 3–{wb_rnds}", "Rep Rnd 2."],
            ["Finish", "Fasten off. Test it stretches over your hips before continuing."],
        ],
    })

    # --- 2. skirt (hdc) ---
    hem_circ = wb_circ * S["fullness"]
    hem_sts = _jsround(hem_circ * hdc["st"])
    sk_rnds = max(6, _jsround(skirt_len * hdc["row"]))
    sk_start = _jsround(waist * hdc["st"])  # skirt top sits at true waist
    sk_join = even_adjust(wb_sts, sk_start, "hdc")
    sk_plan = inc_plan(sk_start, hem_sts, sk_rnds, "hdc", 1)
    if hem_sts <= sk_start:
        warnings.append("Hem is no wider than the waist — raise fullness or check hdc gauge.")
    pieces.append({
        "id": "skirt",
        "title": "A-line skirt",
        "stitch": "in the round, downward · hdc",
        "counts": {"start": sk_start, "end": sk_plan["finalCount"], "rounds": sk_rnds, "incRounds": len(sk_plan["rounds"])},
        "steps": [
            ["Set-up", f"Join to the lower edge of the waistband. Ch 2, {sk_join}, join. ({wb_sts} rib sts → {sk_start} hdc)"],
            ["Plain rnds", "Ch 2, hdc in each st around, join. Rep for every round not listed."],
            *[[f"Rnd {x['rnd']}", f"Ch 2, {x['text']}, join. ({x['after']} hdc)"] for x in sk_plan["rounds"]],
            ["Finish", f"Work plain to Rnd {sk_rnds}. Fasten off. ({sk_plan['finalCount']} hdc)"],
        ],
    })

    # --- 3. flounce (sc) ---
    fl_top = _jsround(upper_bust * sc["st"])
    fl_bot = _jsround(fl_top * S["flare"])
    fl_rnds = max(5, _jsround(16 * sc["row"]))
    fl_plan = inc_plan(fl_top, fl_bot, fl_rnds, "sc", 1)
    pieces.append({
        "id": "flounce",
        "title": "Off-shoulder flounce",
        "stitch": "in the round · sc tapestry",
        "counts": {"start": fl_top, "end": fl_plan["finalCount"], "rounds": fl_rnds},
        "steps": [
            ["Foundation", f"In {C['cap']}, ch {fl_top}. Join to form a ring, not twisting."],
            ["Rnd 1", f"Ch 1, sc in each ch around, join. ({fl_top} sc)"],
            *[[f"Rnd {x['rnd']}", f"Ch 1, {x['text']}, join. ({x['after']} sc)"] for x in fl_plan["rounds"]],
            ["Finish", f"Work plain to Rnd {fl_rnds}. Thread elastic through Rnd 1. ({fl_plan['finalCount']} sc)"],
        ],
    })

    # --- 4. spots (colourwork chart) ---
    chart = spot_chart(dot_dia, S["dotGap"], sc["st"], sc["row"])
    reps_around = max(1, math.floor(fl_top / chart["repW"]))
    fl_adj = reps_around * chart["repW"]
    pieces.append({
        "id": "spots",
        "title": "Polka spots",
        "stitch": "tapestry sc · carry both colours",
        "counts": {
            "spotW": chart["W"], "spotH": chart["H"], "repeatW": chart["repW"],
            "repeatH": chart["repH"], "repsAround": reps_around, "adjustedSts": fl_adj,
        },
        "chart": chart,
        "steps": [
            ["Stitch count", f"Adjust the flounce from {fl_top} to {fl_adj} sts so {reps_around} repeats fit exactly — otherwise the last spot is cut in half at the join."],
            ["Colour change", "Change colour on the LAST pull-through of the stitch BEFORE the one you want in the new colour."],
            ["Carrying", "Lay the resting colour along the top of the stitches and work over it. No floats."],
            *[[f"Rnd {i + 1}", f"*sc {row['lead']} in {C['cap']}, sc {row['w']} in {C['spot']}, sc {row['trail']} in {C['cap']}; rep from * {reps_around} times."] for i, row in enumerate(chart["rows"])],
            [f"Rnds {chart['H'] + 1}–{chart['repH']}", f"Sc in {C['cap']} around, carrying {C['spot']}."],
            ["Stagger", f"Shift the next band by {_jsround(chart['repW'] / 2)} sts so spots brick rather than stack."],
        ],
    })

    # --- 5. sleeves (rib cuff -> sc body) ---
    cuff_sts = even(_jsround((wrist + 2) * rib["st"]))
    sc_cuff = _jsround((wrist + 2) * sc["st"])
    bal_sts = _jsround(upper_arm * S["balloon"] * sc["st"])
    top_sts = _jsround((upper_arm + 4) * sc["st"])
    cuff_rnds = max(3, _jsround(5 * rib["row"]))
    sl_rnds = max(cuff_rnds + 6, cuff_rnds + _jsround((sleeve_len - 5) * sc["row"]))
    sleeve_steps: List[List[str]] = [
        ["Foundation", f"In {C['cap']}, ch {cuff_sts}. Join to form a ring."],
        ["Rnd 1", f"Ch 1, sc in each ch around, join. ({cuff_sts} sc)"],
        ["Cuff rib", f"Ch 2, *fpdc, bpdc; rep from * around, join. Rep to Rnd {cuff_rnds}."],
        [f"Rnd {cuff_rnds + 1}", f"Ch 1, {even_adjust(cuff_sts, sc_cuff, 'sc')}, join. ({cuff_sts} rib sts → {sc_cuff} sc)"],
    ]
    cur = sc_cuff
    rnd = cuff_rnds + 1
    if bal_sts > sc_cuff * 2:
        rnd += 1
        sleeve_steps.append([f"Rnd {rnd}", f"Ch 1, 2 sc in each st around, join. ({sc_cuff * 2} sc)"])
        cur = sc_cuff * 2
    if bal_sts > cur:
        rnd += 1
        sleeve_steps.append([f"Rnd {rnd}", f"Ch 1, {even_adjust(cur, bal_sts, 'sc')}, join. ({bal_sts} sc)"])
        cur = bal_sts
    straight_to = max(rnd + 1, sl_rnds - 2)
    sleeve_steps.append([f"Rnds {rnd + 1}–{straight_to}", f"Ch 1, sc around, join. Work spots as charted. ({cur} sc)"])
    if cur > top_sts:
        sleeve_steps.append([f"Rnd {straight_to + 1}", f"Ch 1, {even_adjust(cur, top_sts, 'sc')}, join. ({top_sts} sc)"])
    sleeve_steps.append(["Finish", "Fasten off. Thread elastic through the final round."])
    pieces.append({
        "id": "sleeves",
        "title": "Lantern sleeves ×2",
        "stitch": "in the round, cuff up · rib + sc",
        "counts": {"cuff": cuff_sts, "balloon": bal_sts, "top": top_sts, "rounds": sl_rnds},
        "steps": sleeve_steps,
        "makeCount": 2,
    })

    # --- 6. gill frill ---
    gill_base = mult(fl_plan["finalCount"], 6)
    gill_rnds = max(4, _jsround(5 * sc["row"]))
    pieces.append({
        "id": "gillFrill",
        "title": "Gill frill (under flounce)",
        "stitch": "in the round · shell edging",
        "counts": {"base": gill_base, "rounds": gill_rnds + 2, "shells": gill_base // 6},
        "steps": [
            ["Set-up", f"In {C['body']}, join to the flounce edge. Sc evenly around to {gill_base} sc (multiple of 6). Join."],
            ["Body", f"Ch 1, sc around, join. Rep to Rnd {gill_rnds}."],
            ["Shells", f"Ch 1, *sc in next st, sk 2, 5 dc in next st, sk 2; rep from * around, join. ({gill_base // 6} shells)"],
            ["Picots", "Ch 1, *sc, (ch 3, sl st in 3rd ch from hook), sc; rep from * around, join."],
            ["Finish", "Fasten off and block so the shells open."],
        ],
    })

    # --- 7. hem frill ---
    frill_base = mult(sk_plan["finalCount"], 6)
    frill_full = _jsround(frill_base * 1.6)
    frill_rnds = max(5, _jsround(9 * hdc["row"]))
    pieces.append({
        "id": "hemFrill",
        "title": "Skirt hem frill",
        "stitch": "in the round · hdc + shells",
        "counts": {"base": frill_base, "full": frill_full, "rounds": frill_rnds + 2},
        "steps": [
            ["Set-up", f"In {C['body']}, join to the skirt hem. Hdc evenly around to {frill_base} hdc (multiple of 6). Join."],
            ["Flare", f"Ch 2, *hdc in next 2 sts, 2 hdc in next; rep from * around, join. ({frill_full} hdc)"],
            ["Body", f"Ch 2, hdc around, join. Rep to Rnd {frill_rnds}."],
            ["Shells", "Ch 1, *sc, sk 2, 5 dc in next st, sk 2; rep from * around, join."],
            ["Finish", "Fasten off and block the frill open."],
        ],
    })

    # --- 8. mushroom border ---
    motifs = max(6, _jsround(hem_circ / 7))
    pieces.append({
        "id": "border",
        "title": "Mushroom border",
        "stitch": "surface embroidery",
        "counts": {"motifs": motifs, "spacing": hem_circ / motifs},
        "steps": [
            ["Placement", f"Mark {motifs} points around the skirt, ~{H(hem_circ / motifs)} apart, above the frill join."],
            ["Caps", f"Embroider a cap and stem at each in {C['cap']}, surface slip stitch or duplicate stitch."],
            ["Spots", f"Tiny {C['spot']} French knots on each cap."],
            ["Timing", "AFTER the skirt is finished and blocked — embroidering as you go distorts the increase rounds."],
        ],
    })

    # --- 9. straps ---
    strap_len = 48
    strap_sts = _jsround(strap_len * sc["st"])
    pieces.append({
        "id": "straps",
        "title": "Bowtie shoulder straps ×2",
        "stitch": "flat · sc",
        "counts": {"chain": strap_sts + 3, "sts": strap_sts + 2, "length": strap_len},
        "steps": [
            ["Make 2", f"In {C['cap']}, ch {strap_sts + 3}. Sc in 2nd ch from hook and each ch across. ({strap_sts + 2} sc)"],
            ["Rows 2–3", "Ch 1, turn, sc across. Rep once."],
            ["Attach", "Sew to the front and back of the flounce; tie in bows at the shoulders."],
            ["Blocking", "Wet-block the whole dress, easing both frills open."],
        ],
        "makeCount": 2,
    })

    # --- fit warnings the maker genuinely needs ---
    if hip > 0 and wb_circ * 1.35 < hip:
        warnings.append("Waistband may not stretch over your hips — seam it and test before crocheting the skirt.")

    def chk_gauge(label: str, d: Dict[str, float]) -> None:
        if d["st"] * 10 < 6 or d["st"] * 10 > 44 or d["row"] * 10 < 4 or d["row"] * 10 > 50:
            warnings.append(f"The {label} gauge looks unusual — check the swatch size matches the distance counted.")

    chk_gauge("rib", rib)
    chk_gauge("hdc", hdc)
    chk_gauge("sc", sc)

    return {
        "pieces": pieces,
        "warnings": warnings,
        "meta": {
            "unit": u,
            "density": {"rib": rib, "hdc": hdc, "sc": sc},
            "waistbandCirc": wb_circ,
            "hemCirc": hem_circ,
            "skirtTopSts": sk_start,
            "colors": C,
        },
    }


# Backwards-compatible aliases mirroring the JS export names, so the test
# contract can import the same identifiers.
computePattern = compute_pattern
incPlan = inc_plan
evenAdjust = even_adjust
spotChart = spot_chart
toCm = to_cm
fromCm = from_cm

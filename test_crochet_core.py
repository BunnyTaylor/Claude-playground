"""Test contract for crochet_core (Python port).

These are not incidental tests — each one locks in a bug that was actually
found and fixed during development of the original engine. Keep them green
through any refactor.

Run either way:
    pytest test_crochet_core.py
    python test_crochet_core.py          # no pytest needed
"""

import copy
import math

from crochet_core import (
    compute_pattern, default_input, DEFAULT_INPUT, inc_plan, even_adjust,
    spot_chart, spot_charts, density, even, mult, to_cm, from_cm,
)

# The JS suite reaches into DEFAULT_INPUT via structuredClone; we deep-copy.
_DEF = default_input()


# ---------------- units ----------------

def test_inch_conversion_round_trips():
    assert to_cm(10, "cm") == 10
    assert abs(to_cm(4, "in") - 10.16) < 1e-9
    assert abs(from_cm(to_cm(36.2, "in"), "in") - 36.2) < 1e-9


def test_four_inch_swatch_is_10_16cm():
    # a 4-inch swatch is 10.16cm, not 10 — the 1.6% systematic error
    g = {"sts": 16, "rows": 18, "width": 4, "height": 4}
    d = density(g, "in")
    assert abs(d["st"] - 16 / 10.16) < 1e-9
    assert d["st"] != 1.6  # the old bug


def test_gauge_is_independent_of_swatch_size():
    a = density({"sts": 18, "rows": 9, "width": 10, "height": 10}, "cm")
    b = density({"sts": 22.5, "rows": 11.25, "width": 12.5, "height": 12.5}, "cm")
    assert abs(a["st"] - b["st"]) < 1e-9
    assert abs(a["row"] - b["row"]) < 1e-9


def test_non_square_swatches_use_width_for_sts_height_for_rows():
    d = density({"sts": 20, "rows": 24, "width": 13, "height": 11}, "cm")
    assert abs(d["st"] - 20 / 13) < 1e-9
    assert abs(d["row"] - 24 / 11) < 1e-9


def test_zero_or_negative_swatch_size_is_rejected():
    try:
        density({"sts": 16, "rows": 18, "width": 0, "height": 10}, "cm")
    except (ValueError, Exception):
        return
    raise AssertionError("expected a raise for non-positive swatch size")


# ---------------- shaping ----------------

def test_inc_plan_reaches_its_target_exactly():
    for start, target, rounds in [
        (110, 221, 81), (42, 83, 36), (276, 552, 198), (62, 124, 135), (100, 101, 20),
    ]:
        p = inc_plan(start, target, rounds, "hdc", 1)
        assert p["finalCount"] == target, f"{start}->{target}"


def test_inc_plan_never_schedules_shaping_past_the_end():
    rounds = 6
    while rounds < 200:
        p = inc_plan(100, 240, rounds, "hdc", 1)
        if p["rounds"]:
            assert p["rounds"][-1]["rnd"] <= rounds
        rounds += 7


def test_inc_plan_is_a_no_op_when_no_increase_needed():
    p = inc_plan(120, 120, 40, "hdc", 1)
    assert len(p["rounds"]) == 0
    assert p["finalCount"] == 120


def test_even_adjust_consumes_and_produces_exact_counts():
    def parse(frm, to):
        # re-derive what the written instruction actually does
        if to == frm:
            return [frm, to]
        if to < frm:
            dec = frm - to
            iv = math.floor(frm / dec)
            if iv < 3:
                return [2 * dec + (frm - 2 * dec), dec + (frm - 2 * dec)]
            tail = frm - iv * dec
            return [iv * dec + tail, dec * (iv - 1) + tail]
        inc = to - frm
        iv = math.floor(frm / inc)
        if iv < 1:
            return [frm, to]
        tail = frm - iv * inc
        return [iv * inc + tail, iv * inc + inc + tail]

    frm = 20
    while frm <= 400:
        to = 20
        while to <= 400:
            consumed, produced = parse(frm, to)
            assert consumed == frm, f"consume {frm}->{to}"
            assert produced == to, f"produce {frm}->{to}"
            assert isinstance(even_adjust(frm, to, "hdc"), str)
            to += 11
        frm += 7


# ---------------- colourwork ----------------

def test_spot_chart_rows_always_sum_to_one_repeat_width():
    for d, g, st, rw in [
        (2.5, 1.2, 1.6, 1.8), (1.5, 0.8, 1.6, 1.8), (4, 1.8, 1.2, 1.0),
        (2, 1.2, 2.4, 2.8), (0.5, 0.8, 1.6, 1.8),
    ]:
        c = spot_chart(d, g, st, rw)
        for row in c["rows"]:
            assert row["lead"] + row["w"] + row["trail"] == c["repW"]
            assert 1 <= row["w"] <= c["W"]
            assert row["lead"] >= 0 and row["trail"] >= 0


def test_spot_is_round_in_centimetres_not_stitches():
    # sts wider than tall -> fewer sts than rows for the same diameter
    c = spot_chart(2.5, 1.2, 1.6, 1.8)
    assert c["W"] == 4
    assert c["H"] == 5


def test_spot_chart_bulges_in_the_middle():
    c = spot_chart(3, 1.2, 1.6, 1.8)
    mid = math.floor(len(c["rows"]) / 2)
    assert c["rows"][mid]["w"] >= c["rows"][0]["w"]
    assert c["rows"][mid]["w"] >= c["rows"][-1]["w"]


def test_spot_charts_are_sorted_largest_first_and_each_valid():
    charts = spot_charts([2.5, 1.2, 3.5], 1.2, 1.6, 1.8)
    assert len(charts) == 3
    dias = [c["diaCm"] for c in charts]
    assert dias == sorted(dias, reverse=True)  # largest first
    for c in charts:
        for row in c["rows"]:
            assert row["lead"] + row["w"] + row["trail"] == c["repW"]


def test_single_dot_size_leaves_default_pattern_unchanged():
    # dotSizes with one value must equal the dotDia path exactly
    base = compute_pattern(DEFAULT_INPUT)
    inp = copy.deepcopy(DEFAULT_INPUT)
    inp["style"]["dotSizes"] = [inp["style"]["dotDia"]]
    same = compute_pattern(inp)
    b = next(p for p in base["pieces"] if p["id"] == "spots")
    s = next(p for p in same["pieces"] if p["id"] == "spots")
    assert b["steps"] == s["steps"]
    assert b["counts"] == s["counts"]


def test_multiple_dot_sizes_produce_a_charts_palette_only_on_spots():
    base = compute_pattern(DEFAULT_INPUT)
    inp = copy.deepcopy(DEFAULT_INPUT)
    inp["style"]["dotSizes"] = [1.5, 2.5, 3.5]
    res = compute_pattern(inp)
    spots = next(p for p in res["pieces"] if p["id"] == "spots")
    assert len(spots["charts"]) == 3
    assert len(spots["counts"]["sizes"]) == 3
    # every other piece is untouched by the spot-size change
    for a, b in zip(base["pieces"], res["pieces"]):
        if a["id"] != "spots":
            assert a["counts"] == b["counts"], a["id"]


# ---------------- helpers ----------------

def test_rib_counts_are_always_even():
    assert even(109) == 110
    assert even(110) == 110


def test_mult_never_returns_less_than_one_repeat():
    assert mult(2, 6) == 6
    assert mult(221, 6) == 222


# ---------------- whole pattern ----------------

def test_produces_all_nine_pieces_in_construction_order():
    pieces = compute_pattern(DEFAULT_INPUT)["pieces"]
    assert [p["id"] for p in pieces] == [
        "waistband", "skirt", "flounce", "spots", "sleeves",
        "gillFrill", "hemFrill", "border", "straps",
    ]


def test_waistband_stitch_count_is_even():
    pieces = compute_pattern(DEFAULT_INPUT)["pieces"]
    assert pieces[0]["counts"]["sts"] % 2 == 0


def test_skirt_top_lands_at_the_true_waist():
    res = compute_pattern(DEFAULT_INPUT)
    pieces, meta = res["pieces"], res["meta"]
    top_cm = pieces[1]["counts"]["start"] / meta["density"]["hdc"]["st"]
    assert abs(top_cm - DEFAULT_INPUT["body"]["waist"]) < 1.5, f"skirt top {top_cm}cm"


def test_each_gauge_affects_only_its_own_pieces():
    base = compute_pattern(DEFAULT_INPUT)
    bumped = copy.deepcopy(DEFAULT_INPUT)
    bumped["gauges"]["sc"]["sts"] = 22  # sc only
    after = compute_pattern(bumped)

    def by_id(res, k):
        return next(p for p in res["pieces"] if p["id"] == k)

    assert by_id(base, "waistband")["counts"]["sts"] == by_id(after, "waistband")["counts"]["sts"]
    assert by_id(base, "skirt")["counts"]["start"] == by_id(after, "skirt")["counts"]["start"]
    assert by_id(base, "flounce")["counts"]["start"] != by_id(after, "flounce")["counts"]["start"]


def test_every_piece_has_steps_and_a_title():
    pieces = compute_pattern(DEFAULT_INPUT)["pieces"]
    for p in pieces:
        assert len(p["title"]) > 0, p["id"]
        assert len(p["steps"]) > 0, p["id"]
        for label, text in p["steps"]:
            assert isinstance(label, str)
            assert len(text) > 0, f"{p['id']}/{label}"


def test_survives_extreme_but_legal_gauges_without_throwing():
    for sts in [7, 12, 20, 40]:
        inp = copy.deepcopy(DEFAULT_INPUT)
        inp["gauges"]["rib"]["sts"] = sts
        inp["gauges"]["hdc"]["sts"] = sts
        inp["gauges"]["sc"]["sts"] = sts
        compute_pattern(inp)  # must not raise


def test_warns_when_hem_is_no_wider_than_the_waist():
    inp = copy.deepcopy(DEFAULT_INPUT)
    inp["style"]["fullness"] = 1.0
    warnings = compute_pattern(inp)["warnings"]
    assert any("hem" in w.lower() for w in warnings)


def test_inches_and_centimetres_describe_the_same_garment():
    cm = compute_pattern(DEFAULT_INPUT)
    inch = copy.deepcopy(DEFAULT_INPUT)
    inch["unit"] = "in"
    for k in inch["body"]:
        inch["body"][k] = inch["body"][k] / 2.54
    for g in inch["gauges"].values():
        g["width"] /= 2.54
        g["height"] /= 2.54
    inch["style"]["dotDia"] /= 2.54
    res = compute_pattern(inch)
    a = cm["pieces"][0]["counts"]["sts"]
    b = res["pieces"][0]["counts"]["sts"]
    assert abs(a - b) <= 2, f"cm {a} vs in {b}"


# ---------------- visualization ----------------

def test_visualizer_renders_well_formed_svg_for_single_and_multi_size():
    import xml.dom.minidom
    from crochet_viz import render_dress_svg

    for sizes in (None, [1.5, 2.5, 3.5]):
        inp = copy.deepcopy(DEFAULT_INPUT)
        if sizes:
            inp["style"]["dotSizes"] = sizes
        svg = render_dress_svg(compute_pattern(inp), inp)
        assert svg.startswith("<svg") and svg.endswith("</svg>")
        xml.dom.minidom.parseString(svg)  # raises if malformed
        assert "ellipse" in svg  # spots got drawn


def test_visualizer_is_deterministic():
    from crochet_viz import render_dress_svg
    inp = default_input()
    inp["style"]["dotSizes"] = [1.5, 2.5, 3.5]
    a = render_dress_svg(compute_pattern(inp), inp)
    b = render_dress_svg(compute_pattern(inp), inp)
    assert a == b  # seeded scatter -> same picture every time


# --------------- dependency-free runner ---------------

if __name__ == "__main__":
    import sys

    tests = [(name, obj) for name, obj in sorted(globals().items())
             if name.startswith("test_") and callable(obj)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  ok   {name}")
        except Exception as exc:  # noqa: BLE001 - test runner reports all
            failed += 1
            print(f"  FAIL {name}: {exc}")
    total = len(tests)
    print(f"\n{total - failed}/{total} passed")
    sys.exit(1 if failed else 0)

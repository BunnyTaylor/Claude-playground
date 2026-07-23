#!/usr/bin/env python3
"""crochet_cli -- command-line pattern generator for the mushroom dress.

Thin renderer over ``crochet_core.compute_pattern``. It builds the pattern
input from a JSON config file and/or command-line flags, then prints the
full round-by-round pattern to the terminal.

Examples:
    # Generate the default pattern (DK cotton, average measurements)
    python crochet_cli.py

    # Your own numbers, in inches
    python crochet_cli.py --unit in --waist 29 --hip 38 --bust 36

    # Save the current settings, edit them, and reload
    python crochet_cli.py --waist 70 --dump-config me.json
    python crochet_cli.py --config me.json

    # Just one piece, or machine-readable output
    python crochet_cli.py --piece skirt
    python crochet_cli.py --json > pattern.json

Config files are plain JSON matching the ``compute_pattern`` input shape;
flags override whatever the config (or the built-in default) provides.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict

from crochet_core import compute_pattern, default_input, from_cm, _r1


# --------------------------------------------------------------------------- #
# ANSI colour (auto-disabled when not a TTY or when --no-color is given)
# --------------------------------------------------------------------------- #

class Style:
    def __init__(self, enabled: bool) -> None:
        self.on = enabled

    def _wrap(self, code: str, s: str) -> str:
        return f"\033[{code}m{s}\033[0m" if self.on else s

    def bold(self, s: str) -> str:   return self._wrap("1", s)
    def dim(self, s: str) -> str:    return self._wrap("2", s)
    def red(self, s: str) -> str:    return self._wrap("38;5;131", s)
    def cream(self, s: str) -> str:  return self._wrap("38;5;223", s)
    def moss(self, s: str) -> str:   return self._wrap("38;5;107", s)
    def head(self, s: str) -> str:   return self._wrap("1;38;5;131", s)


# --------------------------------------------------------------------------- #
# Argument -> input mapping
# --------------------------------------------------------------------------- #

# flag name -> (input section, key). Body/style/color live in nested dicts.
_BODY = {
    "bust": "bust", "waist": "waist", "upper_bust": "upperBust", "hip": "hip",
    "upper_arm": "upperArm", "wrist": "wrist", "skirt_len": "skirtLen",
    "sleeve_len": "sleeveLen",
}
_STYLE = {
    "waist_ease": "waistEase", "fullness": "fullness", "flare": "flare",
    "balloon": "balloon", "dot_dia": "dotDia", "dot_gap": "dotGap",
}
_COLORS = {"cap_color": "cap", "spot_color": "spot", "body_color": "body"}
# gauge flags are e.g. rib_sts -> ("rib", "sts")
_GAUGE_STITCHES = ("rib", "hdc", "sc")
_GAUGE_FIELDS = {"sts": "sts", "rows": "rows", "w": "width", "h": "height"}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="crochet_cli.py",
        description="Made-to-measure mushroom-dress crochet pattern generator.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Examples:", 1)[1] if "Examples:" in __doc__ else None,
    )
    p.add_argument("--config", metavar="FILE", help="load a JSON config as the base input")
    p.add_argument("--unit", choices=["cm", "in"], help="measurement unit (default cm)")

    b = p.add_argument_group("body measurements")
    for flag in _BODY:
        b.add_argument(f"--{flag.replace('_', '-')}", type=float, dest=flag)

    s = p.add_argument_group("style")
    for flag in _STYLE:
        s.add_argument(f"--{flag.replace('_', '-')}", type=float, dest=flag)
    s.add_argument("--dot-sizes", dest="dot_sizes", metavar="A,B,C",
                   help="comma-separated spot diameters for a scattered mix (e.g. 1.5,2.5,3.5)")

    g = p.add_argument_group("gauge (per stitch: sts / rows over w x h)")
    for st in _GAUGE_STITCHES:
        for f in _GAUGE_FIELDS:
            g.add_argument(f"--{st}-{f}", type=float, dest=f"{st}_{f}")

    c = p.add_argument_group("colour names (appear in the written pattern)")
    for flag in _COLORS:
        c.add_argument(f"--{flag.replace('_', '-')}", dest=flag, metavar="NAME")

    o = p.add_argument_group("output")
    o.add_argument("--piece", metavar="ID", help="show only one piece (e.g. skirt, sleeves)")
    o.add_argument("--yarn", action="store_true", help="append a rough yarn estimate")
    o.add_argument("--json", action="store_true", help="emit the full result as JSON")
    o.add_argument("--svg", metavar="FILE", help="also write an SVG dress visualization to FILE")
    o.add_argument("--dump-config", metavar="FILE", help="write the resolved input to FILE and exit")
    o.add_argument("--no-chart", action="store_true", help="skip the ASCII spot chart")
    o.add_argument("--no-color", action="store_true", help="disable ANSI colour")
    return p


def resolve_input(args: argparse.Namespace) -> Dict[str, Any]:
    """Merge default input <- config file <- explicit flags."""
    inp = default_input()
    if args.config:
        with open(args.config, encoding="utf-8") as fh:
            loaded = json.load(fh)
        # shallow-merge each known section so a partial config is fine
        for section in ("gauges", "body", "style", "colors"):
            if section in loaded:
                inp[section].update(loaded[section])
        if "unit" in loaded:
            inp["unit"] = loaded["unit"]

    if args.unit:
        inp["unit"] = args.unit
    for flag, key in _BODY.items():
        if getattr(args, flag) is not None:
            inp["body"][key] = getattr(args, flag)
    for flag, key in _STYLE.items():
        if getattr(args, flag) is not None:
            inp["style"][key] = getattr(args, flag)
    if getattr(args, "dot_sizes", None):
        sizes = [float(x) for x in args.dot_sizes.replace(" ", "").split(",") if x]
        if sizes:
            inp["style"]["dotDia"] = sizes[0]
            if len(sizes) > 1:
                inp["style"]["dotSizes"] = sizes
    for flag, key in _COLORS.items():
        if getattr(args, flag) is not None:
            inp["colors"][key] = getattr(args, flag)
    for st in _GAUGE_STITCHES:
        for f, key in _GAUGE_FIELDS.items():
            val = getattr(args, f"{st}_{f}")
            if val is not None:
                inp["gauges"][st][key] = val
    return inp


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #

def render_chart(chart: Dict[str, Any], colors: Dict[str, str], sty: Style) -> str:
    """One repeat of the spot chart as ASCII: '#' = spot, '.' = cap."""
    lines = []
    spot_cell, cap_cell = sty.cream("██"), sty.red("░░")
    for r in range(chart["repH"]):
        cells = []
        for c in range(chart["repW"]):
            on = False
            if r < chart["H"]:
                row = chart["rows"][r]
                on = row["lead"] <= c < row["lead"] + row["w"]
            cells.append(spot_cell if on else cap_cell)
        lines.append("  " + "".join(cells))
    key = sty.dim(
        f"  {chart['W']}x{chart['H']} st spot · {chart['repW']}x{chart['repH']} repeat"
        f" · {sty.cream('██')}={colors['spot']} {sty.red('░░')}={colors['cap']}"
    )
    return "\n".join(lines) + "\n" + key


def render_piece(piece: Dict[str, Any], sty: Style, show_chart: bool) -> str:
    out = []
    title = piece["title"]
    if piece.get("makeCount", 1) > 1 and "×" not in title:
        title = f"{title} (make {piece['makeCount']})"
    bar = "─" * max(len(title) + 2, 40)
    out.append(sty.head(f"┌{bar}┐"))
    out.append(sty.head(f"│ {title}"))
    out.append(sty.dim(f"│ {piece['stitch']}"))
    out.append(sty.head(f"└{bar}┘"))

    counts = ", ".join(f"{k}: {v}" for k, v in piece["counts"].items() if k != "sizes")
    out.append("  " + sty.moss(counts))
    out.append("")

    for label, text in piece["steps"]:
        out.append(f"  {sty.bold(label.ljust(12))}  {text}")

    if show_chart and "chart" in piece:
        out.append("")
        out.append(render_chart(piece["chart"], _colors_from_piece_context(piece), sty))
    return "\n".join(out)


def _colors_from_piece_context(piece: Dict[str, Any]) -> Dict[str, str]:
    # The spots piece text references colour names; fall back to generic labels.
    return {"cap": "cap", "spot": "spot"}


def render(result: Dict[str, Any], inp: Dict[str, Any], sty: Style,
           only: str | None, show_chart: bool) -> str:
    out = []
    unit = result["meta"]["unit"]
    meta = result["meta"]

    if only is None:
        out.append(sty.head("═" * 52))
        out.append(sty.head("  MUSHROOM DRESS — made-to-measure crochet pattern"))
        out.append(sty.head("═" * 52))
        d = meta["density"]
        out.append(sty.dim(
            f"  gauge/10{unit}:  "
            f"rib {_r1(d['rib']['st'] * 10)}st  "
            f"hdc {_r1(d['hdc']['st'] * 10)}st  "
            f"sc {_r1(d['sc']['st'] * 10)}st"
        ))
        out.append(sty.dim(
            f"  waistband {_r1(from_cm(meta['waistbandCirc'], unit))}{unit}"
            f" · hem {_r1(from_cm(meta['hemCirc'], unit))}{unit}"
        ))
        out.append("")

    if result["warnings"]:
        out.append(sty.red("  ⚠ FIT WARNINGS"))
        for w in result["warnings"]:
            out.append(sty.red(f"    • {w}"))
        out.append("")

    pieces = result["pieces"]
    if only:
        pieces = [p for p in pieces if p["id"] == only]
        if not pieces:
            ids = ", ".join(p["id"] for p in result["pieces"])
            return f"No piece '{only}'. Available: {ids}"

    for i, piece in enumerate(pieces):
        out.append(render_piece(piece, sty, show_chart))
        if i < len(pieces) - 1:
            out.append("")
    return "\n".join(out)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #

def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        inp = resolve_input(args)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error: could not read config: {exc}", file=sys.stderr)
        return 2

    if args.dump_config:
        try:
            with open(args.dump_config, "w", encoding="utf-8") as fh:
                json.dump(inp, fh, indent=2)
                fh.write("\n")
        except OSError as exc:
            print(f"error: could not write config: {exc}", file=sys.stderr)
            return 2
        print(f"Wrote resolved config to {args.dump_config}")
        return 0

    try:
        result = compute_pattern(inp)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.svg:
        try:
            from crochet_viz import render_dress_svg
            with open(args.svg, "w", encoding="utf-8") as fh:
                fh.write(render_dress_svg(result, inp))
        except OSError as exc:
            print(f"error: could not write SVG: {exc}", file=sys.stderr)
            return 2
        print(f"Wrote visualization to {args.svg}")

    if args.json:
        # strip the chart's nested rows down for compact JSON? keep it full.
        print(json.dumps(result, indent=2))
        return 0

    enabled = (not args.no_color) and sys.stdout.isatty()
    sty = Style(enabled)
    print(render(result, inp, sty, args.piece, not args.no_chart))
    if args.yarn and not args.piece:
        print()
        print(render_yarn(result, sty))
    return 0


def render_yarn(result: Dict[str, Any], sty: Style) -> str:
    from crochet_core import estimate_yarn
    y = estimate_yarn(result)
    u = y["unit"]
    prefer_yd = u == "in"

    def amt(c) -> str:
        return f"{c['yards']} yd" if prefer_yd else f"{c['meters']} m"

    out = [sty.head("  YARN ESTIMATE") + sty.dim(f"  (rough · +{y['wastePct']}% for ends & joins)")]
    for k in ("cap", "body", "spot"):
        c = y["byColor"].get(k)
        if c and c["meters"] > 0:
            out.append(f"    {sty.bold(c['name'].ljust(14))} {amt(c)}")
    out.append(sty.moss(f"    {'total'.ljust(14)} {amt(y['total'])}"))
    return "\n".join(out)


if __name__ == "__main__":
    raise SystemExit(main())

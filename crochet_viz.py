"""crochet_viz -- render a computed pattern as a front-view SVG of the dress.

Pure, dependency-free (stdlib only). ``render_dress_svg(result, input)`` turns
the output of :func:`crochet_core.compute_pattern` into a stylised but
proportional picture of the finished dress, so a maker can *see* it before
committing yarn: the off-shoulder flounce, lantern sleeves, fitted waist and
A-line skirt, sized by the same measurements that drive the pattern, with
scattered spots in whatever sizes the design specifies.

The silhouette is scaled from the real circumferences, so fuller skirts look
fuller and a bigger flare reads as a bigger flare. Spots are placed with a
seeded RNG, so the same input always yields the same picture.
"""

from __future__ import annotations

import html
import random
from typing import Any, Dict, List, Optional

from crochet_core import to_cm

# Default palette, from the original reference design (amanita mushroom).
DEFAULT_PALETTE = {
    "cap": "#B83A2B",       # amanita red — flounce, sleeves
    "capDeep": "#7C271F",
    "spot": "#FCF8EF",      # ivory — the dots
    "body": "#F2E4C9",      # oat — skirt, frills
    "moss": "#6F824F",
    "line": "#e4cfb0",
    "bg": "#F3DEDE",
}


def _e(v: float) -> str:
    """Format a number for SVG (trim trailing zeros)."""
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def render_dress_svg(
    result: Dict[str, Any],
    inp: Dict[str, Any],
    palette: Optional[Dict[str, str]] = None,
    width: int = 520,
    height: int = 820,
    schematic: bool = False,
) -> str:
    """Return an SVG string picturing the dress described by ``result``.

    ``result`` is a :func:`crochet_core.compute_pattern` return value; ``inp``
    is the input that produced it (for measurements and spot sizes). ``palette``
    optionally overrides the default hex colours (keys: cap, spot, body).
    ``schematic=True`` overlays the finished measurements as labelled callouts.
    """
    pal = {**DEFAULT_PALETTE, **(palette or {})}
    meta = result["meta"]
    u = meta["unit"]
    body = {**inp.get("body", {})}
    style = {**inp.get("style", {})}

    def cm(v: float) -> float:
        return to_cm(v, u)

    # --- measurements in cm ---
    upper_bust = cm(body.get("upperBust", 84))
    waistband = meta["waistbandCirc"]          # already cm
    hem = meta["hemCirc"]                       # already cm
    upper_arm = cm(body.get("upperArm", 30))
    skirt_len = cm(body.get("skirtLen", 45))
    sleeve_len = cm(body.get("sleeveLen", 50))
    flare = style.get("flare", 1.8)
    balloon = style.get("balloon", 1.4)

    cx = width / 2

    # Scale so the waistband half-width is a comfortable ~62px; everything else
    # follows in true proportion (clamped so wild inputs still fit the frame).
    half_waist_cm = max(waistband / 2, 1)
    scale = 62.0 / half_waist_cm

    def halfw(circ_cm: float, cap_frac: float = 0.42) -> float:
        return min(width * cap_frac, (circ_cm / 2) * scale)

    fl_top_half = halfw(upper_bust, 0.34)
    fl_bot_half = min(width * 0.44, fl_top_half * _lerp(1.15, 1.5, min(flare / 2.2, 1)))
    waist_half = halfw(waistband, 0.30)
    hem_half = halfw(hem, 0.46)

    # --- vertical layout (px) ---
    y_shoulder = 84
    y_fl_top = 96
    fl_h = 150
    y_fl_bot = y_fl_top + fl_h
    y_waist = y_fl_bot + 46
    # skirt length scaled but framed
    skirt_h = max(150, min(height - y_waist - 70, skirt_len * scale * 1.15))
    y_hem = y_waist + skirt_h

    parts: List[str] = []

    # ---------- background ----------
    parts.append(f'<rect x="0" y="0" width="{width}" height="{height}" fill="{pal["bg"]}"/>')
    # soft vignette
    parts.append(
        f'<ellipse cx="{cx}" cy="{height*0.5:.0f}" rx="{width*0.62:.0f}" ry="{height*0.55:.0f}" '
        f'fill="#ffffff" opacity="0.18"/>'
    )

    # ---------- bodice (behind everything) ----------
    # A body-colour torso from bust to waist, so the off-shoulder flounce and
    # the skirt read as one garment rather than two floating pieces.
    y_bod_top = 116
    bod_top_half = min(width * 0.30, (upper_bust / 2) * scale * 0.88)
    waist_half_pre = min(width * 0.30, (meta["waistbandCirc"] / 2) * scale)
    parts.append(
        f'<path d="M {_e(cx - bod_top_half)} {_e(y_bod_top)} L {_e(cx + bod_top_half)} {_e(y_bod_top)} '
        f'L {_e(cx + waist_half_pre)} {_e(y_waist)} L {_e(cx - waist_half_pre)} {_e(y_waist)} Z" '
        f'fill="{pal["body"]}" opacity="0.55"/>'
    )

    # ---------- sleeves (lantern) ----------
    sl_top_half = 24
    sl_bulge = min(70, (upper_arm * balloon / 2) * scale * 0.9)
    sl_len = min(230, max(150, sleeve_len * scale * 0.9))
    y_sl_top = y_fl_top + 6
    y_sl_bot = y_sl_top + sl_len
    y_sl_mid = y_sl_top + sl_len * 0.55

    spot_regions: List[Dict[str, float]] = []

    for side in (-1, 1):
        ox = cx + side * (fl_top_half - 6)
        # a lantern: narrow at shoulder, bulging, gathered at cuff
        outer = ox + side * sl_bulge
        cuff_half = 20
        path = (
            f'M {_e(ox)} {_e(y_sl_top)} '
            f'C {_e(ox + side*sl_bulge*1.1)} {_e(y_sl_top + 12)}, '
            f'{_e(outer)} {_e(y_sl_mid - 30)}, {_e(outer)} {_e(y_sl_mid)} '
            f'C {_e(outer)} {_e(y_sl_mid + 40)}, {_e(ox + side*cuff_half)} {_e(y_sl_bot - 14)}, '
            f'{_e(ox + side*cuff_half)} {_e(y_sl_bot)} '
            f'L {_e(ox - side*cuff_half)} {_e(y_sl_bot)} '
            f'C {_e(ox - side*cuff_half)} {_e(y_sl_bot - 40)}, {_e(ox)} {_e(y_sl_mid + 30)}, '
            f'{_e(ox)} {_e(y_sl_mid)} '
            f'C {_e(ox)} {_e(y_sl_mid - 40)}, {_e(ox)} {_e(y_sl_top + 20)}, {_e(ox)} {_e(y_sl_top)} Z'
        )
        parts.append(f'<path d="{path}" fill="{pal["cap"]}" stroke="{pal["capDeep"]}" stroke-width="2"/>')
        # ribbed cuff
        parts.append(
            f'<rect x="{_e(ox - cuff_half)} " y="{_e(y_sl_bot-10)}" width="{_e(2*cuff_half)}" height="12" '
            f'rx="4" fill="{pal["capDeep"]}"/>'
        )
        # a spot region roughly covering the sleeve bulge
        rx = min(ox, outer) if side < 0 else ox
        spot_regions.append({
            "x0": min(ox, outer) + 6, "x1": max(ox, outer) - 6,
            "y0": y_sl_top + 20, "y1": y_sl_mid + 30, "density": 0.55,
        })

    # ---------- skirt (A-line, body colour) ----------
    skirt = (
        f'M {_e(cx - waist_half)} {_e(y_waist)} '
        f'L {_e(cx + waist_half)} {_e(y_waist)} '
        f'L {_e(cx + hem_half)} {_e(y_hem)} '
        f'Q {_e(cx)} {_e(y_hem + 20)} {_e(cx - hem_half)} {_e(y_hem)} Z'
    )
    parts.append(f'<path d="{skirt}" fill="{pal["body"]}" stroke="{pal["line"]}" stroke-width="2"/>')

    # ---------- hem frill (scalloped) ----------
    scallops = 14
    frill = [f'M {_e(cx - hem_half)} {_e(y_hem)}']
    for i in range(scallops):
        t0 = i / scallops
        t1 = (i + 1) / scallops
        x0 = _lerp(cx - hem_half, cx + hem_half, t0)
        x1 = _lerp(cx - hem_half, cx + hem_half, t1)
        y0 = _lerp(y_hem, y_hem + 20, abs(0.5 - t0) * 2 * -1 + 1) if False else y_hem + (14 if 0 < i < scallops else 0)
        frill.append(f'Q {_e((x0+x1)/2)} {_e(y_hem + 30)} {_e(x1)} {_e(y_hem + 6)}')
    parts.append(
        '<path d="' + " ".join(frill) + f'" fill="none" stroke="{pal["body"]}" stroke-width="7" '
        f'stroke-linecap="round" opacity="0.9"/>'
    )

    # ---------- waistband (ribbed) ----------
    parts.append(
        f'<rect x="{_e(cx - waist_half)}" y="{_e(y_waist - 12)}" width="{_e(2*waist_half)}" height="18" '
        f'rx="3" fill="{pal["capDeep"]}"/>'
    )
    for i in range(int(2 * waist_half // 6)):
        rx = cx - waist_half + 3 + i * 6
        parts.append(f'<line x1="{_e(rx)}" y1="{_e(y_waist-11)}" x2="{_e(rx)}" y2="{_e(y_waist+5)}" stroke="{pal["cap"]}" stroke-width="1" opacity="0.4"/>')

    # ---------- flounce (off-shoulder, cap colour) ----------
    flounce = (
        f'M {_e(cx - fl_top_half)} {_e(y_fl_top)} '
        f'L {_e(cx + fl_top_half)} {_e(y_fl_top)} '
        f'L {_e(cx + fl_bot_half)} {_e(y_fl_bot)} '
        f'Q {_e(cx)} {_e(y_fl_bot + 18)} {_e(cx - fl_bot_half)} {_e(y_fl_bot)} Z'
    )
    parts.append(f'<path d="{flounce}" fill="{pal["cap"]}" stroke="{pal["capDeep"]}" stroke-width="2"/>')
    # top elastic edge
    parts.append(
        f'<line x1="{_e(cx - fl_top_half)}" y1="{_e(y_fl_top)}" x2="{_e(cx + fl_top_half)}" y2="{_e(y_fl_top)}" '
        f'stroke="{pal["capDeep"]}" stroke-width="3" stroke-linecap="round"/>'
    )

    # ---------- gill frill under the flounce (pale scallops) ----------
    gill = [f'M {_e(cx - fl_bot_half)} {_e(y_fl_bot)}']
    gscal = 12
    for i in range(gscal):
        t1 = (i + 1) / gscal
        x0 = _lerp(cx - fl_bot_half, cx + fl_bot_half, i / gscal)
        x1 = _lerp(cx - fl_bot_half, cx + fl_bot_half, t1)
        gill.append(f'Q {_e((x0+x1)/2)} {_e(y_fl_bot + 22)} {_e(x1)} {_e(y_fl_bot + 4)}')
    parts.append('<path d="' + " ".join(gill) + f'" fill="none" stroke="{pal["body"]}" stroke-width="6" stroke-linecap="round" opacity="0.85"/>')

    # flounce spot region
    spot_regions.append({
        "x0": cx - fl_bot_half + 8, "x1": cx + fl_bot_half - 8,
        "y0": y_fl_top + 12, "y1": y_fl_bot - 8, "density": 1.0,
        "taper": (fl_top_half, fl_bot_half, y_fl_top, y_fl_bot, cx),
    })

    # ---------- straps ----------
    for side in (-1, 1):
        x0 = cx + side * fl_top_half * 0.7
        parts.append(
            f'<path d="M {_e(x0)} {_e(y_fl_top)} Q {_e(x0 + side*10)} {_e(y_shoulder-8)} {_e(x0 + side*4)} {_e(y_shoulder-14)}" '
            f'fill="none" stroke="{pal["cap"]}" stroke-width="5" stroke-linecap="round"/>'
        )

    # ---------- spots (various sizes) ----------
    # radii come from the design's spot sizes, in cm -> px
    spots_piece = next((p for p in result["pieces"] if p["id"] == "spots"), None)
    sizes_cm: List[float] = []
    if spots_piece and spots_piece.get("charts"):
        sizes_cm = [c["diaCm"] for c in spots_piece["charts"]]
    if not sizes_cm:
        sizes_cm = [cm(style.get("dotDia", 2.5))]
    # Spots are small at true scale; boost for legibility while keeping the
    # size *differences* clearly visible. Keep as a list (not a set) so a
    # weighted random pick draws the full range of sizes.
    spot_scale = scale * 2.2
    radii = sorted((max(3.0, (d / 2) * spot_scale) for d in sizes_cm), reverse=True)
    n_sizes = len({round(d, 2) for d in sizes_cm})

    seed = int((round(upper_bust * 7) + round(hem * 13) + round(sum(radii) * 17)) % 2147483647)
    rng = random.Random(seed)

    def in_taper(x: float, y: float, region: Dict[str, Any]) -> bool:
        t = region.get("taper")
        if not t:
            return True
        top_h, bot_h, y0, y1, ccx = t
        frac = (y - y0) / max(1e-6, (y1 - y0))
        h = _lerp(top_h, bot_h, max(0.0, min(1.0, frac))) - 6
        return abs(x - ccx) <= h

    placed: List[tuple] = []
    for region in spot_regions:
        area = max(1.0, (region["x1"] - region["x0"]) * (region["y1"] - region["y0"]))
        count = int(area / 2600 * region["density"]) + 3
        attempts = 0
        made = 0
        while made < count and attempts < count * 40:
            attempts += 1
            r = radii[rng.randrange(len(radii))] * rng.uniform(0.82, 1.12)
            x = rng.uniform(region["x0"] + r, region["x1"] - r)
            y = rng.uniform(region["y0"] + r, region["y1"] - r)
            if not in_taper(x, y, region):
                continue
            if any((x - px) ** 2 + (y - py) ** 2 < (r + pr + 4) ** 2 for px, py, pr in placed):
                continue
            placed.append((x, y, r))
            made += 1
            parts.append(
                f'<ellipse cx="{_e(x)}" cy="{_e(y)}" rx="{_e(r)}" ry="{_e(r*0.92)}" '
                f'fill="{pal["spot"]}" opacity="0.96"/>'
            )

    # ---------- mushroom motifs along the hem ----------
    border_piece = next((p for p in result["pieces"] if p["id"] == "border"), None)
    n_mush = 7
    if border_piece:
        n_mush = max(3, min(11, int(border_piece["counts"].get("motifs", 7))))
    for i in range(n_mush):
        t = (i + 0.5) / n_mush
        mx = _lerp(cx - hem_half * 0.9, cx + hem_half * 0.9, t)
        my = y_hem - 26
        _mushroom(parts, mx, my, 9, pal)

    # ---------- schematic measurement callouts ----------
    if schematic:
        ink = "#5b4038"

        def hlabel(half: float, y: float, label: str) -> None:
            x2 = width - 116
            parts.append(f'<line x1="{_e(cx + half)}" y1="{_e(y)}" x2="{_e(x2)}" y2="{_e(y)}" stroke="{ink}" stroke-width="1" stroke-dasharray="2 2"/>')
            parts.append(f'<circle cx="{_e(cx + half)}" cy="{_e(y)}" r="2.2" fill="{ink}"/>')
            parts.append(f'<text x="{_e(x2 + 5)}" y="{_e(y + 4)}" font-family="Nunito,sans-serif" font-size="11.5" fill="{ink}">{html.escape(label)}</text>')

        hlabel(fl_top_half, y_fl_top, f"upper bust {_fmt(upper_bust, u)}")
        hlabel(waist_half, y_waist, f"waist {_fmt(meta['waistbandCirc'], u)}")
        hlabel(hem_half, y_hem, f"hem {_fmt(hem, u)}")

        # vertical skirt-length dimension on the left
        lx = 48
        parts.append(f'<line x1="{lx}" y1="{_e(y_waist)}" x2="{lx}" y2="{_e(y_hem)}" stroke="{ink}" stroke-width="1"/>')
        for yy in (y_waist, y_hem):
            parts.append(f'<line x1="{lx - 4}" y1="{_e(yy)}" x2="{lx + 4}" y2="{_e(yy)}" stroke="{ink}" stroke-width="1"/>')
        parts.append(f'<text x="{lx + 7}" y="{_e((y_waist + y_hem) / 2)}" font-family="Nunito,sans-serif" font-size="11.5" fill="{ink}">skirt {html.escape(_fmt(skirt_len, u))}</text>')

    # ---------- caption ----------
    parts.append(
        f'<text x="{cx}" y="{height-24}" text-anchor="middle" '
        f'font-family="Georgia, serif" font-size="15" fill="{pal["capDeep"]}">'
        f'preview · waist {_fmt(meta["waistbandCirc"], u)} · hem {_fmt(meta["hemCirc"], u)} · '
        f'{n_sizes} spot size{"s" if n_sizes != 1 else ""}</text>'
    )

    svg_open = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" '
        f'aria-label="Front-view preview of the mushroom dress">'
    )
    return svg_open + "".join(parts) + "</svg>"


def _mushroom(parts: List[str], x: float, y: float, s: float, pal: Dict[str, str]) -> None:
    """Draw a tiny amanita mushroom glyph centred on (x, y)."""
    # stem
    parts.append(f'<rect x="{_e(x - s*0.28)}" y="{_e(y)}" width="{_e(s*0.56)}" height="{_e(s*1.1)}" rx="{_e(s*0.2)}" fill="{pal["spot"]}" stroke="{pal["line"]}" stroke-width="0.5"/>')
    # cap
    parts.append(f'<path d="M {_e(x - s)} {_e(y)} A {_e(s)} {_e(s*0.8)} 0 0 1 {_e(x + s)} {_e(y)} Z" fill="{pal["cap"]}" stroke="{pal["capDeep"]}" stroke-width="0.6"/>')
    # cap spots
    for dx, dy, dr in [(-0.4, -0.3, 0.16), (0.35, -0.2, 0.13), (0.0, -0.45, 0.12)]:
        parts.append(f'<circle cx="{_e(x + dx*s)}" cy="{_e(y + dy*s)}" r="{_e(dr*s)}" fill="{pal["spot"]}"/>')


def _fmt(cm_val: float, unit: str) -> str:
    from crochet_core import from_cm
    v = from_cm(cm_val, unit)
    return f"{round(v * 10) / 10:g} {unit}"


if __name__ == "__main__":  # quick manual render
    import sys
    from crochet_core import compute_pattern, default_input

    inp = default_input()
    inp["style"]["dotSizes"] = [1.5, 2.5, 3.5]
    svg = render_dress_svg(compute_pattern(inp), inp)
    out = sys.argv[1] if len(sys.argv) > 1 else "dress.svg"
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(svg)
    print(f"wrote {out} ({len(svg)} bytes)")

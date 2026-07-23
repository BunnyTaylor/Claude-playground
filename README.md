# Mushroom Dress — crochet pattern generator (Python)

A made-to-measure crochet pattern generator. It turns your gauge swatches and
body measurements into a full nine-piece pattern for an amanita-mushroom dress
(spotted off-shoulder flounce, lantern sleeves, A-line skirt, gill frills) —
with exact stitch counts and round-by-round written instructions.

This is a Python port of a JavaScript engine (`crochet-core.mjs`). The pure
engine is the asset; everything else renders over it.

```
crochet_core.py        the pattern engine — pure, dependency-free, no I/O
crochet_viz.py         SVG dress visualizer (stdlib only)
crochet_cli.py         command-line renderer over the engine
serve.py               tiny stdlib web server for the browser UI
web/                   the web UI (HTML/CSS/JS) with in-browser project saving
test_crochet_core.py   the test contract (25 tests, each locking a real bug)
```

Everything is standard-library Python 3.8+ — nothing to `pip install`.

## Quick start

### Web UI (recommended)

```bash
python3 serve.py --open          # opens http://127.0.0.1:8000
```

Set your gauge, measurements, colours and spot sizes and the page shows a
**live SVG preview of the dress** alongside the full round-by-round pattern.
It also gives you:

- **A per-piece row counter** — big tappable −/＋ buttons that track which round
  you're on, show the running stitch count, and light up on increase rounds.
  Progress is saved per project, so you can put the phone down mid-round and
  come back. Ideal for actually making the thing with a phone propped nearby.
- **A yarn estimate** — rough metres/yards per colour (with an allowance for
  ends and joins) so you know roughly how much to buy.
- **Projects saved in your browser** (localStorage) — name one, hit Save, and
  it survives refreshes; load, duplicate, delete, or **export/import** all
  projects as a JSON file to move them between devices. Nothing leaves your
  device, and there's no account or server storage.

### Command line

```bash
python3 crochet_cli.py                       # full default pattern
python3 crochet_cli.py --svg dress.svg       # also export the visualization
python3 test_crochet_core.py                 # confirm the engine (or: pytest)
```

## Using the CLI

The pattern is driven by **gauge** (three separate swatches — rib, hdc, sc),
**body measurements**, and a few **style** choices. Override any of them with
flags, or keep them in a JSON config file.

```bash
# Your own numbers
python3 crochet_cli.py --waist 70 --hip 96 --upper-bust 82 --skirt-len 50

# In inches (supply inch measurements and inch gauge)
python3 crochet_cli.py --unit in --waist 29 --hip 38 \
    --rib-w 4 --rib-h 4 --hdc-w 4 --hdc-h 4 --sc-w 4 --sc-h 4

# Non-square rib swatch: 20 sts over 9cm, 11 rows over 10cm
python3 crochet_cli.py --rib-sts 20 --rib-w 9 --rib-rows 11 --rib-h 10

# Spots in several sizes (a scattered, mixed look) + a saved picture
python3 crochet_cli.py --dot-sizes 1.5,2.5,3.5 --svg dress.svg

# Alternative silhouette, UK terms, with a yarn estimate
python3 crochet_cli.py --sleeveless --strapless --terms UK --yarn

# One piece only, or machine-readable output
python3 crochet_cli.py --piece sleeves
python3 crochet_cli.py --json > pattern.json

# Save your settings, edit the file, reload
python3 crochet_cli.py --waist 70 --dump-config me.json
python3 crochet_cli.py --config me.json
```

Run `python3 crochet_cli.py --help` for the full flag list. Colour and the
ASCII spot chart auto-disable when output is piped; `--no-color` / `--no-chart`
force it off.

> **Unit note:** the built-in defaults are centimetre-shaped. `--unit in` tells
> the engine to *interpret* your numbers as inches — it does not convert the
> defaults, so pass inch measurements and inch swatch sizes together.

## Spots in several sizes

By default the flounce and sleeves carry one uniform spot size, worked as
tapestry crochet in even repeating bands. Give the design **several
diameters** and it switches to a scattered mix:

```python
inp = default_input()
inp["style"]["dotSizes"] = [1.5, 2.5, 3.5]     # cm (or inches, matching unit)
```

Mixed sizes don't tile into even tapestry bands, so the engine changes the
`spots` piece to the honest construction for a varied look — work the ground
plain, then add each spot as surface embroidery or applique — and returns one
elliptical `chart` per size (largest first). A single-element `dotSizes`
behaves exactly like the classic single-`dotDia` path, so default output is
unchanged.

## Visualization

`crochet_viz.render_dress_svg(result, input, palette=None)` returns an SVG
front view of the finished dress — off-shoulder flounce, lantern sleeves,
fitted waist, A-line skirt, scallop frills and hem mushrooms — scaled from the
real circumferences, with spots scattered in whatever sizes the design uses
(seeded, so the same input always draws the same picture). The web UI shows it
live; the CLI writes it with `--svg`; call it directly for your own renderer.

## Silhouettes & terminology

The same engine drives alternative silhouettes via `style` toggles, and the
written pattern can be produced in either terminology:

```python
inp["style"]["sleeveless"] = True   # omit the sleeves
inp["style"]["strapless"]  = True   # omit the straps (flounce held by elastic)
inp["terms"] = "UK"                 # sc→dc, hdc→htr, dc→tr … (default "US")
```

`convert_terms(result, "UK")` rewrites the finished pattern's stitch names in a
single pass (so `dc2tog` → `tr2tog`, never a cascade). The web UI exposes both
as controls and includes an abbreviations / US↔UK reference; the CLI has
`--sleeveless`, `--strapless`, and `--terms`.

## Yarn estimate

`crochet_core.estimate_yarn(result)` returns a rough yardage estimate — metres
and yards per piece and per colour, plus a grand total with a fixed allowance
for weaving and joins. It multiplies the stitches worked in each piece by the
physical stitch width and a per-stitch consumption factor. Crochet yardage
can't be exact without swatching the real yarn, so treat it as a shopping
guide (buy a little over), not a precise figure. The web UI shows it as a
panel; the CLI prints it with `--yarn`.

## Row-counter data

Each round-based piece carries a `progress` block:

```python
piece["progress"]   # {"total", "start", "end", "incRounds": [{"rnd", "count"}, ...]}
```

`incRounds` lists exactly which rounds change the stitch count and to what, so a
counter can show the running count at any round and flag increase rounds without
parsing prose. The web UI's row counter is built on this.

## The API

```python
from crochet_core import compute_pattern, default_input

result = compute_pattern({
    "unit": "cm",                                    # or "in"
    "gauges": {                                      # three independent swatches
        "rib": {"sts": 18, "rows":  9, "width": 10, "height": 10},
        "hdc": {"sts": 14, "rows": 11, "width": 10, "height": 10},
        "sc":  {"sts": 16, "rows": 18, "width": 10, "height": 10},
    },
    "body":   {"bust": 92, "waist": 74, "upperBust": 84, "hip": 98,
               "upperArm": 30, "wrist": 16, "skirtLen": 45, "sleeveLen": 50},
    "style":  {"waistEase": -5, "fullness": 2.0, "flare": 1.8, "balloon": 1.4,
               "dotDia": 2.5, "dotGap": 1.2},
    "colors": {"cap": "Crimson", "spot": "Ivory", "body": "Oat"},
})

result["pieces"]     # nine pieces in construction order
result["warnings"]   # fit warnings the maker needs
result["meta"]       # densities, key circumferences, resolved colours
```

Each piece has `id`, `title`, `stitch`, `counts`, and `steps` (a list of
`[label, text]` pairs). The `spots` piece also carries a `chart`.

Call `default_input()` for a fresh, safe-to-mutate copy of the defaults.

## Why the maths is the way it is

These are load-bearing crochet facts baked into the engine — get them wrong and
the pattern looks plausible and fits nobody. The test contract locks each in.

- **Gauge is per-stitch, not per-project.** Rib, hdc and sc make different-sized
  stitches from the same yarn, so the garment needs three separate swatches.
- **Swatches are never exactly 10 cm.** Gauge is `stitches ÷ measured distance`,
  supplied explicitly; a 4-inch swatch is 10.16 cm, not 10 (a 1.6% error).
- **Pieces at different gauges can't be joined stitch-for-stitch.** Rib is
  compressed, so every gauge boundary gets an explicit adjustment round
  (`even_adjust`) — otherwise the skirt splays off the waistband like a ruffle.
- **Stitches aren't square, so spots are ellipses** with independent stitch and
  row counts (`spot_chart`).
- **Colourwork must divide evenly into the round**, or the last spot is sliced
  at the join; the flounce count is rounded to an exact multiple of the repeat.
- **Increase remainders are distributed into the final round** so the running
  count hits its target exactly — `inc_plan(...).finalCount == target`, always.

A subtle porting detail: JavaScript's `Math.round` rounds half *up*, while
Python's `round` uses banker's rounding. The engine uses a half-up
`_jsround` throughout so the counts match the original exactly.

## Test contract

The invariants below must hold through any refactor (all covered in the tests):

- `inc_plan(...).finalCount == target`, exactly, always
- no increase round is ever scheduled past the end of its piece
- `even_adjust(from, to)` consumes exactly `from` and produces exactly `to`
- for every spot-chart row: `lead + w + trail == repW`
- rib stitch counts are always even (fpdc/bpdc must pair)
- changing one gauge changes only the pieces that use it
- skirt-top circumference lands within 1.5 cm of the true waist
- cm and inch inputs for the same body produce the same pattern (±2 sts)

Known-good default output (validated by the CLI): waistband 124 sts × 11 rnds;
skirt 104 → 193 hdc, 50 rnds; flounce 134 → 241 sc, 29 rnds; spots 4 × 5,
repeat 9 × 10; sleeves 32 rib → 67 balloon.

## What's next

Done so far: the engine, CLI, web UI, dress visualization, multi-size spots,
in-browser persistence, per-piece row counter, yarn estimate, project
export/import, sleeveless/strapless silhouettes, and US/UK terminology.

Natural next steps, roughly in value order:

1. **Editable spot layout** — drag spots on the preview, save custom scatters.
2. **More silhouettes** — tiered skirt, midi/maxi presets, high-neck variant.
3. **Schematic measurements** — label the finished dimensions on the SVG.
4. **Proper PDF export** (currently the browser's print dialog).
5. **Photo progress log** per project, alongside the row counter.

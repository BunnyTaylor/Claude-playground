# Mushroom Dress — crochet pattern generator (Python)

A made-to-measure crochet pattern generator. It turns your gauge swatches and
body measurements into a full nine-piece pattern for an amanita-mushroom dress
(spotted off-shoulder flounce, lantern sleeves, A-line skirt, gill frills) —
with exact stitch counts and round-by-round written instructions.

This is a Python port of a JavaScript engine (`crochet-core.mjs`). The pure
engine is the asset; the CLI is a renderer over it.

```
crochet_core.py        the pattern engine — pure, dependency-free, no I/O
crochet_cli.py         command-line renderer over the engine
test_crochet_core.py   the test contract (22 tests, each locking a real bug)
```

## Quick start

No dependencies — standard-library Python 3.8+.

```bash
# Full default pattern (DK cotton, average measurements)
python3 crochet_cli.py

# Confirm the engine is correct
python3 test_crochet_core.py        # or: pytest
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

The engine and a working CLI are done. Natural next steps, roughly in value
order (from the original project handoff):

1. **Project persistence** — saved projects, each with its own gauges,
   measurements, colours and yarn notes. (`--config` / `--dump-config` are a
   first step; a small `projects/` store with `list`/`save`/`load` is the win.)
2. **Row counter / progress tracking** — the pattern is ~250 rounds; a
   per-piece counter that knows which round is an increase round beats paper.
3. Yarn / yardage estimate per piece.
4. Alternative silhouettes from the same engine (sleeveless, midi, tiered).

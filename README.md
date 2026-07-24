# Crochet Pattern Studio

A made-to-measure crochet pattern **studio**: a home page of pattern
collections, and a studio that turns your gauge and measurements into a full
pattern with exact stitch counts, round-by-round instructions, a live preview,
a per-piece row counter, a yarn estimate, and PDF export.

The first collection is the **Amanita Mushroom Set** — a spotted off-shoulder
dress with a matching mushroom-cap bucket hat and drawstring bag, all sized
from the same gauge, colours and spots so the set matches. It's built as a
**platform**: new pattern generators are added via a small registry (see
[Adding a pattern generator](#adding-a-pattern-generator)).

**The engine runs entirely in the browser, so the app is pure static files** —
no server, no build step, works offline (installable PWA). One engine source
(JavaScript) drives the web app, the CLI, and the tests, so they can never
disagree.

```
web/                    the app — open web/index.html and it just works
  crochet-core.js       THE engine (dress + hat + bag generators)
  crochet-viz.js        the SVG visualizers (dress / hat / bag)
  registry.js           the catalogue of collections & generators (extensibility)
  app.js                UI: home + studio, inputs, counter, projects (localStorage)
  index.html, style.css
crochet-cli.mjs         command-line generator (Node) over the same engine
serve.mjs               tiny static dev server (Node)
build-artifact.mjs      bundles web/ into one self-contained HTML file
test/                   the test contract (38 tests, each locking a real bug)
Dockerfile              self-host on any Docker host (nginx static)
.github/workflows/      auto-deploy to GitHub Pages on push
```

## Adding a pattern generator

The app is data-driven, so a new pattern is three steps:

1. **Engine** — add `computeThing(input)` to `web/crochet-core.js` returning the
   standard `{ pieces, warnings, meta }` shape (each piece with `counts`,
   `steps`, and — for the row counter — a `progress` block; set `meta.kind`).
2. **Preview** — add a `renderThingSvg(...)` branch in `web/crochet-viz.js`,
   dispatched by `meta.kind` (and, if it needs new inputs, an input-group
   `<div id="thingInputs">` in `index.html`).
3. **Register** — add an entry to `web/registry.js` (label, emoji, blurb, the
   `compute` function name, and which `inputGroups` to show).

That's it — the home-page card, the studio switcher, the form, preview, row
counter, yarn estimate, PDF, and saved-project handling all read from the
registry. No other wiring.

## Use it

Nothing to install — it's static files.

```bash
# Open it directly
open web/index.html            # or just double-click the file

# …or serve it (any static server works)
npm start                      # http://127.0.0.1:8000  (Node)
python3 -m http.server -d web  # if you prefer Python
```

Pick what to **Make** — a **Dress**, a matching **Hat** (mushroom-cap bucket
hat with a flared brim and gill frill), or a matching **Bag** (drawstring
bucket bag). All three share your gauge, colours, and spots, so a whole set
comes out matching. Set your gauge, measurements, colours and spot sizes and
the page shows a **live preview** and the full pattern. It also gives you a
**per-piece row counter** (tappable, tracks increase rounds, saves progress per
project), a **yarn estimate**, **PDF export** (a clean print layout — cover,
preview, yarn, then every piece), US/UK terminology, skirt-length presets
(mini/midi/maxi), sleeveless/strapless silhouettes, and **projects saved in
your browser** (localStorage) — save, load, duplicate, delete, and
export/import all projects as a JSON file to move between devices. Nothing
leaves your device.

It's also an **installable PWA**: on a hosted copy (GitHub Pages / your own
host) your browser offers "Install app" / "Add to Home Screen," and after the
first visit it works **fully offline** — ideal for crocheting with the phone
propped next to you and no signal.

## Host it

The app is static, so it hosts anywhere:

- **GitHub Pages (free, auto-deploy).** The included workflow
  (`.github/workflows/deploy-pages.yml`) publishes `web/` on every push. One-time
  setup: repo **Settings → Pages → Source → “GitHub Actions”**. The site then
  lives at `https://<user>.github.io/<repo>/` and updates itself on every push.
- **Your own Docker host.** `docker build -t mushroom-dress .` then
  `docker run -d --restart unless-stopped -p 8080:80 mushroom-dress` — nginx
  serving the static files. Update with `git pull` + rebuild.
- **A single shareable file.** `npm run build` bundles everything into
  `dist/artifact.html` (one self-contained file, no external requests) that you
  can host, email, or open offline.

## Command line

```bash
node crochet-cli.mjs                          # full default pattern
node crochet-cli.mjs --waist 70 --hip 96 --skirt-len 50
node crochet-cli.mjs --unit in --waist 29 --rib-w 4 --hdc-w 4 --sc-w 4
node crochet-cli.mjs --dot-sizes 1.5,2.5,3.5 --svg dress.svg --schematic
node crochet-cli.mjs --sleeveless --terms UK --yarn
node crochet-cli.mjs --piece skirt            # one piece
node crochet-cli.mjs --json                   # machine-readable
```

`--help` lists every flag. Config files: `--dump-config me.json` saves the
resolved input; `--config me.json` loads it.

## Test it

```bash
npm test        # node --test  → 33 pass
```

Each test locks in a real crochet-maths bug. The invariants below must hold
through any refactor:

- `incPlan(...).finalCount === target`, exactly, always
- no increase round is ever scheduled past the end of its piece
- `evenAdjust(from, to)` consumes exactly `from` and produces exactly `to`
- for every spot-chart row: `lead + w + trail === repW`
- rib stitch counts are always even (fpdc/bpdc must pair)
- changing one gauge changes only the pieces that use it
- skirt-top circumference lands within 1.5 cm of the true waist
- cm and inch inputs for the same body produce the same pattern (±2 sts)

Known-good default output: skirt 104 → 193 hdc, 50 rnds; flounce 134 → 241 sc,
29 rnds; spots 4 × 5, repeat 9 × 10; sleeves → 67 balloon. The waistband
depends on the ribbing style — **sideways** (default) is 62 rows around × 22
tall; the **in-the-round** option is 124 sts × 11 rnds. If a refactor changes
these, something broke.

### Ribbing (waistband & cuffs)

A starting chain is the least-stretchy part of a piece and fights the stretch
ribbing is there to give. So the default is **sideways back-loop-only rib** —
worked as a flat strip with the rows running around the body and seamed into a
ring (the crochet equivalent of knit ribbing, and the stretchiest option). The
`style.ribStyle` option (`"sideways"` default, or `"post"` for in-the-round
fpdc/bpdc rib off a chainless foundation) is exposed in the UI (**Ribbing**
selector) and the CLI (`--rib-style`). In sideways mode the band is sized by
*rows around*, and the skirt/sleeve is worked into the row-ends.

## The engine

```js
const Core = require("./web/crochet-core.js");   // browser: global `CrochetCore`
const result = Core.computePattern({
  unit: "cm",                                     // or "in"
  terms: "US",                                    // or "UK"
  gauges: {                                        // three independent swatches
    rib: { sts: 18, rows:  9, width: 10, height: 10 },
    hdc: { sts: 14, rows: 11, width: 10, height: 10 },
    sc:  { sts: 16, rows: 18, width: 10, height: 10 },
  },
  body:   { bust: 92, waist: 74, upperBust: 84, hip: 98,
            upperArm: 30, wrist: 16, skirtLen: 45, sleeveLen: 50 },
  style:  { waistEase: -5, fullness: 2.0, flare: 1.8, balloon: 1.4,
            dotDia: 2.5, dotGap: 1.2,
            dotSizes: [1.5, 2.5, 3.5],             // optional: mixed spot sizes
            sleeveless: false, strapless: false }, // silhouette toggles
  colors: { cap: "Crimson", spot: "Ivory", body: "Oat" },
});

result.pieces      // nine pieces in construction order (each: id, title,
                   //   stitch, counts, steps, and progress for the row counter)
result.warnings    // fit warnings the maker needs
result.meta        // densities, key circumferences, resolved colours

Core.estimateYarn(result);                         // { total, byColor, pieces }
Core.convertTerms(result, "UK");                    // rewrite stitch names US→UK

const Viz = require("./web/crochet-viz.js");
Viz.renderDressSvg(result, input, palette, { schematic: true });  // SVG string
```

## Why the maths is the way it is

These are load-bearing crochet facts baked into the engine — get them wrong and
the pattern looks plausible and fits nobody. The test contract locks each in.

- **Gauge is per-stitch, not per-project.** Rib, hdc and sc make different-sized
  stitches from the same yarn, so the garment needs three separate swatches.
- **Swatches are never exactly 10 cm.** Gauge is `stitches ÷ measured distance`,
  supplied explicitly; a 4-inch swatch is 10.16 cm, not 10 (a 1.6% error).
- **Pieces at different gauges can't be joined stitch-for-stitch.** Rib is
  compressed, so every gauge boundary gets an explicit adjustment round
  (`evenAdjust`) — otherwise the skirt splays off the waistband like a ruffle.
- **Stitches aren't square, so spots are ellipses** with independent stitch and
  row counts (`spotChart`).
- **Colourwork must divide evenly into the round**, or the last spot is sliced
  at the join; the flounce count is rounded to an exact multiple of the repeat.
- **Increase remainders are distributed into the final round** so the running
  count hits its target exactly — `incPlan(...).finalCount === target`, always.

A rounding note: the engine uses a half-up `jsround` (`Math.floor(n + 0.5)`)
everywhere, matching how the counts were originally derived — not JavaScript's
`Math.round` edge cases or bankers' rounding.

## What's next

Done: dress, hat, and bag generators; CLI; static web app; visualizations
(with a measurements overlay); multi-size spots; in-browser persistence +
export/import; per-piece row counter; yarn estimate; PDF export; skirt-length
presets; sleeveless/strapless silhouettes; US/UK terms; installable offline
PWA; and three hosting paths (shareable file, GitHub Pages, Docker).

Ideas, roughly in value order:

1. **Accessory viz/CLI parity** — expose hat/bag in the CLI too, add schematic
   overlays for them.
2. **Editable spot layout** — drag spots on the preview, save custom scatters.
3. **More variants** — beret & slouchy beanie hats; cross-body / coin-purse
   bags; tiered skirt; high-neck dress.
4. **Photo progress log** per project, alongside the row counter.

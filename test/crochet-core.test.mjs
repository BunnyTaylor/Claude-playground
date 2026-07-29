/**
 * Test contract for crochet-core (the engine).
 *
 * Each test locks in a bug that was actually found and fixed during
 * development. This is the single guarantee for the engine — keep it green
 * through any refactor.
 *
 *   node --test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Core = require("../web/crochet-core.js");
const Viz = require("../web/crochet-viz.js");

const {
  computePattern, computeHat, computeBag, computeTights, decPlan, defaultInput, DEFAULT_INPUT, incPlan, evenAdjust,
  spotChart, spotCharts, estimateYarn, convertTerms, density, even, mult, toCm, fromCm,
} = Core;

const tightsInput = () => { const i = defaultInput(); i.accessory = { thigh: 56, ankle: 24, inseam: 70, rise: 27 }; return i; };

function walkProgressEnd(p) {
  let c = p.progress.start;
  for (const it of [...p.progress.incRounds].sort((a, b) => a.rnd - b.rnd)) c = it.count;
  return c;
}

/* ---------------- units ---------------- */

test("inch conversion round-trips", () => {
  assert.equal(toCm(10, "cm"), 10);
  assert.ok(Math.abs(toCm(4, "in") - 10.16) < 1e-9);
  assert.ok(Math.abs(fromCm(toCm(36.2, "in"), "in") - 36.2) < 1e-9);
});

test("a 4-inch swatch is 10.16cm, not 10", () => {
  const d = density({ sts: 16, rows: 18, width: 4, height: 4 }, "in");
  assert.ok(Math.abs(d.st - 16 / 10.16) < 1e-9);
  assert.notEqual(d.st, 1.6);
});

test("gauge is independent of swatch size", () => {
  const a = density({ sts: 18, rows: 9, width: 10, height: 10 }, "cm");
  const b = density({ sts: 22.5, rows: 11.25, width: 12.5, height: 12.5 }, "cm");
  assert.ok(Math.abs(a.st - b.st) < 1e-9 && Math.abs(a.row - b.row) < 1e-9);
});

test("non-square swatches use width for sts and height for rows", () => {
  const d = density({ sts: 20, rows: 24, width: 13, height: 11 }, "cm");
  assert.ok(Math.abs(d.st - 20 / 13) < 1e-9 && Math.abs(d.row - 24 / 11) < 1e-9);
});

test("zero or negative swatch size is rejected", () => {
  assert.throws(() => density({ sts: 16, rows: 18, width: 0, height: 10 }, "cm"));
});

/* ---------------- shaping ---------------- */

test("incPlan lands cleanly near its target with no leftover tail", () => {
  for (const [start, target, rounds] of [
    [110, 221, 81], [42, 83, 36], [276, 552, 198], [62, 124, 135], [100, 101, 20], [114, 221, 56],
  ]) {
    const p = incPlan(start, target, rounds, "hdc", 1);
    // every increase round divides evenly — no "hdc in each of last N sts" stub
    for (const r of p.rounds) {
      assert.ok(!/in each of last/.test(r.text), `tail in ${start}->${target}: ${r.text}`);
      assert.equal(r.after - r.before, p.rounds[0].after - p.rounds[0].before, "constant add");
    }
    // finishes on a clean multiple within one increment of the requested width
    const add = p.rounds.length ? p.rounds[0].after - p.rounds[0].before : 0;
    assert.ok(p.finalCount >= start, `${start}->${target} not below start`);
    assert.ok(Math.abs(p.finalCount - target) <= add, `${start}->${target} lands ${p.finalCount}`);
  }
});

test("incPlan never schedules shaping past the end of the piece", () => {
  for (let rounds = 6; rounds < 200; rounds += 7) {
    const p = incPlan(100, 240, rounds, "hdc", 1);
    if (p.rounds.length) assert.ok(p.rounds[p.rounds.length - 1].rnd <= rounds);
  }
});

test("incPlan is a no-op when no increase is needed", () => {
  const p = incPlan(120, 120, 40, "hdc", 1);
  assert.equal(p.rounds.length, 0);
  assert.equal(p.finalCount, 120);
});

test("evenAdjust consumes and produces exact counts", () => {
  const st = "hdc";
  // count how many base sts a single instruction segment consumes and produces
  const seg = (s) => {
    let m;
    if ((m = s.match(new RegExp(`^2 ${st} in each of (?:next|last) (\\d+) sts$`)))) return [+m[1], 2 * +m[1]];
    if (s === `2 ${st} in next st`) return [1, 2];
    if ((m = s.match(new RegExp(`^${st} in each of (?:next|last) (\\d+) sts$`)))) return [+m[1], +m[1]];
    if (s === `${st} in next st`) return [1, 1];
    if (s === `${st}2tog`) return [2, 1];
    throw new Error("unparsed segment: " + s);
  };
  // split a comma-separated body on ", " but only at paren depth 0, so nested
  // "(...) N times" groups stay intact.
  const splitTop = (body) => {
    const out = []; let depth = 0, start = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && ch === "," && body[i + 1] === " ") { out.push(body.slice(start, i)); i++; start = i + 1; }
    }
    out.push(body.slice(start));
    return out;
  };
  // [consumed, produced] for one item: a leaf segment, or a "(<body>) N times"
  // group (recursively summed × N).
  const sumItem = (item) => {
    const m = item.match(/^\((.+)\) (\d+) times?$/);
    if (m) { const [c, p] = sumBody(m[1]); return [c * +m[2], p * +m[2]]; }
    return seg(item);
  };
  const sumBody = (body) => {
    let c = 0, p = 0;
    for (const t of splitTop(body)) { const [sc, sp] = sumItem(t); c += sc; p += sp; }
    return [c, p];
  };
  // parse a full evenAdjust string → [consumed, produced], or null for the
  // count-less forms (identity / more-than-doubling fallback). Handles one or
  // more "*<body>; rep from * N times" blocks (body may contain nested groups)
  // plus an optional trailing run.
  const parse = (str) => {
    if (str === `${st} in each st around`) return null;
    if (str.includes("evenly to")) return null;
    let c = 0, p = 0, matched = false, end = 0;
    const re = /\*(.+?); rep from \* (\d+) times/g;
    let m;
    while ((m = re.exec(str))) {
      matched = true; end = re.lastIndex;
      const reps = +m[2];
      const [bc, bp] = sumBody(m[1]);
      c += bc * reps; p += bp * reps;
    }
    // no "*...; rep" block at all → a coprime Bresenham list; parse the whole string
    const rest = (matched ? str.slice(end).replace(/^,\s*/, "") : str).trim();
    if (rest) for (const t of splitTop(rest)) { const [sc, sp] = sumItem(t); c += sc; p += sp; }
    return [c, p];
  };
  for (let from = 20; from <= 400; from += 7) {
    for (let to = 20; to <= 400; to += 11) {
      const out = evenAdjust(from, to, st);
      assert.equal(typeof out, "string");
      const parsed = parse(out);
      if (!parsed) continue;                          // identity / >2-per-st fallback
      assert.equal(parsed[0], from, `consume ${from}->${to}: ${out}`);
      assert.equal(parsed[1], to, `produce ${from}->${to}: ${out}`);
    }
  }
});

/* ---------------- colourwork ---------------- */

test("spot chart rows always sum to one repeat width", () => {
  for (const [d, g, st, rw] of [
    [2.5, 1.2, 1.6, 1.8], [1.5, 0.8, 1.6, 1.8], [4, 1.8, 1.2, 1.0], [2, 1.2, 2.4, 2.8], [0.5, 0.8, 1.6, 1.8],
  ]) {
    const c = spotChart(d, g, st, rw);
    for (const row of c.rows) {
      assert.equal(row.lead + row.w + row.trail, c.repW);
      assert.ok(row.w >= 1 && row.w <= c.W && row.lead >= 0 && row.trail >= 0);
    }
  }
});

test("spot is round in centimetres, not in stitches", () => {
  const c = spotChart(2.5, 1.2, 1.6, 1.8);
  assert.equal(c.W, 4);
  assert.equal(c.H, 5);
});

test("spot chart bulges in the middle", () => {
  const c = spotChart(3, 1.2, 1.6, 1.8);
  const mid = Math.floor(c.rows.length / 2);
  assert.ok(c.rows[mid].w >= c.rows[0].w && c.rows[mid].w >= c.rows[c.rows.length - 1].w);
});

test("spotCharts are sorted largest-first and each valid", () => {
  const charts = spotCharts([2.5, 1.2, 3.5], 1.2, 1.6, 1.8);
  assert.equal(charts.length, 3);
  const dias = charts.map((c) => c.diaCm);
  assert.deepEqual(dias, [...dias].sort((a, b) => b - a));
  for (const c of charts) for (const row of c.rows) assert.equal(row.lead + row.w + row.trail, c.repW);
});

/* ---------------- helpers ---------------- */

test("rib counts are always even", () => {
  assert.equal(even(109), 110);
  assert.equal(even(110), 110);
});

test("mult never returns less than one repeat", () => {
  assert.equal(mult(2, 6), 6);
  assert.equal(mult(221, 6), 222);
});

/* ---------------- whole pattern ---------------- */

test("produces all nine pieces in construction order", () => {
  const { pieces } = computePattern(DEFAULT_INPUT);
  assert.deepEqual(pieces.map((p) => p.id),
    ["waistband", "skirt", "flounce", "spots", "sleeves", "gillFrill", "hemFrill", "border", "straps"]);
});

test("waistband stitch count is even", () => {
  assert.equal(computePattern(DEFAULT_INPUT).pieces[0].counts.sts % 2, 0);
});

test("skirt top lands at the true waist, not the compressed band", () => {
  const { pieces, meta } = computePattern(DEFAULT_INPUT);
  const topCm = pieces[1].counts.start / meta.density.hdc.st;
  assert.ok(Math.abs(topCm - DEFAULT_INPUT.body.waist) < 1.5, `skirt top ${topCm}cm`);
});

test("each gauge affects only its own pieces", () => {
  const base = computePattern(DEFAULT_INPUT);
  const bumped = structuredClone(DEFAULT_INPUT);
  bumped.gauges.sc.sts = 22;
  const after = computePattern(bumped);
  const id = (res, k) => res.pieces.find((p) => p.id === k);
  assert.equal(id(base, "waistband").counts.sts, id(after, "waistband").counts.sts);
  assert.equal(id(base, "skirt").counts.start, id(after, "skirt").counts.start);
  assert.notEqual(id(base, "flounce").counts.start, id(after, "flounce").counts.start);
});

test("every piece has steps and a title", () => {
  for (const p of computePattern(DEFAULT_INPUT).pieces) {
    assert.ok(p.title.length > 0, p.id);
    assert.ok(p.steps.length > 0, p.id);
    for (const [label, text] of p.steps) {
      assert.equal(typeof label, "string");
      assert.ok(text.length > 0, `${p.id}/${label}`);
    }
  }
});

test("survives extreme but legal gauges without throwing", () => {
  for (const sts of [7, 12, 20, 40]) {
    const inp = structuredClone(DEFAULT_INPUT);
    inp.gauges.rib.sts = inp.gauges.hdc.sts = inp.gauges.sc.sts = sts;
    assert.doesNotThrow(() => computePattern(inp));
  }
});

test("warns when the hem is no wider than the waist", () => {
  const inp = structuredClone(DEFAULT_INPUT);
  inp.style.fullness = 1.0;
  assert.ok(computePattern(inp).warnings.some((w) => /hem/i.test(w)));
});

test("inches and centimetres describe the same garment", () => {
  const cm = computePattern(DEFAULT_INPUT);
  const inch = structuredClone(DEFAULT_INPUT);
  inch.unit = "in";
  for (const k of Object.keys(inch.body)) inch.body[k] = inch.body[k] / 2.54;
  for (const g of Object.values(inch.gauges)) { g.width /= 2.54; g.height /= 2.54; }
  inch.style.dotDia /= 2.54;
  const res = computePattern(inch);
  assert.ok(Math.abs(cm.pieces[0].counts.sts - res.pieces[0].counts.sts) <= 2);
});

/* ---------------- multi-size spots ---------------- */

test("single dot size leaves the default pattern unchanged", () => {
  const base = computePattern(DEFAULT_INPUT);
  const inp = structuredClone(DEFAULT_INPUT);
  inp.style.dotSizes = [inp.style.dotDia];
  const same = computePattern(inp);
  const b = base.pieces.find((p) => p.id === "spots");
  const s = same.pieces.find((p) => p.id === "spots");
  assert.deepEqual(b.steps, s.steps);
  assert.deepEqual(b.counts, s.counts);
});

test("multiple dot sizes produce a charts palette only on spots", () => {
  const base = computePattern(DEFAULT_INPUT);
  const inp = structuredClone(DEFAULT_INPUT);
  inp.style.dotSizes = [1.5, 2.5, 3.5];
  const res = computePattern(inp);
  const spots = res.pieces.find((p) => p.id === "spots");
  assert.equal(spots.charts.length, 3);
  assert.equal(spots.counts.sizes.length, 3);
  for (const a of base.pieces) {
    if (a.id !== "spots") assert.deepEqual(a.counts, res.pieces.find((p) => p.id === a.id).counts, a.id);
  }
});

/* ---------------- progress / yarn ---------------- */

test("progress end matches counts and stays in bounds", () => {
  const pieces = computePattern(DEFAULT_INPUT).pieces.filter((p) => p.progress);
  for (const id of ["waistband", "skirt", "flounce", "sleeves", "gillFrill", "hemFrill"]) {
    assert.ok(pieces.find((p) => p.id === id), id);
  }
  for (const p of pieces) {
    const pr = p.progress;
    assert.ok(pr.total >= 1);
    for (const it of pr.incRounds) assert.ok(it.rnd >= 1 && it.rnd <= pr.total, p.id);
    let c = pr.start;
    for (const it of [...pr.incRounds].sort((a, b) => a.rnd - b.rnd)) c = it.count;
    assert.equal(c, pr.end, p.id);
  }
});

test("yarn estimate is positive, consistent, and grows with a bigger body", () => {
  const est = estimateYarn(computePattern(DEFAULT_INPUT));
  assert.ok(est.total.meters > 0);
  assert.ok(Math.abs(est.total.yards - est.total.meters * 1.0936) < est.total.meters);
  const by = est.byColor.cap.meters + est.byColor.body.meters + est.byColor.spot.meters;
  assert.ok(Math.abs(by - est.total.meters) < 1.0);
  const big = structuredClone(DEFAULT_INPUT);
  for (const k of Object.keys(big.body)) big.body[k] *= 1.3;
  assert.ok(estimateYarn(computePattern(big)).total.meters > est.total.meters);
});

/* ---------------- silhouettes / terminology ---------------- */

test("sleeveless and strapless omit their pieces", () => {
  const inp = structuredClone(DEFAULT_INPUT);
  inp.style.sleeveless = true;
  inp.style.strapless = true;
  const res = computePattern(inp);
  const ids = res.pieces.map((p) => p.id);
  assert.ok(!ids.includes("sleeves") && !ids.includes("straps"));
  assert.deepEqual(ids, ["waistband", "skirt", "flounce", "spots", "gillFrill", "hemFrill", "border"]);
  assert.ok(res.warnings.some((w) => /strapless/i.test(w)));
});

test("default still has sleeves and straps", () => {
  const ids = computePattern(DEFAULT_INPUT).pieces.map((p) => p.id);
  assert.ok(ids.includes("sleeves") && ids.includes("straps"));
});

test("UK terms convert stitch names without corrupting compounds", () => {
  // use post-stitch rib so fpdc/bpdc are present to exercise the compound map
  const inp = structuredClone(DEFAULT_INPUT);
  inp.style.ribStyle = "post";
  const res = computePattern(inp);
  const uk = convertTerms(res, "UK");
  const joined = uk.pieces.flatMap((p) => p.steps.map((s) => s[1])).join(" ");
  assert.ok(joined.includes("htr"));   // hdc -> htr
  assert.ok(joined.includes("fptr"));  // fpdc -> fptr (compound, atomically)
  assert.ok(!joined.includes("hdc") && !joined.includes("sc2tog"));
  assert.notEqual(res, uk);
});

/* ---------------- ribbing construction ---------------- */

test("default ribbing is sideways (back-loop), seamed into a ring", () => {
  const wb = computePattern(DEFAULT_INPUT).pieces.find((p) => p.id === "waistband");
  assert.match(wb.stitch, /sideways/);
  // sized by rows-around (~ waistCirc x row gauge), not stitches-around
  assert.equal(wb.counts.rowsAround, wb.counts.sts);
  assert.ok(wb.counts.heightSts >= 6);
  const joined = wb.steps.map((s) => s[1]).join(" ");
  assert.match(joined, /back loop only/);
  assert.ok(!/fpdc/.test(joined));  // no post-stitch rib in sideways mode
});

test("post rib option restores in-the-round fpdc/bpdc with the same skirt top", () => {
  const inp = structuredClone(DEFAULT_INPUT);
  inp.style.ribStyle = "post";
  const res = computePattern(inp);
  const wb = res.pieces.find((p) => p.id === "waistband");
  assert.match(wb.stitch, /in the round/);
  assert.ok(wb.counts.sts % 2 === 0);
  assert.match(wb.steps.map((s) => s[1]).join(" "), /fpdc/);
  // the skirt still lands at the true waist regardless of rib style
  const sideways = computePattern(DEFAULT_INPUT).pieces.find((p) => p.id === "skirt");
  const post = res.pieces.find((p) => p.id === "skirt");
  assert.equal(sideways.counts.start, post.counts.start);
});

test("both rib modes keep every piece's progress end exact", () => {
  for (const style of ["sideways", "post"]) {
    const inp = structuredClone(DEFAULT_INPUT);
    inp.style.ribStyle = style;
    for (const p of computePattern(inp).pieces) {
      if (!p.progress) continue;
      assert.equal(walkProgressEnd(p), p.progress.end, `${style}/${p.id}`);
      for (const it of p.progress.incRounds) assert.ok(it.rnd >= 1 && it.rnd <= p.progress.total, `${style}/${p.id}`);
    }
  }
});

test("US terms is a no-op", () => {
  const res = computePattern(DEFAULT_INPUT);
  assert.equal(convertTerms(res, "US"), res);
});

test("tights produce a mycelium set tagged kind:tights", () => {
  const r = computeTights(tightsInput());
  assert.equal(r.meta.kind, "tights");
  assert.deepEqual(r.pieces.map((p) => p.id), ["waistband", "yoke", "legs", "mycelium"].length ? ["waistband", "yoke", "legs", "cuffs", "mycelium"] : []);
  // legs taper from thigh(+gusset) down to the ankle, exactly
  const legs = r.pieces.find((p) => p.id === "legs");
  assert.ok(legs.counts.start > legs.counts.end, "legs taper");
  assert.equal(legs.progress.end, legs.counts.end);
  // yoke grows waist → hip, exactly
  const yoke = r.pieces.find((p) => p.id === "yoke");
  assert.ok(yoke.counts.end >= yoke.counts.start);
  assert.equal(estimateYarn(r).total.meters > 0, true);
});

test("decPlan lands cleanly near its target, no tail, never past the end", () => {
  for (let rounds = 6; rounds < 160; rounds += 9) {
    const p = decPlan(120, 40, rounds, "sc", 1);
    for (const r of p.rounds) {
      assert.ok(!/in each of last/.test(r.text), `tail: ${r.text}`);
      assert.equal(r.before - r.after, p.rounds[0].before - p.rounds[0].after, "constant sub");
    }
    const sub = p.rounds.length ? p.rounds[0].before - p.rounds[0].after : 0;
    assert.ok(Math.abs(p.finalCount - 40) <= sub, `dec ${rounds} lands ${p.finalCount}`);
    if (p.rounds.length) assert.ok(p.rounds[p.rounds.length - 1].rnd <= rounds);
  }
});

/* ---------------- visualization ---------------- */

test("visualizer renders well-formed SVG for single and multi size", () => {
  for (const sizes of [null, [1.5, 2.5, 3.5]]) {
    const inp = defaultInput();
    if (sizes) inp.style.dotSizes = sizes;
    const svg = Viz.renderDressSvg(computePattern(inp), inp);
    assert.ok(svg.startsWith("<svg") && svg.endsWith("</svg>"));
    assert.ok(svg.includes("ellipse"));
  }
});

/* ---------------- matching accessories: hat & bag ---------------- */

test("hat produces a mushroom-cap set tagged kind:hat", () => {
  const r = computeHat(DEFAULT_INPUT);
  assert.equal(r.meta.kind, "hat");
  assert.deepEqual(r.pieces.map((p) => p.id), ["crown", "sides", "brim", "gillFrill", "spots"]);
});

test("bag produces a bucket-bag set tagged kind:bag", () => {
  const r = computeBag(DEFAULT_INPUT);
  assert.equal(r.meta.kind, "bag");
  assert.deepEqual(r.pieces.map((p) => p.id), ["base", "sides", "spots", "band", "strap"]);
});

test("accessory shaping reaches its target exactly and stays in bounds", () => {
  for (const r of [computeHat(DEFAULT_INPUT), computeBag(DEFAULT_INPUT)]) {
    for (const p of r.pieces) {
      if (!p.progress) continue;
      assert.ok(p.progress.total >= 1, p.id);
      for (const it of p.progress.incRounds) assert.ok(it.rnd >= 1 && it.rnd <= p.progress.total, p.id);
      assert.equal(walkProgressEnd(p), p.progress.end, p.id);
    }
    // spots divide evenly into the round
    const s = r.pieces.find((p) => p.id === "spots");
    assert.equal(s.counts.adjustedSts % s.counts.repeatW, 0);
  }
});

test("accessories react to their own dimensions", () => {
  const bigHead = structuredClone(DEFAULT_INPUT);
  bigHead.accessory = { headCirc: 62 };
  assert.notEqual(
    computeHat(DEFAULT_INPUT).pieces.find((p) => p.id === "crown").counts.end,
    computeHat(bigHead).pieces.find((p) => p.id === "crown").counts.end
  );
  const bigBag = structuredClone(DEFAULT_INPUT);
  bigBag.accessory = { diameter: 26 };
  assert.notEqual(
    computeBag(DEFAULT_INPUT).pieces.find((p) => p.id === "base").counts.end,
    computeBag(bigBag).pieces.find((p) => p.id === "base").counts.end
  );
});

test("yarn estimate works for hat and bag (positive, buckets sum to total)", () => {
  for (const r of [computeHat(DEFAULT_INPUT), computeBag(DEFAULT_INPUT)]) {
    const est = estimateYarn(r);
    assert.ok(est.total.meters > 0, r.meta.kind);
    const by = est.byColor.cap.meters + est.byColor.body.meters + est.byColor.spot.meters;
    assert.ok(Math.abs(by - est.total.meters) < 1.0, r.meta.kind);
  }
});

test("visualizer schematic adds measurement labels and is deterministic", () => {
  const inp = defaultInput();
  inp.style.dotSizes = [1.5, 2.5, 3.5];
  const plain = Viz.renderDressSvg(computePattern(inp), inp);
  const labelled = Viz.renderDressSvg(computePattern(inp), inp, null, { schematic: true });
  assert.ok(labelled.includes("waist") && labelled.includes("hem") && labelled.includes("upper bust"));
  assert.ok(labelled.length > plain.length);
  assert.equal(Viz.renderDressSvg(computePattern(inp), inp), Viz.renderDressSvg(computePattern(inp), inp));
});

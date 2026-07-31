/*
 * crochet-core (JavaScript) — pattern engine for the mushroom dress.
 *
 * Browser/Node port of crochet_core.py, kept behaviour-identical so the app
 * can run entirely client-side (GitHub Pages, a shared link, offline) with no
 * server. The Python module remains the tested reference; a cross-check script
 * diffs this engine's output against it.
 *
 * Classic script (no ES modules): defines a global `CrochetCore`, so the same
 * file works via <script src> and inlined into a single-file build.
 *
 * All internal maths is in CENTIMETRES. Rounding uses a half-up jsround to
 * match Python's engine (and the original JS), NOT bankers' rounding.
 */
var CrochetCore = (function () {
  "use strict";

  var CM_PER_IN = 2.54;
  var toCm = function (v, unit) { return unit === "in" ? v * CM_PER_IN : v; };
  var fromCm = function (cm, unit) { return unit === "in" ? cm / CM_PER_IN : cm; };

  // half-up rounding, matching Python's math.floor(n + 0.5)
  var jsround = function (n) { return Math.floor(n + 0.5); };
  var r1 = function (n) { return jsround(n * 10) / 10; };

  var even = function (n) { n = Math.trunc(n); return (n % 2) ? n + 1 : n; };
  var mult = function (n, m) { return Math.max(m, jsround(n / m) * m); };
  var gcdInt = function (a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a; };
  // how "round" a stitch count is: rewards divisibility by common repeat sizes, so
  // shaping rounds land on counts that continue cleanly and are easy to track.
  var factorScore = function (n) { var s = 0, d = [2, 3, 4, 5, 6, 8, 12]; for (var i = 0; i < d.length; i++) if (n % d[i] === 0) s++; return s; };
  // snap a raw count to the nicest integer in [lo, hi]: prefer many small factors,
  // then a larger gcd with `from` (a cleaner join/increase from that count), then
  // the least movement. Callers set lo/hi to bound how far the count may drift —
  // wide for decorative counts, within the fit tolerance for body-fitted ones.
  var niceCount = function (raw, from, lo, hi) {
    var best = raw, bestScore = -Infinity;
    for (var t = lo; t <= hi; t++) {
      if (t < 1) continue;
      var s = factorScore(t) * 4 + (from ? gcdInt(from, Math.abs(t - from)) : 0) - Math.abs(t - raw);
      if (s > bestScore) { bestScore = s; best = t; }
    }
    return best;
  };

  function density(g, unit) {
    var w = toCm(g.width, unit), h = toCm(g.height, unit);
    if (!(w > 0) || !(h > 0)) throw new Error("gauge swatch size must be positive");
    if (!(g.sts > 0) || !(g.rows > 0)) throw new Error("gauge counts must be positive");
    return { st: g.sts / w, row: g.rows / h };
  }

  function incPlan(start, target, totalRnds, stitch, setupRnds, chunkFrac) {
    if (setupRnds === undefined) setupRnds = 1;
    var total = target - start;
    var out = { rounds: [], every: 0, finalCount: start };
    if (total <= 0) return out;

    // Each increase round adds `add` stitches evenly. To keep every round a clean
    // repeat with NO leftover tail, `add` must divide the current count — and since
    // every count is start + k·add, that holds for all rounds exactly when `add`
    // divides `start`. So pick the divisor of `start` nearest the target chunk
    // (~chunkFrac of start): a smaller chunk means smaller, more frequent increases.
    var usable = Math.max(1, totalRnds - setupRnds - 1);
    // aim for ~chunkFrac of start per round, but at least enough to reach the target
    // within the rounds available, and never more than the whole increase.
    var minPer = Math.ceil(total / usable);
    var desired = Math.min(total, Math.max(jsround(start * (chunkFrac || 0.08)), minPer));
    // add must divide start (=> divides every count => clean, tail-free rounds). Prefer
    // a divisor near `desired` that is also big enough to finish in time (>= minPer).
    var hiD = Math.max(1, Math.min(start - 1, total));
    var add = 1, bestAll = Infinity, addFits = 0, bestFits = Infinity;
    for (var d = 1; d <= hiD; d++) {
      if (start % d) continue;
      var dist = Math.abs(d - desired);
      if (dist < bestAll) { bestAll = dist; add = d; }
      if (d >= minPer && dist < bestFits) { bestFits = dist; addFits = d; }
    }
    if (addFits) add = addFits;
    // the flare ends on start + n·add, a clean multiple of `add` near the target width.
    var n = Math.max(1, Math.round(total / add));
    if (n > usable) n = usable;

    var cur = start, prevRnd = setupRnds;
    for (var i = 1; i <= n; i++) {
      var before = cur;
      // add divides before, so this is one clean repeat with no leftover tail
      var text = spreadGroups(add, before - add, stitch, "2 " + stitch + " in next st");
      cur += add;
      // distribute the increase ROUNDS evenly across the whole piece so the flare
      // reaches the hem instead of finishing early and leaving a plain skirt bottom
      var rnd = setupRnds + Math.round(i * usable / n);
      if (rnd <= prevRnd) rnd = prevRnd + 1;
      if (rnd > totalRnds) rnd = totalRnds;
      prevRnd = rnd;
      out.rounds.push({ rnd: rnd, before: before, after: cur, add: add, text: text });
    }
    out.every = Math.max(1, Math.round(usable / n));
    out.finalCount = cur;
    return out;
  }

  // The one distribution primitive every shaping round uses. Spread `majCount`
  // majority stitches across `groups` dividers as evenly as a readable instruction
  // allows, and return the round text. One "group" is `k` majority stitches
  // (majUnit, e.g. "hdc" or "2 hdc") then one divider (divPhrase, e.g.
  // "2 hdc in next st" for an increase or "hdc2tog" for a decrease). Group sizes
  // differ by at most one — `big` groups get q+1, `small` get q. gcd(big, small)
  // is the number of identical arcs the round splits into: when > 1 we repeat one
  // arc so the denser groups recur at evenly-spaced points; when 1 (no exact
  // repeat) we Bresenham-interleave the large and small groups. There is never a
  // leftover tail. Assumes groups >= 1.
  function spreadGroups(groups, majCount, majUnit, divPhrase) {
    if (majCount < 0) majCount = 0;                    // defensive: never below zero majority sts
    var q = Math.floor(majCount / groups), rr = majCount % groups;   // rr groups get q+1
    var body = function (k) {                          // k majority sts, then one divider
      if (k <= 0) return divPhrase;
      var majPart = k === 1 ? majUnit + " in next st" : majUnit + " in each of next " + k + " sts";
      return majPart + ", " + divPhrase;
    };
    var seg = function (k, cnt) { return cnt === 1 ? body(k) : "(" + body(k) + ") " + cnt + " times"; };
    var block = function (k, n) { return n === 1 ? body(k) : "*" + body(k) + "; rep from * " + n + " times"; };
    var big = rr, small = groups - rr;
    if (big === 0) return block(q, small);             // all groups uniform (q majority)
    if (small === 0) return block(q + 1, big);         // all groups uniform (q+1 majority)
    var g = gcdInt(big, small);
    if (g === 1) {
      var topChunks = function (s) {                    // top-level ", "-separated pieces
        var d = 0, n = 1;
        for (var i = 0; i < s.length; i++) {
          var c = s[i];
          if (c === "(") d++; else if (c === ")") d--;
          else if (d === 0 && c === "," && s[i + 1] === " ") n++;
        }
        return n;
      };
      var mnN = Math.min(big, small), mxN = Math.max(big, small);
      var mnBody = (big <= small) ? body(q + 1) : body(q);   // the rarer group type
      var mxBody = (big <= small) ? body(q) : body(q + 1);
      // 1) Sprinkle the rarer groups evenly among the common ones (Bresenham + RLE).
      var list = [], acc = 0;
      for (var i2 = 0; i2 < groups; i2++) {
        var nb = Math.floor((i2 + 1) * mnN / groups), h = nb !== acc; acc = nb;
        var last = list[list.length - 1];
        if (last && last.h === h) last.n++; else list.push({ h: h, n: 1 });
      }
      var sprinkle = list.map(function (r) { var b = r.h ? mnBody : mxBody; return r.n === 1 ? b : "(" + b + ") " + r.n + " times"; }).join(", ");
      if (topChunks(sprinkle) <= 6) return sprinkle;
      // 2) Balanced: pair each rarer group with its share of common groups into
      //    A = mnN equal-ish arcs so the two interleave, written as two blocks.
      var A = mnN, base = Math.floor(mxN / A), extra = mxN % A;
      var arcOf = function (c) { var a = [mnBody]; for (var j = 0; j < c; j++) a.push(mxBody); return a.join(", "); };
      var arcSeg = function (c, cnt) { return "(" + arcOf(c) + ") " + cnt + (cnt === 1 ? " time" : " times"); };
      return arcSeg(base, A - extra) + ", " + arcSeg(base + 1, extra);
    }
    // g equal arcs: each arc has big/g large groups then small/g small groups.
    return "*" + seg(q + 1, big / g) + ", " + seg(q, small / g) + "; rep from * " + g + " times";
  }

  // Adjust a round from `frm` to `to` stitches in one round, evenly and tail-free.
  function evenAdjust(frm, to, stitch) {
    if (to === frm) return stitch + " in each st around";
    if (to < frm) {
      var dec = frm - to;
      // more than half removed can't be done with 2tog alone (needs 3tog+) — rare fallback
      if (2 * dec > frm) return stitch + "2tog around, then " + stitch + " evenly to " + to + " sts";
      // `dec` dividers (each a 2tog), with the frm − 2·dec plain sts spread between them
      return spreadGroups(dec, frm - 2 * dec, stitch, stitch + "2tog");
    }
    var inc = to - frm;
    if (inc >= frm) return "2 " + stitch + " in each st around, then " + stitch + " evenly to " + to + " sts";
    // increases are the dividers; when near-doubling, the plain sts are the rarer
    // side, so make them the dividers instead for the more natural phrasing.
    return inc <= frm - inc
      ? spreadGroups(inc, frm - inc, stitch, "2 " + stitch + " in next st")
      : spreadGroups(frm - inc, inc, "2 " + stitch, stitch + " in next st");
  }

  function spotChart(diaCm, gapMult, stPerCm, rowPerCm) {
    var W = Math.max(2, jsround(diaCm * stPerCm));
    var H = Math.max(2, jsround(diaCm * rowPerCm));
    var gapH = Math.max(2, jsround(diaCm * gapMult * stPerCm));
    var gapV = Math.max(2, jsround(diaCm * gapMult * rowPerCm));
    var repW = W + gapH, repH = H + gapV;
    var rows = [];
    for (var i = 0; i < H; i++) {
      var y = ((i + 0.5) / H) * 2 - 1;
      var w = jsround(W * Math.sqrt(Math.max(0, 1 - y * y)));
      w = Math.min(W, Math.max(1, w));
      var lead = Math.floor((repW - w) / 2);
      rows.push({ w: w, lead: lead, trail: repW - w - lead });
    }
    return { W: W, H: H, gapH: gapH, gapV: gapV, repW: repW, repH: repH, rows: rows };
  }

  function spotCharts(sizesCm, gapMult, stPerCm, rowPerCm) {
    var sorted = sizesCm.slice().sort(function (a, b) { return b - a; });
    return sorted.map(function (dia) {
      var c = spotChart(dia, gapMult, stPerCm, rowPerCm);
      c.diaCm = dia;
      return c;
    });
  }

  var DEFAULT_INPUT = {
    unit: "cm",
    gauges: {
      rib: { sts: 18, rows: 9, width: 10, height: 10 },
      hdc: { sts: 14, rows: 11, width: 10, height: 10 },
      sc: { sts: 16, rows: 18, width: 10, height: 10 }
    },
    body: { bust: 92, waist: 74, upperBust: 84, hip: 98, upperArm: 30, wrist: 16, skirtLen: 45, sleeveLen: 50 },
    style: { waistEase: -5, fullness: 2.0, flare: 1.8, balloon: 1.4, dotDia: 2.5, dotGap: 1.2, ribStyle: "sideways" },
    colors: { cap: "cap colour", spot: "spot colour", body: "body colour" }
  };
  var defaultInput = function () { return JSON.parse(JSON.stringify(DEFAULT_INPUT)); };

  function computePattern(input) {
    if (!input) input = DEFAULT_INPUT;
    var u = input.unit || "cm";
    var C = Object.assign({}, DEFAULT_INPUT.colors, input.colors || {});
    var S = Object.assign({}, DEFAULT_INPUT.style, input.style || {});
    var B = Object.assign({}, DEFAULT_INPUT.body, input.body || {});
    var G = Object.assign({}, DEFAULT_INPUT.gauges, input.gauges || {});

    var rib = density(G.rib, u), hdc = density(G.hdc, u), sc = density(G.sc, u);
    var waist = toCm(B.waist, u), upperBust = toCm(B.upperBust, u), hip = toCm(B.hip, u);
    var upperArm = toCm(B.upperArm, u), wrist = toCm(B.wrist, u);
    var skirtLen = toCm(B.skirtLen, u), sleeveLen = toCm(B.sleeveLen, u);
    var dotDia = toCm(S.dotDia, u);

    var warnings = [];
    var H = function (cm) { return r1(fromCm(cm, u)) + " " + u; };
    var pieces = [];

    // 1. waistband
    var ribStyle = S.ribStyle === "post" ? "post" : "sideways";   // default: sideways back-loop rib
    var wbCirc = waist + S.waistEase;                             // fit reference for the skirt/hem (unchanged)
    // The ribbed BAND is worked to a smaller RELAXED circumference so it must
    // stretch to sit at the waist — that stretch is what grips. Sideways back-loop
    // rib is far stretchier than post-stitch rib, so it needs deeper negative ease
    // or it slides down. bandEase is a fraction of the waist; default is rib-style-
    // aware and can be overridden with S.bandEase.
    var bandEase = (S.bandEase != null) ? S.bandEase
                 : (ribStyle === "sideways" ? -0.15 : (S.waistEase / Math.max(1, waist)));
    var bandCirc = Math.max(20, waist * (1 + bandEase));         // relaxed band circumference
    var wbRnds = Math.max(4, jsround(12 * rib.row));
    var wbHeightSts = Math.max(6, jsround(wbRnds * rib.st / rib.row));    // band height in sts (sideways)
    var wbRowsAround = even(jsround(bandCirc * rib.row));                  // rows around = edge pickup count (sideways)
    var wbSts = even(jsround(bandCirc * rib.st));                         // stitches around (in-the-round)
    // The band is worked first, then folded into the skirt piece (below) instead of
    // being fastened off on its own — after it you rotate/continue and work the skirt
    // straight down its edge, so band + skirt + hem frill read as one instruction.
    var wbEdge, wbEdgeLabel, bandSteps, bandCounts, bandStitch, bandSts;
    if (ribStyle === "sideways") {
      wbEdge = wbRowsAround;
      wbEdgeLabel = wbRowsAround + " row-ends";
      bandSts = wbHeightSts * wbRowsAround;
      bandStitch = "sideways rib band, then A-line skirt in the round · rib + hdc";
      bandCounts = { style: "sideways", sts: wbRowsAround, rowsAround: wbRowsAround, heightSts: wbHeightSts, circumference: bandCirc };
      bandSteps = [
        ["Waistband — foundation", "In " + C.body + ", ch " + wbHeightSts + " — this is the band's HEIGHT, not its circumference, so there's no starting chain around your body to fight the stretch."],
        ["Waistband — rib rows", "Row 1: sc in 2nd ch from hook and each ch (" + wbHeightSts + " sc). Every row after: ch 1, turn, sc in back loop only across. The back-loop ridges make the rib."],
        ["Waistband — length", "Work " + wbRowsAround + " rows. Relaxed the strip is about " + H(bandCirc) + " — deliberately smaller than your " + H(waist) + " waist, so the stretchy rib has to grip. It should need a firm stretch to close and stay put. Add/remove rows to fit (very stretchy yarn → fewer rows)."],
        ["Waistband — seam", "Join the first and last rows into a ring (mattress st or sc seam). Test it grips your waist and still pulls over your hips."],
        ["Turn for the skirt", "Do NOT fasten off. Rotate the band 90° and work the skirt straight down into the row-ends along one long edge — the next round sets the skirt's stitch count."]
      ];
    } else {
      wbEdge = wbSts;
      wbEdgeLabel = wbSts + " rib sts";
      bandSts = wbSts * wbRnds;
      bandStitch = "rib band in the round, then A-line skirt · fpdc/bpdc + hdc";
      bandCounts = { style: "post", sts: wbSts, rounds: wbRnds, circumference: bandCirc };
      bandSteps = [
        ["Waistband — foundation (stretchy start)", "In " + C.body + ", work " + wbSts + " foundation sc (fsc) and join into a ring, not twisting — a foundation row stretches with the rib; a starting chain won't clear your hips."],
        ["Waistband — rib", "Ch 2, *fpdc in next st, bpdc in next st; rep from * around, join. Rep to Rnd " + wbRnds + ". (" + wbSts + " sts)"],
        ["Down to the skirt", "Do NOT fasten off — continue straight down into the skirt below; the next round sets the skirt's stitch count."]
      ];
    }

    // 2. skirt (with the waistband folded in above it and the hem frill below)
    var hemCirc = wbCirc * S.fullness;
    var skRnds = Math.max(6, jsround(skirtLen * hdc.row));
    // Skirt top rides the true waist (fit-critical): nudge to a rounder count but
    // keep it within a stitch or two of the waist (well inside fit tolerance) and,
    // where it can, sharing a factor with the band edge for a cleaner join round.
    var skTol = 1.3;                                            // cm of allowed give
    var skStart = niceCount(jsround(waist * hdc.st), wbEdge,
      Math.ceil(waist * hdc.st - skTol * hdc.st), Math.floor(waist * hdc.st + skTol * hdc.st));
    // Hem is a decorative flare with real slack: snap up to a clean count that
    // continues cleanly from the skirt top.
    var hemRaw = jsround(hemCirc * hdc.st);
    var hemSts = niceCount(hemRaw, skStart, hemRaw - 3, hemRaw + 3);
    var skJoin = evenAdjust(wbEdge, skStart, "hdc");
    // ~4.5% per increase round → smaller, more frequent increases for a smoother A-line
    var skPlan = incPlan(skStart, hemSts, skRnds, "hdc", 1, 0.045);
    if (hemSts <= skStart) warnings.push("Hem is no wider than the waist — raise fullness or check hdc gauge.");
    // Hem frill worked STRAIGHT onto the bottom of the skirt — same body colour, no
    // separate join. Flare once to a fuller ruffle (a multiple of 6 for the shell
    // edging), ruffle straight for a few rounds, then a shell edge.
    var frillFull = mult(jsround(skPlan.finalCount * 1.6), 6);
    var frillRnds = Math.max(4, jsround(9 * hdc.row));
    var frillFlare = evenAdjust(skPlan.finalCount, frillFull, "hdc");
    var frillShells = Math.floor(frillFull / 6);
    var frillFlareRnd = skRnds + 1, frillEndRnd = skRnds + 1 + frillRnds;
    pieces.push({
      id: "skirt", title: "Waistband, A-line skirt & hem frill", stitch: bandStitch,
      counts: { start: skStart, hem: skPlan.finalCount, end: frillFull, shells: frillShells, rounds: frillEndRnd + 1, incRounds: skPlan.rounds.length, band: bandCounts },
      progress: { total: frillEndRnd, start: skStart, end: frillFull,
        incRounds: skPlan.rounds.map(function (x) { return { rnd: x.rnd, count: x.after }; }).concat([{ rnd: frillFlareRnd, count: frillFull }]) },
      extraYarn: [{ g: "rib", color: "body", sts: bandSts, title: "Waistband (rib)" }],
      steps: bandSteps.concat([
        ["Skirt set-up (Rnd 1)", "Ch 2, " + skJoin + ", working into the band edge, join. (" + wbEdgeLabel + " → " + skStart + " hdc)"],
        ["Plain rnds", "Ch 2, hdc in each st around, join. Rep for every round not listed."]
      ]).concat(skPlan.rounds.map(function (x) { return ["Rnd " + x.rnd, "Ch 2, " + x.text + ", join. (" + x.after + " hdc)"]; }))
        .concat([
          ["Hem (Rnd " + skRnds + ")", "Work plain to Rnd " + skRnds + " — do NOT fasten off; the frill continues straight down the same edge. (" + skPlan.finalCount + " hdc)"],
          ["Frill flare (Rnd " + frillFlareRnd + ")", "Ch 2, " + frillFlare + ", join. (" + frillFull + " hdc)"],
          ["Frill ruffle", "Ch 2, hdc in each st around, join. Rep to Rnd " + frillEndRnd + " so the frill ruffles. (" + frillFull + " hdc)"],
          ["Frill shell edge", "Ch 1, *sc in next st, sk 2, 5 dc in next st, sk 2; rep from * around, join. (" + frillShells + " shells)"],
          ["Finish", "Fasten off and block the frill open."]
        ])
    });

    // 3. flounce
    var flTop = jsround(upperBust * sc.st);
    var flBot = jsround(flTop * S.flare);
    var flRnds = Math.max(5, jsround(16 * sc.row));
    var flPlan = incPlan(flTop, flBot, flRnds, "sc", 1);
    // gill frill worked straight onto the flounce's lower edge (colour change to body),
    // folded into this piece instead of being a separate join-on frill.
    var gillBase = mult(flPlan.finalCount, 6);                  // multiple of 6 for the shells
    var gillRnds = Math.max(4, jsround(5 * sc.row));
    var gillShells = Math.floor(gillBase / 6);
    var gillAdjust = evenAdjust(flPlan.finalCount, gillBase, "sc");
    pieces.push({
      id: "flounce", title: "Off-shoulder flounce + gill frill", stitch: "in the round · sc tapestry, shell edge",
      counts: { start: flTop, end: flPlan.finalCount, gill: gillBase, shells: gillShells, rounds: flRnds + gillRnds + 2 },
      progress: { total: flRnds, start: flTop, end: flPlan.finalCount,
        incRounds: flPlan.rounds.map(function (x) { return { rnd: x.rnd, count: x.after }; }) },
      extraYarn: [{ g: "sc", color: "body", sts: gillBase * (gillRnds + 2), title: "Gill frill" }],
      steps: [
        ["Foundation", "In " + C.cap + ", ch " + flTop + ". Join to form a ring, not twisting."],
        ["Rnd 1", "Ch 1, sc in each ch around, join. (" + flTop + " sc)"]
      ].concat(flPlan.rounds.map(function (x) { return ["Rnd " + x.rnd, "Ch 1, " + x.text + ", join. (" + x.after + " sc)"]; }))
        .concat([
          ["Flounce finish", "Work plain to Rnd " + flRnds + ". Thread elastic through Rnd 1 so it sits off the shoulder. (" + flPlan.finalCount + " sc)"],
          ["Gill frill — set up", "Change to " + C.body + " at the flounce's lower edge (don't fasten off). Ch 1, " + gillAdjust + ", join. (" + gillBase + " sc — a multiple of 6)"],
          ["Gill frill — body", "Ch 1, sc in each st around, join. Rep to Rnd " + (flRnds + gillRnds) + "."],
          ["Gill frill — shells", "Ch 1, *sc in next st, sk 2, 5 dc in next st, sk 2; rep from * around, join. (" + gillShells + " shells)"],
          ["Gill frill — picots", "Ch 1, *sc, (ch 3, sl st in 3rd ch from hook), sc; rep from * around, join."],
          ["Finish", "Fasten off and block so the shells open."]
        ])
    });

    // 4. spots
    var rawSizes = (S.dotSizes && S.dotSizes.length) ? S.dotSizes : [S.dotDia];
    var sizesCm = rawSizes.map(function (s) { return toCm(s, u); });
    var charts = spotCharts(sizesCm, S.dotGap, sc.st, sc.row);
    var chart = charts[0];
    var repsAround = Math.max(1, Math.floor(flTop / chart.repW));
    var flAdj = repsAround * chart.repW;
    var spotsPiece;
    if (charts.length === 1) {
      spotsPiece = {
        id: "spots", title: "Polka spots", stitch: "tapestry sc · carry both colours",
        counts: { spotW: chart.W, spotH: chart.H, repeatW: chart.repW, repeatH: chart.repH, repsAround: repsAround, adjustedSts: flAdj },
        chart: chart, charts: charts,
        steps: [
          ["Stitch count", "Adjust the flounce from " + flTop + " to " + flAdj + " sts so " + repsAround + " repeats fit exactly — otherwise the last spot is cut in half at the join."],
          ["Colour change", "Change colour on the LAST pull-through of the stitch BEFORE the one you want in the new colour."],
          ["Carrying", "Lay the resting colour along the top of the stitches and work over it. No floats."]
        ].concat(chart.rows.map(function (row, i) {
          return ["Rnd " + (i + 1), "*sc " + row.lead + " in " + C.cap + ", sc " + row.w + " in " + C.spot + ", sc " + row.trail + " in " + C.cap + "; rep from * " + repsAround + " times."];
        })).concat([
          ["Rnds " + (chart.H + 1) + "–" + chart.repH, "Sc in " + C.cap + " around, carrying " + C.spot + "."],
          ["Stagger", "Shift the next band by " + jsround(chart.repW / 2) + " sts so spots brick rather than stack."]
        ])
      };
    } else {
      var sizeLabel = charts.map(function (c) { return r1(fromCm(c.diaCm, u)) + u + " (" + c.W + "×" + c.H + " sts)"; }).join(", ");
      spotsPiece = {
        id: "spots", title: "Scattered spots (mixed sizes)", stitch: "surface embroidery / applique · scattered",
        counts: {
          sizes: charts.map(function (c) { return { diaCm: c.diaCm, W: c.W, H: c.H, repeatW: c.repW, repeatH: c.repH }; }),
          spotW: chart.W, spotH: chart.H, repeatW: chart.repW, repeatH: chart.repH, repsAround: repsAround, adjustedSts: flAdj
        },
        chart: chart, charts: charts,
        steps: [
          ["Approach", "With spots in " + charts.length + " sizes, work the flounce and sleeves plain in " + C.cap + ", then add each spot afterwards — mixed sizes will not tile into even tapestry bands."],
          ["Motif sizes", "Make spots at these sizes: " + sizeLabel + ". Each is a filled ellipse worked to the stitch counts shown."]
        ].concat(charts.map(function (c, i) {
          return ["Size " + (i + 1) + " — " + r1(fromCm(c.diaCm, u)) + u,
            "Widths per row (centre outward): " + c.rows.map(function (row) { return row.w; }).join(", ") + " sts over " + c.H + " rows."];
        })).concat([
          ["Placement", "Scatter them at random over the " + C.cap + " areas, mixing large and small, roughly " + r1(fromCm(chart.gapH / sc.st, u)) + u + " apart. Aim for an even sprinkle rather than a grid — see the visualisation."],
          ["Method", "Duplicate stitch or satin stitch in " + C.spot + " for embroidered spots; or crochet each ellipse separately and whip-stitch it on for a raised, appliqued look."],
          ["Timing", "Add the spots after the piece is worked but before assembly, so the ground fabric lies flat while you stitch."]
        ])
      };
    }
    pieces.push(spotsPiece);

    // 5. sleeves — the cuff follows the same ribStyle as the waistband, then the
    // body is worked in the round identically from scCuff onward.
    var cuffSts = even(jsround((wrist + 2) * rib.st));
    // Cuff opening rides the wrist (fit-critical): nudge to a rounder count within a
    // stitch or two, sharing a factor with the rib count for a cleaner cuff join.
    var scTol = 1.3, scRealCuff = (wrist + 2) * sc.st;
    var scCuff = niceCount(jsround(scRealCuff), cuffSts,
      Math.ceil(scRealCuff - scTol * sc.st), Math.floor(scRealCuff + scTol * sc.st));
    // Balloon peak is decorative fullness with real slack — snap to a clean count.
    var balRaw = jsround(upperArm * S.balloon * sc.st);
    var balSts = niceCount(balRaw, scCuff * 2, balRaw - 3, balRaw + 3);
    // Sleeve top has a little ease; nudge to a rounder count within a stitch or two.
    var topRaw = jsround((upperArm + 4) * sc.st);
    var topSts = niceCount(topRaw, balSts, topRaw - 2, topRaw + 2);
    var cuffRnds = Math.max(3, jsround(5 * rib.row));
    var cuffHeightSts = Math.max(6, jsround(cuffRnds * rib.st / rib.row));
    var cuffRowsAround = even(jsround((wrist + 2) * rib.row));
    var bodyRnds = Math.max(6, jsround((sleeveLen - 5) * sc.row));
    var sleeveSteps, cuffEndRnd, cuffStartCount, cuffLabel;
    if (ribStyle === "sideways") {
      cuffEndRnd = 1;
      cuffStartCount = scCuff;
      cuffLabel = cuffRowsAround;
      sleeveSteps = [
        ["Cuff (sideways rib)", "In " + C.cap + ", ch " + cuffHeightSts + " (the cuff height). Row 1: sc in 2nd ch and each ch; then ch 1, turn, sc in back loop only across. Work " + cuffRowsAround + " rows, then seam into a ring — back-loop rows stretch to pass over your hand."],
        ["Rnd 1", "Ch 1, work " + scCuff + " sc evenly around the cuff's edge, join. (" + scCuff + " sc)"]
      ];
    } else {
      cuffEndRnd = cuffRnds + 1;
      cuffStartCount = cuffSts;
      cuffLabel = cuffSts;
      sleeveSteps = [
        ["Foundation (stretchy start)", "In " + C.cap + ", work " + cuffSts + " foundation sc (fsc) and join into a ring — the foundation stretches with the rib so the cuff clears your hand."],
        ["Cuff rib", "Ch 2, *fpdc, bpdc; rep from * around, join. Rep to Rnd " + cuffRnds + ". (" + cuffSts + " sts)"],
        ["Rnd " + (cuffRnds + 1), "Ch 1, " + evenAdjust(cuffSts, scCuff, "sc") + ", join. (" + cuffSts + " rib sts → " + scCuff + " sc)"]
      ];
    }
    var slRnds = cuffEndRnd + bodyRnds;
    var cur = scCuff, rnd = cuffEndRnd;
    var sleeveInc = [{ rnd: cuffEndRnd, count: scCuff }];
    if (balSts > scCuff * 2) {
      rnd += 1;
      sleeveSteps.push(["Rnd " + rnd, "Ch 1, 2 sc in each st around, join. (" + (scCuff * 2) + " sc)"]);
      cur = scCuff * 2;
      sleeveInc.push({ rnd: rnd, count: cur });
    }
    if (balSts > cur) {
      rnd += 1;
      sleeveSteps.push(["Rnd " + rnd, "Ch 1, " + evenAdjust(cur, balSts, "sc") + ", join. (" + balSts + " sc)"]);
      cur = balSts;
      sleeveInc.push({ rnd: rnd, count: cur });
    }
    var straightTo = Math.max(rnd + 1, slRnds - 2);
    sleeveSteps.push(["Rnds " + (rnd + 1) + "–" + straightTo, "Ch 1, sc around, join. Work spots as charted. (" + cur + " sc)"]);
    var sleeveEnd = cur;
    if (cur > topSts) {
      sleeveSteps.push(["Rnd " + (straightTo + 1), "Ch 1, " + evenAdjust(cur, topSts, "sc") + ", join. (" + topSts + " sc)"]);
      sleeveInc.push({ rnd: straightTo + 1, count: topSts });
      sleeveEnd = topSts;
    }
    sleeveSteps.push(["Finish", "Fasten off. Thread elastic through the final round."]);
    if (!S.sleeveless) {
      pieces.push({
        id: "sleeves", title: "Lantern sleeves ×2",
        stitch: ribStyle === "sideways" ? "sideways cuff + sc body" : "in the round, cuff up · rib + sc",
        counts: { cuff: cuffLabel, balloon: balSts, top: topSts, rounds: slRnds },
        progress: { total: slRnds, start: cuffStartCount, end: sleeveEnd, incRounds: sleeveInc },
        steps: sleeveSteps, makeCount: 2
      });
    }

    // (the gill frill is now worked straight onto the flounce above — see piece 3;
    //  the hem frill is worked straight onto the skirt — see piece 2)

    // 6. mushroom border
    var motifs = Math.max(6, jsround(hemCirc / 7));
    pieces.push({
      id: "border", title: "Mushroom border", stitch: "surface embroidery",
      counts: { motifs: motifs, spacing: hemCirc / motifs },
      steps: [
        ["Placement", "Mark " + motifs + " points around the skirt, ~" + H(hemCirc / motifs) + " apart, above the hem frill."],
        ["Caps", "Embroider a cap and stem at each in " + C.cap + ", surface slip stitch or duplicate stitch."],
        ["Spots", "Tiny " + C.spot + " French knots on each cap."],
        ["Timing", "AFTER the skirt is finished and blocked — embroidering as you go distorts the increase rounds."]
      ]
    });

    // 9. straps
    var strapLen = 48;
    var strapSts = jsround(strapLen * sc.st);
    if (!S.strapless) {
      pieces.push({
        id: "straps", title: "Bowtie shoulder straps ×2", stitch: "flat · sc",
        counts: { chain: strapSts + 3, sts: strapSts + 2, length: strapLen },
        steps: [
          ["Make 2", "In " + C.cap + ", ch " + (strapSts + 3) + ". Sc in 2nd ch from hook and each ch across. (" + (strapSts + 2) + " sc)"],
          ["Rows 2–3", "Ch 1, turn, sc across. Rep once."],
          ["Attach", "Sew to the front and back of the flounce; tie in bows at the shoulders."],
          ["Blocking", "Wet-block the whole dress, easing both frills open."]
        ],
        makeCount: 2
      });
    }
    if (S.strapless) warnings.push("Strapless: the flounce is held up by elastic and negative ease alone — test it stays up before committing.");

    if (hip > 0 && wbCirc * 1.35 < hip) {
      warnings.push("Waistband may not stretch over your hips — seam it and test before crocheting the skirt.");
    }
    var chkGauge = function (label, d) {
      if (d.st * 10 < 6 || d.st * 10 > 44 || d.row * 10 < 4 || d.row * 10 > 50) {
        warnings.push("The " + label + " gauge looks unusual — check the swatch size matches the distance counted.");
      }
    };
    chkGauge("rib", rib); chkGauge("hdc", hdc); chkGauge("sc", sc);

    return {
      pieces: pieces, warnings: warnings,
      meta: {
        unit: u, kind: "dress", density: { rib: rib, hdc: hdc, sc: sc },
        waistbandCirc: wbCirc, hemCirc: hemCirc, skirtTopSts: skStart, colors: C
      }
    };
  }

  // Shared: a spotted-band "spots" piece for the accessories, reusing the
  // same elliptical chart the dress uses so everything matches.
  function spotsPieceFor(baseSts, C, S, u, sc, where) {
    var sizesCm = ((S.dotSizes && S.dotSizes.length) ? S.dotSizes : [S.dotDia]).map(function (s) { return toCm(s, u); });
    var charts = spotCharts(sizesCm, S.dotGap, sc.st, sc.row);
    var chart = charts[0];
    var reps = Math.max(1, Math.floor(baseSts / chart.repW));
    return {
      id: "spots", title: "Spots", stitch: "tapestry sc · carry both colours",
      counts: { spotW: chart.W, spotH: chart.H, repeatW: chart.repW, repeatH: chart.repH, repsAround: reps, adjustedSts: reps * chart.repW },
      chart: chart, charts: charts,
      steps: [
        ["Where", "Work the spots on " + where + ", in " + C.cap + " carrying " + C.spot + "."],
        ["Count", "Adjust that round to " + (reps * chart.repW) + " sts so " + reps + " spot repeats fit exactly — otherwise the last spot is cut in half at the join."],
      ].concat(chart.rows.map(function (row, i) {
        return ["Rnd " + (i + 1), "*sc " + row.lead + " in " + C.cap + ", sc " + row.w + " in " + C.spot + ", sc " + row.trail + " in " + C.cap + "; rep from * " + reps + " times."];
      })).concat([["Stagger", "Shift each band by " + jsround(chart.repW / 2) + " sts so spots brick rather than stack."]]),
    };
  }

  // ---- Matching bucket HAT (mushroom cap): domed spotted crown, grip band,
  // flared brim, gill frill underneath. Worked top-down. ----
  function computeHat(input) {
    input = input || {};
    var u = input.unit || "cm";
    var C = Object.assign({}, DEFAULT_INPUT.colors, input.colors || {});
    var S = Object.assign({}, DEFAULT_INPUT.style, input.style || {});
    var G = Object.assign({}, DEFAULT_INPUT.gauges, input.gauges || {});
    var A = input.accessory || {};
    var rib = density(G.rib, u), hdc = density(G.hdc, u), sc = density(G.sc, u);
    var headCirc = toCm(A.headCirc != null ? A.headCirc : 56, u);
    var sideHeight = toCm(A.sideHeight != null ? A.sideHeight : 8, u);
    var brimWidth = toCm(A.brimWidth != null ? A.brimWidth : 5, u);
    var warnings = [], pieces = [];
    var mapInc = function (rounds) { return rounds.map(function (x) { return { rnd: x.rnd, count: x.after }; }); };

    // head circumference is fit-critical; nudge toward a rounder count (so the brim
    // increases starting from headSts divide cleanly) but stay within fit tolerance.
    var headReal = headCirc * hdc.st, headTol = 1.3;
    var headSts = niceCount(even(jsround(headReal)), 0,
      Math.ceil(headReal - headTol * hdc.st), Math.floor(headReal + headTol * hdc.st));
    var radius = headCirc / (2 * Math.PI);
    var crownRnds = Math.max(6, jsround(radius * hdc.row));
    var crownPlan = incPlan(8, headSts, crownRnds, "hdc", 1);
    pieces.push({
      id: "crown", title: "Mushroom-cap crown", stitch: "in the round, top down · hdc",
      counts: { start: 8, end: crownPlan.finalCount, rounds: crownRnds },
      progress: { total: crownRnds, start: 8, end: crownPlan.finalCount, incRounds: mapInc(crownPlan.rounds) },
      yarn: { g: "hdc", color: "cap" },
      steps: [
        ["Foundation", "In " + C.cap + ", make a magic ring; 8 hdc into the ring, join. (8 hdc)"],
        ["Dome", "Increase on the rounds below to dome the cap to " + crownPlan.finalCount + " sts."],
      ].concat(crownPlan.rounds.map(function (x) { return ["Rnd " + x.rnd, "Ch 2, " + x.text + ", join. (" + x.after + " hdc)"]; }))
        .concat([["Finish", "Work plain to Rnd " + crownRnds + ". (" + crownPlan.finalCount + " hdc)"]]),
    });

    var sideRnds = Math.max(3, jsround(sideHeight * hdc.row));
    pieces.push({
      id: "sides", title: "Cap sides", stitch: "in the round · hdc",
      counts: { sts: headSts, rounds: sideRnds },
      progress: { total: sideRnds, start: headSts, end: headSts, incRounds: [] },
      yarn: { g: "hdc", color: "cap" },
      steps: [
        ["Body", "In " + C.cap + ", ch 2, hdc in each st around, join. Rep to Rnd " + sideRnds + ". (" + headSts + " hdc)"],
        ["Try on", "Slip it on before the brim — the sides should sit snugly on your head."],
      ],
    });

    var brimSts = even(jsround((headCirc + 2 * Math.PI * brimWidth) * hdc.st));
    var brimRnds = Math.max(3, jsround(brimWidth * hdc.row));
    var brimPlan = incPlan(headSts, brimSts, brimRnds + 2, "hdc", 1);
    pieces.push({
      id: "brim", title: "Flared brim", stitch: "in the round · hdc",
      counts: { start: headSts, end: brimPlan.finalCount, rounds: brimRnds },
      progress: { total: brimRnds + 1, start: headSts, end: brimPlan.finalCount, incRounds: mapInc(brimPlan.rounds) },
      yarn: { g: "hdc", color: "cap" },
      steps: [
        ["Flare", "The brim flares out like the edge of a mushroom cap."],
      ].concat(brimPlan.rounds.map(function (x) { return ["Rnd " + x.rnd, "Ch 2, " + x.text + ", join. (" + x.after + " hdc)"]; }))
        .concat([["Finish", "Fasten off. (" + brimPlan.finalCount + " hdc)"]]),
    });

    var gillBase = mult(brimPlan.finalCount, 6);
    var gillRnds = Math.max(2, jsround(3 * sc.row));
    pieces.push({
      id: "gillFrill", title: "Gill frill (cap underside)", stitch: "shell edging · sc + dc",
      counts: { base: gillBase, shells: Math.floor(gillBase / 6) },
      progress: { total: gillRnds + 1, start: gillBase, end: gillBase, incRounds: [] },
      yarn: { g: "sc", color: "body" },
      steps: [
        ["Set-up", "In " + C.body + ", join under the brim edge. Sc evenly to " + gillBase + " sc (multiple of 6). Join."],
        ["Shells", "Ch 1, *sc in next st, sk 2, 5 dc in next st, sk 2; rep from * around, join. (" + Math.floor(gillBase / 6) + " shells)"],
        ["Finish", "Fasten off; block so the gills open like a real cap."],
      ],
    });

    pieces.push(spotsPieceFor(headSts, C, S, u, sc, "the cap sides and lower crown"));

    if (headSts < 40) warnings.push("Head circumference looks small — double-check the measurement and your hdc gauge.");
    return {
      pieces: pieces, warnings: warnings,
      meta: { unit: u, kind: "hat", density: { rib: rib, hdc: hdc, sc: sc }, colors: C, headCirc: headCirc, brimCirc: headCirc + 2 * Math.PI * brimWidth },
    };
  }

  // ---- Matching drawstring bucket BAG: round base, straight spotted sides,
  // eyelet round + drawstring, strap. Worked bottom-up. ----
  function computeBag(input) {
    input = input || {};
    var u = input.unit || "cm";
    var C = Object.assign({}, DEFAULT_INPUT.colors, input.colors || {});
    var S = Object.assign({}, DEFAULT_INPUT.style, input.style || {});
    var G = Object.assign({}, DEFAULT_INPUT.gauges, input.gauges || {});
    var A = input.accessory || {};
    var rib = density(G.rib, u), hdc = density(G.hdc, u), sc = density(G.sc, u);
    var diameter = toCm(A.diameter != null ? A.diameter : 18, u);
    var height = toCm(A.height != null ? A.height : 22, u);
    var strapLen = toCm(A.strapLen != null ? A.strapLen : 70, u);
    var warnings = [], pieces = [];
    var mapInc = function (rounds) { return rounds.map(function (x) { return { rnd: x.rnd, count: x.after }; }); };

    // the bag base has real slack — snap to a rounder count (cleaner eyelets, spots).
    var baseRaw = even(jsround(Math.PI * diameter * hdc.st));
    var baseSts = niceCount(baseRaw, 0, baseRaw - 3, baseRaw + 3);
    var baseRnds = Math.max(5, jsround((diameter / 2) * hdc.row));
    var basePlan = incPlan(8, baseSts, baseRnds, "hdc", 1);
    pieces.push({
      id: "base", title: "Round base", stitch: "in the round, from a ring · hdc",
      counts: { start: 8, end: basePlan.finalCount, rounds: baseRnds },
      progress: { total: baseRnds, start: 8, end: basePlan.finalCount, incRounds: mapInc(basePlan.rounds) },
      yarn: { g: "hdc", color: "body" },
      steps: [
        ["Foundation", "In " + C.body + ", magic ring; 8 hdc into the ring, join. (8 hdc)"],
        ["Flat circle", "Increase on the rounds below, keeping the base flat, to " + basePlan.finalCount + " sts."],
      ].concat(basePlan.rounds.map(function (x) { return ["Rnd " + x.rnd, "Ch 2, " + x.text + ", join. (" + x.after + " hdc)"]; }))
        .concat([["Turn up", "On the next round, work into the back loops only once to pop the sides up."]]),
    });

    var sideRnds = Math.max(6, jsround(height * hdc.row));
    pieces.push({
      id: "sides", title: "Bag sides", stitch: "in the round · hdc",
      counts: { sts: baseSts, rounds: sideRnds },
      progress: { total: sideRnds, start: baseSts, end: baseSts, incRounds: [] },
      yarn: { g: "hdc", color: "cap" },
      steps: [
        ["Body", "In " + C.cap + ", ch 2, hdc in each st around, join. Rep to Rnd " + sideRnds + ". (" + baseSts + " hdc)"],
        ["Spots", "Work the spots (below) over these rounds while you go, or add them after."],
      ],
    });

    pieces.push(spotsPieceFor(baseSts, C, S, u, sc, "the bag sides"));

    var eyelets = Math.floor(baseSts / 4);
    pieces.push({
      id: "band", title: "Eyelet band + top", stitch: "in the round · dc + sc",
      counts: { sts: baseSts, eyelets: eyelets, rounds: 3 },
      progress: { total: 3, start: baseSts, end: baseSts, incRounds: [] },
      yarn: { g: "hdc", color: "cap" },
      steps: [
        ["Eyelets", "Ch 3, *dc in next st, ch 1, sk 1 st; rep from * around, join. (" + eyelets + " eyelet holes for the drawstring)"],
        ["Top", "Ch 1, sc in each dc and each ch-1 space around, join. (" + baseSts + " sc)"],
        ["Edge", "Ch 1, sc around once more, join. Fasten off."],
      ],
    });

    var strapSts = jsround(strapLen * sc.st);
    pieces.push({
      id: "strap", title: "Strap + drawstring", stitch: "flat cords · sc / chain",
      counts: { strap: strapSts + 1, drawstring: jsround(Math.PI * diameter * 1.6 * sc.st) },
      yarn: { g: "sc", color: "cap", sts: (strapSts + 1) * 3 },
      steps: [
        ["Strap", "In " + C.cap + ", ch " + (strapSts + 2) + "; sc in 2nd ch and each ch across, then 2 more rows. Sew the ends inside the top edge."],
        ["Drawstring", "Ch a cord about " + Math.round(Math.PI * diameter * 1.6) + " sts long (long enough to weave through the eyelets and tie). Weave it through the eyelet round."],
        ["Finish", "Knot the drawstring ends; add a tassel if you like. Block the base flat."],
      ],
    });

    if (baseSts < 24) warnings.push("Base diameter looks small — check the diameter and your hdc gauge.");
    return {
      pieces: pieces, warnings: warnings,
      meta: { unit: u, kind: "bag", density: { rib: rib, hdc: hdc, sc: sc }, colors: C, baseCirc: Math.PI * diameter, height: height },
    };
  }

  // decrease equivalent of incPlan (start > target): spreads decrease rounds
  // evenly across the piece and uses evenAdjust for even shaping within a round.
  function decPlan(start, target, totalRnds, stitch, setupRnds, chunkFrac) {
    if (setupRnds === undefined) setupRnds = 1;
    var total = start - target;
    var out = { rounds: [], every: 0, finalCount: start };
    if (total <= 0) return out;
    var usable = Math.max(1, totalRnds - setupRnds - 1);
    // mirror incPlan: remove a fixed `sub` per round that divides `start`, so every
    // count stays a multiple of `sub` and each round is a clean repeat with no tail.
    var minPer = Math.ceil(total / usable);
    var desired = Math.min(total, Math.max(jsround(start * (chunkFrac || 0.08)), minPer));
    var hiD = Math.max(1, Math.min(start - 1, total));
    var sub = 1, bestAll = Infinity, subFits = 0, bestFits = Infinity;
    for (var d = 1; d <= hiD; d++) {
      if (start % d) continue;
      var dist = Math.abs(d - desired);
      if (dist < bestAll) { bestAll = dist; sub = d; }
      if (d >= minPer && dist < bestFits) { bestFits = dist; subFits = d; }
    }
    if (subFits) sub = subFits;
    var n = Math.max(1, Math.round(total / sub));
    if (n > usable) n = usable;
    var cur = start, prevRnd = setupRnds;
    for (var i = 1; i <= n; i++) {
      var before = cur;
      // sub divides before, so this is one clean repeat with no leftover tail
      var text = spreadGroups(sub, before - 2 * sub, stitch, stitch + "2tog");
      cur -= sub;
      var rnd = setupRnds + Math.round(i * usable / n);
      if (rnd <= prevRnd) rnd = prevRnd + 1;
      if (rnd > totalRnds) rnd = totalRnds;
      prevRnd = rnd;
      out.rounds.push({ rnd: rnd, before: before, after: cur, sub: sub, text: text });
    }
    out.every = Math.max(1, Math.round(usable / n));
    out.finalCount = cur;
    return out;
  }

  // ---- Matching mycelium TIGHTS (footless): rib waistband, sc hip yoke, two
  // tapered legs, ankle cuffs, plus an embroidered mycelium web. Worked top-down. ----
  function computeTights(input) {
    input = input || {};
    var u = input.unit || "cm";
    var C = Object.assign({}, DEFAULT_INPUT.colors, input.colors || {});
    var S = Object.assign({}, DEFAULT_INPUT.style, input.style || {});
    var B = Object.assign({}, DEFAULT_INPUT.body, input.body || {});
    var G = Object.assign({}, DEFAULT_INPUT.gauges, input.gauges || {});
    var A = input.accessory || {};
    var rib = density(G.rib, u), hdc = density(G.hdc, u), sc = density(G.sc, u);
    var H = function (cm) { return r1(fromCm(cm, u)) + " " + u; };
    var mapC = function (rounds) { return rounds.map(function (x) { return { rnd: x.rnd, count: x.after }; }); };

    var waist = toCm(A.waist != null ? A.waist : B.waist, u);
    var hip = toCm(A.hip != null ? A.hip : B.hip, u);
    var thigh = toCm(A.thigh != null ? A.thigh : 56, u);
    var ankle = toCm(A.ankle != null ? A.ankle : 24, u);
    var inseam = toCm(A.inseam != null ? A.inseam : 70, u);
    var rise = toCm(A.rise != null ? A.rise : 27, u);
    var hug = 0.94;   // sc barely stretches — work ~6% under the body so tights hug

    var warnings = [], pieces = [];

    // 1. rib waistband (grip), same construction options as the dress
    var ribStyle = S.ribStyle === "post" ? "post" : "sideways";
    var bandEase = (S.bandEase != null) ? S.bandEase : (ribStyle === "sideways" ? -0.15 : (S.waistEase / Math.max(1, waist)));
    var bandCirc = Math.max(20, waist * (1 + bandEase));
    var bandEdge;
    if (ribStyle === "sideways") {
      var bandHeightSts = Math.max(6, jsround(6 * rib.st));
      var bandRows = even(jsround(bandCirc * rib.row));
      bandEdge = bandRows;
      pieces.push({
        id: "waistband", title: "Rib waistband", stitch: "sideways · back-loop rib, seamed",
        counts: { sts: bandRows, heightSts: bandHeightSts, rowsAround: bandRows, circumference: bandCirc },
        progress: { total: bandRows, start: bandHeightSts, end: bandHeightSts, incRounds: [] },
        yarn: { g: "rib", color: "body" },
        steps: [
          ["Foundation", "In " + C.body + ", ch " + bandHeightSts + " (the band's height). Row 1: sc in 2nd ch from hook and each ch across."],
          ["Rib rows", "Ch 1, turn, sc in back loop only across. Work " + bandRows + " rows — relaxed about " + H(bandCirc) + ", smaller than your " + H(waist) + " waist so it grips."],
          ["Seam", "Join first and last rows into a ring. Fold double and leave a gap if you want to thread elastic."],
        ],
      });
    } else {
      var bandSts = even(jsround(bandCirc * rib.st));
      var bandRnds = Math.max(4, jsround(6 * rib.row));
      bandEdge = bandSts;
      pieces.push({
        id: "waistband", title: "Rib waistband", stitch: "in the round · fpdc/bpdc rib",
        counts: { sts: bandSts, rounds: bandRnds, circumference: bandCirc },
        progress: { total: bandRnds, start: bandSts, end: bandSts, incRounds: [] },
        yarn: { g: "rib", color: "body" },
        steps: [
          ["Foundation (stretchy start)", "In " + C.body + ", work " + bandSts + " foundation sc and join into a ring, not twisting."],
          ["Rib", "Ch 2, *fpdc, bpdc; rep from * around, join. Rep to Rnd " + bandRnds + ". (" + bandSts + " sts)"],
        ],
      });
    }

    // 2. hip yoke — waistband down to the crotch, waist → hip, sc in the round
    // waist is fit-critical; nudge toward a rounder count that also joins cleanly
    // from the band edge and starts the yoke increases on a good divisor, within tol.
    var yokeReal = waist * sc.st * hug, fitTol = 1.3;
    var yokeTop = niceCount(even(jsround(yokeReal)), bandEdge,
      Math.ceil(yokeReal - fitTol * sc.st), Math.floor(yokeReal + fitTol * sc.st));
    var yokeBot = even(jsround(hip * sc.st * hug));
    var riseRnds = Math.max(6, jsround(rise * sc.row));
    var yokeJoin = evenAdjust(bandEdge, yokeTop, "sc");
    var yokePlan = incPlan(yokeTop, yokeBot, riseRnds, "sc", 1, 0.06);
    pieces.push({
      id: "yoke", title: "Hip yoke", stitch: "in the round, downward · sc",
      counts: { start: yokeTop, end: yokePlan.finalCount, rounds: riseRnds, rise: rise },
      progress: { total: riseRnds, start: yokeTop, end: yokePlan.finalCount, incRounds: mapC(yokePlan.rounds) },
      yarn: { g: "sc", color: "cap" },
      steps: [
        ["Set-up", "In " + C.cap + ", join to the lower edge of the waistband. Ch 1, " + yokeJoin + ", join. (band → " + yokeTop + " sc)"],
        ["Shape to the hip", "Work down toward the crotch over ~" + H(rise) + " (rise), increasing to " + yokePlan.finalCount + " sc at your hip."],
      ].concat(yokePlan.rounds.map(function (x) { return ["Rnd " + x.rnd, "Ch 1, " + x.text + ", join. (" + x.after + " sc)"]; }))
        .concat([["Crotch", "Work plain to Rnd " + riseRnds + ", then divide for the two legs (next)."]]),
    });

    // 3. legs (make 2) — thigh → ankle taper, sc in the round
    var gusset = Math.max(4, even(jsround(4 * sc.st)));
    // thigh has a little ease; nudge the leg start toward a rounder count so the
    // taper decreases (which start from legStart) divide cleanly, within fit tol.
    var legReal = thigh * sc.st * hug + gusset;
    var legStart = niceCount(even(jsround(thigh * sc.st * hug)) + gusset, 0,
      Math.ceil(legReal - 1.3 * sc.st), Math.floor(legReal + 1.3 * sc.st));
    var legBot = even(jsround(ankle * sc.st * hug));
    var legRnds = Math.max(8, jsround(inseam * sc.row));
    var legPlan = decPlan(legStart, legBot, legRnds, "sc", 2, 0.045);
    pieces.push({
      id: "legs", title: "Legs (make 2)", stitch: "in the round, downward · sc", makeCount: 2,
      counts: { start: legStart, end: legPlan.finalCount, rounds: legRnds, gusset: gusset },
      progress: { total: legRnds, start: legStart, end: legPlan.finalCount, incRounds: mapC(legPlan.rounds) },
      yarn: { g: "sc", color: "cap" },
      steps: [
        ["Divide", "At the crotch, put half the yoke sts on hold for the other leg. Rejoin " + C.cap + " around one leg and work " + gusset + " extra sc across the crotch gap — a small gusset for movement. (" + legStart + " sc)"],
        ["Taper to the ankle", "Work down the leg over ~" + H(inseam) + " (inseam), decreasing to " + legPlan.finalCount + " sc at your ankle."],
      ].concat(legPlan.rounds.map(function (x) { return ["Rnd " + x.rnd, "Ch 1, " + x.text + ", join. (" + x.after + " sc)"]; }))
        .concat([["Second leg", "Rejoin " + C.cap + " at the held crotch sts and work the second leg the same way."]]),
    });

    // 4. ankle cuffs (make 2)
    var cuffRnds = Math.max(3, jsround(3 * rib.row));
    pieces.push({
      id: "cuffs", title: "Ankle cuffs (make 2)", stitch: "in the round · fpdc/bpdc rib", makeCount: 2,
      counts: { sts: legPlan.finalCount, rounds: cuffRnds },
      progress: { total: cuffRnds, start: legPlan.finalCount, end: legPlan.finalCount, incRounds: [] },
      yarn: { g: "rib", color: "body" },
      steps: [
        ["Cuff", "In " + C.body + ", at each ankle: ch 2, *fpdc, bpdc; rep from * around, join. Rep for " + cuffRnds + " rounds."],
        ["Finish", "Fasten off. A snug rib cuff keeps footless tights from riding up."],
      ],
    });

    // 5. mycelium veins — embroidered branching web (no progress → estimated by sts)
    pieces.push({
      id: "mycelium", title: "Mycelium veins", stitch: "surface crochet / embroidery",
      counts: {}, yarn: { g: "sc", color: "spot", sts: jsround((inseam * 2 + hip) * sc.st * 1.2) },
      steps: [
        ["Idea", "Add a branching mycelium web in " + C.spot + " — the pale roots of your mushroom body, climbing the tights."],
        ["Method", "Surface slip stitch (or chain / split-stitch embroidery) fine, wandering lines that fork as they go."],
        ["Grow it", "Start a few main veins near each ankle; let them branch every few cm into finer threads that wrap the leg and thin out over the hips. Keep it sparse and asymmetric — nothing in nature is even."],
        ["Timing", "Work it after the tights are finished and blocked, trying them on so the veins follow your leg."],
      ],
    });

    if (legBot < 24) warnings.push("Ankle opening looks small — footless tights must still pass over your heel; check the ankle measurement.");
    warnings.push("Crochet stretches less than knit — the negative ease and rib bands do the fitting, so try each stage on before moving on.");

    return {
      pieces: pieces, warnings: warnings,
      meta: {
        unit: u, kind: "tights", density: { rib: rib, hdc: hdc, sc: sc }, colors: C,
        waistCirc: waist, hipCirc: hip, thighCirc: thigh, ankleCirc: ankle, inseam: inseam, rise: rise,
      },
    };
  }

  function estimateYarn(result) {
    var meta = result.meta, dens = meta.density, colors = meta.colors;
    var waste = 1.12, yd = 1.0936;
    var factor = { rib: 5.2, hdc: 3.3, sc: 2.6 };
    var spec = {
      waistband: ["rib", "rib", "body"], skirt: ["hdc", "hdc", "body"],
      flounce: ["sc", "sc", "cap"], sleeves: ["sc", "sc", "cap"],
      straps: ["sc", "sc", "cap"]
    };
    function totalSts(piece) {
      var pr = piece.progress;
      if (!pr) return 0;
      var inc = pr.incRounds.slice().sort(function (a, b) { return a.rnd - b.rnd; });
      var s = 0;
      for (var r = 1; r <= pr.total; r++) {
        var c = pr.start;
        for (var j = 0; j < inc.length; j++) if (inc[j].rnd <= r) c = inc[j].count;
        s += c;
      }
      return s;
    }
    var colorCm = { cap: 0, body: 0, spot: 0 };
    var spottedCm = 0;    // yarn in cap-coloured (spotted) areas
    var piecesOut = [];
    result.pieces.forEach(function (p) {
      // Prefer per-piece yarn metadata (hat/bag); fall back to the dress spec.
      var g, ck, sts;
      if (p.yarn) {
        g = p.yarn.g; ck = p.yarn.color;
        sts = p.progress ? totalSts(p) : (p.yarn.sts || 0);
      } else if (spec[p.id]) {
        g = spec[p.id][0]; ck = spec[p.id][2];
        sts = p.id === "straps" ? p.counts.sts * 3 : totalSts(p);
      } else {
        return; // non-yarn piece (spots, border, drawstring notes)
      }
      var cm = sts * (1.0 / dens[g].st) * factor[g] * (p.makeCount || 1) * waste;
      if (cm > 0) {
        colorCm[ck] += cm;
        if (ck === "cap") spottedCm += cm;
        piecesOut.push({ id: p.id, title: p.title, color: ck, meters: Math.round(cm / 100 * 10) / 10, yards: Math.round(cm / 100 * yd * 10) / 10 });
      }
      // extra yarn segments for consolidated pieces worked in more than one gauge or
      // colour (e.g. the rib band folded into the skirt, the body gill on the flounce)
      (p.extraYarn || []).forEach(function (ex) {
        var xcm = ex.sts * (1.0 / dens[ex.g].st) * factor[ex.g] * (p.makeCount || 1) * waste;
        if (!(xcm > 0)) return;
        colorCm[ex.color] += xcm;
        if (ex.color === "cap") spottedCm += xcm;
        piecesOut.push({ id: p.id + ":" + ex.g, title: ex.title || (p.title + " (extra)"), color: ex.color, meters: Math.round(xcm / 100 * 10) / 10, yards: Math.round(xcm / 100 * yd * 10) / 10 });
      });
    });
    var spotCm = spottedCm * 0.15;
    colorCm.spot += spotCm;
    piecesOut.push({ id: "spots", title: "Polka spots", color: "spot", meters: Math.round(spotCm / 100 * 10) / 10, yards: Math.round(spotCm / 100 * yd * 10) / 10 });
    var totalCm = colorCm.cap + colorCm.body + colorCm.spot;
    var byColor = {};
    ["cap", "body", "spot"].forEach(function (k) {
      byColor[k] = { name: colors[k] || k, meters: Math.round(colorCm[k] / 100 * 10) / 10, yards: Math.round(colorCm[k] / 100 * yd * 10) / 10 };
    });
    return { unit: meta.unit, wastePct: 12, pieces: piecesOut, byColor: byColor,
      total: { meters: Math.round(totalCm / 100 * 10) / 10, yards: Math.round(totalCm / 100 * yd * 10) / 10 } };
  }

  var US_TO_UK = { sc2tog: "dc2tog", hdc2tog: "htr2tog", dc2tog: "tr2tog", fpdc: "fptr", bpdc: "bptr", sc: "dc", hdc: "htr", dc: "tr", tr: "dtr" };
  var US_TOKEN_RE = /\b(sc2tog|hdc2tog|dc2tog|fpdc|bpdc|hdc|sc|dc|tr)\b/g;

  function convertTerms(result, terms) {
    if (terms !== "UK") return result;
    var out = JSON.parse(JSON.stringify(result));
    var conv = function (s) { return s.replace(US_TOKEN_RE, function (m) { return US_TO_UK[m]; }); };
    out.pieces.forEach(function (p) {
      p.title = conv(p.title);
      p.stitch = conv(p.stitch);
      p.steps = p.steps.map(function (pair) { return [conv(pair[0]), conv(pair[1])]; });
    });
    out.meta.terms = "UK";
    return out;
  }

  return {
    CM_PER_IN: CM_PER_IN, toCm: toCm, fromCm: fromCm, jsround: jsround, r1: r1,
    even: even, mult: mult, density: density, incPlan: incPlan, evenAdjust: evenAdjust,
    spotChart: spotChart, spotCharts: spotCharts, DEFAULT_INPUT: DEFAULT_INPUT, defaultInput: defaultInput,
    computePattern: computePattern, computeHat: computeHat, computeBag: computeBag,
    computeTights: computeTights, decPlan: decPlan,
    estimateYarn: estimateYarn, convertTerms: convertTerms
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CrochetCore;

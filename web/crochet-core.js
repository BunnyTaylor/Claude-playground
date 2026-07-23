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

  function density(g, unit) {
    var w = toCm(g.width, unit), h = toCm(g.height, unit);
    if (!(w > 0) || !(h > 0)) throw new Error("gauge swatch size must be positive");
    if (!(g.sts > 0) || !(g.rows > 0)) throw new Error("gauge counts must be positive");
    return { st: g.sts / w, row: g.rows / h };
  }

  function incPlan(start, target, totalRnds, stitch, setupRnds) {
    if (setupRnds === undefined) setupRnds = 1;
    var total = target - start;
    var out = { rounds: [], every: 0, finalCount: start };
    if (total <= 0) return out;

    var chunk = Math.max(4, jsround(start * 0.08));
    var n = Math.max(1, jsround(total / chunk));
    var usable = Math.max(1, totalRnds - setupRnds - 1);
    if (n > usable) n = usable;

    var every = Math.max(1, Math.floor(usable / n));
    var per = Math.floor(total / n);
    var rem = total - per * n;

    var cur = start;
    for (var i = 1; i <= n; i++) {
      var add = per + (i === n ? rem : 0);
      var before = cur;
      var interval = Math.floor(before / add);
      var tail = before - interval * add;
      var text = interval <= 1
        ? "2 " + stitch + " in each of first " + add + " sts, " + stitch + " in each rem st"
        : "*" + stitch + " in each of next " + (interval - 1) + " sts, 2 " + stitch +
          " in next st; rep from * " + add + " times" +
          (tail > 0 ? ", " + stitch + " in each of last " + tail + " sts" : "");
      cur += add;
      out.rounds.push({ rnd: setupRnds + i * every, before: before, after: cur, add: add, text: text });
    }
    out.every = every;
    out.finalCount = cur;
    return out;
  }

  function evenAdjust(frm, to, stitch) {
    if (to === frm) return stitch + " in each st around";
    if (to < frm) {
      var dec = frm - to, iv = Math.floor(frm / dec);
      if (iv < 3) return "*" + stitch + "2tog; rep from * " + dec + " times, " +
        stitch + " in each of last " + (frm - 2 * dec) + " sts";
      var tail = frm - iv * dec;
      return "*" + stitch + " in each of next " + (iv - 2) + " sts, " + stitch +
        "2tog; rep from * " + dec + " times" +
        (tail > 0 ? ", " + stitch + " in each of last " + tail + " sts" : "");
    }
    var inc = to - frm, iv2 = Math.floor(frm / inc);
    if (iv2 < 1) return "2 " + stitch + " in each st around, then " + stitch + " evenly to " + to + " sts";
    var tail2 = frm - iv2 * inc;
    return "*" + stitch + " in each of next " + (iv2 - 1) + " sts, 2 " + stitch +
      " in next st; rep from * " + inc + " times" +
      (tail2 > 0 ? ", " + stitch + " in each of last " + tail2 + " sts" : "");
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
    style: { waistEase: -5, fullness: 2.0, flare: 1.8, balloon: 1.4, dotDia: 2.5, dotGap: 1.2 },
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
    var wbCirc = waist + S.waistEase;
    var wbSts = even(jsround(wbCirc * rib.st));
    var wbRnds = Math.max(4, jsround(12 * rib.row));
    pieces.push({
      id: "waistband", title: "Fitted waistband", stitch: "in the round · fpdc/bpdc rib",
      counts: { sts: wbSts, rounds: wbRnds, circumference: wbCirc },
      progress: { total: wbRnds, start: wbSts, end: wbSts, incRounds: [] },
      steps: [
        ["Foundation", "Ch " + wbSts + ". Taking care not to twist, join with sl st to form a ring."],
        ["Rnd 1", "Ch 1, sc in each ch around, join. (" + wbSts + " sc)"],
        ["Rnd 2", "Ch 2, *fpdc in next st, bpdc in next st; rep from * around, join. (" + wbSts + " sts)"],
        ["Rnds 3–" + wbRnds, "Rep Rnd 2."],
        ["Finish", "Fasten off. Test it stretches over your hips before continuing."]
      ]
    });

    // 2. skirt
    var hemCirc = wbCirc * S.fullness;
    var hemSts = jsround(hemCirc * hdc.st);
    var skRnds = Math.max(6, jsround(skirtLen * hdc.row));
    var skStart = jsround(waist * hdc.st);
    var skJoin = evenAdjust(wbSts, skStart, "hdc");
    var skPlan = incPlan(skStart, hemSts, skRnds, "hdc", 1);
    if (hemSts <= skStart) warnings.push("Hem is no wider than the waist — raise fullness or check hdc gauge.");
    pieces.push({
      id: "skirt", title: "A-line skirt", stitch: "in the round, downward · hdc",
      counts: { start: skStart, end: skPlan.finalCount, rounds: skRnds, incRounds: skPlan.rounds.length },
      progress: { total: skRnds, start: skStart, end: skPlan.finalCount,
        incRounds: skPlan.rounds.map(function (x) { return { rnd: x.rnd, count: x.after }; }) },
      steps: [
        ["Set-up", "Join to the lower edge of the waistband. Ch 2, " + skJoin + ", join. (" + wbSts + " rib sts → " + skStart + " hdc)"],
        ["Plain rnds", "Ch 2, hdc in each st around, join. Rep for every round not listed."]
      ].concat(skPlan.rounds.map(function (x) { return ["Rnd " + x.rnd, "Ch 2, " + x.text + ", join. (" + x.after + " hdc)"]; }))
        .concat([["Finish", "Work plain to Rnd " + skRnds + ". Fasten off. (" + skPlan.finalCount + " hdc)"]])
    });

    // 3. flounce
    var flTop = jsround(upperBust * sc.st);
    var flBot = jsround(flTop * S.flare);
    var flRnds = Math.max(5, jsround(16 * sc.row));
    var flPlan = incPlan(flTop, flBot, flRnds, "sc", 1);
    pieces.push({
      id: "flounce", title: "Off-shoulder flounce", stitch: "in the round · sc tapestry",
      counts: { start: flTop, end: flPlan.finalCount, rounds: flRnds },
      progress: { total: flRnds, start: flTop, end: flPlan.finalCount,
        incRounds: flPlan.rounds.map(function (x) { return { rnd: x.rnd, count: x.after }; }) },
      steps: [
        ["Foundation", "In " + C.cap + ", ch " + flTop + ". Join to form a ring, not twisting."],
        ["Rnd 1", "Ch 1, sc in each ch around, join. (" + flTop + " sc)"]
      ].concat(flPlan.rounds.map(function (x) { return ["Rnd " + x.rnd, "Ch 1, " + x.text + ", join. (" + x.after + " sc)"]; }))
        .concat([["Finish", "Work plain to Rnd " + flRnds + ". Thread elastic through Rnd 1. (" + flPlan.finalCount + " sc)"]])
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

    // 5. sleeves
    var cuffSts = even(jsround((wrist + 2) * rib.st));
    var scCuff = jsround((wrist + 2) * sc.st);
    var balSts = jsround(upperArm * S.balloon * sc.st);
    var topSts = jsround((upperArm + 4) * sc.st);
    var cuffRnds = Math.max(3, jsround(5 * rib.row));
    var slRnds = Math.max(cuffRnds + 6, cuffRnds + jsround((sleeveLen - 5) * sc.row));
    var sleeveSteps = [
      ["Foundation", "In " + C.cap + ", ch " + cuffSts + ". Join to form a ring."],
      ["Rnd 1", "Ch 1, sc in each ch around, join. (" + cuffSts + " sc)"],
      ["Cuff rib", "Ch 2, *fpdc, bpdc; rep from * around, join. Rep to Rnd " + cuffRnds + "."],
      ["Rnd " + (cuffRnds + 1), "Ch 1, " + evenAdjust(cuffSts, scCuff, "sc") + ", join. (" + cuffSts + " rib sts → " + scCuff + " sc)"]
    ];
    var cur = scCuff, rnd = cuffRnds + 1;
    var sleeveInc = [{ rnd: cuffRnds + 1, count: scCuff }];
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
        id: "sleeves", title: "Lantern sleeves ×2", stitch: "in the round, cuff up · rib + sc",
        counts: { cuff: cuffSts, balloon: balSts, top: topSts, rounds: slRnds },
        progress: { total: slRnds, start: cuffSts, end: sleeveEnd, incRounds: sleeveInc },
        steps: sleeveSteps, makeCount: 2
      });
    }

    // 6. gill frill
    var gillBase = mult(flPlan.finalCount, 6);
    var gillRnds = Math.max(4, jsround(5 * sc.row));
    pieces.push({
      id: "gillFrill", title: "Gill frill (under flounce)", stitch: "in the round · shell edging",
      counts: { base: gillBase, rounds: gillRnds + 2, shells: Math.floor(gillBase / 6) },
      progress: { total: gillRnds + 2, start: gillBase, end: gillBase, incRounds: [] },
      steps: [
        ["Set-up", "In " + C.body + ", join to the flounce edge. Sc evenly around to " + gillBase + " sc (multiple of 6). Join."],
        ["Body", "Ch 1, sc around, join. Rep to Rnd " + gillRnds + "."],
        ["Shells", "Ch 1, *sc in next st, sk 2, 5 dc in next st, sk 2; rep from * around, join. (" + Math.floor(gillBase / 6) + " shells)"],
        ["Picots", "Ch 1, *sc, (ch 3, sl st in 3rd ch from hook), sc; rep from * around, join."],
        ["Finish", "Fasten off and block so the shells open."]
      ]
    });

    // 7. hem frill
    var frillBase = mult(skPlan.finalCount, 6);
    var frillFull = jsround(frillBase * 1.6);
    var frillRnds = Math.max(5, jsround(9 * hdc.row));
    pieces.push({
      id: "hemFrill", title: "Skirt hem frill", stitch: "in the round · hdc + shells",
      counts: { base: frillBase, full: frillFull, rounds: frillRnds + 2 },
      progress: { total: frillRnds + 2, start: frillBase, end: frillFull, incRounds: [{ rnd: 2, count: frillFull }] },
      steps: [
        ["Set-up", "In " + C.body + ", join to the skirt hem. Hdc evenly around to " + frillBase + " hdc (multiple of 6). Join."],
        ["Flare", "Ch 2, *hdc in next 2 sts, 2 hdc in next; rep from * around, join. (" + frillFull + " hdc)"],
        ["Body", "Ch 2, hdc around, join. Rep to Rnd " + frillRnds + "."],
        ["Shells", "Ch 1, *sc, sk 2, 5 dc in next st, sk 2; rep from * around, join."],
        ["Finish", "Fasten off and block the frill open."]
      ]
    });

    // 8. mushroom border
    var motifs = Math.max(6, jsround(hemCirc / 7));
    pieces.push({
      id: "border", title: "Mushroom border", stitch: "surface embroidery",
      counts: { motifs: motifs, spacing: hemCirc / motifs },
      steps: [
        ["Placement", "Mark " + motifs + " points around the skirt, ~" + H(hemCirc / motifs) + " apart, above the frill join."],
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
        unit: u, density: { rib: rib, hdc: hdc, sc: sc },
        waistbandCirc: wbCirc, hemCirc: hemCirc, skirtTopSts: skStart, colors: C
      }
    };
  }

  function estimateYarn(result) {
    var meta = result.meta, dens = meta.density, colors = meta.colors;
    var waste = 1.12, yd = 1.0936;
    var factor = { rib: 5.2, hdc: 3.3, sc: 2.6 };
    var spec = {
      waistband: ["rib", "rib", "body"], skirt: ["hdc", "hdc", "body"],
      flounce: ["sc", "sc", "cap"], sleeves: ["sc", "sc", "cap"],
      gillFrill: ["sc", "sc", "body"], hemFrill: ["hdc", "hdc", "body"], straps: ["sc", "sc", "cap"]
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
    var byId = {};
    result.pieces.forEach(function (p) { byId[p.id] = p; });
    var colorCm = { cap: 0, body: 0, spot: 0 };
    var flounceSleeveCm = 0;
    var piecesOut = [];
    Object.keys(spec).forEach(function (pid) {
      var p = byId[pid];
      if (!p) return;
      var dk = spec[pid][0], fk = spec[pid][1], ck = spec[pid][2];
      var make = p.makeCount || 1;
      var sts = pid === "straps" ? p.counts.sts * 3 : totalSts(p);
      var width = 1.0 / dens[dk].st;
      var cm = sts * width * factor[fk] * make * waste;
      colorCm[ck] += cm;
      if (pid === "flounce" || pid === "sleeves") flounceSleeveCm += cm;
      piecesOut.push({ id: pid, title: p.title, color: ck, meters: Math.round(cm / 100 * 10) / 10, yards: Math.round(cm / 100 * yd * 10) / 10 });
    });
    var spotCm = flounceSleeveCm * 0.15;
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
    computePattern: computePattern, estimateYarn: estimateYarn, convertTerms: convertTerms
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = CrochetCore;

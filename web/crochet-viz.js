/*
 * crochet-viz (JavaScript) — front-view SVG of the dress.
 *
 * Browser/Node port of crochet_viz.py. Draws a proportional front view from a
 * CrochetCore.computePattern result: off-shoulder flounce, lantern sleeves,
 * fitted waist, A-line skirt, frills and hem mushrooms, with spots scattered
 * in the design's sizes. Seeded, so the same input always draws the same
 * picture (its own PRNG, so scatter positions differ from the Python viz but
 * are deterministic here). Classic script: defines a global `CrochetViz`.
 */
var CrochetViz = (function (Core) {
  "use strict";

  var DEFAULT_PALETTE = {
    cap: "#B83A2B", capDeep: "#7C271F", spot: "#FCF8EF", body: "#F2E4C9",
    moss: "#6F824F", line: "#e4cfb0", bg: "#F3DEDE"
  };

  function e(v) { return (Math.round(v * 100) / 100).toString(); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  // mulberry32 — small deterministic PRNG
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fmt(cmVal, unit) {
    var v = Core.fromCm(cmVal, unit);
    return (Math.round(v * 10) / 10) + " " + unit;
  }

  function mushroom(parts, x, y, s, pal) {
    parts.push('<rect x="' + e(x - s * 0.28) + '" y="' + e(y) + '" width="' + e(s * 0.56) + '" height="' + e(s * 1.1) + '" rx="' + e(s * 0.2) + '" fill="' + pal.spot + '" stroke="' + pal.line + '" stroke-width="0.5"/>');
    parts.push('<path d="M ' + e(x - s) + ' ' + e(y) + ' A ' + e(s) + ' ' + e(s * 0.8) + ' 0 0 1 ' + e(x + s) + ' ' + e(y) + ' Z" fill="' + pal.cap + '" stroke="' + pal.capDeep + '" stroke-width="0.6"/>');
    [[-0.4, -0.3, 0.16], [0.35, -0.2, 0.13], [0.0, -0.45, 0.12]].forEach(function (d) {
      parts.push('<circle cx="' + e(x + d[0] * s) + '" cy="' + e(y + d[1] * s) + '" r="' + e(d[2] * s) + '" fill="' + pal.spot + '"/>');
    });
  }

  function renderDressSvg(result, inp, palette, opts) {
    opts = opts || {};
    var schematic = !!opts.schematic;
    var width = opts.width || 520, height = opts.height || 820;
    var pal = Object.assign({}, DEFAULT_PALETTE, palette || {});
    var meta = result.meta, u = meta.unit;
    var body = Object.assign({}, inp.body || {});
    var style = Object.assign({}, inp.style || {});
    var cm = function (v) { return Core.toCm(v, u); };

    var upperBust = cm(body.upperBust != null ? body.upperBust : 84);
    var waistband = meta.waistbandCirc, hem = meta.hemCirc;
    var upperArm = cm(body.upperArm != null ? body.upperArm : 30);
    var wrist = cm(body.wrist != null ? body.wrist : 16);
    var hip = cm(body.hip != null ? body.hip : 98);
    var skirtLen = cm(body.skirtLen != null ? body.skirtLen : 45);
    var sleeveLen = cm(body.sleeveLen != null ? body.sleeveLen : 50);
    var flare = style.flare != null ? style.flare : 1.8;
    var balloon = style.balloon != null ? style.balloon : 1.4;

    var cx = width / 2;
    var scale = 62.0 / Math.max(waistband / 2, 1);
    var halfw = function (circCm, capFrac) { return Math.min(width * capFrac, (circCm / 2) * scale); };

    var flTopHalf = halfw(upperBust, 0.34);
    var flBotHalf = Math.min(width * 0.44, flTopHalf * lerp(1.15, 1.5, Math.min(flare / 2.2, 1)));
    var waistHalf = halfw(waistband, 0.30);
    var hipHalf = halfw(hip, 0.46);
    var hemHalf = halfw(hem, 0.46);

    var yShoulder = 84, yFlTop = 96, flH = 150;
    var yFlBot = yFlTop + flH;
    var yWaist = yFlBot + 46;
    var skirtH = Math.max(150, Math.min(height - yWaist - 70, skirtLen * scale * 1.15));
    var yHem = yWaist + skirtH;
    var yHip = yWaist + (yHem - yWaist) * 0.42;

    var parts = [];
    parts.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="' + pal.bg + '"/>');
    parts.push('<ellipse cx="' + cx + '" cy="' + Math.round(height * 0.5) + '" rx="' + Math.round(width * 0.62) + '" ry="' + Math.round(height * 0.55) + '" fill="#ffffff" opacity="0.18"/>');

    // bodice (behind)
    var yBodTop = 116;
    var bodTopHalf = Math.min(width * 0.30, (upperBust / 2) * scale * 0.88);
    var waistHalfPre = Math.min(width * 0.30, (waistband / 2) * scale);
    parts.push('<path d="M ' + e(cx - bodTopHalf) + ' ' + e(yBodTop) + ' L ' + e(cx + bodTopHalf) + ' ' + e(yBodTop) + ' L ' + e(cx + waistHalfPre) + ' ' + e(yWaist) + ' L ' + e(cx - waistHalfPre) + ' ' + e(yWaist) + ' Z" fill="' + pal.body + '" opacity="0.55"/>');

    // sleeve dimensions — drawn later, on top of the flounce so they aren't hidden
    var slBulge = Math.min(76, (upperArm * balloon / 2) * scale * 1.0);
    var slLen = Math.min(240, Math.max(150, sleeveLen * scale * 0.95));
    var ySlTop = yFlTop + 4, ySlBot = ySlTop + slLen, ySlMid = ySlTop + slLen * 0.5;
    var cuffHalf = Math.max(9, Math.min(26, (wrist / 2) * scale * 1.15));
    var sleeveless = !result.pieces.some(function (p) { return p.id === "sleeves"; });
    var spotRegions = [];

    // skirt — curves through the hip so hip measurement visibly shapes it
    parts.push('<path d="M ' + e(cx - waistHalf) + ' ' + e(yWaist) +
      ' L ' + e(cx + waistHalf) + ' ' + e(yWaist) +
      ' Q ' + e(cx + hipHalf) + ' ' + e(yHip) + ' ' + e(cx + hemHalf) + ' ' + e(yHem) +
      ' Q ' + e(cx) + ' ' + e(yHem + 20) + ' ' + e(cx - hemHalf) + ' ' + e(yHem) +
      ' Q ' + e(cx - hipHalf) + ' ' + e(yHip) + ' ' + e(cx - waistHalf) + ' ' + e(yWaist) +
      ' Z" fill="' + pal.body + '" stroke="' + pal.line + '" stroke-width="2"/>');

    // hem frill
    var scallops = 14, frill = ["M " + e(cx - hemHalf) + " " + e(yHem)];
    for (var i = 0; i < scallops; i++) {
      var x0 = lerp(cx - hemHalf, cx + hemHalf, i / scallops);
      var x1 = lerp(cx - hemHalf, cx + hemHalf, (i + 1) / scallops);
      frill.push("Q " + e((x0 + x1) / 2) + " " + e(yHem + 30) + " " + e(x1) + " " + e(yHem + 6));
    }
    parts.push('<path d="' + frill.join(" ") + '" fill="none" stroke="' + pal.body + '" stroke-width="7" stroke-linecap="round" opacity="0.9"/>');

    // waistband
    parts.push('<rect x="' + e(cx - waistHalf) + '" y="' + e(yWaist - 12) + '" width="' + e(2 * waistHalf) + '" height="18" rx="3" fill="' + pal.capDeep + '"/>');
    for (var k = 0; k < Math.floor(2 * waistHalf / 6); k++) {
      var rx = cx - waistHalf + 3 + k * 6;
      parts.push('<line x1="' + e(rx) + '" y1="' + e(yWaist - 11) + '" x2="' + e(rx) + '" y2="' + e(yWaist + 5) + '" stroke="' + pal.cap + '" stroke-width="1" opacity="0.4"/>');
    }

    // flounce
    parts.push('<path d="M ' + e(cx - flTopHalf) + ' ' + e(yFlTop) + ' L ' + e(cx + flTopHalf) + ' ' + e(yFlTop) + ' L ' + e(cx + flBotHalf) + ' ' + e(yFlBot) + ' Q ' + e(cx) + ' ' + e(yFlBot + 18) + ' ' + e(cx - flBotHalf) + ' ' + e(yFlBot) + ' Z" fill="' + pal.cap + '" stroke="' + pal.capDeep + '" stroke-width="2"/>');
    parts.push('<line x1="' + e(cx - flTopHalf) + '" y1="' + e(yFlTop) + '" x2="' + e(cx + flTopHalf) + '" y2="' + e(yFlTop) + '" stroke="' + pal.capDeep + '" stroke-width="3" stroke-linecap="round"/>');

    // gill frill
    var gill = ["M " + e(cx - flBotHalf) + " " + e(yFlBot)], gscal = 12;
    for (var gi = 0; gi < gscal; gi++) {
      var gx0 = lerp(cx - flBotHalf, cx + flBotHalf, gi / gscal);
      var gx1 = lerp(cx - flBotHalf, cx + flBotHalf, (gi + 1) / gscal);
      gill.push("Q " + e((gx0 + gx1) / 2) + " " + e(yFlBot + 22) + " " + e(gx1) + " " + e(yFlBot + 4));
    }
    parts.push('<path d="' + gill.join(" ") + '" fill="none" stroke="' + pal.body + '" stroke-width="6" stroke-linecap="round" opacity="0.85"/>');

    spotRegions.push({ x0: cx - flBotHalf + 8, x1: cx + flBotHalf - 8, y0: yFlTop + 12, y1: yFlBot - 8, density: 1.0, taper: [flTopHalf, flBotHalf, yFlTop, yFlBot, cx] });

    // sleeves (drawn here, on top of the flounce, hanging from the shoulders)
    if (!sleeveless) {
      [-1, 1].forEach(function (side) {
        var topX = cx + side * flTopHalf;                 // attach at the flounce top corner
        var shoulderW = 13;
        var outerMax = topX + side * slBulge;             // widest point of the balloon
        var innerMin = topX - side * 4;                   // inner edge, near the body
        var cuffCenter = topX + side * (slBulge * 0.18);  // cuff drapes slightly outward
        var path =
          "M " + e(topX - side * shoulderW) + " " + e(ySlTop) +
          " Q " + e(topX + side * shoulderW) + " " + e(ySlTop - 4) + " " + e(topX + side * shoulderW) + " " + e(ySlTop + 8) +
          " C " + e(outerMax) + " " + e(ySlTop + 34) + ", " + e(outerMax) + " " + e(ySlMid - 18) + ", " + e(outerMax) + " " + e(ySlMid) +
          " C " + e(outerMax) + " " + e(ySlMid + 48) + ", " + e(cuffCenter + side * cuffHalf) + " " + e(ySlBot - 22) + ", " + e(cuffCenter + side * cuffHalf) + " " + e(ySlBot) +
          " L " + e(cuffCenter - side * cuffHalf) + " " + e(ySlBot) +
          " C " + e(cuffCenter - side * cuffHalf) + " " + e(ySlBot - 26) + ", " + e(innerMin) + " " + e(ySlMid + 32) + ", " + e(innerMin) + " " + e(ySlMid) +
          " C " + e(innerMin) + " " + e(ySlMid - 40) + ", " + e(topX - side * shoulderW) + " " + e(ySlTop + 30) + ", " + e(topX - side * shoulderW) + " " + e(ySlTop) + " Z";
        parts.push('<path d="' + path + '" fill="' + pal.cap + '" stroke="' + pal.capDeep + '" stroke-width="2"/>');
        parts.push('<rect x="' + e(cuffCenter - cuffHalf) + '" y="' + e(ySlBot - 10) + '" width="' + e(2 * cuffHalf) + '" height="12" rx="4" fill="' + pal.capDeep + '"/>');
        spotRegions.push({ x0: Math.min(innerMin, outerMax) + 5, x1: Math.max(innerMin, outerMax) - 5, y0: ySlTop + 16, y1: ySlMid + 24, density: 0.5 });
      });
    }

    // straps
    var strapless = !result.pieces.some(function (p) { return p.id === "straps"; });
    if (!strapless) {
      [-1, 1].forEach(function (side) {
        var sx = cx + side * flTopHalf * 0.7;
        parts.push('<path d="M ' + e(sx) + ' ' + e(yFlTop) + ' Q ' + e(sx + side * 10) + ' ' + e(yShoulder - 8) + ' ' + e(sx + side * 4) + ' ' + e(yShoulder - 14) + '" fill="none" stroke="' + pal.cap + '" stroke-width="5" stroke-linecap="round"/>');
      });
    }

    // spots
    var spotsPiece = result.pieces.filter(function (p) { return p.id === "spots"; })[0];
    var sizesCm = (spotsPiece && spotsPiece.charts) ? spotsPiece.charts.map(function (c) { return c.diaCm; }) : [];
    if (!sizesCm.length) sizesCm = [cm(style.dotDia != null ? style.dotDia : 2.5)];
    var spotScale = scale * 2.2;
    var radii = sizesCm.map(function (d) { return Math.max(3.0, (d / 2) * spotScale); }).sort(function (a, b) { return b - a; });
    var distinct = {};
    sizesCm.forEach(function (d) { distinct[Math.round(d * 100) / 100] = 1; });
    var nSizes = Object.keys(distinct).length;

    var radSum = radii.reduce(function (a, b) { return a + b; }, 0);
    var seed = (Math.round(upperBust * 7) + Math.round(hem * 13) + Math.round(radSum * 17)) % 2147483647;
    var rand = mulberry32(seed);

    function inTaper(x, y, region) {
      var t = region.taper;
      if (!t) return true;
      var frac = (y - t[2]) / Math.max(1e-6, t[3] - t[2]);
      var h = lerp(t[0], t[1], Math.max(0, Math.min(1, frac))) - 6;
      return Math.abs(x - t[4]) <= h;
    }
    var placed = [];
    spotRegions.forEach(function (region) {
      var area = Math.max(1, (region.x1 - region.x0) * (region.y1 - region.y0));
      var count = Math.floor(area / 2600 * region.density) + 3;
      var attempts = 0, made = 0;
      while (made < count && attempts < count * 40) {
        attempts++;
        var r = radii[Math.floor(rand() * radii.length)] * (0.82 + rand() * 0.30);
        var x = region.x0 + r + rand() * (region.x1 - region.x0 - 2 * r);
        var y = region.y0 + r + rand() * (region.y1 - region.y0 - 2 * r);
        if (!inTaper(x, y, region)) continue;
        var clash = placed.some(function (p) { return (x - p[0]) * (x - p[0]) + (y - p[1]) * (y - p[1]) < (r + p[2] + 4) * (r + p[2] + 4); });
        if (clash) continue;
        placed.push([x, y, r]);
        made++;
        parts.push('<ellipse cx="' + e(x) + '" cy="' + e(y) + '" rx="' + e(r) + '" ry="' + e(r * 0.92) + '" fill="' + pal.spot + '" opacity="0.96"/>');
      }
    });

    // mushrooms along hem
    var borderPiece = result.pieces.filter(function (p) { return p.id === "border"; })[0];
    var nMush = borderPiece ? Math.max(3, Math.min(11, Math.floor(borderPiece.counts.motifs))) : 7;
    for (var mi = 0; mi < nMush; mi++) {
      var mx = lerp(cx - hemHalf * 0.9, cx + hemHalf * 0.9, (mi + 0.5) / nMush);
      mushroom(parts, mx, yHem - 26, 9, pal);
    }

    // schematic callouts
    if (schematic) {
      var ink = "#5b4038";
      var hlabel = function (half, y, label) {
        var x2 = width - 116;
        parts.push('<line x1="' + e(cx + half) + '" y1="' + e(y) + '" x2="' + e(x2) + '" y2="' + e(y) + '" stroke="' + ink + '" stroke-width="1" stroke-dasharray="2 2"/>');
        parts.push('<circle cx="' + e(cx + half) + '" cy="' + e(y) + '" r="2.2" fill="' + ink + '"/>');
        parts.push('<text x="' + e(x2 + 5) + '" y="' + e(y + 4) + '" font-family="Nunito,sans-serif" font-size="11.5" fill="' + ink + '">' + esc(label) + '</text>');
      };
      hlabel(flTopHalf, yFlTop, "upper bust " + fmt(upperBust, u));
      hlabel(waistHalf, yWaist, "waist " + fmt(meta.waistbandCirc, u));
      hlabel(hemHalf, yHem, "hem " + fmt(hem, u));
      var lx = 48;
      parts.push('<line x1="' + lx + '" y1="' + e(yWaist) + '" x2="' + lx + '" y2="' + e(yHem) + '" stroke="' + ink + '" stroke-width="1"/>');
      [yWaist, yHem].forEach(function (yy) { parts.push('<line x1="' + (lx - 4) + '" y1="' + e(yy) + '" x2="' + (lx + 4) + '" y2="' + e(yy) + '" stroke="' + ink + '" stroke-width="1"/>'); });
      parts.push('<text x="' + (lx + 7) + '" y="' + e((yWaist + yHem) / 2) + '" font-family="Nunito,sans-serif" font-size="11.5" fill="' + ink + '">skirt ' + esc(fmt(skirtLen, u)) + '</text>');
    }

    // caption
    parts.push('<text x="' + cx + '" y="' + (height - 24) + '" text-anchor="middle" font-family="Georgia, serif" font-size="15" fill="' + pal.capDeep + '">preview · waist ' + esc(fmt(meta.waistbandCirc, u)) + ' · hem ' + esc(fmt(hem, u)) + ' · ' + nSizes + ' spot size' + (nSizes !== 1 ? "s" : "") + '</text>');

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Front-view preview of the mushroom dress">' + parts.join("") + "</svg>";
  }

  // spotsFromResult — pull the design's spot diameters (cm) off the result
  function spotDiasCm(result, inp, Core, u) {
    var spots = result.pieces.filter(function (p) { return p.id === "spots"; })[0];
    if (spots && spots.charts) return spots.charts.map(function (c) { return c.diaCm; });
    var s = (inp.style || {});
    return [Core.toCm(s.dotDia != null ? s.dotDia : 2.5, u)];
  }

  function scatter(parts, region, radii, seed, pal) {
    var rand = mulberry32(seed >>> 0);
    var placed = [];
    var area = Math.max(1, (region.x1 - region.x0) * (region.y1 - region.y0));
    var count = Math.floor(area / 2200) + 3;
    var attempts = 0, made = 0;
    while (made < count && attempts < count * 40) {
      attempts++;
      var r = radii[Math.floor(rand() * radii.length)] * (0.85 + rand() * 0.3);
      var x = region.x0 + r + rand() * (region.x1 - region.x0 - 2 * r);
      var y = region.y0 + r + rand() * (region.y1 - region.y0 - 2 * r);
      if (region.ellipse) {
        var nx = (x - region.cx) / (region.rx - r), ny = (y - region.cy) / (region.ry - r);
        if (nx * nx + ny * ny > 1) continue;
      }
      if (placed.some(function (p) { return (x - p[0]) * (x - p[0]) + (y - p[1]) * (y - p[1]) < (r + p[2] + 4) * (r + p[2] + 4); })) continue;
      placed.push([x, y, r]); made++;
      parts.push('<ellipse cx="' + e(x) + '" cy="' + e(y) + '" rx="' + e(r) + '" ry="' + e(r * 0.92) + '" fill="' + pal.spot + '" opacity="0.96"/>');
    }
  }

  // ---- Mushroom-cap hat ----
  function renderHatSvg(result, inp, palette, opts) {
    opts = opts || {};
    var width = opts.width || 460, height = opts.height || 380;
    var pal = Object.assign({}, DEFAULT_PALETTE, palette || {});
    var meta = result.meta, u = meta.unit;
    var headDia = meta.headCirc / Math.PI, brimDia = meta.brimCirc / Math.PI;
    var cx = width / 2;
    var scale = Math.min((width * 0.82) / brimDia, 11);
    var headHalf = (headDia / 2) * scale, brimHalf = (brimDia / 2) * scale;
    var yBase = height * 0.60, domeH = headHalf * 1.25;
    var parts = [];
    parts.push('<rect width="' + width + '" height="' + height + '" fill="' + pal.bg + '"/>');
    // gill frill fanning under the brim
    for (var gi = 0; gi <= 22; gi++) {
      var t = gi / 22, gx = lerp(cx - brimHalf, cx + brimHalf, t);
      parts.push('<line x1="' + e(cx + (gx - cx) * 0.35) + '" y1="' + e(yBase + 4) + '" x2="' + e(gx) + '" y2="' + e(yBase + 20 + Math.sin(t * Math.PI) * 10) + '" stroke="' + pal.body + '" stroke-width="3" stroke-linecap="round" opacity="0.85"/>');
    }
    // brim disc
    parts.push('<ellipse cx="' + cx + '" cy="' + e(yBase) + '" rx="' + e(brimHalf) + '" ry="' + e(brimHalf * 0.26) + '" fill="' + pal.cap + '" stroke="' + pal.capDeep + '" stroke-width="2"/>');
    // dome
    parts.push('<path d="M ' + e(cx - headHalf) + ' ' + e(yBase) + ' A ' + e(headHalf) + ' ' + e(domeH) + ' 0 0 1 ' + e(cx + headHalf) + ' ' + e(yBase) + ' Z" fill="' + pal.cap + '" stroke="' + pal.capDeep + '" stroke-width="2"/>');
    // spots on the dome
    var radii = spotDiasCm(result, inp, Core, u).map(function (d) { return Math.max(4, (d / 2) * scale * 1.6); });
    scatter(parts, { x0: cx - headHalf + 6, x1: cx + headHalf - 6, y0: yBase - domeH + 8, y1: yBase - 6, ellipse: true, cx: cx, cy: yBase, rx: headHalf, ry: domeH }, radii, Math.round(headDia * 31), pal);
    parts.push('<text x="' + cx + '" y="' + (height - 18) + '" text-anchor="middle" font-family="Georgia, serif" font-size="14" fill="' + pal.capDeep + '">bucket hat · head ' + esc(fmt(meta.headCirc, u)) + '</text>');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Preview of the mushroom bucket hat">' + parts.join("") + "</svg>";
  }

  // ---- Drawstring bucket bag ----
  function renderBagSvg(result, inp, palette, opts) {
    opts = opts || {};
    var width = opts.width || 400, height = opts.height || 420;
    var pal = Object.assign({}, DEFAULT_PALETTE, palette || {});
    var meta = result.meta, u = meta.unit;
    var dia = meta.baseCirc / Math.PI, ht = meta.height;
    var cx = width / 2;
    var scale = Math.min((width * 0.62) / dia, (height * 0.5) / Math.max(ht, 1), 9);
    var half = (dia / 2) * scale, bodyH = ht * scale;
    var yTop = height * 0.26, yBot = yTop + bodyH, ry = half * 0.30;
    var parts = [];
    parts.push('<rect width="' + width + '" height="' + height + '" fill="' + pal.bg + '"/>');
    // strap
    parts.push('<path d="M ' + e(cx - half) + ' ' + e(yTop + 6) + ' C ' + e(cx - half - 60) + ' ' + e(yTop - 120) + ', ' + e(cx + half + 60) + ' ' + e(yTop - 120) + ', ' + e(cx + half) + ' ' + e(yTop + 6) + '" fill="none" stroke="' + pal.cap + '" stroke-width="8" stroke-linecap="round"/>');
    // body
    parts.push('<path d="M ' + e(cx - half) + ' ' + e(yTop) + ' L ' + e(cx - half) + ' ' + e(yBot) + ' A ' + e(half) + ' ' + e(ry) + ' 0 0 0 ' + e(cx + half) + ' ' + e(yBot) + ' L ' + e(cx + half) + ' ' + e(yTop) + ' Z" fill="' + pal.cap + '" stroke="' + pal.capDeep + '" stroke-width="2"/>');
    // base ellipse (front lip)
    parts.push('<path d="M ' + e(cx - half) + ' ' + e(yBot) + ' A ' + e(half) + ' ' + e(ry) + ' 0 0 0 ' + e(cx + half) + ' ' + e(yBot) + '" fill="none" stroke="' + pal.capDeep + '" stroke-width="2" opacity="0.5"/>');
    // spots on the body
    var radii = spotDiasCm(result, inp, Core, u).map(function (d) { return Math.max(4, (d / 2) * scale * 1.6); });
    scatter(parts, { x0: cx - half + 6, x1: cx + half - 6, y0: yTop + 14, y1: yBot - 10 }, radii, Math.round(dia * 53), pal);
    // eyelet band + gathered top with drawstring
    parts.push('<rect x="' + e(cx - half) + '" y="' + e(yTop - 6) + '" width="' + e(2 * half) + '" height="12" fill="' + pal.capDeep + '" opacity="0.85"/>');
    for (var ei = 0; ei < 7; ei++) {
      var ex = lerp(cx - half + 8, cx + half - 8, ei / 6);
      parts.push('<circle cx="' + e(ex) + '" cy="' + e(yTop) + '" r="2.4" fill="' + pal.bg + '"/>');
    }
    parts.push('<ellipse cx="' + cx + '" cy="' + e(yTop) + '" rx="' + e(half) + '" ry="' + e(ry) + '" fill="none" stroke="' + pal.capDeep + '" stroke-width="2"/>');
    parts.push('<path d="M ' + e(cx - half) + ' ' + e(yTop) + ' q ' + e(half) + ' -18 ' + e(2 * half) + ' 0" fill="none" stroke="' + pal.body + '" stroke-width="4" stroke-linecap="round"/>');
    parts.push('<text x="' + cx + '" y="' + (height - 16) + '" text-anchor="middle" font-family="Georgia, serif" font-size="14" fill="' + pal.capDeep + '">bucket bag · ⌀ ' + esc(fmt(dia, u)) + ' × ' + esc(fmt(ht, u)) + '</text>');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Preview of the mushroom bucket bag">' + parts.join("") + "</svg>";
  }

  // dispatcher by garment kind
  function render(result, inp, palette, opts) {
    var kind = result.meta && result.meta.kind;
    if (kind === "hat") return renderHatSvg(result, inp, palette, opts);
    if (kind === "bag") return renderBagSvg(result, inp, palette, opts);
    return renderDressSvg(result, inp, palette, opts);
  }

  return { DEFAULT_PALETTE: DEFAULT_PALETTE, renderDressSvg: renderDressSvg, renderHatSvg: renderHatSvg, renderBagSvg: renderBagSvg, render: render };
})(typeof CrochetCore !== "undefined" ? CrochetCore : require("./crochet-core.js"));

if (typeof module !== "undefined" && module.exports) module.exports = CrochetViz;

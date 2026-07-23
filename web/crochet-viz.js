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
    var hemHalf = halfw(hem, 0.46);

    var yShoulder = 84, yFlTop = 96, flH = 150;
    var yFlBot = yFlTop + flH;
    var yWaist = yFlBot + 46;
    var skirtH = Math.max(150, Math.min(height - yWaist - 70, skirtLen * scale * 1.15));
    var yHem = yWaist + skirtH;

    var parts = [];
    parts.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="' + pal.bg + '"/>');
    parts.push('<ellipse cx="' + cx + '" cy="' + Math.round(height * 0.5) + '" rx="' + Math.round(width * 0.62) + '" ry="' + Math.round(height * 0.55) + '" fill="#ffffff" opacity="0.18"/>');

    // bodice (behind)
    var yBodTop = 116;
    var bodTopHalf = Math.min(width * 0.30, (upperBust / 2) * scale * 0.88);
    var waistHalfPre = Math.min(width * 0.30, (waistband / 2) * scale);
    parts.push('<path d="M ' + e(cx - bodTopHalf) + ' ' + e(yBodTop) + ' L ' + e(cx + bodTopHalf) + ' ' + e(yBodTop) + ' L ' + e(cx + waistHalfPre) + ' ' + e(yWaist) + ' L ' + e(cx - waistHalfPre) + ' ' + e(yWaist) + ' Z" fill="' + pal.body + '" opacity="0.55"/>');

    // sleeves
    var slBulge = Math.min(70, (upperArm * balloon / 2) * scale * 0.9);
    var slLen = Math.min(230, Math.max(150, sleeveLen * scale * 0.9));
    var ySlTop = yFlTop + 6, ySlBot = ySlTop + slLen, ySlMid = ySlTop + slLen * 0.55;
    var spotRegions = [];
    var sleeveless = !result.pieces.some(function (p) { return p.id === "sleeves"; });
    if (!sleeveless) {
      [-1, 1].forEach(function (side) {
        var ox = cx + side * (flTopHalf - 6);
        var outer = ox + side * slBulge, cuffHalf = 20;
        var path = "M " + e(ox) + " " + e(ySlTop) +
          " C " + e(ox + side * slBulge * 1.1) + " " + e(ySlTop + 12) + ", " + e(outer) + " " + e(ySlMid - 30) + ", " + e(outer) + " " + e(ySlMid) +
          " C " + e(outer) + " " + e(ySlMid + 40) + ", " + e(ox + side * cuffHalf) + " " + e(ySlBot - 14) + ", " + e(ox + side * cuffHalf) + " " + e(ySlBot) +
          " L " + e(ox - side * cuffHalf) + " " + e(ySlBot) +
          " C " + e(ox - side * cuffHalf) + " " + e(ySlBot - 40) + ", " + e(ox) + " " + e(ySlMid + 30) + ", " + e(ox) + " " + e(ySlMid) +
          " C " + e(ox) + " " + e(ySlMid - 40) + ", " + e(ox) + " " + e(ySlTop + 20) + ", " + e(ox) + " " + e(ySlTop) + " Z";
        parts.push('<path d="' + path + '" fill="' + pal.cap + '" stroke="' + pal.capDeep + '" stroke-width="2"/>');
        parts.push('<rect x="' + e(ox - cuffHalf) + '" y="' + e(ySlBot - 10) + '" width="' + e(2 * cuffHalf) + '" height="12" rx="4" fill="' + pal.capDeep + '"/>');
        spotRegions.push({ x0: Math.min(ox, outer) + 6, x1: Math.max(ox, outer) - 6, y0: ySlTop + 20, y1: ySlMid + 30, density: 0.55 });
      });
    }

    // skirt
    parts.push('<path d="M ' + e(cx - waistHalf) + ' ' + e(yWaist) + ' L ' + e(cx + waistHalf) + ' ' + e(yWaist) + ' L ' + e(cx + hemHalf) + ' ' + e(yHem) + ' Q ' + e(cx) + ' ' + e(yHem + 20) + ' ' + e(cx - hemHalf) + ' ' + e(yHem) + ' Z" fill="' + pal.body + '" stroke="' + pal.line + '" stroke-width="2"/>');

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

  return { DEFAULT_PALETTE: DEFAULT_PALETTE, renderDressSvg: renderDressSvg };
})(typeof CrochetCore !== "undefined" ? CrochetCore : require("./crochet-core.js"));

if (typeof module !== "undefined" && module.exports) module.exports = CrochetViz;

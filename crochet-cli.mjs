#!/usr/bin/env node
/**
 * crochet-cli — command-line pattern generator for the mushroom dress.
 *
 * Thin renderer over the same engine the web app uses (web/crochet-core.js),
 * so the terminal and the browser can never disagree. Builds the pattern input
 * from a JSON config and/or flags, then prints the round-by-round pattern.
 *
 *   node crochet-cli.mjs                       # default pattern
 *   node crochet-cli.mjs --waist 70 --hip 96
 *   node crochet-cli.mjs --unit in --waist 29 --rib-w 4 --hdc-w 4 --sc-w 4
 *   node crochet-cli.mjs --dot-sizes 1.5,2.5,3.5 --svg dress.svg --schematic
 *   node crochet-cli.mjs --sleeveless --terms UK --yarn
 *   node crochet-cli.mjs --piece skirt        # one piece
 *   node crochet-cli.mjs --json               # machine-readable
 */
import { parseArgs } from "node:util";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Core = require("./web/crochet-core.js");
const Viz = require("./web/crochet-viz.js");

const BODY = { bust: "bust", waist: "waist", "upper-bust": "upperBust", hip: "hip", "upper-arm": "upperArm", wrist: "wrist", "skirt-len": "skirtLen", "sleeve-len": "sleeveLen" };
const STYLE = { "waist-ease": "waistEase", fullness: "fullness", flare: "flare", balloon: "balloon", "dot-dia": "dotDia", "dot-gap": "dotGap" };
const COLORS = { "cap-color": "cap", "spot-color": "spot", "body-color": "body" };
const GAUGES = ["rib", "hdc", "sc"];
const GFIELDS = { sts: "sts", rows: "rows", w: "width", h: "height" };

function buildOptions() {
  const o = {
    config: { type: "string" }, unit: { type: "string" }, terms: { type: "string" },
    sleeveless: { type: "boolean" }, strapless: { type: "boolean" },
    "dot-sizes": { type: "string" }, piece: { type: "string" }, yarn: { type: "boolean" },
    json: { type: "boolean" }, svg: { type: "string" }, schematic: { type: "boolean" },
    "dump-config": { type: "string" }, "no-chart": { type: "boolean" }, "no-color": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  };
  for (const f of Object.keys(BODY)) o[f] = { type: "string" };
  for (const f of Object.keys(STYLE)) o[f] = { type: "string" };
  for (const f of Object.keys(COLORS)) o[f] = { type: "string" };
  for (const st of GAUGES) for (const f of Object.keys(GFIELDS)) o[`${st}-${f}`] = { type: "string" };
  return o;
}

// --- ANSI colour ---
function makeStyle(on) {
  const w = (c, s) => (on ? `\x1b[${c}m${s}\x1b[0m` : s);
  return {
    bold: (s) => w("1", s), dim: (s) => w("2", s),
    red: (s) => w("38;5;131", s), cream: (s) => w("38;5;223", s),
    moss: (s) => w("38;5;107", s), head: (s) => w("1;38;5;131", s),
  };
}

function resolveInput(v) {
  const inp = Core.defaultInput();
  if (v.config) {
    const loaded = JSON.parse(fs.readFileSync(v.config, "utf8"));
    for (const sec of ["gauges", "body", "style", "colors"]) if (loaded[sec]) Object.assign(inp[sec], loaded[sec]);
    if (loaded.unit) inp.unit = loaded.unit;
    if (loaded.terms) inp.terms = loaded.terms;
  }
  if (v.unit) inp.unit = v.unit;
  if (v.terms) inp.terms = v.terms;
  if (v.sleeveless) inp.style.sleeveless = true;
  if (v.strapless) inp.style.strapless = true;
  for (const [f, k] of Object.entries(BODY)) if (v[f] != null) inp.body[k] = parseFloat(v[f]);
  for (const [f, k] of Object.entries(STYLE)) if (v[f] != null) inp.style[k] = parseFloat(v[f]);
  for (const [f, k] of Object.entries(COLORS)) if (v[f] != null) inp.colors[k] = v[f];
  for (const st of GAUGES) for (const [f, k] of Object.entries(GFIELDS)) if (v[`${st}-${f}`] != null) inp.gauges[st][k] = parseFloat(v[`${st}-${f}`]);
  if (v["dot-sizes"]) {
    const sizes = v["dot-sizes"].split(",").map((x) => parseFloat(x.trim())).filter((n) => !isNaN(n));
    if (sizes.length) { inp.style.dotDia = sizes[0]; if (sizes.length > 1) inp.style.dotSizes = sizes; }
  }
  return inp;
}

function renderChart(chart, sty) {
  const lines = [];
  const spot = sty.cream("██"), cap = sty.red("░░");
  for (let r = 0; r < chart.repH; r++) {
    let cells = "";
    for (let c = 0; c < chart.repW; c++) {
      let on = false;
      if (r < chart.H) { const row = chart.rows[r]; on = c >= row.lead && c < row.lead + row.w; }
      cells += on ? spot : cap;
    }
    lines.push("  " + cells);
  }
  lines.push(sty.dim(`  ${chart.W}x${chart.H} st spot · ${chart.repW}x${chart.repH} repeat`));
  return lines.join("\n");
}

function renderPiece(p, sty, showChart) {
  const out = [];
  let title = p.title;
  if ((p.makeCount || 1) > 1 && !title.includes("×")) title += ` (make ${p.makeCount})`;
  const bar = "─".repeat(Math.max(title.length + 2, 40));
  out.push(sty.head(`┌${bar}┐`));
  out.push(sty.head(`│ ${title}`));
  out.push(sty.dim(`│ ${p.stitch}`));
  out.push(sty.head(`└${bar}┘`));
  const counts = Object.entries(p.counts).filter(([k]) => k !== "sizes").map(([k, val]) => `${k}: ${val}`).join(", ");
  out.push("  " + sty.moss(counts));
  out.push("");
  for (const [label, text] of p.steps) out.push(`  ${sty.bold(label.padEnd(12))}  ${text}`);
  if (showChart && p.chart) { out.push(""); out.push(renderChart(p.chart, sty)); }
  return out.join("\n");
}

function renderYarn(result, sty) {
  const y = Core.estimateYarn(result);
  const preferYd = y.unit === "in";
  const amt = (c) => (preferYd ? `${c.yards} yd` : `${c.meters} m`);
  const out = [sty.head("  YARN ESTIMATE") + sty.dim(`  (rough · +${y.wastePct}% for ends & joins)`)];
  for (const k of ["cap", "body", "spot"]) { const c = y.byColor[k]; if (c && c.meters > 0) out.push(`    ${sty.bold(c.name.padEnd(14))} ${amt(c)}`); }
  out.push(sty.moss(`    ${"total".padEnd(14)} ${amt(y.total)}`));
  return out.join("\n");
}

function render(result, sty, only, showChart) {
  const out = [];
  const meta = result.meta, u = meta.unit;
  if (!only) {
    out.push(sty.head("═".repeat(52)));
    out.push(sty.head("  MUSHROOM DRESS — made-to-measure crochet pattern"));
    out.push(sty.head("═".repeat(52)));
    const d = meta.density;
    out.push(sty.dim(`  gauge/10${u}:  rib ${Core.r1(d.rib.st * 10)}st  hdc ${Core.r1(d.hdc.st * 10)}st  sc ${Core.r1(d.sc.st * 10)}st`));
    out.push(sty.dim(`  waistband ${Core.r1(Core.fromCm(meta.waistbandCirc, u))}${u} · hem ${Core.r1(Core.fromCm(meta.hemCirc, u))}${u}`));
    out.push("");
  }
  if (result.warnings.length) {
    out.push(sty.red("  ⚠ FIT WARNINGS"));
    for (const w of result.warnings) out.push(sty.red(`    • ${w}`));
    out.push("");
  }
  let pieces = result.pieces;
  if (only) {
    pieces = pieces.filter((p) => p.id === only);
    if (!pieces.length) return `No piece '${only}'. Available: ${result.pieces.map((p) => p.id).join(", ")}`;
  }
  pieces.forEach((p, i) => { out.push(renderPiece(p, sty, showChart)); if (i < pieces.length - 1) out.push(""); });
  return out.join("\n");
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: buildOptions(), allowPositionals: false }));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
  if (values.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, "").trim());
    return;
  }

  let inp;
  try { inp = resolveInput(values); }
  catch (err) { console.error(`error: could not read config: ${err.message}`); process.exit(2); }

  if (values["dump-config"]) {
    fs.writeFileSync(values["dump-config"], JSON.stringify(inp, null, 2) + "\n");
    console.log(`Wrote resolved config to ${values["dump-config"]}`);
    return;
  }

  let result;
  try {
    result = Core.computePattern(inp);
    result = Core.convertTerms(result, values.terms || "US");
  } catch (err) { console.error(`error: ${err.message}`); process.exit(1); }

  if (values.svg) {
    fs.writeFileSync(values.svg, Viz.renderDressSvg(result, inp, null, { schematic: !!values.schematic }));
    console.log(`Wrote visualization to ${values.svg}`);
  }
  if (values.json) { console.log(JSON.stringify(result, null, 2)); return; }

  const sty = makeStyle(!values["no-color"] && process.stdout.isTTY);
  console.log(render(result, sty, values.piece, !values["no-chart"]));
  if (values.yarn && !values.piece) { console.log(""); console.log(renderYarn(result, sty)); }
}

main();

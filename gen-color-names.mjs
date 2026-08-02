/*
 * gen-color-names.mjs — regenerate web/color-names.js (the colour name → hex table
 * the studio uses to tint a role's colour picker from its name).
 *
 * The output is committed as a static data asset, so you only need this when you
 * want to refresh the source lists. Run:
 *
 *   npm i --no-save color-name-list xkcd-colors && node gen-color-names.mjs
 *
 * Sources (both permissively licensed):
 *   - meodai/color-name-list  (~30k names, MIT)          — the bulk
 *   - xkcd colour survey       (~949 names, public domain, via the MIT xkcd-colors pkg)
 *   - a few yarn words below   — predictable common colours
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const full = require("color-name-list/dist/colornames.json");
const xkcd = require("xkcd-colors").colors;
const curated = {
  oatmeal: "#d8cbb3", ecru: "#cdbfa3", bone: "#e3dac9", eggshell: "#f0ead6", alabaster: "#eae6d9",
  pearl: "#eae0c8", vanilla: "#f3e5ab", greige: "#bab5a8", espresso: "#4a3728", mocha: "#8a6a52",
  latte: "#c8a97e", caramel: "#a97142", terracotta: "#c96f4a", petrol: "#1f5f6b", celadon: "#b7cbb2",
  seafoam: "#93e9be", pistachio: "#a7c68a", cobalt: "#2a52be", pewter: "#8e9294", platinum: "#e2e0da",
  graphite: "#4b4f52", camel: "#c19a6b", oat: "#e0d3ba", taupe: "#8b7e66", forest: "#1f5c3a", sage: "#9caf88",
};

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const map = {};
for (const c of full) { const k = norm(c.name); if (k) map[k] = c.hex.toLowerCase(); }   // base
for (const c of xkcd) if (c.clean_name && c.hex) map[c.clean_name] = c.hex.toLowerCase(); // overlay
for (const k in curated) map[k] = curated[k];                                             // overlay

const obj = {};
for (const k of Object.keys(map).sort()) obj[k] = map[k];
const header =
  "/*\n * color-names.js — colour name -> hex fallback for the studio colour previews.\n" +
  " * Base: the meodai color-name-list (~30k names, MIT), overlaid with the xkcd colour\n" +
  " * survey and a few yarn words for predictable common colours. Keys are lower-cased\n" +
  " * with non-alphanumerics stripped. Regenerate with gen-color-names.mjs.\n */\n";
fs.writeFileSync(new URL("./web/color-names.js", import.meta.url),
  header + "var COLOR_NAMES = " + JSON.stringify(obj) + ";\n" +
  'if (typeof module !== "undefined" && module.exports) module.exports = COLOR_NAMES;\n');
console.log("wrote web/color-names.js with", Object.keys(obj).length, "names");

/*
 * gen-color-names.mjs — regenerate web/color-names.js (the colour name → hex table
 * the studio uses to tint a role's colour picker from its name).
 *
 * The output is committed as a static data asset, so you only need this when you
 * want to refresh the source list. Run:
 *
 *   npm i --no-save color-name-list && node gen-color-names.mjs
 *
 * Source: meodai/color-name-list (~30k names, MIT). Common CSS names (red, teal,
 * ivory…) are already handled by the browser's own parser in the app, so this only
 * needs to cover the descriptive/marketing names the CSS parser doesn't know.
 */
import fs from "node:fs";

const list = JSON.parse(fs.readFileSync(
  new URL("./node_modules/color-name-list/dist/colornames.json", import.meta.url), "utf8"));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const map = {};
for (const c of list) { const k = norm(c.name); if (k) map[k] = c.hex.toLowerCase(); }

const obj = {};
for (const k of Object.keys(map).sort()) obj[k] = map[k];
const header =
  "/*\n * color-names.js — colour name -> hex fallback for the studio colour previews.\n" +
  " * The meodai color-name-list (~30k names, MIT). Keys are lower-cased with\n" +
  " * non-alphanumerics stripped. Used only to tint the preview picker from a name;\n" +
  " * standard CSS names are resolved by the browser first. Regenerate: gen-color-names.mjs.\n */\n";
fs.writeFileSync(new URL("./web/color-names.js", import.meta.url),
  header + "var COLOR_NAMES = " + JSON.stringify(obj) + ";\n" +
  'if (typeof module !== "undefined" && module.exports) module.exports = COLOR_NAMES;\n');
console.log("wrote web/color-names.js with", Object.keys(obj).length, "names");

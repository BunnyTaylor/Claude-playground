/*
 * build-artifact.mjs — inline the static site (web/) into one self-contained
 * HTML file for publishing as a single-file link (e.g. a Claude artifact).
 *
 * Same source as the GitHub Pages site — this is only a bundling step, so
 * there is nothing extra to maintain. Output has no <html>/<head>/<body>
 * wrappers (the artifact host adds those) and no external requests.
 *
 *   node build-artifact.mjs        ->  dist/artifact.html
 */
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL(`./web/${f}`, import.meta.url), "utf8");

const html = read("index.html");
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/\s*<script src="[^"]*"><\/script>/g, "") // drop external script tags; we inline below
  .trim();

const css = read("style.css");
const core = read("crochet-core.js");
const viz = read("crochet-viz.js");
const registry = read("registry.js");
const colorNames = read("color-names.js");
const app = read("app.js");

const out =
  `<style>\n${css}\n</style>\n\n${body}\n\n` +
  `<script>\n${core}\n</script>\n` +
  `<script>\n${viz}\n</script>\n` +
  `<script>\n${registry}\n</script>\n` +
  `<script>\n${colorNames}\n</script>\n` +
  `<script>\n${app}\n</script>\n`;

fs.mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("./dist/artifact.html", import.meta.url), out);
console.log(`wrote dist/artifact.html (${(out.length / 1024).toFixed(1)} KB, self-contained)`);

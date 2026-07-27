"use strict";
/* Crochet Pattern Studio — front-end. Runs the engine in the browser
 * (crochet-core.js / crochet-viz.js) and persists projects, progress and
 * gauge swatches in localStorage. Nothing leaves the device. */

const $ = (id) => document.getElementById(id);
const LS_PROJECTS = "mushroom.projects.v1";
const LS_WORKING = "mushroom.working.v1";
const LS_PROGRESS = "mushroom.progress.v1";
const LS_SWATCHES = "mushroom.swatches.v1";
const round1 = (n) => Math.round(n * 10) / 10;

let unit = "cm";
let terms = "US";
let curColl = Registry.collections[0];          // current collection
let curGen = curColl.generators[0];             // current generator (dress/hat/bag/…)
const INPUT_GROUPS = ["dressInputs", "hatInputs", "bagInputs"];
let activeId = null;          // id of the currently-loaded saved project
let debounceTimer = null;
let pendingStatus = null;    // one-shot status message for the next generate() (survives the debounce)
let LAST = null;             // most recent /api/pattern response

/* ---------- field <-> state ---------- */

const GAUGES = ["rib", "hdc", "sc"];
const GFIELDS = { Sts: "sts", Rows: "rows", W: "width", H: "height" };
const BODY = ["bust", "waist", "upperBust", "hip", "upperArm", "wrist", "skirtLen", "sleeveLen"];
const ACC = { headCirc: "headCirc", sideHeight: "sideHeight", brimWidth: "brimWidth", diameter: "diameter", bagHeight: "height", strapLen: "strapLen" };
// measurement fields that must be numerically converted when the unit changes
const CONVERT = [...BODY, ...Object.keys(ACC)];
// The studio's active gauge now comes from picking saved swatches (per stitch),
// not raw inputs. studioGauge holds the live numbers; DEFAULT_GAUGE seeds it so a
// fresh project previews before any swatch is chosen.
const DEFAULT_GAUGE = {
  rib: { sts: 18, rows: 9, width: 10, height: 10 },
  hdc: { sts: 14, rows: 11, width: 10, height: 10 },
  sc:  { sts: 16, rows: 18, width: 10, height: 10 },
};
let studioGauge = JSON.parse(JSON.stringify(DEFAULT_GAUGE));
const GAUGE_SEL = { rib: "gaugeSelRib", hdc: "gaugeSelHdc", sc: "gaugeSelSc" };

function gather() {
  const num = (id) => parseFloat($(id).value);
  const gauges = {};
  for (const g of GAUGES) gauges[g] = { ...studioGauge[g] };   // set via the per-stitch swatch pickers
  const body = {};
  for (const b of BODY) body[b] = num(b);

  const sizes = ($("dotSizes").value || "")
    .split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n) && n > 0);

  const style = {
    waistEase: num("waistEase"), fullness: num("fullness"),
    flare: num("flare"), balloon: num("balloon"),
    dotGap: parseFloat($("dotGap").value),
    dotDia: sizes.length ? sizes[0] : 2.5,
    ribStyle: $("ribStyle").value,
  };
  // "auto" lets the engine pick negative ease by rib style; otherwise it's a fraction
  if ($("bandEase").value !== "auto") style.bandEase = parseFloat($("bandEase").value);
  // one size -> uniform tapestry bands; several -> a scattered mix
  if (sizes.length > 1) style.dotSizes = sizes;
  if ($("sleeveless").checked) style.sleeveless = true;
  if ($("strapless").checked) style.strapless = true;

  const colors = {
    cap: ($("capName").value || "").trim() || "cap colour",
    spot: ($("spotName").value || "").trim() || "spot colour",
    body: ($("bodyName").value || "").trim() || "body colour",
  };
  const palette = { cap: $("capCol").value, spot: $("spotCol").value, body: $("bodyCol").value };
  const accessory = {};
  for (const [id, key] of Object.entries(ACC)) accessory[key] = num(id);

  return {
    input: { unit, terms, gauges, body, style, colors, accessory },
    palette,
    ui: {
      name: $("pName").value,
      names: { capName: $("capName").value, spotName: $("spotName").value, bodyName: $("bodyName").value },
      dotSizes: $("dotSizes").value, dotGap: $("dotGap").value,
      waistEase: $("waistEase").value, fullness: $("fullness").value,
      bandEase: $("bandEase").value,
      flare: $("flare").value, balloon: $("balloon").value,
      capCol: $("capCol").value, spotCol: $("spotCol").value, bodyCol: $("bodyCol").value,
    },
  };
}

function apply(state) {
  // restore a saved project into the form
  const { input, ui } = state;
  unit = input.unit || "cm";
  for (const btn of $("unitSeg").children) btn.classList.toggle("on", btn.dataset.unit === unit);
  terms = input.terms || "US";
  for (const btn of $("termsSeg").children) btn.classList.toggle("on", btn.dataset.terms === terms);
  $("sleeveless").checked = !!(input.style && input.style.sleeveless);
  $("strapless").checked = !!(input.style && input.style.strapless);
  if (input.accessory) {
    for (const [id, key] of Object.entries(ACC)) if (input.accessory[key] != null) $(id).value = input.accessory[key];
  }

  for (const g of GAUGES) {
    const src = (input.gauges && input.gauges[g]) || DEFAULT_GAUGE[g];
    studioGauge[g] = { sts: src.sts, rows: src.rows, width: src.width, height: src.height };
  }
  populateGaugeSelectors();
  for (const b of BODY) $(b).value = input.body[b];

  $("pName").value = (ui && ui.name) || "";
  $("capName").value = input.colors.cap === "cap colour" ? "" : input.colors.cap;
  $("spotName").value = input.colors.spot === "spot colour" ? "" : input.colors.spot;
  $("bodyName").value = input.colors.body === "body colour" ? "" : input.colors.body;

  const S = input.style;
  $("dotSizes").value = (S.dotSizes && S.dotSizes.length ? S.dotSizes : [S.dotDia]).join(", ");
  setSelect("dotGap", S.dotGap);
  setSelect("waistEase", S.waistEase);
  setSelect("fullness", S.fullness);
  setSelect("flare", S.flare);
  setSelect("balloon", S.balloon);
  setSelect("ribStyle", S.ribStyle || "sideways");
  setSelect("bandEase", (ui && ui.bandEase) || (S.bandEase != null ? String(S.bandEase) : "auto"));
  if (ui) {
    $("capCol").value = ui.capCol || "#B83A2B";
    $("spotCol").value = ui.spotCol || "#FCF8EF";
    $("bodyCol").value = ui.bodyCol || "#F2E4C9";
  }
}

function setSelect(id, val) {
  const el = $(id), s = String(val);
  if ([...el.options].some((o) => o.value === s)) el.value = s;
}

/* ---------- rendering ---------- */

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// The engine runs entirely in the browser (crochet-core.js / crochet-viz.js),
// so the app is a static site — no server, works offline and on GitHub Pages.
function generate() {
  const { input, palette, ui } = gather();
  localStorage.setItem(LS_WORKING, JSON.stringify({ input, ui, coll: curColl.id, gen: curGen.id }));
  try {
    let result = CrochetCore[curGen.compute](input);
    result = CrochetCore.convertTerms(result, input.terms || "US");
    result.svg = CrochetViz.render(result, input, palette, { schematic: $("schematic").checked });
    result.yarn = CrochetCore.estimateYarn(result);
    render(result);
    updateGaugeDerived();
    $("status").textContent = pendingStatus || "updated";
    pendingStatus = null;
  } catch (err) {
    $("status").textContent = "error: " + err.message;
  }
}

/* ---------- collection / generator (registry-driven) ---------- */

function buildTypeSwitch(coll) {
  $("collLabel").textContent = coll.name;
  $("typeSeg").innerHTML = coll.generators
    .map((g) => `<button data-gen="${g.id}">${g.emoji ? g.emoji + " " : ""}${esc(g.label)}</button>`).join("");
}

function setGenerator(gen) {
  curGen = gen;
  for (const b of $("typeSeg").children) b.classList.toggle("on", b.dataset.gen === gen.id);
  for (const gid of INPUT_GROUPS) $(gid).hidden = !gen.inputGroups.includes(gid);
  $("schematic").closest("label").style.display = gen.schematic ? "" : "none";
  document.querySelector(".toolbar h2").textContent = "Your " + gen.label.toLowerCase();
}

/* ---------- home / studio routing ---------- */

function showHome() {
  $("studioView").hidden = true;
  $("swatchView").hidden = true;
  $("homeView").hidden = false;
  renderHome();
  if (location.hash !== "#/") location.hash = "#/";
}

function openStudio(collId, genId, setHash = true) {
  const f = Registry.find(collId, genId) || Registry.find(curColl.id, curColl.generators[0].id);
  curColl = f.collection;
  buildTypeSwitch(curColl);
  setGenerator(f.generator);
  $("homeView").hidden = true;
  $("swatchView").hidden = true;
  $("studioView").hidden = false;
  populateGaugeSelectors();   // refresh pickers so newly-saved swatches show up
  if (setHash) location.hash = "#/" + curColl.id + "/" + f.generator.id;
  generate();
}

function route() {
  const hash = location.hash || "";
  const sw = hash.match(/^#\/swatch(?:\/([^/]+))?/);
  if (sw) { openSwatch(sw[1], false); return; }
  const m = hash.match(/^#\/([^/]+)\/([^/]+)/);
  if (m && Registry.find(m[1], m[2])) openStudio(m[1], m[2], false);
  else showHome();
}

function renderHome() {
  // one card per collection — the studio's Make switch picks the component
  $("collections").innerHTML = `<div class="collection"><h2>Patterns</h2>
    <div class="gallery">` +
    Registry.collections.map((c) => `
      <button class="gcard" data-coll="${c.id}" data-gen="${c.generators[0].id}">
        <div class="gemoji">${c.emoji}</div>
        <div class="gname">${esc(c.name)}</div>
        <div class="gblurb">${esc(c.tagline)}</div>
        <div class="ggo">${c.generators.map((g) => esc(g.label)).join(" · ")} — open →</div>
      </button>`).join("") +
    `<div class="gcard soon"><div class="gemoji">✨</div><div class="gname">More coming</div><div class="gblurb">New collections and patterns will appear here.</div></div>
    </div></div>`;
  renderSwatches();
  renderHomeProjects();
}

/* ---------- gauge swatches ---------- */

// Legacy swatches (and studio quick-saves) stored one `rib` gauge. The tool now
// tracks BLO vs post rib separately, so normalise old records on load: a `rib`
// gauge becomes ribPost if it was worked in the round, otherwise ribBlo.
// Normalise old swatch schemas to the current one (a `measurements` list):
//   - very old: a single `gauges.rib`  → ribBlo/ribPost by its worked tag
//   - previous: `gauges.{ribBlo,ribPost,hdc,sc}` (each with a worked tag)
//   - current:  `measurements: [{stitch,worked,sts,rows,width,height,stretchW?,stretchH?}]`
function migrateSwatchRec(rec) {
  if (!rec || rec.measurements) return rec;
  const g = rec.gauges || {};
  if (g.rib && !g.ribBlo && !g.ribPost) {
    const k = g.rib.worked === "round" ? "ribPost" : "ribBlo";
    g[k] = { ...g.rib, worked: g.rib.worked || (k === "ribPost" ? "round" : "flat") };
    delete g.rib;
  }
  const REC = { ribBlo: "flat", ribPost: "round", hdc: "round", sc: "round" };
  const measurements = [];
  for (const stitch of ["ribBlo", "ribPost", "hdc", "sc"]) {
    const m = g[stitch];
    if (m && m.sts > 0 && m.width > 0) {
      measurements.push({ stitch, worked: m.worked || REC[stitch], sts: m.sts, rows: m.rows, width: m.width, height: m.height });
    }
  }
  rec.measurements = measurements;
  delete rec.gauges;
  return rec;
}
const loadSwatches = () => { try { const s = JSON.parse(localStorage.getItem(LS_SWATCHES)) || {}; for (const id in s) migrateSwatchRec(s[id]); return s; } catch { return {}; } };
const saveSwatches = (s) => localStorage.setItem(LS_SWATCHES, JSON.stringify(s));

function gatherGauges() {
  const g = {};
  for (const k of GAUGES) g[k] = { ...studioGauge[k] };
  return g;
}

// per-stitch density in the given unit (st & row per cm, or per inch)
function densityIn(gauge, u) {
  try {
    const d = CrochetCore.density(gauge, u);
    const per = u === "in" ? 2.54 : 1;
    return { st: round1(d.st * per), row: round1(d.row * per) };
  } catch { return null; }
}

function updateGaugeDerived() {
  const parts = GAUGES.map((k) => {
    const d = densityIn(studioGauge[k], unit);
    return d ? `<b>${k}</b> ${d.st}×${d.row}` : "";
  }).filter(Boolean).join(" · ");
  $("gaugeDerived").innerHTML = parts ? `≈ ${parts} <span style="opacity:.7">st×row per ${unit}</span>` : "";
}

// saved measurements that fit a studio gauge slot ('rib' accepts BLO or post rib)
function applicableMeas(stitch) {
  const sw = loadSwatches();
  const out = [];
  for (const id of Object.keys(sw).sort((a, b) => (sw[b].savedAt || 0) - (sw[a].savedAt || 0))) {
    for (const m of (sw[id].measurements || [])) {
      if (!swMeasured(m)) continue;
      const ok = stitch === "rib" ? (m.stitch === "ribBlo" || m.stitch === "ribPost") : m.stitch === stitch;
      if (ok) out.push({ id, key: measKey(m), name: sw[id].name, m });
    }
  }
  return out;
}

// (re)fill the three per-stitch gauge dropdowns from saved swatches; keeps selection
function populateGaugeSelectors() {
  for (const stitch of GAUGES) {
    const el = $(GAUGE_SEL[stitch]); if (!el) continue;
    const cur = el.value;
    const list = applicableMeas(stitch);
    let html = `<option value="__default__">Standard gauge</option>`;
    html += list.map(({ id, key, name, m }) => {
      const d = densityIn(m, unit);
      const lbl = SW_STITCH_LABEL[m.stitch] + "·" + (m.worked === "round" ? "rnd" : "flat");
      return `<option value="${id}|${key}">${esc(name)} — ${lbl}${d ? ` (${d.st}×${d.row})` : ""}</option>`;
    }).join("");
    html += `<option value="__new__">＋ New swatch…</option>`;
    el.innerHTML = html;
    el.value = (cur && [...el.options].some((o) => o.value === cur)) ? cur : "__default__";
  }
}

// apply a dropdown choice to studioGauge; returns false if it navigated away (New)
function setGaugeFromSel(stitch, val) {
  const el = $(GAUGE_SEL[stitch]);
  if (val === "__new__") { if (el) el.value = "__default__"; openSwatch(); return false; }
  if (val === "__default__" || !val) { studioGauge[stitch] = { ...DEFAULT_GAUGE[stitch] }; return true; }
  const [id, key] = val.split("|");
  const rec = loadSwatches()[id];
  const m = rec && (rec.measurements || []).find((x) => measKey(x) === key);
  if (!m) { studioGauge[stitch] = { ...DEFAULT_GAUGE[stitch] }; return true; }
  studioGauge[stitch] = { sts: m.sts, rows: m.rows, width: m.width, height: m.height };
  if (stitch === "rib") {   // a stretchy rib auto-sets the waistband grip
    const f = measStretchFactor(m), be = $("bandEase");
    if (f > 1.001 && be) be.value = suggestGripValue(f);
  }
  return true;
}

const swMeasured = (m) => m && m.sts > 0 && m.width > 0;

// "Use in studio" from a swatch card: point every matching gauge slot at this swatch
function applySwatch(id) {
  const s = loadSwatches()[id];
  if (!s) return { stitches: [], grip: null };
  unit = s.unit || "cm";
  for (const b of $("unitSeg").children) b.classList.toggle("on", b.dataset.unit === unit);
  const ms = s.measurements || [];
  const pick = (stitch, preferWorked) => {
    const cands = ms.filter((m) => m.stitch === stitch && swMeasured(m));
    return cands.find((m) => m.worked === preferWorked) || cands[0] || null;
  };
  populateGaugeSelectors();
  const post = !!$("ribStyle") && $("ribStyle").value === "post";
  const targets = { rib: post ? pick("ribPost", "round") : pick("ribBlo", "flat"), hdc: pick("hdc", "round"), sc: pick("sc", "round") };
  const applied = [];
  let grip = null;
  for (const stitch of GAUGES) {
    const m = targets[stitch];
    if (!m) continue;
    studioGauge[stitch] = { sts: m.sts, rows: m.rows, width: m.width, height: m.height };
    const el = $(GAUGE_SEL[stitch]); if (el) el.value = id + "|" + measKey(m);
    applied.push(stitch);
    if (stitch === "rib") {
      const f = measStretchFactor(m), be = $("bandEase");
      if (f > 1.001 && be) { be.value = suggestGripValue(f); grip = suggestGripLabel(f); }
    }
  }
  return { stitches: applied, grip };
}

// measurements that were actually filled in (for the dropdown's "covers…" hint)
function swatchStitches(rec) {
  return (rec.measurements || []).filter(swMeasured);
}

// dropdown label: name — yarn, hook · how many measurements it carries
function swatchLabel(rec) {
  const y = rec.yarn || {};
  const desc = [(y.line || y.brand || "").trim(), (y.hook || "").trim()].filter(Boolean).join(", ");
  const n = swatchStitches(rec).length;
  const tail = [desc, n ? n + " measurement" + (n !== 1 ? "s" : "") : ""].filter(Boolean).join(" · ");
  return rec.name + (tail ? " — " + tail : "");
}

// kept as the name every call site uses; now refreshes the per-stitch gauge pickers
function populateSwatchSelect() { populateGaugeSelectors(); }

function renderSwatches() {
  const guide = `<details class="refbox"><summary>How to make a gauge swatch</summary><div class="guide">
    <p>A swatch tells the maths how big your stitches really are — get it right and everything fits.</p>
    <ul>
      <li>Work a swatch <b>12–15 cm square</b> in the stitch, with the yarn and hook you'll use for that part.</li>
      <li><b>Let it rest before measuring.</b> Ribbing springs back — measure it <b>relaxed</b>, not stretched.</li>
      <li>Lay it flat; count the <b>stitches across a width</b> and the <b>rows down a height</b> (pin the span). A bigger counted span is more accurate.</li>
      <li>Enter the stitches, rows, and the <b>width &amp; height you measured</b> — it needn't be 10 cm, and non-square is fine (width sets stitch gauge, height sets row gauge).</li>
      <li><b>Swatch each stitch separately</b> — rib (waistband &amp; cuffs), hdc (skirt/bag) and sc (flounce/sleeves/hat) come out different from the same yarn.</li>
    </ul>
    <p>Density is then <b>stitches ÷ width</b> and <b>rows ÷ height</b> — that's what every count is built from.</p>
  </div></details>`;
  const sw = loadSwatches();
  const ids = Object.keys(sw).sort((a, b) => sw[b].savedAt - sw[a].savedAt);
  const cards = ids.length ? ids.map((id) => {
    const s = sw[id], u = s.unit || "cm";
    const dens = (s.measurements || []).map((m) => {
      const d = densityIn(m, u);
      if (!d) return "";
      const icon = m.worked === "round" ? "↻" : "⇄";
      const f = measStretchFactor(m);
      const stretch = f > 1.001 ? ` <span style="color:var(--clay)">+${Math.round((f - 1) * 100)}%</span>` : "";
      const lbl = (SW_STITCH_LABEL[m.stitch] || m.stitch) + " " + (m.worked === "round" ? "↻" : "⇄");
      return `<span class="sd" title="worked ${SW_WORKED_LABEL[m.worked]}"><b>${lbl}</b>${d.st + " × " + d.row}${stretch}</span>`;
    }).filter(Boolean).join("") || `<span class="sd" style="opacity:.6">no measurements</span>`;
    const y = s.yarn || {};
    const yline = [y.brand, y.line, y.weight, y.hook].filter(Boolean).join(" · ");
    const cols = Array.isArray(y.colorways) ? y.colorways : (y.colorway ? [y.colorway] : []);
    const notes = (s.notes || "").trim();
    return `<div class="swcard"><div class="swtop"><div class="swn">${esc(s.name)}</div><button class="x" data-delsw="${id}" title="Delete">✕</button></div>
      ${yline ? `<div class="swy">${esc(yline)}</div>` : ""}
      ${cols.length ? `<div class="swchips">${cols.map((c) => `<span class="chip mini">${esc(c)}</span>`).join("")}</div>` : ""}
      <div class="swd">${dens}</div>
      <div class="swm">st × row per ${u}, from your sts÷width &amp; rows÷height</div>
      ${notes ? `<div class="swm" style="opacity:.85;font-style:italic">${esc(notes)}</div>` : ""}
      <div class="btnrow" style="margin-top:0"><button class="btn ghost sm" data-usesw="${id}">Use in studio →</button><button class="btn ghost sm" data-editsw="${id}">Edit</button><button class="btn ghost sm" data-dupsw="${id}">Duplicate</button></div></div>`;
  }).join("") : `<div class="empty">No swatches yet — make one in the swatch tool, or hit “Save swatch” in the studio.</div>`;
  const tools = ids.length ? `<button class="btn ghost sm" id="swExportBtn">⬆ Export</button><button class="btn ghost sm" id="swImportBtn">⬇ Import</button>` : `<button class="btn ghost sm" id="swImportBtn">⬇ Import</button>`;
  $("swatches").innerHTML = `<div class="homeproj">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <h2 style="margin:0">Gauge swatches</h2>
      <div class="btnrow" style="margin:0">${tools}<button class="btn sm" id="newSwatchBtn">＋ New swatch</button></div>
    </div>
    <p class="ctag" style="margin:6px 0 10px">Save the gauges you measure — with the yarn you used — and reuse them across patterns. Density is stitches ÷ the distance you counted.</p>
    ${guide}<div class="swlist">${cards}</div></div>
    <input type="file" id="swImportFile" accept="application/json" hidden>`;
}

function duplicateSwatch(id) {
  const s = loadSwatches();
  const src = s[id];
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.name = (src.name || "Swatch") + " (copy)";
  copy.savedAt = Date.now();
  const newId = "s" + Date.now().toString(36);
  s[newId] = copy;
  saveSwatches(s);
  populateSwatchSelect();
  openSwatch(newId);   // open the copy ready to tweak (e.g. a new colourway or hook)
}

function exportSwatches() {
  const bundle = { kind: "mushroom-swatches", version: 1, exportedAt: new Date().toISOString(), swatches: loadSwatches() };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mushroom-swatches.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function importSwatchFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const b = JSON.parse(reader.result);
      const incoming = b.swatches || (b.kind ? {} : b);   // accept a raw swatch map too
      for (const k in incoming) migrateSwatchRec(incoming[k]);
      saveSwatches({ ...loadSwatches(), ...incoming });
      renderSwatches();
      populateSwatchSelect();
    } catch (err) {
      alert("Swatch import failed: " + err.message);
    }
    e.target.value = "";
  };
  reader.readAsText(file);
}

/* ---------- swatch tool (dedicated tab) ---------- */

// A swatch profile (one yarn + hook) holds a LIST of measurements. Each measurement
// is a stitch type × construction (flat / in the round) — so flat and round of the
// same stitch are separate entries and you can mix them freely on one profile. You
// add only the ones you swatched (via the "+ Add" menu), so it never crowds. Each
// records a RELAXED gauge and an optional STRETCHED size (for stretchy stitches).
const SW_STITCH_LABEL = { ribBlo: "BLO rib", ribPost: "Post rib", hdc: "Hdc", sc: "Sc" };
const SW_WORKED_LABEL = { flat: "flat", round: "in the round" };
const SW_TYPES = [
  { key: "ribBlo-flat",   stitch: "ribBlo",  worked: "flat",  stretchy: true },
  { key: "ribBlo-round",  stitch: "ribBlo",  worked: "round", stretchy: true },
  { key: "ribPost-round", stitch: "ribPost", worked: "round", stretchy: true },
  { key: "ribPost-flat",  stitch: "ribPost", worked: "flat",  stretchy: true },
  { key: "hdc-round",     stitch: "hdc",     worked: "round" },
  { key: "hdc-flat",      stitch: "hdc",     worked: "flat"  },
  { key: "sc-round",      stitch: "sc",      worked: "round" },
  { key: "sc-flat",       stitch: "sc",      worked: "flat"  },
];
const SW_TYPE_BY_KEY = {};
for (const t of SW_TYPES) SW_TYPE_BY_KEY[t.key] = t;
const measKey = (m) => m.stitch + "-" + m.worked;
const measTypeLabel = (t) => SW_STITCH_LABEL[t.stitch] + " · " + SW_WORKED_LABEL[t.worked];
function swInstrFor(stitch, worked) {
  const e = SWATCH_INSTR[stitch];
  return typeof e === "string" ? e : (e[worked] || e.flat || e.round);
}
// stretch factor → suggested waistband grip (a bandEase select value / label)
function suggestGripValue(f) { return f >= 1.6 ? "-0.20" : f >= 1.4 ? "-0.16" : f >= 1.2 ? "-0.12" : "-0.08"; }
function suggestGripLabel(f) { return f >= 1.6 ? "very snug" : f >= 1.4 ? "snug" : f >= 1.2 ? "standard" : "light"; }
let swUnit = "cm", swEditId = null, swMeas = {};   // swMeas: key -> {sts,rows,width,height,stretchW,stretchH}
const SW_YARN = ["swBrand", "swLine", "swFiber", "swHook", "swWeight"];   // colours handled as chips
let swColors = [];   // colours this swatch is used in (multi-value chip field)

function renderColorChips() {
  const wrap = $("swColorway"), input = $("swColorwayInput");
  wrap.querySelectorAll(".chip").forEach((n) => n.remove());
  for (const c of swColors) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `${esc(c)} <button type="button" class="cx" data-c="${esc(c)}" title="Remove">×</button>`;
    wrap.insertBefore(chip, input);
  }
}
function addColor(v) {
  (v || "").split(",").map((x) => x.trim()).filter(Boolean).forEach((c) => {
    if (!swColors.some((x) => x.toLowerCase() === c.toLowerCase())) swColors.push(c);
  });
  renderColorChips();
}
function removeColor(v) { swColors = swColors.filter((x) => x !== v); renderColorChips(); }
// colours in the record, including any text still sitting in the input
function gatherColors() {
  const pending = ($("swColorwayInput").value || "").trim();
  const out = [...swColors];
  if (pending && !out.some((x) => x.toLowerCase() === pending.toLowerCase())) out.push(pending);
  return out;
}
const SWATCH_INSTR = {
  ribBlo: {
    flat: `<div class="guide"><p><b>BLO rib — worked flat</b> (this is the default sideways band). Back-loop-only single crochet, turned every row, worked as a long thin strip and seamed short-end to short-end into a ring. A flat, turned swatch matches this fabric exactly.</p>
    <p class="ctag" style="margin:.4em 0"><b>New to the words?</b> The <i>back loop</i> is the far one of the two loops on top of a stitch (the front loop is the near one); working only into it leaves a stretchy ridge. A <i>turning chain</i> is the ch 1 before you turn. <i>RS/WS</i> = right side / wrong side.</p>
    <p><b>Make it (flat, turned):</b></p>
    <ul>
      <li>Ch 12–16. Row 1: sc in the 2nd ch from the hook and in each ch across.</li>
      <li>Every row after: ch 1, <b>turn</b>, then <b>sc in the back loop only</b> across.</li>
      <li>Work ~15 cm / 6 in. Because you turn every row, both faces get ridges — the reversible, stretchy rib.</li>
    </ul>
    <p class="ctag" style="margin:.4em 0"><b>Yes — stay back-loop-only even after you turn.</b> That's what makes it rib: each row's ridge lands on whichever face was toward you, so turning + BLO puts ridges on both sides. (Don't confuse this with the <b>Sc</b> tab, which says to alternate back/front loops when turning — that's a <i>different</i> goal: faking the one-sided fabric of sc worked in the round. The rib wants both faces, so here you never switch.)</p>
    <p><b>Measure it:</b> let the strip <b>rest fully relaxed</b> (rib springs back — don't stretch it). Count the <b>stitches across the short foundation edge</b> and the <b>ridged rows along the length</b>, with the width &amp; height you counted over. It's flat, so measuring is easy.</p>
    <p>Tag this <b>flat</b>. BLO rib can also be worked <i>in the round</i> (a spiral BLO band) — if that's what you'll make, switch the tag to <b>In the round</b> for the matching guidance.</p></div>`,
    round: `<div class="guide"><p><b>BLO rib — worked in the round.</b> Same back-loop-only stitch, but spiralled with the RS always facing you (a seamless BLO band). It reads differently from the flat, turned version, so swatch it the way you'll make it.</p>
    <p class="ctag" style="margin:.4em 0"><b>Why it differs from flat:</b> in the round you always work into the back loop on the RS, so every ridge lands on the same face. Turning a flat swatch flips which loop faces you, so the gauge isn't identical — hence a separate tag.</p>
    <p><b>Stretchy start — no plain chain.</b> Begin with a <b>foundation single crochet (fsc)</b> ring, not a chain, so the cast-on edge stretches with the rib.</p>
    <p><b>Make it (in the round):</b></p>
    <ul>
      <li>Work ~30 <b>fsc</b> and join into a ring without twisting.</li>
      <li>Every round: <b>sc in the back loop only</b> around; don't turn — keep spiralling, RS out, ~15 rounds.</li>
      <li><b>Alternative:</b> work flat <b>without turning</b> (cut/slide and rejoin each row so the RS always faces you) — easier to lay flat and measure, same one-sided fabric.</li>
    </ul>
    <p><b>Measuring a round band (a tube won't lie flat):</b> relax it first, then fold the tube flat, measure the <b>folded width and double it</b> for the circumference; <b>stitches around ÷ circumference</b> = stitch density. Count rounds up the height.</p>
    <p>Tag this <b>in the round</b>.</p></div>`,
  },
  ribPost: {
    round: `<div class="guide"><p><b>Post rib — worked in the round</b> (this is the “Ribbing: In the round” option). Raised vertical columns made with <i>post stitches</i>, spiralled, never turned.</p>
    <p class="ctag" style="margin:.4em 0"><b>New to the words?</b> A <i>post stitch</i> wraps around the vertical “post” (stem) of the stitch below instead of its top loops. <i>fpdc</i> = front-post dc (pulled toward you), <i>bpdc</i> = back-post (pushed away). Alternating them makes columns stand forward and back — the rib. <i>RS</i> = right side, always facing you in the round.</p>
    <p><b>Stretchy start — no plain chain.</b> Begin with a <b>foundation single crochet (fsc)</b> ring, exactly as the pattern does — it stretches with the rib where a chain wouldn't.</p>
    <p><b>Make it (in the round):</b></p>
    <ul>
      <li>Work ~24 <b>fsc</b> (an even number) and join into a ring without twisting.</li>
      <li>Rnd 1: ch 2, then <b>*fpdc in next st, bpdc in next st; repeat from * around</b>, join.</li>
      <li>Repeat ~12 rounds. RS always faces out — you never turn.</li>
      <li><b>Alternative:</b> if a tiny tube is fiddly, work the same rounds <b>flat without turning</b> (rejoin at the start each round).</li>
    </ul>
    <p><b>Measuring a round rib (a tube won't lie flat):</b> post rib pulls in hard — measure it <b>relaxed</b>. Fold the tube flat, measure the <b>folded width and double it</b> for the circumference; <b>stitches around ÷ circumference</b> = stitch density. Count rounds up the height.</p>
    <p>Tag this <b>in the round</b>.</p></div>`,
    flat: `<div class="guide"><p><b>Post rib — worked flat</b> (post-stitch columns worked back and forth, turning every row). Handy if you'd rather make the band as a flat panel and seam it.</p>
    <p class="ctag" style="margin:.4em 0"><b>The turning catch:</b> a post column has to stay raised on the RS. When you turn to a WS row, the fabric is flipped, so to keep the same column popping forward you work the <i>opposite</i> post stitch from what you see — i.e. work <b>bpdc over the columns that were fpdc</b> (and vice-versa). Miss this and the ribs zig-zag instead of running straight.</p>
    <p><b>Make it (flat, turned):</b></p>
    <ul>
      <li>Start with a <b>foundation single crochet (fsc)</b> row (stretchier than a chain), even number of sts.</li>
      <li>Row 1 (RS): ch 2, <b>*fpdc, bpdc; rep across</b>, turn.</li>
      <li>Row 2 (WS): ch 2, work each stitch as its <b>opposite</b> post stitch so the columns line up (fp where you meet a bp, bp where you meet an fp), turn. Repeat.</li>
    </ul>
    <p><b>Measure it:</b> relax it first, then count <b>stitches across</b> a width and <b>rows down</b> a height — it lies flat, so measuring is straightforward.</p>
    <p>Tag this <b>flat</b>. (The pattern's in-the-round option uses the round version — keep that as a separate swatch.)</p></div>`,
  },
  hdc: `<div class="guide"><p><b>Hdc — worked in the round</b> in the patterns (the skirt and the bag body spiral around and around, right side always facing you). Fabric worked in the round can come out a touch different from flat fabric, so for the truest fit, swatch it in the round too.</p>
    <p class="ctag" style="margin:.4em 0"><b>New to the words?</b> <i>In the round</i> = you never turn; the right side (RS, the front) always faces you. <i>Diameter</i> = straight across a circle through the middle; <i>circumference</i> = the distance all the way around = <b>π × diameter</b> (π ≈ 3.14).</p>
    <p><b>Round methods — pick one:</b></p>
    <ul>
      <li><b>Small tube (closest to the real thing):</b> ch ~30, join into a ring, and spiral hdc round and round for ~12 rounds. RS always faces out.</li>
      <li><b>Flat disc / hat-top:</b> start in a magic ring and increase each round into a flat circle. Truly in-the-round, but the increases crowd your counting — measure out in a calm mid-band, not near the centre or the edge.</li>
      <li><b>Flat, but without turning:</b> work a row, then <b>don't turn</b> — cut the yarn (or slide a long loop) and rejoin at the <i>start</i> of the row so the RS faces you again for every row. This fakes in-the-round on a flat rectangle that's easy to measure. A little fiddly, but the numbers are honest.</li>
    </ul>
    <p><b>Avoid for gauge:</b> a normal turned, back-and-forth flat swatch. It's the fastest to make, but it reads slightly differently from the round fabric — okay in a pinch, just tag it <b>flat</b> so you know.</p>
    <p><b>Measuring a round swatch (a circle won't lie flat!):</b></p>
    <ul>
      <li><b>Tube:</b> lay it flat so it folds double, measure the folded width, and <b>double it</b> — that's the circumference. Divide your stitch count for the round by that circumference to get stitches per cm/inch. Rounds are easy: count the ridges up the height.</li>
      <li><b>Flat disc:</b> you can't press a dome flat without distorting it, so measure the <b>diameter</b> across the middle, then circumference = <b>π × diameter</b>; the stitches in that round ÷ that circumference is your st density. Or just count stitches across a <b>2 in / 5 cm span you lay a ruler on</b> in a flat area and divide by that span.</li>
      <li><b>Flat-no-turn rectangle:</b> measure it like any flat swatch — count sts across a width and rows down a height.</li>
    </ul>
    <p>Rest it first, then tag it <b>in the round</b> (or <b>flat</b> if you took the shortcut).</p></div>`,
  sc: `<div class="guide"><p><b>Sc — worked in the round</b> in the patterns (the flounce, the sleeves and the hat all spiral, RS facing). Swatch it in the round the same way as hdc.</p>
    <p class="ctag" style="margin:.4em 0"><b>New to the words?</b> Each stitch has two loops on top — a <i>back loop</i> (far) and <i>front loop</i> (near). <i>RS/WS</i> = right side / wrong side. In the round the RS always faces you; flat, it flips every time you turn.</p>
    <p><b>Round methods — pick one:</b></p>
    <ul>
      <li><b>Small tube:</b> ch ~30, join, and spiral sc round and round ~15 rounds — RS always out. Closest to the real fabric.</li>
      <li><b>Flat disc:</b> magic ring, increase into a circle; measure a calm mid-band, away from the centre and edge.</li>
      <li><b>Flat, without turning:</b> work a row, don't turn, cut/slide and rejoin at the start each row so RS always faces you — an easy-to-measure rectangle that behaves like the round.</li>
    </ul>
    <p><b>Why flat ≠ round (the important bit):</b> in the round you always work into the <b>back loop on the RS</b>, so every ridge lands on the same face — a consistent one-sided texture. If you swatch flat and turn, half your rows are worked from the WS, which flips which loop faces you and the ridges stop lining up. To mimic in-the-round back-loop fabric on a flat, turned swatch, work <b>back loops on RS rows and front loops on WS rows</b>. (Our rib avoids all this by being worked sideways.)</p>
    <p><b>Measuring a round swatch (it won't lie flat):</b> for a <b>tube</b>, measure the folded-flat width and double it for the circumference; for a <b>flat disc</b>, measure the <b>diameter</b> and use circumference = <b>π × diameter</b>, or count stitches across a <b>2 in / 5 cm</b> span laid with a ruler in a flat area. Then stitches ÷ that distance = your density. Count rows/rounds up the height as usual.</p>
    <p>Rest it, then tag it <b>in the round</b> (or <b>flat</b> if you took the shortcut).</p></div>`,
};

// stretch factor along the swatch's around-axis (rows for flat rib, sts for round)
function measStretchFactor(m) {
  const wF = (m.stretchW > 0 && m.width > 0) ? m.stretchW / m.width : 0;
  const hF = (m.stretchH > 0 && m.height > 0) ? m.stretchH / m.height : 0;
  return Math.max(wF, hF);
}

function measDerivedHtml(key) {
  const m = swMeas[key]; if (!m) return "";
  const t = SW_TYPE_BY_KEY[key];
  const d = densityIn({ sts: m.sts, rows: m.rows, width: m.width, height: m.height }, swUnit);
  let s = d ? `≈ <b>${d.st}×${d.row}</b> st×row per ${swUnit}` : `<span style="opacity:.65">enter sts + width for density</span>`;
  const wF = (m.stretchW > 0 && m.width > 0) ? m.stretchW / m.width : 0;
  const hF = (m.stretchH > 0 && m.height > 0) ? m.stretchH / m.height : 0;
  const bits = [];
  if (wF > 1.001) bits.push(`+${Math.round((wF - 1) * 100)}% wide`);
  if (hF > 1.001) bits.push(`+${Math.round((hF - 1) * 100)}% tall`);
  if (bits.length) {
    s += ` · stretches <b>${bits.join(", ")}</b>`;
    if (t.stretchy) s += ` → suggests a <b>${suggestGripLabel(Math.max(wF, hF))}</b> waistband grip`;
  }
  return s;
}

function measCardHtml(key) {
  const m = swMeas[key], t = SW_TYPE_BY_KEY[key];
  const v = (x) => (x > 0 ? x : "");
  const inp = (f, step, ph) => `<input type="number" step="${step}" data-k="${key}" data-f="${f}" value="${v(m[f])}"${ph ? ` placeholder="${ph}"` : ""}>`;
  // Columns pair each count with its dimension: Sts | W , Rows | H. The stretched
  // row leaves the count cells blank (counts don't change) and puts stretched-W
  // directly under W and stretched-H under H, so each direction reads top-to-bottom.
  return `<div class="swmeas" data-k="${key}">
    <div class="swmtop"><b>${measTypeLabel(t)}</b><button class="x" data-rm="${key}" title="Remove">✕</button></div>
    <div class="gauge"><div class="gh"></div><div class="gh">Sts</div><div class="gh">W</div><div class="gh">Rows</div><div class="gh">H</div></div>
    <div class="gauge"><div class="gl">Relaxed</div>${inp("sts", "0.5")}${inp("width", "0.1")}${inp("rows", "0.5")}${inp("height", "0.1")}</div>
    <div class="gauge"><div class="gl" style="opacity:.75">Stretched</div><div></div>${inp("stretchW", "0.1", "→ W")}<div></div>${inp("stretchH", "0.1", "↓ H")}</div>
    <div class="gnote" style="margin:1px 0 4px">Optional. Stretch the swatch <b>sideways</b> to a comfortable max and note the new <b>width</b>; stretch it <b>lengthwise</b> and note the new <b>height</b>. Sts/rows don't change.${t.stretchy ? " Recommended for rib." : ""}</div>
    <div class="swderiv gnote" data-d="${key}">${measDerivedHtml(key)}</div>
    <details class="refbox" style="margin-top:8px"><summary>How to swatch this</summary>${swInstrFor(t.stitch, t.worked)}</details>
  </div>`;
}

function renderSwAddOptions() {
  const sel = $("swAddType");
  const avail = SW_TYPES.filter((t) => !swMeas[t.key]);
  sel.innerHTML = `<option value="">＋ Add a swatch measurement…</option>` +
    avail.map((t) => `<option value="${t.key}">${measTypeLabel(t)}</option>`).join("");
  sel.disabled = avail.length === 0;
}

function renderSwMeas() {
  const keys = SW_TYPES.map((t) => t.key).filter((k) => swMeas[k]);
  $("swMeas").innerHTML = keys.length ? keys.map(measCardHtml).join("")
    : `<div class="empty">No measurements yet — use “Add a swatch measurement” above.</div>`;
  renderSwAddOptions();
}

function addMeas(key) {
  if (!SW_TYPE_BY_KEY[key] || swMeas[key]) return;
  swMeas[key] = { sts: 0, rows: 0, width: 0, height: 0, stretchW: 0, stretchH: 0 };
  renderSwMeas();
}
function removeMeas(key) { delete swMeas[key]; renderSwMeas(); }

function clearSwatchForm() {
  $("swName").value = ""; $("swNotes").value = "";
  for (const id of SW_YARN) $(id).value = "";
  $("swColorwayInput").value = ""; swColors = []; renderColorChips();
  swUnit = unit; swMeas = {};
  for (const b of $("swUnitSeg").children) b.classList.toggle("on", b.dataset.unit === swUnit);
  renderSwMeas();
}

function loadSwatchForm(rec) {
  $("swName").value = rec.name || "";
  const y = rec.yarn || {};
  $("swBrand").value = y.brand || ""; $("swLine").value = y.line || ""; $("swFiber").value = y.fiber || "";
  $("swWeight").value = y.weight || ""; $("swHook").value = y.hook || "";
  // colours: array (current) or a legacy single/comma "colorway" string
  swColors = Array.isArray(y.colorways) ? [...y.colorways]
    : (y.colorway ? y.colorway.split(",").map((s) => s.trim()).filter(Boolean) : []);
  $("swColorwayInput").value = ""; renderColorChips();
  $("swNotes").value = rec.notes || "";
  swUnit = rec.unit || "cm";
  for (const b of $("swUnitSeg").children) b.classList.toggle("on", b.dataset.unit === swUnit);
  swMeas = {};
  for (const m of rec.measurements || []) {
    const key = measKey(m);
    if (!SW_TYPE_BY_KEY[key]) continue;
    swMeas[key] = { sts: m.sts || 0, rows: m.rows || 0, width: m.width || 0, height: m.height || 0, stretchW: m.stretchW || 0, stretchH: m.stretchH || 0 };
  }
  renderSwMeas();
}

function gatherSwatchRecord() {
  const measurements = SW_TYPES.filter((t) => { const m = swMeas[t.key]; return m && m.sts > 0 && m.width > 0; })
    .map((t) => {
      const m = swMeas[t.key];
      const out = { stitch: t.stitch, worked: t.worked, sts: m.sts, rows: m.rows, width: m.width, height: m.height };
      if (m.stretchW > 0) out.stretchW = m.stretchW;
      if (m.stretchH > 0) out.stretchH = m.stretchH;
      return out;
    });
  return {
    name: ($("swName").value || "").trim(),
    unit: swUnit,
    yarn: { brand: $("swBrand").value.trim(), line: $("swLine").value.trim(), fiber: $("swFiber").value.trim(), weight: $("swWeight").value.trim(), hook: $("swHook").value.trim(), colorways: gatherColors() },
    notes: ($("swNotes").value || "").trim(),
    measurements,
  };
}

function openSwatch(id, setHash = true) {
  $("homeView").hidden = true; $("studioView").hidden = true; $("swatchView").hidden = false;
  swEditId = id || null;
  const rec = id ? loadSwatches()[id] : null;
  if (rec) { loadSwatchForm(rec); $("swTitle").textContent = "Edit swatch"; }
  else { clearSwatchForm(); $("swTitle").textContent = "New gauge swatch"; }
  if (setHash) location.hash = id ? "#/swatch/" + id : "#/swatch";
}

function saveSwatchFromTool(use) {
  const rec = gatherSwatchRecord();
  if (!rec.name) rec.name = [rec.yarn.brand, rec.yarn.weight].filter(Boolean).join(" ") || "Untitled swatch";
  rec.savedAt = Date.now();
  const all = loadSwatches();
  const id = swEditId || ("s" + Date.now().toString(36));
  all[id] = rec;
  saveSwatches(all);
  populateSwatchSelect();
  if (use) { applySwatch(id); openStudio(curColl.id, curGen.id); }
  else { showHome(); $("status").textContent = `saved swatch “${rec.name}”`; }
}

function renderHomeProjects() {
  const projects = loadProjects();
  const ids = Object.keys(projects).sort((a, b) => projects[b].savedAt - projects[a].savedAt);
  if (!ids.length) { $("homeProjects").innerHTML = ""; return; }
  $("homeProjects").innerHTML = `<div class="homeproj"><h2>Your projects</h2><div class="hplist">` +
    ids.map((id) => {
      const pr = projects[id], gen = pr.state.gen || "dress";
      const found = Registry.find(pr.state.coll || "mushroom", gen);
      const emoji = found ? found.generator.emoji : "🧶";
      return `<div class="hp" data-load="${id}"><div class="hpe">${emoji}</div>
        <div class="hpn">${esc(pr.state.ui.name || "Untitled")}</div>
        <div class="hpk">${esc(found ? found.generator.label : gen)}</div>
        <button class="x" data-del="${id}" title="Delete">✕</button></div>`;
    }).join("") + `</div></div>`;
}

function render(data) {
  LAST = data;
  $("viz").innerHTML = data.svg || "";

  const w = $("warnings");
  if (data.warnings && data.warnings.length) {
    w.innerHTML = `<div class="warn"><b>⚠ Fit warnings</b><ul>` +
      data.warnings.map((x) => `<li>${esc(x)}</li>`).join("") + `</ul></div>`;
  } else { w.innerHTML = ""; }

  renderYarn(data.yarn);

  $("cards").innerHTML = data.pieces.map((p) => {
    const wide = ["spots", "sleeves", "border"].includes(p.id);
    const counts = Object.entries(p.counts)
      .filter(([k]) => k !== "sizes")
      .map(([k, v]) => `${k}: ${fmtCount(v)}`).join(" · ");
    const steps = p.steps.map(([lb, tx]) =>
      `<div class="step"><div class="lb">${esc(lb)}</div><div class="tx">${esc(tx)}</div></div>`).join("");
    const make = (p.makeCount || 1) > 1 ? ` ×${p.makeCount}` : "";
    return `<div class="card${wide ? " wide" : ""}">
      <div class="ch"><h3>${esc(p.title)}${make}</h3><div class="st">${esc(p.stitch)}</div></div>
      <div class="cb">${counterHTML(p)}<div class="counts">${esc(counts)}</div>${steps}</div>
    </div>`;
  }).join("");
  syncCounters();
}

function renderYarn(yarn) {
  const el = $("yarn");
  if (!yarn) { el.innerHTML = ""; return; }
  const u = yarn.unit;
  const unitPref = u === "in" ? "yd" : "m";
  const amount = (c) => unitPref === "yd" ? `${c.yards} yd <small>(${c.meters} m)</small>` : `${c.meters} m <small>(${c.yards} yd)</small>`;
  const cols = ["cap", "body", "spot"].filter((k) => yarn.byColor[k] && yarn.byColor[k].meters > 0).map((k) => {
    const c = yarn.byColor[k];
    return `<div class="cc"><div class="n">${esc(c.name)}</div><div class="v">${amount(c)}</div></div>`;
  }).join("");
  el.innerHTML = `<div class="yarn"><h3>Yarn estimate</h3>
    <p class="sub">Rough guide (includes +${yarn.wastePct}% for ends &amp; joins) — buy a little over.</p>
    <div class="colors">${cols}</div>
    <div class="tot">Total ≈ ${amount(yarn.total)}</div></div>`;
}

/* ---------- row counter ---------- */

function counterHTML(p) {
  if (!p.progress) return "";
  return `<div class="counter" data-piece="${p.id}">
    <button class="cbtn" data-d="-1" aria-label="previous round">−</button>
    <div class="cmid"><div class="crnd"></div><div class="ccount"></div><div class="cbar"><i></i></div></div>
    <button class="cbtn" data-d="1" aria-label="next round">＋</button>
    <button class="cbtn creset" data-reset="1">reset</button>
  </div>`;
}

const progressAll = () => { try { return JSON.parse(localStorage.getItem(LS_PROGRESS)) || {}; } catch { return {}; } };
const curProj = () => activeId || "working";

function getRound(pid) {
  const all = progressAll();
  return (all[curProj()] && all[curProj()][pid]) || 0;
}
function setRound(pid, r, total) {
  r = Math.max(0, Math.min(total, r));
  const all = progressAll();
  (all[curProj()] = all[curProj()] || {})[pid] = r;
  localStorage.setItem(LS_PROGRESS, JSON.stringify(all));
  syncCounters();
}
function countAt(prog, r) {
  let c = prog.start;
  for (const it of [...prog.incRounds].sort((a, b) => a.rnd - b.rnd)) if (it.rnd <= r) c = it.count;
  return c;
}
function pieceById(pid) { return LAST && LAST.pieces.find((p) => p.id === pid); }

function syncCounters() {
  document.querySelectorAll(".counter").forEach((el) => {
    const p = pieceById(el.dataset.piece);
    if (!p || !p.progress) return;
    const prog = p.progress, r = getRound(p.id);
    const isInc = prog.incRounds.some((it) => it.rnd === r);
    const done = r >= prog.total;
    el.classList.toggle("inc", isInc && r > 0);
    el.querySelector(".crnd").innerHTML = done
      ? `✓ done · ${prog.total} rnds`
      : `Rnd ${r} / ${prog.total}${isInc && r > 0 ? ` · <span class="cinc">increase</span>` : ""}`;
    el.querySelector(".ccount").textContent = `${countAt(prog, r)} sts`;
    el.querySelector(".cbar > i").style.width = `${Math.round(r / prog.total * 100)}%`;
    el.querySelector('[data-d="-1"]').disabled = r <= 0;
    el.querySelector('[data-d="1"]').disabled = done;
  });
}

function fmtCount(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : Math.round(v * 10) / 10;
  return v;
}

/* ---------- projects (localStorage) ---------- */

const loadProjects = () => { try { return JSON.parse(localStorage.getItem(LS_PROJECTS)) || {}; } catch { return {}; } };
const saveProjects = (p) => localStorage.setItem(LS_PROJECTS, JSON.stringify(p));

function renderProjects() {
  const projects = loadProjects();
  const ids = Object.keys(projects).sort((a, b) => projects[b].savedAt - projects[a].savedAt);
  const list = $("projList");
  if (!ids.length) { list.innerHTML = `<div class="empty">No saved projects yet — hit Save.</div>`; return; }
  list.innerHTML = ids.map((id) => {
    const pr = projects[id];
    const d = new Date(pr.savedAt);
    const when = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    return `<div class="proj${id === activeId ? " active" : ""}" data-id="${id}">
      <div><div class="pn" data-load="${id}">${esc(pr.state.ui.name || "Untitled")}</div>
      <div class="pd">${esc(when)}</div></div>
      <button class="x" data-del="${id}" title="Delete">✕</button></div>`;
  }).join("");
}

function saveCurrent() {
  const state = gather();
  state.coll = curColl.id;
  state.gen = curGen.id;
  if (!state.ui.name.trim()) state.ui.name = "Untitled";
  const projects = loadProjects();
  const id = activeId || ("p" + Date.now().toString(36));
  projects[id] = { savedAt: Date.now(), state };
  saveProjects(projects);
  activeId = id;
  renderProjects();
  $("status").textContent = `saved “${state.ui.name}”`;
}

function loadProject(id) {
  const pr = loadProjects()[id];
  if (!pr) return;
  activeId = id;
  apply(pr.state);
  renderProjects();
  openStudio(pr.state.coll || "mushroom", pr.state.gen || "dress");  // switches generator + generates
}

function deleteProject(id) {
  const projects = loadProjects();
  delete projects[id];
  saveProjects(projects);
  if (activeId === id) activeId = null;
  renderProjects();
}

/* ---------- wiring ---------- */

function scheduleGenerate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(generate, 250);
}

function wire() {
  // any input change re-computes (debounced)
  document.querySelectorAll("input, select").forEach((el) => {
    if (el.type === "button" || el.closest("#swatchView")) return;   // swatch tab drives its own preview
    el.addEventListener("input", scheduleGenerate);
    el.addEventListener("change", scheduleGenerate);
  });
  // swatch measurements: live-update state + derived readout as you type
  $("swMeas").addEventListener("input", (e) => {
    const el = e.target.closest("input[data-k]");
    if (!el) return;
    const k = el.dataset.k, f = el.dataset.f, v = parseFloat(el.value);
    if (!swMeas[k]) return;
    swMeas[k][f] = isNaN(v) ? 0 : v;
    const d = $("swMeas").querySelector(`[data-d="${k}"]`);
    if (d) d.innerHTML = measDerivedHtml(k);
  });
  $("swMeas").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) removeMeas(rm.dataset.rm);
  });
  $("swAddType").addEventListener("change", (e) => {
    if (e.target.value) { addMeas(e.target.value); e.target.value = ""; }
  });

  // colour chips — Enter or comma commits the typed colour; Backspace on empty removes the last
  $("swColorwayInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addColor(e.target.value); e.target.value = ""; }
    else if (e.key === "Backspace" && !e.target.value && swColors.length) { removeColor(swColors[swColors.length - 1]); }
  });
  $("swColorwayInput").addEventListener("blur", (e) => { addColor(e.target.value); e.target.value = ""; });
  $("swColorway").addEventListener("click", (e) => {
    const cx = e.target.closest(".cx");
    if (cx) removeColor(cx.dataset.c);
    else if (e.target.id === "swColorway") $("swColorwayInput").focus();   // click empty area to type
  });

  // unit toggle converts the numeric fields so 92cm becomes 36.2in
  for (const btn of $("unitSeg").children) {
    btn.addEventListener("click", () => {
      const next = btn.dataset.unit;
      if (next === unit) return;
      const f = next === "in" ? (v) => v / 2.54 : (v) => v * 2.54;
      for (const id of CONVERT) {
        const v = parseFloat($(id).value);
        if (!isNaN(v)) $(id).value = Math.round(f(v) * 10) / 10;
      }
      // gauge W/H live in studioGauge now (not inputs) — convert them too
      for (const g of GAUGES) for (const dim of ["width", "height"]) {
        if (studioGauge[g][dim] > 0) studioGauge[g][dim] = Math.round(f(studioGauge[g][dim]) * 10) / 10;
      }
      const ds = $("dotSizes").value.split(",").map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n)).map((n) => Math.round(f(n) * 10) / 10);
      if (ds.length) $("dotSizes").value = ds.join(", ");
      for (const b of $("unitSeg").children) b.classList.toggle("on", b.dataset.unit === next);
      unit = next;
      generate();
    });
  }

  for (const btn of $("termsSeg").children) {
    btn.addEventListener("click", () => {
      if (btn.dataset.terms === terms) return;
      terms = btn.dataset.terms;
      for (const b of $("termsSeg").children) b.classList.toggle("on", b.dataset.terms === terms);
      generate();
    });
  }

  // generator switch (buttons are built from the registry, so use delegation)
  $("typeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-gen]");
    if (!btn || btn.dataset.gen === curGen.id) return;
    const gen = curColl.generators.find((g) => g.id === btn.dataset.gen);
    setGenerator(gen);
    location.hash = "#/" + curColl.id + "/" + gen.id;
    generate();
  });

  // home gallery + back + home project list + hash routing
  $("collections").addEventListener("click", (e) => {
    const card = e.target.closest(".gcard[data-gen]");
    if (card) openStudio(card.dataset.coll, card.dataset.gen);
  });
  $("homeProjects").addEventListener("click", (e) => {
    const load = e.target.closest(".hp[data-load]");
    const del = e.target.closest(".x[data-del]");
    if (del) { deleteProject(del.dataset.del); renderHomeProjects(); e.stopPropagation(); }
    else if (load) loadProject(load.dataset.load);
  });
  $("backBtn").addEventListener("click", showHome);
  addEventListener("hashchange", route);

  // per-stitch gauge pickers — choose a saved swatch (or add one) for each stitch
  for (const stitch of GAUGES) {
    $(GAUGE_SEL[stitch]).addEventListener("change", (e) => {
      const val = e.target.value;
      const opt = e.target.selectedOptions[0];
      const label = opt ? opt.textContent : "";
      const proceed = setGaugeFromSel(stitch, val);   // false = navigated to New swatch
      if (!proceed) return;
      pendingStatus = val === "__default__" ? `${stitch}: standard gauge` : `${stitch} gauge from “${label.split(" — ")[0]}”`;
      clearTimeout(debounceTimer);
      generate();
    });
  }
  $("swatches").addEventListener("click", (e) => {
    const use = e.target.closest("[data-usesw]");
    const del = e.target.closest("[data-delsw]");
    const edit = e.target.closest("[data-editsw]");
    const dup = e.target.closest("[data-dupsw]");
    if (e.target.closest("#newSwatchBtn")) openSwatch();
    else if (e.target.closest("#swExportBtn")) exportSwatches();
    else if (e.target.closest("#swImportBtn")) $("swImportFile").click();
    else if (edit) openSwatch(edit.dataset.editsw);
    else if (dup) duplicateSwatch(dup.dataset.dupsw);
    else if (use) { applySwatch(use.dataset.usesw); openStudio(curColl.id, curGen.id); }
    else if (del) { const s = loadSwatches(); delete s[del.dataset.delsw]; saveSwatches(s); renderSwatches(); populateSwatchSelect(); }
  });
  $("swatches").addEventListener("change", (e) => {
    if (e.target.id === "swImportFile") importSwatchFile(e);
  });

  // swatch tool — unit toggle converts every measurement's lengths (W/H, stretched)
  for (const btn of $("swUnitSeg").children) {
    btn.addEventListener("click", () => {
      const next = btn.dataset.unit;
      if (next === swUnit) return;
      const f = next === "in" ? (v) => v / 2.54 : (v) => v * 2.54;
      for (const k in swMeas) for (const dim of ["width", "height", "stretchW", "stretchH"]) {
        if (swMeas[k][dim] > 0) swMeas[k][dim] = Math.round(f(swMeas[k][dim]) * 10) / 10;
      }
      for (const b of $("swUnitSeg").children) b.classList.toggle("on", b.dataset.unit === next);
      swUnit = next; renderSwMeas();
    });
  }
  $("swSaveBtn").addEventListener("click", () => saveSwatchFromTool(false));
  $("swSaveUseBtn").addEventListener("click", () => saveSwatchFromTool(true));
  $("swBackBtn").addEventListener("click", showHome);

  for (const btn of $("lenPresets").children) {
    btn.addEventListener("click", () => {
      const cm = parseFloat(btn.dataset.len);
      $("skirtLen").value = unit === "in" ? Math.round(cm / 2.54 * 10) / 10 : cm;
      generate();
    });
  }

  $("saveBtn").addEventListener("click", saveCurrent);
  $("newBtn").addEventListener("click", () => {
    activeId = null;
    apply(DEFAULT_STATE());
    renderProjects();
    generate();
    $("status").textContent = "new project";
  });
  $("dupBtn").addEventListener("click", () => {
    activeId = null;
    $("pName").value = ($("pName").value || "Untitled") + " copy";
    saveCurrent();
  });

  $("projList").addEventListener("click", (e) => {
    const load = e.target.getAttribute("data-load");
    const del = e.target.getAttribute("data-del");
    if (load) loadProject(load);
    else if (del) deleteProject(del);
  });

  // row-counter buttons (event delegation on the persistent container)
  $("cards").addEventListener("click", (e) => {
    const btn = e.target.closest(".cbtn");
    if (!btn) return;
    const wrap = btn.closest(".counter");
    const p = pieceById(wrap.dataset.piece);
    if (!p || !p.progress) return;
    if (btn.dataset.reset !== undefined) setRound(p.id, 0, p.progress.total);
    else setRound(p.id, getRound(p.id) + parseInt(btn.dataset.d, 10), p.progress.total);
  });

  // PWA install: show the button only when the browser offers installation
  let deferredPrompt = null;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $("installBtn").hidden = false;
  });
  $("installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $("installBtn").hidden = true;
  });
  addEventListener("appinstalled", () => { $("installBtn").hidden = true; });

  $("printBtn").addEventListener("click", () => {
    // The page <title> becomes the suggested PDF filename in "Save as PDF".
    const prev = document.title;
    const name = ($("pName").value.trim() || "Mushroom pattern") + " — crochet pattern";
    document.title = name;
    window.print();
    setTimeout(() => { document.title = prev; }, 800);
  });
  $("svgBtn").addEventListener("click", downloadSVG);
  $("exportBtn").addEventListener("click", exportAll);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", importFile);
}

function exportAll() {
  const bundle = {
    kind: "mushroom-dress-projects", version: 1, exportedAt: new Date().toISOString(),
    projects: loadProjects(), progress: progressAll(),
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mushroom-dress-projects.json";
  a.click();
  URL.revokeObjectURL(a.href);
  $("status").textContent = "exported projects";
}

function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const b = JSON.parse(reader.result);
      const incoming = b.projects || (b.kind ? {} : b); // accept a raw project map too
      const merged = { ...loadProjects(), ...incoming };
      saveProjects(merged);
      if (b.progress) {
        localStorage.setItem(LS_PROGRESS, JSON.stringify({ ...progressAll(), ...b.progress }));
      }
      renderProjects();
      $("status").textContent = `imported ${Object.keys(incoming).length} project(s)`;
    } catch (err) {
      $("status").textContent = "import failed: " + err.message;
    }
    $("importFile").value = "";
  };
  reader.readAsText(file);
}

function downloadSVG() {
  const svg = $("viz").innerHTML;
  if (!svg) return;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ($("pName").value.trim() || "mushroom-dress") + ".svg";
  a.click();
  URL.revokeObjectURL(a.href);
}

function fillReference() {
  const abbr = [
    ["ch", "chain"], ["sl st", "slip stitch"], ["sc", "single crochet"],
    ["hdc", "half double crochet"], ["dc", "double crochet"], ["tr", "treble"],
    ["fpdc", "front post dc"], ["bpdc", "back post dc"], ["2tog", "2 stitches together (decrease)"],
    ["fsc", "foundation sc (chainless, stretchy start)"], ["blo", "back loop only (makes ribs)"],
    ["rep", "repeat"], ["sk", "skip"], ["rnd", "round"], ["rem", "remaining"],
    ["join", "sl st to first st of round"], ["* … *", "repeat between the stars"],
  ];
  $("abbrGrid").innerHTML = abbr.map(([a, m]) => `<div><b>${a}</b> — ${m}</div>`).join("");
  const rows = [
    ["US term", "UK term"], ["sc — single crochet", "dc — double crochet"],
    ["hdc — half double", "htr — half treble"], ["dc — double crochet", "tr — treble"],
    ["tr — treble", "dtr — double treble"], ["sl st — slip stitch", "ss — slip stitch"],
  ];
  $("ukTable").innerHTML = rows.map((r, i) =>
    i === 0 ? `<tr><th>${r[0]}</th><th>${r[1]}</th></tr>` : `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`
  ).join("");
}

function DEFAULT_STATE() {
  return {
    input: {
      unit: "cm", terms: "US",
      gauges: {
        rib: { sts: 18, rows: 9, width: 10, height: 10 },
        hdc: { sts: 14, rows: 11, width: 10, height: 10 },
        sc: { sts: 16, rows: 18, width: 10, height: 10 },
      },
      body: { bust: 92, waist: 74, upperBust: 84, hip: 98, upperArm: 30, wrist: 16, skirtLen: 45, sleeveLen: 50 },
      style: { waistEase: -5, fullness: 2.0, flare: 1.8, balloon: 1.4, dotDia: 2.5, dotGap: 1.2, dotSizes: [1.5, 2.5, 3.5], ribStyle: "sideways" },
      accessory: { headCirc: 56, sideHeight: 8, brimWidth: 5, diameter: 18, height: 22, strapLen: 70 },
      colors: { cap: "cap colour", spot: "spot colour", body: "body colour" },
    },
    coll: "mushroom",
    gen: "dress",
    ui: { name: "", capCol: "#B83A2B", spotCol: "#FCF8EF", bodyCol: "#F2E4C9" },
  };
}

/* ---------- boot ---------- */

(function boot() {
  wire();
  fillReference();
  let working = null;
  try { working = JSON.parse(localStorage.getItem(LS_WORKING)); } catch { working = null; }
  if (working && working.input) apply(working);   // prime the form fields
  renderProjects();
  populateSwatchSelect();
  buildTypeSwitch(curColl);
  route();   // #/coll/gen → that studio; otherwise the home page
})();

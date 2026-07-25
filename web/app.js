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
let LAST = null;             // most recent /api/pattern response

/* ---------- field <-> state ---------- */

const GAUGES = ["rib", "hdc", "sc"];
const GFIELDS = { Sts: "sts", Rows: "rows", W: "width", H: "height" };
const BODY = ["bust", "waist", "upperBust", "hip", "upperArm", "wrist", "skirtLen", "sleeveLen"];
const ACC = { headCirc: "headCirc", sideHeight: "sideHeight", brimWidth: "brimWidth", diameter: "diameter", bagHeight: "height", strapLen: "strapLen" };
// measurement fields that must be numerically converted when the unit changes
const CONVERT = [...BODY, "ribW", "ribH", "hdcW", "hdcH", "scW", "scH", ...Object.keys(ACC)];

function gather() {
  const num = (id) => parseFloat($(id).value);
  const gauges = {};
  for (const g of GAUGES) {
    gauges[g] = {
      sts: num(g + "Sts"), rows: num(g + "Rows"),
      width: num(g + "W"), height: num(g + "H"),
    };
  }
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
    $(g + "Sts").value = input.gauges[g].sts;
    $(g + "Rows").value = input.gauges[g].rows;
    $(g + "W").value = input.gauges[g].width;
    $(g + "H").value = input.gauges[g].height;
  }
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
    $("status").textContent = "updated";
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

const loadSwatches = () => { try { return JSON.parse(localStorage.getItem(LS_SWATCHES)) || {}; } catch { return {}; } };
const saveSwatches = (s) => localStorage.setItem(LS_SWATCHES, JSON.stringify(s));

function gatherGauges() {
  const num = (id) => parseFloat($(id).value);
  const g = {};
  for (const k of GAUGES) g[k] = { sts: num(k + "Sts"), rows: num(k + "Rows"), width: num(k + "W"), height: num(k + "H") };
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
    const g = { sts: parseFloat($(k + "Sts").value), rows: parseFloat($(k + "Rows").value), width: parseFloat($(k + "W").value), height: parseFloat($(k + "H").value) };
    const d = densityIn(g, unit);
    return d ? `<b>${k}</b> ${d.st}×${d.row}` : "";
  }).filter(Boolean).join(" · ");
  $("gaugeDerived").innerHTML = parts ? `≈ ${parts} <span style="opacity:.7">st×row per ${unit}</span>` : "";
}

function saveCurrentSwatch() {
  const name = ($("swatchName").value || "").trim() || "Untitled swatch";
  const s = loadSwatches();
  s["s" + Date.now().toString(36)] = { name, savedAt: Date.now(), unit, gauges: gatherGauges() };
  saveSwatches(s);
  populateSwatchSelect();
  $("status").textContent = `saved swatch “${name}”`;
}

function applySwatch(id) {
  const s = loadSwatches()[id];
  if (!s) return;
  unit = s.unit || "cm";
  for (const b of $("unitSeg").children) b.classList.toggle("on", b.dataset.unit === unit);
  for (const k of GAUGES) {
    const g = s.gauges[k] || {};
    if (!(g.sts > 0 && g.width > 0)) continue;   // only apply gauges that were actually measured
    $(k + "Sts").value = g.sts; $(k + "Rows").value = g.rows;
    $(k + "W").value = g.width; $(k + "H").value = g.height;
  }
}

function populateSwatchSelect() {
  const s = loadSwatches();
  const ids = Object.keys(s).sort((a, b) => s[b].savedAt - s[a].savedAt);
  $("useSwatch").innerHTML = `<option value="">Load a saved swatch…</option>` +
    ids.map((id) => `<option value="${id}">${esc(s[id].name)}</option>`).join("");
}

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
    const dens = GAUGES.map((k) => {
      const d = densityIn(s.gauges[k], u);
      const w = (s.gauges[k] && s.gauges[k].worked) || SW_REC[k];
      const tag = d ? ` <em title="worked ${SW_WORKED_LABEL[w]}" style="font-style:normal;color:var(--ink-soft)">${w === "round" ? "↻" : "⇄"}</em>` : "";
      return `<span class="sd"><b>${k}</b>${d ? d.st + " × " + d.row : "—"}${tag}</span>`;
    }).join("");
    const y = s.yarn || {};
    const yline = [y.brand, y.line, y.weight, y.hook].filter(Boolean).join(" · ");
    return `<div class="swcard"><div class="swtop"><div class="swn">${esc(s.name)}</div><button class="x" data-delsw="${id}" title="Delete">✕</button></div>
      ${yline ? `<div class="swy">${esc(yline)}</div>` : ""}
      <div class="swd">${dens}</div>
      <div class="swm">st × row per ${u}, from your sts÷width &amp; rows÷height</div>
      <div class="btnrow" style="margin-top:0"><button class="btn ghost sm" data-usesw="${id}">Use in studio →</button><button class="btn ghost sm" data-editsw="${id}">Edit</button></div></div>`;
  }).join("") : `<div class="empty">No swatches yet — make one in the swatch tool, or hit “Save swatch” in the studio.</div>`;
  $("swatches").innerHTML = `<div class="homeproj">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <h2 style="margin:0">Gauge swatches</h2>
      <button class="btn sm" id="newSwatchBtn">＋ New swatch</button>
    </div>
    <p class="ctag" style="margin:6px 0 10px">Save the gauges you measure — with the yarn you used — and reuse them across patterns. Density is stitches ÷ the distance you counted.</p>
    ${guide}<div class="swlist">${cards}</div></div>`;
}

/* ---------- swatch tool (dedicated tab) ---------- */

let swUnit = "cm", swEditId = null, curSwStitch = "rib";
const SW_REC = { rib: "flat", hdc: "round", sc: "round" };   // how each stitch is worked in the patterns
const SW_WORKED_LABEL = { flat: "flat", round: "in the round" };
let swWorked = { ...SW_REC };
const SW_GAUGE_IDS = {
  rib: ["swRibSts", "swRibRows", "swRibW", "swRibH"],
  hdc: ["swHdcSts", "swHdcRows", "swHdcW", "swHdcH"],
  sc: ["swScSts", "swScRows", "swScW", "swScH"],
};
const SW_YARN = ["swBrand", "swLine", "swFiber", "swHook", "swColorway", "swWeight"];
const SWATCH_INSTR = {
  rib: `<div class="guide"><p><b>Rib — worked sideways, flat, back-loop only.</b> This is the one part of the set that really is flat: the waistband and cuffs are a long thin strip, turned every row, then seamed short-end to short-end into a ring. So a flat, turned swatch matches the real fabric exactly — no round-vs-flat trickery needed here.</p>
    <p class="ctag" style="margin:.4em 0"><b>New to the words?</b> The <i>back loop</i> is the far one of the two loops on top of a stitch (the front loop is the near one). A <i>turning chain</i> is the ch 1 you make before turning so the edge stays the right height. <i>RS/WS</i> = right side / wrong side (front/back of the work).</p>
    <p><b>Make it (flat, turned — the correct way for rib):</b></p>
    <ul>
      <li>Ch 12–16. Row 1: sc in the 2nd ch from the hook and in each ch across.</li>
      <li>Every row after: ch 1, <b>turn</b>, then <b>sc in the back loop only</b> of each stitch across.</li>
      <li>Keep going until the strip is ~15 cm / 6 in long. It'll look like columns of raised ridges — that's the rib.</li>
    </ul>
    <p><b>Alternative flat styles:</b> some folks like <i>hdc</i> back-loop rib (taller, faster) or a <i>ch-1-turn slip-stitch</i> rib (very stretchy, dense) — either is fine to swatch the same way, turning every row. What matters is that you turn: rib is meant to be reversible, so both faces should match.</p>
    <p><b>Measure it:</b> rib springs back, so let the strip <b>rest fully relaxed</b> (don't stretch it) before measuring. Count the <b>stitches across the short foundation edge</b> and the <b>ridged rows along the length</b>, and enter each with the width &amp; height you actually counted over. Because you count along a flat strip, measuring is easy — just don't pull it taut.</p>
    <p>Tag this one <b>flat</b> below.</p></div>`,
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

function swSetStitch(st) {
  curSwStitch = st;
  for (const b of $("swStitchSeg").children) b.classList.toggle("on", b.dataset.st === st);
  $("swInstr").innerHTML = SWATCH_INSTR[st];
  for (const b of $("swWorkedSeg").children) b.classList.toggle("on", b.dataset.w === swWorked[st]);
  updateSwWorkedNote();
}

function updateSwWorkedNote() {
  const st = curSwStitch, w = swWorked[st], rec = SW_REC[st];
  $("swWorkedNote").innerHTML = w === rec
    ? `✓ Matches how <b>${st}</b> is worked in the patterns (${SW_WORKED_LABEL[rec]}).`
    : `⚠ <b>${st}</b> is worked <b>${SW_WORKED_LABEL[rec]}</b> in the patterns — a swatch worked ${SW_WORKED_LABEL[w]} can read slightly off. Best to swatch it ${SW_WORKED_LABEL[rec]}.`;
}

function updateSwDerived() {
  const parts = GAUGES.map((k) => {
    const [s, r, w, h] = SW_GAUGE_IDS[k];
    const g = { sts: parseFloat($(s).value), rows: parseFloat($(r).value), width: parseFloat($(w).value), height: parseFloat($(h).value) };
    const d = densityIn(g, swUnit);
    return d ? `<b>${k}</b> ${d.st}×${d.row}` : "";
  }).filter(Boolean).join(" · ");
  $("swDerived").innerHTML = parts ? `≈ ${parts} <span style="opacity:.7">st×row per ${swUnit}</span>` : "";
}

function clearSwatchForm() {
  $("swName").value = "";
  for (const id of SW_YARN) $(id).value = "";
  for (const k of GAUGES) for (const id of SW_GAUGE_IDS[k]) $(id).value = "";
  swUnit = unit;
  swWorked = { ...SW_REC };
  for (const b of $("swUnitSeg").children) b.classList.toggle("on", b.dataset.unit === swUnit);
}

function loadSwatchForm(rec) {
  $("swName").value = rec.name || "";
  const y = rec.yarn || {};
  $("swBrand").value = y.brand || ""; $("swLine").value = y.line || ""; $("swFiber").value = y.fiber || "";
  $("swWeight").value = y.weight || ""; $("swHook").value = y.hook || ""; $("swColorway").value = y.colorway || "";
  swUnit = rec.unit || "cm";
  for (const b of $("swUnitSeg").children) b.classList.toggle("on", b.dataset.unit === swUnit);
  swWorked = { ...SW_REC };
  for (const k of GAUGES) {
    const g = (rec.gauges && rec.gauges[k]) || {};
    const [s, r, w, h] = SW_GAUGE_IDS[k];
    $(s).value = g.sts > 0 ? g.sts : ""; $(r).value = g.rows > 0 ? g.rows : "";
    $(w).value = g.width > 0 ? g.width : ""; $(h).value = g.height > 0 ? g.height : "";
    if (g.worked) swWorked[k] = g.worked;
  }
}

function gatherSwatchRecord() {
  const num = (id) => { const v = parseFloat($(id).value); return isNaN(v) ? 0 : v; };
  const gauges = {};
  for (const k of GAUGES) {
    const [s, r, w, h] = SW_GAUGE_IDS[k];
    gauges[k] = { sts: num(s), rows: num(r), width: num(w), height: num(h), worked: swWorked[k] };
  }
  return {
    name: ($("swName").value || "").trim(),
    unit: swUnit,
    yarn: { brand: $("swBrand").value.trim(), line: $("swLine").value.trim(), fiber: $("swFiber").value.trim(), weight: $("swWeight").value.trim(), hook: $("swHook").value.trim(), colorway: $("swColorway").value.trim() },
    gauges,
  };
}

function openSwatch(id, setHash = true) {
  $("homeView").hidden = true; $("studioView").hidden = true; $("swatchView").hidden = false;
  swEditId = id || null;
  const rec = id ? loadSwatches()[id] : null;
  if (rec) { loadSwatchForm(rec); $("swTitle").textContent = "Edit swatch"; }
  else { clearSwatchForm(); $("swTitle").textContent = "New gauge swatch"; }
  swSetStitch(curSwStitch);
  updateSwDerived();
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
  $("swatchView").addEventListener("input", updateSwDerived);

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

  // gauge swatches
  $("saveSwatchBtn").addEventListener("click", saveCurrentSwatch);
  $("useSwatch").addEventListener("change", (e) => {
    if (!e.target.value) return;
    applySwatch(e.target.value);
    e.target.value = "";
    generate();
  });
  $("swatches").addEventListener("click", (e) => {
    const use = e.target.closest("[data-usesw]");
    const del = e.target.closest("[data-delsw]");
    const edit = e.target.closest("[data-editsw]");
    if (e.target.closest("#newSwatchBtn")) openSwatch();
    else if (edit) openSwatch(edit.dataset.editsw);
    else if (use) { applySwatch(use.dataset.usesw); openStudio(curColl.id, curGen.id); }
    else if (del) { const s = loadSwatches(); delete s[del.dataset.delsw]; saveSwatches(s); renderSwatches(); populateSwatchSelect(); }
  });

  // swatch tool
  for (const b of $("swStitchSeg").children) b.addEventListener("click", () => swSetStitch(b.dataset.st));
  for (const b of $("swWorkedSeg").children) b.addEventListener("click", () => {
    swWorked[curSwStitch] = b.dataset.w;
    for (const x of $("swWorkedSeg").children) x.classList.toggle("on", x.dataset.w === b.dataset.w);
    updateSwWorkedNote();
  });
  for (const btn of $("swUnitSeg").children) {
    btn.addEventListener("click", () => {
      const next = btn.dataset.unit;
      if (next === swUnit) return;
      const f = next === "in" ? (v) => v / 2.54 : (v) => v * 2.54;
      for (const k of GAUGES) { const ids = SW_GAUGE_IDS[k]; for (const id of [ids[2], ids[3]]) { const v = parseFloat($(id).value); if (!isNaN(v)) $(id).value = Math.round(f(v) * 10) / 10; } }
      for (const b of $("swUnitSeg").children) b.classList.toggle("on", b.dataset.unit === next);
      swUnit = next; updateSwDerived();
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

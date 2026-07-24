"use strict";
/* Mushroom Dress — front-end. Talks to the Python engine over /api/pattern,
 * renders the visualization + written pattern, and persists projects in
 * localStorage (multiple named projects, saved in the browser). */

const $ = (id) => document.getElementById(id);
const LS_PROJECTS = "mushroom.projects.v1";
const LS_WORKING = "mushroom.working.v1";
const LS_PROGRESS = "mushroom.progress.v1";

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
  $("studioView").hidden = false;
  if (setHash) location.hash = "#/" + curColl.id + "/" + f.generator.id;
  generate();
}

function route() {
  const m = (location.hash || "").match(/^#\/([^/]+)\/([^/]+)/);
  if (m && Registry.find(m[1], m[2])) openStudio(m[1], m[2], false);
  else showHome();
}

function renderHome() {
  $("collections").innerHTML = Registry.collections.map((c) => `
    <div class="collection">
      <h2>${c.emoji} ${esc(c.name)}</h2>
      <p class="ctag">${esc(c.tagline)}</p>
      <div class="gallery">
        ${c.generators.map((g) => `
          <button class="gcard" data-coll="${c.id}" data-gen="${g.id}">
            <div class="gemoji">${g.emoji}</div>
            <div class="gname">${esc(g.label)}</div>
            <div class="gblurb">${esc(g.blurb)}</div>
            <div class="ggo">Open studio →</div>
          </button>`).join("")}
        <div class="gcard soon"><div class="gemoji">✨</div><div class="gname">More coming</div><div class="gblurb">New collections and patterns will appear here.</div></div>
      </div>
    </div>`).join("");
  renderHomeProjects();
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
    if (el.type === "button") return;
    el.addEventListener("input", scheduleGenerate);
    el.addEventListener("change", scheduleGenerate);
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
  buildTypeSwitch(curColl);
  route();   // #/coll/gen → that studio; otherwise the home page
})();

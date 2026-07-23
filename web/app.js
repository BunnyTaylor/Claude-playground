"use strict";
/* Mushroom Dress — front-end. Talks to the Python engine over /api/pattern,
 * renders the visualization + written pattern, and persists projects in
 * localStorage (multiple named projects, saved in the browser). */

const $ = (id) => document.getElementById(id);
const LS_PROJECTS = "mushroom.projects.v1";
const LS_WORKING = "mushroom.working.v1";

let unit = "cm";
let activeId = null;          // id of the currently-loaded saved project
let debounceTimer = null;

/* ---------- field <-> state ---------- */

const GAUGES = ["rib", "hdc", "sc"];
const GFIELDS = { Sts: "sts", Rows: "rows", W: "width", H: "height" };
const BODY = ["bust", "waist", "upperBust", "hip", "upperArm", "wrist", "skirtLen", "sleeveLen"];
// measurement fields that must be numerically converted when the unit changes
const CONVERT = [...BODY, "ribW", "ribH", "hdcW", "hdcH", "scW", "scH"];

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
  };
  // one size -> uniform tapestry bands; several -> a scattered mix
  if (sizes.length > 1) style.dotSizes = sizes;

  const colors = {
    cap: ($("capName").value || "").trim() || "cap colour",
    spot: ($("spotName").value || "").trim() || "spot colour",
    body: ($("bodyName").value || "").trim() || "body colour",
  };
  const palette = { cap: $("capCol").value, spot: $("spotCol").value, body: $("bodyCol").value };

  return {
    input: { unit, gauges, body, style, colors },
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

async function generate() {
  const { input, palette, ui } = gather();
  localStorage.setItem(LS_WORKING, JSON.stringify({ input, ui }));
  $("status").textContent = "computing…";
  try {
    const res = await fetch("/api/pattern", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, palette }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    render(data);
    $("status").textContent = "updated";
  } catch (err) {
    $("status").textContent = "error: " + err.message;
  }
}

function render(data) {
  $("viz").innerHTML = data.svg || "";

  const w = $("warnings");
  if (data.warnings && data.warnings.length) {
    w.innerHTML = `<div class="warn"><b>⚠ Fit warnings</b><ul>` +
      data.warnings.map((x) => `<li>${esc(x)}</li>`).join("") + `</ul></div>`;
  } else { w.innerHTML = ""; }

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
      <div class="cb"><div class="counts">${esc(counts)}</div>${steps}</div>
    </div>`;
  }).join("");
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
  generate();
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

  $("printBtn").addEventListener("click", () => window.print());
  $("svgBtn").addEventListener("click", downloadSVG);
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

function DEFAULT_STATE() {
  return {
    input: {
      unit: "cm",
      gauges: {
        rib: { sts: 18, rows: 9, width: 10, height: 10 },
        hdc: { sts: 14, rows: 11, width: 10, height: 10 },
        sc: { sts: 16, rows: 18, width: 10, height: 10 },
      },
      body: { bust: 92, waist: 74, upperBust: 84, hip: 98, upperArm: 30, wrist: 16, skirtLen: 45, sleeveLen: 50 },
      style: { waistEase: -5, fullness: 2.0, flare: 1.8, balloon: 1.4, dotDia: 2.5, dotGap: 1.2, dotSizes: [1.5, 2.5, 3.5] },
      colors: { cap: "cap colour", spot: "spot colour", body: "body colour" },
    },
    ui: { name: "", capCol: "#B83A2B", spotCol: "#FCF8EF", bodyCol: "#F2E4C9" },
  };
}

/* ---------- boot ---------- */

(function boot() {
  wire();
  let working = null;
  try { working = JSON.parse(localStorage.getItem(LS_WORKING)); } catch { working = null; }
  if (working && working.input) apply(working);
  renderProjects();
  generate();
})();

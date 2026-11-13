// The gallery's data model and the one HTML file that shows it. The page is static: the data is embedded as JSON and a
// small script builds the DOM, so it opens from disk with no network and no framework.
import type { Verdict } from "../check.ts";

/** A picture or clip that was made, or the reason it was not. File paths are relative to the page. */
export type Media = { readonly kind: "ok"; readonly file: string } | { readonly kind: "failed"; readonly error: string };

/** `triangles`: drawn in the timed frame (after the host's level of detail), not the declared maximum. */
export type Numbers = { readonly triangles: number; readonly draws: number; readonly compileMs: number; readonly loadMs: number; readonly msPerFrame: number };

/** `none`: the module exports no `checks`. */
export type Checks = { readonly kind: "none" } | { readonly kind: "table"; readonly rows: readonly Verdict[] } | { readonly kind: "error"; readonly error: string };

export type Entry =
  | {
      readonly kind: "scene"; readonly name: string; readonly source: string; readonly numbers: Numbers;
      readonly cameras: readonly { readonly name: string; readonly media: Media }[];
      readonly styles: readonly { readonly style: string; readonly media: Media }[];
      readonly clip: Media; readonly checks: Checks;
    }
  | { readonly kind: "failed"; readonly name: string; readonly source: string; readonly error: string };

export type GalleryData = {
  readonly commit: string; readonly date: string;
  readonly styles: readonly string[];
  readonly size: { readonly width: number; readonly height: number };
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
  readonly entries: readonly Entry[];
};

const mediaFile = (m: Media): string[] => (m.kind === "ok" ? [m.file] : []);

/** Every file the page can ask for (media and source links), relative to the page. */
export function pageFiles(d: GalleryData): string[] {
  return d.entries.flatMap((e) => [e.source, ...(e.kind === "failed" ? [] : [...e.cameras.flatMap((c) => mediaFile(c.media)), ...e.styles.flatMap((s) => mediaFile(s.media)), ...mediaFile(e.clip)])]);
}

export function renderPage(d: GalleryData): string {
  // "<" is escaped so error text containing "</script>" cannot end the data block.
  const json = JSON.stringify(d).replace(/</g, "\\u003c");
  return PAGE.replace("__TITLE__", `Loft gallery ${d.commit}`).replace("__DATA__", () => json);
}

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
:root { --bg:#0e0f12; --panel:#16181d; --line:#262a31; --fg:#d9dce2; --dim:#8b909a; --accent:#8fb4ff; --bad:#ff8a80; --good:#8fd694; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position:sticky; top:0; z-index:5; background:rgba(14,15,18,.94); backdrop-filter:blur(6px); border-bottom:1px solid var(--line); padding:10px 16px; display:flex; flex-wrap:wrap; gap:10px 18px; align-items:center; }
header h1 { font-size:15px; margin:0; font-weight:600; letter-spacing:.02em; }
header .meta { color:var(--dim); font-size:12px; }
.styles { display:flex; flex-wrap:wrap; gap:4px; }
button, input { font:inherit; color:inherit; }
.styles button, .pp { background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:3px 10px; cursor:pointer; }
.styles button[aria-pressed=true] { border-color:var(--accent); color:var(--accent); }
input[type=search] { background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:4px 10px; min-width:160px; flex:1 1 160px; max-width:280px; }
main { padding:16px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap:14px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; text-align:left; padding:0; cursor:pointer; display:block; width:100%; }
.card:focus-visible, .card.sel { outline:2px solid var(--accent); outline-offset:1px; }
.card .shot { aspect-ratio:var(--ar, 8/5); background:#000; display:block; width:100%; object-fit:cover; }
.card .noshot { aspect-ratio:var(--ar, 8/5); display:flex; align-items:center; justify-content:center; color:var(--bad); font-size:12px; padding:10px; text-align:center; background:#1b1213; overflow:hidden; }
.card .row { padding:8px 12px 10px; }
.card .name { font-weight:600; }
.nums { color:var(--dim); font-size:12px; font-variant-numeric:tabular-nums; display:flex; flex-wrap:wrap; gap:2px 12px; }
.card.failed { border-color:#5a2b2b; }
.skipped { margin-top:22px; color:var(--dim); font-size:12px; }
.skipped b { color:var(--fg); font-weight:500; }
#detail { position:fixed; inset:0; z-index:10; background:var(--bg); overflow:auto; display:none; }
#detail.open { display:block; }
#detail .bar { position:sticky; top:0; background:rgba(14,15,18,.94); border-bottom:1px solid var(--line); padding:10px 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; z-index:2; }
#detail .bar h2 { margin:0; font-size:16px; }
#detail .bar a { color:var(--accent); text-decoration:none; font-size:12px; overflow-wrap:anywhere; }
#detail .bar .sp { flex:1; }
#detail .body { padding:16px; max-width:1500px; margin:0 auto; }
#detail h3 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); font-weight:600; margin:22px 0 8px; }
.pics { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap:12px; }
figure { margin:0; } figure img, figure video { width:100%; display:block; border-radius:6px; background:#000; border:1px solid var(--line); }
figcaption { color:var(--dim); font-size:12px; padding:4px 2px; }
.errbox { background:#1b1213; border:1px solid #5a2b2b; color:#ffb4ab; border-radius:6px; padding:10px; font:12px/1.4 ui-monospace, Menlo, monospace; white-space:pre-wrap; overflow-wrap:anywhere; max-height:50vh; overflow:auto; }
table { border-collapse:collapse; width:100%; font-size:12.5px; font-variant-numeric:tabular-nums; }
th, td { text-align:left; padding:4px 10px 4px 0; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--dim); font-weight:500; }
td.pass { color:var(--good); } td.fail { color:var(--bad); font-weight:600; }
.tablewrap { overflow-x:auto; }
@media (max-width:520px) { main { padding:10px; } header { padding:8px 10px; } #detail .body { padding:10px; } #detail .bar { padding:8px 10px; } }
</style>
</head>
<body>
<header>
  <h1>Loft gallery</h1>
  <span class="meta" id="meta"></span>
  <div class="styles" id="styles" role="group" aria-label="Style"></div>
  <input type="search" id="filter" placeholder="filter scenes" aria-label="Filter scenes">
</header>
<main><div class="grid" id="grid"></div><div class="skipped" id="skipped"></div></main>
<section id="detail" aria-label="Scene"></section>
<script type="application/json" id="data">__DATA__</script>
<script>
"use strict";
const D = JSON.parse(document.getElementById("data").textContent);
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const url = (f) => f.split("/").map(encodeURIComponent).join("/");
const OWN = "own";
let style = OWN, open = -1, selected = 0;

$("meta").textContent = "commit " + D.commit + "  " + D.date + "  " + D.size.width + "x" + D.size.height + "  " + D.entries.length + " scenes";

const mainMedia = (e) => {
  if (e.kind === "failed") return null;
  if (style === OWN) return e.cameras[0] ? e.cameras[0].media : null;
  const s = e.styles.find((x) => x.style === style);
  return s ? s.media : null;
};
const fmt = (n, d = 1) => Number(n).toFixed(d);
const numbers = (e) => e.kind === "failed" ? "failed" :
  e.numbers.triangles.toLocaleString() + " tris  " + e.numbers.draws + " draws  " + fmt(e.numbers.msPerFrame) + " ms/frame";
const timings = (e) => "compile " + fmt(e.numbers.compileMs, 0) + " ms  pipelines " + fmt(e.numbers.loadMs, 0) + " ms";
const AR = D.size.width + " / " + D.size.height;

function shot(m) {
  if (m && m.kind === "ok") return el("img", { className: "shot", src: url(m.file), loading: "lazy", alt: "" });
  return el("div", { className: "noshot", textContent: m ? "failed: " + m.error.split("\n")[0] : "no picture" });
}

function buildStyles() {
  const box = $("styles");
  box.replaceChildren();
  for (const s of [OWN, ...D.styles]) {
    const b = el("button", { textContent: s, type: "button" });
    b.setAttribute("aria-pressed", String(s === style));
    b.onclick = () => { style = s; buildStyles(); buildGrid(); };
    box.append(b);
  }
}

let visible = [];
function buildGrid() {
  const q = $("filter").value.trim().toLowerCase();
  visible = D.entries.map((e, i) => i).filter((i) => D.entries[i].name.toLowerCase().includes(q));
  selected = Math.min(selected, Math.max(0, visible.length - 1));
  const grid = $("grid");
  grid.replaceChildren(...visible.map((i, k) => {
    const e = D.entries[i];
    const c = el("button", { className: "card" + (e.kind === "failed" ? " failed" : "") + (k === selected ? " sel" : ""), type: "button" },
      e.kind === "failed" ? el("div", { className: "noshot", textContent: e.error.split("\n")[0] }) : shot(mainMedia(e)),
      el("div", { className: "row" }, el("div", { className: "name", textContent: e.name }), el("div", { className: "nums", textContent: numbers(e) })));
    c.style.setProperty("--ar", AR);
    c.onclick = () => { selected = k; showDetail(i); };
    return c;
  }));
}

function showDetail(i) {
  open = i;
  const e = D.entries[i];
  const d = $("detail");
  const bar = el("div", { className: "bar" }, el("button", { className: "pp", textContent: "Close (esc)", onclick: closeDetail }),
    el("h2", { textContent: e.name }), el("a", { href: url(e.source), textContent: e.source.replace(/^(\.\.\/)+/, "") }), el("span", { className: "sp" }),
    el("button", { className: "pp", textContent: "<", title: "previous scene", onclick: () => step(-1) }),
    el("button", { className: "pp", textContent: ">", title: "next scene", onclick: () => step(1) }));
  const body = el("div", { className: "body" });
  if (e.kind === "failed") {
    body.append(el("h3", { textContent: "Failed" }), el("pre", { className: "errbox", textContent: e.error }));
  } else {
    body.append(el("div", { className: "nums", textContent: numbers(e) + "  |  " + timings(e) }));
    body.append(el("h3", { textContent: "Cameras (scene's own style)" }), el("div", { className: "pics" }, ...e.cameras.map((c) => fig(c.media, c.name))));
    body.append(el("h3", { textContent: "Styles (first camera: " + (e.cameras[0] ? e.cameras[0].name : "-") + ")" }), el("div", { className: "pics" }, ...e.styles.map((s) => fig(s.media, s.style))));
    body.append(el("h3", { textContent: "Clip" }), clip(e.clip));
    body.append(el("h3", { textContent: "Checks" }), checks(e.checks));
  }
  d.replaceChildren(bar, body);
  d.className = "open";
  d.scrollTop = 0;
  document.body.style.overflow = "hidden";
}
function fig(m, caption) {
  const content = m.kind === "ok" ? el("a", { href: url(m.file), target: "_blank" }, el("img", { src: url(m.file), alt: caption })) : el("div", { className: "errbox", textContent: m.error });
  return el("figure", {}, content, el("figcaption", { textContent: caption }));
}
function clip(m) {
  if (m.kind !== "ok") return el("div", { className: "errbox", textContent: m.error });
  const v = el("video", { src: url(m.file), loop: true, muted: true, autoplay: true, playsInline: true });
  v.muted = true;
  const b = el("button", { className: "pp", textContent: "Pause", type: "button" });
  b.onclick = () => { if (v.paused) { v.play(); b.textContent = "Pause"; } else { v.pause(); b.textContent = "Play"; } };
  const p = v.play(); if (p) p.catch(() => { b.textContent = "Play"; });
  return el("figure", { style: "max-width:960px" }, v, el("figcaption", {}, b));
}
function checks(c) {
  switch (c.kind) {
    case "none": return el("div", { className: "nums", textContent: "This scene exports no checks." });
    case "error": return el("div", { className: "errbox", textContent: c.error });
    case "table": return el("div", { className: "tablewrap" }, el("table", {},
      el("tr", {}, ...["check", "verdict", "measured", "limit"].map((h) => el("th", { textContent: h }))),
      ...c.rows.map((r) => el("tr", {}, el("td", { textContent: r.name }), el("td", { className: r.pass ? "pass" : "fail", textContent: r.pass ? "pass" : "FAIL" }), el("td", { textContent: r.measured }), el("td", { textContent: r.limit })))));
  }
}
function closeDetail() { open = -1; $("detail").className = ""; $("detail").replaceChildren(); document.body.style.overflow = ""; focusCard(); }
function step(delta) {
  const n = visible.length;
  if (n === 0) return;
  selected = (Math.max(visible.indexOf(open), 0) + delta + n) % n;
  buildGrid();
  showDetail(visible[selected]);
}
function focusCard() { const c = $("grid").children[selected]; if (c) c.focus(); }
function move(delta) {
  const cards = [...$("grid").children];
  if (cards.length === 0) return;
  selected = Math.max(0, Math.min(cards.length - 1, selected + delta));
  cards.forEach((c, k) => c.classList.toggle("sel", k === selected));
  cards[selected].focus();
}
function columns() { const cs = [...$("grid").children]; if (cs.length === 0) return 1; const top = cs[0].offsetTop; return Math.max(1, cs.filter((c) => c.offsetTop === top).length); }

document.addEventListener("keydown", (ev) => {
  if (ev.target === $("filter")) { if (ev.key === "Escape") $("filter").blur(); return; }
  if (ev.key === "Escape") { if (open >= 0) closeDetail(); return; }
  const dir = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns() }[ev.key];
  if (dir === undefined) return;
  ev.preventDefault();
  if (open >= 0) step(dir < 0 ? -1 : 1); else move(dir);
});
$("filter").addEventListener("input", buildGrid);
$("skipped").append(...(D.skipped.length ? [el("div", { textContent: "Skipped (not scenes):" }), ...D.skipped.map((s) => el("div", {}, el("b", { textContent: s.name }), " " + s.reason))] : []));
buildStyles(); buildGrid();
</script>
</body>
</html>
`;

// The live viewer. Draws the compiled artefact into the stage's WebGPU canvas through the host's browser path.
// State that should survive a reload (camera, time, changed values, panel) lives in sessionStorage under one key; the
// page saves it on `pagehide`, which covers both a manual reload and the reload `loft dev` triggers after a rebuild.
// Build errors and the reload after a fix are owned by /live.js (src/cli/dev.ts), which does not depend on this file.
import type { Artefact, Camera, FrameStats, View } from "../src/artefact.ts";
import { orbit } from "../src/host/camera.ts";
import { COLOR_FORMAT, createHost, type GpuLoaded } from "../src/host/host.ts";
import { FALLBACK_CAMERAS } from "../src/cli/cameras.ts";
// @ts-expect-error virtual module supplied by `loft dev` (src/cli/dev.ts)
import { build, sceneName, startStyle, styleNames } from "scene:current";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const errorBox = $<HTMLPreElement>("error");
const LOOP_SECONDS = 20;
const KEY = `loft.viewer.${sceneName as string}`;
const NARROW = "(max-width: 700px)";

/** `params` holds only values the user moved away from the scene's defaults, so edits to a default in the file show up. */
/** `style`: "scene" for the scene's own, else a style's name; null until chosen here (then `loft dev --style` decides). */
type Saved = { camera: Camera | null; time: number; params: Record<string, number>; construction: boolean; playing: boolean; speed: number; collapsed: boolean | null; style: string | null };
const state: Saved = { camera: null, time: 0, params: {}, construction: false, playing: true, speed: 1, collapsed: null, style: null };

let dirty = true; // something changed since the last drawn frame
function restore() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) Object.assign(state, JSON.parse(raw) as Partial<Saved>);
  } catch { /* storage can be blocked; the viewer works without it */ }
}
/** Every state change goes through here: save it and draw a frame for it. */
function persist() {
  dirty = true;
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* see restore */ }
}
window.addEventListener("pagehide", persist);

function showError(text: string) { errorBox.textContent = text; errorBox.hidden = false; }
function clearError() { if (!errorBox.hidden) { errorBox.hidden = true; errorBox.textContent = ""; } }

const round4 = (v: number) => Number(v.toPrecision(4));
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3));

function applyPanel() {
  document.body.classList.toggle("collapsed", state.collapsed ?? window.matchMedia(NARROW).matches);
  dirty = true; // the stage changed size
}

async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); return; } catch { /* insecure context or blocked: fall back */ }
  const ta = document.createElement("textarea");
  ta.value = text; document.body.append(ta); ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("clipboard is not available");
}

async function start() {
  restore();
  applyPanel();
  $("panelToggle").onclick = () => { state.collapsed = !document.body.classList.contains("collapsed"); applyPanel(); persist(); };
  if (!("gpu" in navigator)) return showError("WebGPU is not available in this browser (navigator.gpu is missing). Use a recent Chrome or Edge.");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return showError("WebGPU is present but no adapter was returned (blocked GPU or unsupported hardware).");
  const device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", (e) => showError(`WebGPU error:\n${(e as GPUUncapturedErrorEvent).error.message}`));
  const context = canvas.getContext("webgpu")!;
  context.configure({ device, format: COLOR_FORMAT, alphaMode: "opaque" });

  let artefact: Artefact;
  let loaded: GpuLoaded;
  // ---- style: the scene recompiles in the chosen one (a style is a program, so it is a new artefact) ----
  const names = styleNames as readonly string[];
  const style = state.style !== null && (state.style === "scene" || names.includes(state.style)) ? state.style : (startStyle as string);
  const picker = $<HTMLSelectElement>("style");
  for (const n of ["scene", ...names]) picker.append(new Option(n === "scene" ? "scene's own" : n, n));
  picker.value = style;
  picker.disabled = names.length === 0; // the fixture is a compiled artefact
  picker.onchange = () => { state.style = picker.value; persist(); location.reload(); };
  try {
    artefact = await (build as (style: string) => Promise<Artefact>)(style);
    loaded = await createHost(device).load(artefact);
  } catch (e) {
    return showError(`scene failed to compile or load:\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }

  const cameras: Record<string, Camera> = { ...FALLBACK_CAMERAS, ...artefact.cameras };
  const homeCamera = cameras["three"] ?? Object.values(cameras)[0]!;
  if (!state.camera) state.camera = homeCamera;
  const defaults = new Map(artefact.params.map((p) => [p.name, p.def]));
  state.params = Object.fromEntries(Object.entries(state.params).filter(([k]) => defaults.has(k)));

  // ---- cameras and construction ----
  const camRow = $("cameras");
  for (const name of Object.keys(cameras)) {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = () => { state.camera = cameras[name]!; b.blur(); persist(); };
    camRow.append(b);
  }
  const construction = $<HTMLInputElement>("construction");
  const setConstruction = (on: boolean) => { state.construction = on; construction.checked = on; persist(); };
  construction.checked = state.construction;
  if (!artefact.draws.some((d) => d.layer === "construction")) {
    // Toggling would change nothing; say so instead of looking broken.
    construction.disabled = true;
    construction.parentElement!.title = "this scene has no construction layer";
    construction.parentElement!.classList.add("off");
  }
  construction.onchange = () => { setConstruction(construction.checked); construction.blur(); };

  // ---- one slider per param, grouped by the name's prefix before the first dot ----
  const sliders = new Map<string, { wrap: HTMLElement; input: HTMLInputElement; value: HTMLElement }>();
  const groups = new Map<string, HTMLElement>();
  for (const p of artefact.params) {
    const dot = p.name.indexOf(".");
    const group = dot < 0 ? "other" : p.name.slice(0, dot);
    const label = dot < 0 ? p.name : p.name.slice(dot + 1);
    if (!groups.has(group)) {
      const g = document.createElement("section");
      g.className = "group";
      const h = document.createElement("h3");
      h.textContent = group;
      g.append(h);
      groups.set(group, g);
      $("params").append(g);
    }
    const wrap = document.createElement("div");
    wrap.className = "param";
    wrap.title = `${p.name}  (default ${p.def}, range ${p.min} to ${p.max}); double-click to reset`;
    const name = document.createElement("span");
    name.className = "name"; name.textContent = label;
    const value = document.createElement("span");
    value.className = "value";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(p.min); input.max = String(p.max); input.step = String((p.max - p.min) / 500);
    wrap.append(name, value, input);
    groups.get(group)!.append(wrap);
    sliders.set(p.name, { wrap, input, value });
  }
  const showSlider = (name: string) => {
    const s = sliders.get(name)!;
    const v = state.params[name] ?? defaults.get(name)!;
    s.input.value = String(v);
    s.value.textContent = fmt(v);
    s.wrap.classList.toggle("changed", name in state.params);
  };
  for (const [name, s] of sliders) {
    showSlider(name);
    s.input.oninput = () => { state.params[name] = Number(s.input.value); showSlider(name); persist(); };
    s.wrap.ondblclick = () => { delete state.params[name]; showSlider(name); persist(); };
  }
  $("reset").onclick = () => { state.params = {}; for (const n of sliders.keys()) showSlider(n); persist(); };
  const copy = $<HTMLButtonElement>("copy");
  copy.onclick = async () => {
    const changed = Object.fromEntries(Object.entries(state.params).map(([k, v]) => [k, round4(v)]));
    let note = Object.keys(changed).length === 0 ? "nothing changed" : "copied";
    try { await copyText(JSON.stringify(changed, null, 2)); } catch (e) { note = e instanceof Error ? e.message : String(e); }
    copy.textContent = note;
    setTimeout(() => { copy.textContent = "copy values"; }, 1400);
  };

  // ---- time ----
  const play = $<HTMLButtonElement>("play");
  const time = $<HTMLInputElement>("time");
  const speed = $<HTMLSelectElement>("speed");
  let scrubbing = false; // while the thumb is held, the clock does not fight the pointer
  const syncPlay = () => { play.textContent = state.playing ? "pause" : "play"; };
  const setPlaying = (on: boolean) => { state.playing = on; syncPlay(); persist(); };
  const setTime = (t: number) => { state.time = ((t % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS; persist(); };
  play.onclick = () => { setPlaying(!state.playing); play.blur(); };
  time.onpointerdown = () => { scrubbing = true; };
  time.onpointerup = () => { scrubbing = false; };
  time.oninput = () => setTime(Number(time.value));
  speed.value = String(state.speed);
  speed.onchange = () => { state.speed = Number(speed.value); speed.blur(); persist(); };
  syncPlay();

  // ---- camera: drag orbits, wheel zooms ----
  let drag: { x: number; y: number } | null = null;
  canvas.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointerup = () => { drag = null; persist(); };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    // Dragging right swings the camera left around the target, so the scene appears to follow the pointer.
    state.camera = orbit(state.camera!, -(e.clientX - drag.x) * 0.006, (e.clientY - drag.y) * 0.006, 1);
    drag = { x: e.clientX, y: e.clientY };
    dirty = true;
  };
  canvas.onwheel = (e) => { e.preventDefault(); state.camera = orbit(state.camera!, 0, 0, Math.exp(e.deltaY * 0.001)); persist(); };

  // ---- keyboard ----
  // A value slider keeps its own arrow keys and the select its own; the time slider hands its arrows to us (a step of
  // 0.01 s is useless). Space is always ours, so a focused control never also fires on it.
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const ownsArrows = (e.target instanceof HTMLInputElement && e.target.type === "range" && e.target.id !== "time") || e.target instanceof HTMLSelectElement;
    const step = e.shiftKey ? 1 : 0.1;
    switch (e.key) {
      case " ": e.preventDefault(); setPlaying(!state.playing); break;
      case "r": setCameraHome(); break;
      case "c": if (!construction.disabled) setConstruction(!state.construction); break;
      case "p": $("panelToggle").click(); break;
      case "ArrowLeft": if (!ownsArrows) { e.preventDefault(); setPlaying(false); setTime(state.time - step); } break;
      case "ArrowRight": if (!ownsArrows) { e.preventDefault(); setPlaying(false); setTime(state.time + step); } break;
    }
  });
  window.addEventListener("keyup", (e) => { if (e.key === " ") e.preventDefault(); }); // a focused button would click on keyup
  const setCameraHome = () => { state.camera = homeCamera; persist(); };

  new ResizeObserver(() => { dirty = true; }).observe($("stage"));
  window.matchMedia(NARROW).addEventListener("change", applyPanel);

  // ---- frame loop: draws while playing or after any change ----
  const readout = $("readout");
  let last = performance.now();
  let windowStart = last;
  let frames = 0;
  let latest = { cpu: 0, frame: 0 };
  let drawn: FrameStats = { triangles: 0, draws: 0 };
  const tick = async (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    if (state.playing && !scrubbing) state.time = (state.time + dt * state.speed) % LOOP_SECONDS;
    if (!(state.playing || dirty)) {
      if (now - windowStart > 500) readout.textContent = readoutText("idle");
      windowStart = now; frames = 0; // frames per second is only meaningful while frames are being asked for
      requestAnimationFrame(tick);
      return;
    }
    dirty = false;
    if (!scrubbing) time.value = String(state.time);
    $("timeText").textContent = `${state.time.toFixed(2)} s`;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const view: View = { camera: state.camera!, width, height, time: state.time, params: state.params, construction: state.construction };
    const t0 = performance.now();
    try {
      drawn = await loaded.draw(view, context.getCurrentTexture());
      clearError();
    } catch (e) {
      showError(`draw failed:\n${e instanceof Error ? e.message : String(e)}`);
      return; // stop the loop: the next successful rebuild reloads the page
    }
    const cpu = performance.now() - t0;
    // The submit returns at once; the frame is finished when the queue reports it done.
    void device.queue.onSubmittedWorkDone().then(() => { latest = { cpu, frame: performance.now() - t0 }; });
    frames++;
    if (now - windowStart > 500) {
      readout.textContent = readoutText(state.playing ? `${Math.round((frames * 1000) / (now - windowStart))} fps  ${latest.frame.toFixed(1)} ms` : `paused  ${latest.frame.toFixed(1)} ms`);
      windowStart = now; frames = 0;
    }
    requestAnimationFrame(tick);
  };
  const readoutText = (head: string) =>
    `${head}\ncpu ${latest.cpu.toFixed(1)} ms\n${drawn.triangles.toLocaleString("en-US")} triangles drawn (of ${artefact.stats.maxTriangles.toLocaleString("en-US")})  ${drawn.draws} draw calls\n${canvas.width} x ${canvas.height} px @${(window.devicePixelRatio || 1).toFixed(2)}x`;
  requestAnimationFrame(tick);
}

start().catch((e) => showError(`viewer failed:\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));

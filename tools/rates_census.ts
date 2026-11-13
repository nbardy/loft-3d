// The graph census behind docs/gpu_native.md "Rates": for each program the compiler lowers (every shader function and
// every table program), how many nodes it evaluates, and how many of those are build constants, per-frame, per-copy and
// per-item; the per-frame frontier the lifting rule would move into frame-values stages, and what stays. Measured on the
// graph, not the text.
//   bun tools/rates_census.ts <scene.ts> [--programs N] [--copy]
//
// --programs N   list the N programs that evaluate the most nodes.
// --json f      write every program's row (name, rate, node counts) to f.
// --copy         also count per-copy nodes, reading these shader arguments as per copy (an estimate: functions do not
//                state their arguments' rates): i (a surface's vertex function, a glow), p_copy, copy_id, copy_level,
//                cell_id.
import { resolve } from "node:path";
import { compileScene } from "../src/compile/index.ts";
import { plan, rates, LIFT_MIN, type Program, type Rate } from "../src/compile/rates.ts";
import { children, everything, leaves, type Expr } from "../src/expr.ts";
import type { Scene } from "../src/scene.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const k = args.indexOf(name); return k < 0 ? undefined : args.splice(k, 2)[1]; };
const top = Number(flag("--programs") ?? 0);
const copyMode = args.includes("--copy");
const jsonOut = flag("--json");
const path = args.filter((a) => !a.startsWith("--"))[0]!;
const scene = ((await import(resolve(path))) as { default: Scene }).default;
const compiled = compileScene(scene);
// Phase 1's `<name>_common` tables are its own lowering of the runs recorded here: left out, so the census is of the
// graph as authored.
const groups = compiled.programs.map((g) => g.filter((p) => !/_common_0$/.test(p.name))).filter((g) => g.length > 0);

/** A node a program emits a statement for (`emitWgsl`: everything but constants and variables). */
const emitted = (e: Expr): boolean => e.node.op !== "const" && e.node.op !== "var";

const memo = new Map<number, Rate>();
type Row = { name: string; runs: "frame" | "item"; nodes: number; build: number; frame: number; item: number; lifted: number; stays: number };
const rows: Row[] = [];
const frontier = new Map<number, Expr>();
let fetches = 0;
// As the compiler lowers: a program faster than a frame on its own (lifting by rate), and every program that runs once
// per frame together, as one group (lifting what two or more of them read).
const framePrograms = groups.flatMap((g) => g.filter((p) => p.runs === "frame"));
const lowered: (readonly Program[])[] = [...groups.flatMap((g) => g.filter((p) => p.runs === "item").map((p) => [p])), framePrograms];
for (const g of lowered) {
  const p = plan(g, memo);
  g.forEach((prog, k) => {
    const all = everything(prog.roots).filter(emitted);
    const count = (r: Rate) => all.filter((e) => p.rate.get(e.id) === r).length;
    const lifted = p.lifted[k]!;
    for (const x of lifted) frontier.set(x.id, x);
    // What stays: nodes reachable without entering a lifted value (loop bodies with their loop), less build constants
    // (folded into literals), plus a fetch (and a swizzle unless the value is a vec4) per lifted value.
    const cut = new Set(lifted.map((x) => x.id));
    const keep = new Set<number>();
    const stack: Expr[] = [...prog.roots];
    while (stack.length > 0) {
      const e = stack.pop()!;
      if (keep.has(e.id) || cut.has(e.id)) continue;
      keep.add(e.id);
      stack.push(...children(e));
      if (e.node.op === "iterate") stack.push(...e.node.loop.inner);
    }
    const stays = all.filter((e) => keep.has(e.id) && p.rate.get(e.id) !== "build").length;
    const lf = lifted.reduce((n, x) => n + (x.ty === "vec4" ? 1 : 2), 0);
    fetches += lf;
    rows.push({ name: prog.name, runs: prog.runs, nodes: all.length, build: count("build"), frame: count("frame"), item: count("item"), lifted: lifted.length, stays: stays + lf });
  });
}

// The frame-values stages: every per-frame node under a distinct frontier value, once per stage. A value that reads
// tables waits for them: its stage is one past the deepest (here, the level phase 1 scheduled each table at).
const levelOf = new Map(compiled.artefact.tables.map((t) => [t.name, t.fill.kind === "cpu" ? -1 : t.fill.level]));
const stages = new Map<number, Set<number>>();
const stage = new Set<number>();
for (const x of frontier.values()) {
  const d = leaves([x]).tables.reduce((m, t) => Math.max(m, t.role === "static" ? 0 : (levelOf.get(t.name) ?? 0) + 1), 0);
  const s = stages.get(d) ?? new Set<number>();
  stages.set(d, s);
  for (const e of everything([x])) if (emitted(e) && memo.get(e.id) !== "build") { s.add(e.id); stage.add(e.id); }
}

const sum = (f: (r: Row) => number, w?: (r: Row) => boolean) => rows.filter(w ?? (() => true)).reduce((n, r) => n + f(r), 0);
const fmt = (n: number) => n.toLocaleString("en-US");
console.log(`${path}: ${rows.length} programs (${rows.filter((r) => r.runs === "item").length} faster than a frame); LIFT_MIN ${LIFT_MIN}`);
for (const [label, w] of [["all", undefined], ["item programs", (r: Row) => r.runs === "item"], ["frame programs", (r: Row) => r.runs === "frame"]] as const) {
  console.log(`  ${label.padEnd(15)} nodes ${fmt(sum((r) => r.nodes, w))}: build ${fmt(sum((r) => r.build, w))}, frame ${fmt(sum((r) => r.frame, w))}, item ${fmt(sum((r) => r.item, w))}; lifted values ${fmt(sum((r) => r.lifted, w))}; nodes after ${fmt(sum((r) => r.stays, w))}`);
}
console.log(`  distinct frontier values ${fmt(frontier.size)}; frame-values stage nodes ${fmt(stage.size)} (by stage: ${[...stages].sort((a, b) => a[0] - b[0]).map(([d, s]) => `${d}: ${fmt(s.size)}`).join(", ")}); fetch nodes added ${fmt(fetches)}`);
console.log(`  nodes emitted after: programs ${fmt(sum((r) => r.stays))} + frame stage ${fmt(stage.size)} = ${fmt(sum((r) => r.stays) + stage.size)} (before ${fmt(sum((r) => r.nodes))})`);
if (top > 0) {
  for (const r of [...rows].sort((a, b) => b.nodes - a.nodes).slice(0, top)) {
    console.log(`    ${r.name.padEnd(44)} ${r.runs.padEnd(5)} nodes ${String(r.nodes).padStart(6)} build ${String(r.build).padStart(5)} frame ${String(r.frame).padStart(6)} item ${String(r.item).padStart(6)} lifted ${String(r.lifted).padStart(4)} after ${String(r.stays).padStart(6)}`);
  }
}

// Sharing across groups among the programs that run once per frame (which lifting by rate does not touch): per-frame
// nodes (that stay after lifting) reached by two or more such programs.
{
  const readers = new Map<number, number>();
  for (const g of groups) for (const prog of g) {
    if (prog.runs !== "frame") continue;
    const seen = new Set<number>();
    for (const e of everything(prog.roots)) if (emitted(e) && memo.get(e.id) === "frame" && !seen.has(e.id)) { seen.add(e.id); readers.set(e.id, (readers.get(e.id) ?? 0) + 1); }
  }
  let inst = 0, distinct = 0, shared = 0, sharedInst = 0;
  for (const n of readers.values()) { inst += n; distinct++; if (n >= 2) { shared++; sharedInst += n; } }
  console.log(`  frame programs' per-frame nodes: ${fmt(inst)} instances of ${fmt(distinct)} distinct; ${fmt(shared)} distinct read by 2+ programs (${fmt(sharedInst)} instances)`);
}

// Isomorphic programs: the same graph up to constants (and, second, up to which table or curve row it reads). Each
// repeat of a shape beyond the first is code a table of constants could drive instead.
{
  const shapes = new Map<string, number>();
  const shapeOf = (abstractLeaves: boolean) => {
    const memoS = new Map<number, number>();
    const visit = (e: Expr): number => {
      const known = memoS.get(e.id);
      if (known !== undefined) return known;
      const n = e.node;
      let key: string;
      switch (n.op) {
        case "const": key = `c${n.ty}`; break;
        case "var": key = `v${n.ty}`; break;
        case "input": case "param": key = `${n.op}${n.spec.name}`; break;
        case "row": key = `r${abstractLeaves ? "" : n.row.id}:${visit(n.x)}`; break;
        case "fetch": key = `F${abstractLeaves ? n.table.lanes : n.table.name}:${n.lane}:${visit(n.index)}`; break;
        case "iterate": key = `I${n.k}:${children(e).map(visit).join(",")}:${n.loop.next.map(visit).join(",")}`; break;
        case "lib": key = `l${n.fn.name}:${n.args.map(visit).join(",")}`; break;
        case "call": key = `f${n.fn}:${n.args.map(visit).join(",")}`; break;
        case "vec": key = `V${n.ty}:${n.args.map(visit).join(",")}`; break;
        case "get": key = `g${n.sel}:${visit(n.a)}`; break;
      }
      let id = shapes.get(key);
      if (id === undefined) shapes.set(key, (id = shapes.size));
      memoS.set(e.id, id);
      return id;
    };
    return (roots: readonly Expr[]) => roots.map(visit).join(",");
  };
  for (const abstractLeaves of [false, true]) {
    const shape = shapeOf(abstractLeaves);
    const byShape = new Map<string, { n: number; nodes: number; names: string[] }>();
    for (const g of groups) for (const prog of g) {
      const key = `${prog.runs}|${shape(prog.roots)}`;
      // After folding and lifting the repeated code is what stays (`rows`).
      const row = rows.find((r) => r.name === prog.name)!;
      const b = byShape.get(key) ?? { n: 0, nodes: row.stays, names: [] };
      b.n++; b.names.push(prog.name);
      byShape.set(key, b);
    }
    let repeats = 0, saved = 0;
    const big: string[] = [];
    for (const b of byShape.values()) if (b.n >= 2) { repeats += b.n - 1; saved += (b.n - 1) * b.nodes; if (b.nodes * (b.n - 1) > 500) big.push(`${b.names[0]} x${b.n} (${b.nodes})`); }
    console.log(`  isomorphic programs ${abstractLeaves ? "up to constants, tables and rows" : "up to constants"}: ${fmt(repeats)} repeats; nodes (after lifting) they would save ${fmt(saved)}${big.length ? `; largest: ${big.slice(0, 8).join(", ")}` : ""}`);
  }
}

// Pose stage modules after lowering, by the level phase 1 gave each table (levels move by the frame-values stages they
// now read; this is the volume of each level's tables, before and after).
{
  const byLevel = new Map<number, { before: number; after: number }>();
  for (const r of rows) {
    const table = levelOf.has(r.name) ? r.name : r.name.replace(/_\d+$/, "");
    const level = levelOf.get(table);
    if (level === undefined) continue;
    const b = byLevel.get(level) ?? { before: 0, after: 0 };
    b.before += r.nodes; b.after += r.stays;
    byLevel.set(level, b);
  }
  console.log(`  pose programs by phase-1 level, nodes before -> after: ${[...byLevel].sort((a, b) => a[0] - b[0]).map(([l, b]) => `${l}: ${fmt(b.before)} -> ${fmt(b.after)}`).join(", ")}`);
}

if (jsonOut !== undefined) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(jsonOut, JSON.stringify(rows));
}

// The sea's fragment program (`colour_sea`), by what it could be evaluated at: (a) per frame; (b) a smooth function of
// the water's point (the swell, its gradient: only sums, products, quotients, sines, square roots, normalisation),
// which a vertex could evaluate and the rasteriser interpolate within h^2 max|f''| / 8; (c) per pixel: anything that
// reads the pixel's screen position or a GPU-only function (the depth taps of the contact band, the footprint), or
// passes through a threshold (step, smoothstep, floor, fract, min, max, abs, select, clamp): an edge interpolation
// would blur or move.
if (args.includes("--sea")) {
  const SMOOTH = new Set(["add", "sub", "mul", "div", "neg", "sin", "cos", "exp", "sqrt", "normalize", "length", "dot", "cross", "distance", "mix"]);
  for (const g of groups) for (const prog of g) {
    if (!/^(colour_sea|surf_sea|sea_height|sea_gradient)$/.test(prog.name)) continue;
    const r = rates(prog.roots, new Map([...prog.vars].map(([k]) => [k, "item" as Rate])));
    const smooth = new Map<number, boolean>();
    const isSmooth = (e: Expr): boolean => {
      const known = smooth.get(e.id);
      if (known !== undefined) return known;
      const n = e.node;
      let ok: boolean;
      switch (n.op) {
        case "const": case "input": case "param": ok = true; break;
        case "var": ok = n.name !== "f_px"; break;
        case "row": case "fetch": ok = r.get(e.id) !== "item"; break;
        case "lib": ok = false; break;
        case "iterate": ok = false; break;
        case "vec": case "get": ok = children(e).every(isSmooth); break;
        case "call": ok = (r.get(e.id) !== "item" || SMOOTH.has(n.fn)) && children(e).every(isSmooth); break;
      }
      smooth.set(e.id, ok);
      return ok;
    };
    const all = everything(prog.roots).filter(emitted);
    const by = { build: 0, frame: 0, smooth: 0, pixel: 0 };
    const libs = new Map<string, number>();
    for (const e of all) {
      const rate = r.get(e.id);
      if (rate === "build") by.build++;
      else if (rate === "frame") by.frame++;
      else if (isSmooth(e)) by.smooth++;
      else by.pixel++;
      if (e.node.op === "lib") libs.set(e.node.fn.name, (libs.get(e.node.fn.name) ?? 0) + 1);
    }
    console.log(`  sea ${prog.name}: ${all.length} nodes: (build ${by.build}) (a) frame ${by.frame}, (b) smooth in the water's point ${by.smooth}, (c) per pixel ${by.pixel}; library calls ${[...libs].map(([k, v]) => `${k} x${v}`).join(", ")}`);
  }
}

if (copyMode) {
  // Per-copy work inside per-item shader programs: nodes whose slowest clock is the copy.
  const COPY = new Set(["i", "p_copy", "copy_id", "copy_level", "cell_id"]);
  let copyNodes = 0, itemNodes = 0;
  const per: string[] = [];
  for (const g of groups) for (const prog of g) {
    if (!prog.vars.size || ![...prog.vars.keys()].some((v) => COPY.has(v))) continue;
    if (prog.name.startsWith("pose") || /^_T/.test([...prog.vars.keys()][0]!)) continue;
    const vars = new Map<string, Rate>([...prog.vars].map(([k, v]) => [k, COPY.has(k) ? "copy" : v]));
    const r = rates(prog.roots, vars);
    const all = everything(prog.roots).filter(emitted);
    const c = all.filter((e) => r.get(e.id) === "copy").length;
    copyNodes += c; itemNodes += all.length;
    per.push(`${prog.name} ${c}/${all.length}`);
  }
  console.log(`  per-copy nodes in shader functions with a copy argument: ${fmt(copyNodes)} of ${fmt(itemNodes)} (${per.length} functions)`);
  // Fragment functions (paint_, colour_): nodes that read only what a vertex could hand down (u, v, the copy), not the
  // pixel's own world point, normal or screen position. Moving them to the vertex stage interpolates a non-linear
  // function, so it is an approximation; this is the upper bound of what it could save.
  const VERTEX = new Set(["u", "v", ...COPY]);
  let vNodes = 0, fNodes = 0;
  const fr: string[] = [];
  for (const g of groups) for (const prog of g) {
    if (!/^(paint|colour)_/.test(prog.name)) continue;
    const vars = new Map<string, Rate>([...prog.vars].map(([k, v]) => [k, VERTEX.has(k) ? "copy" : v]));
    const r = rates(prog.roots, vars);
    const all = everything(prog.roots).filter(emitted);
    const c = all.filter((e) => r.get(e.id) === "copy").length;
    vNodes += c; fNodes += all.length;
    if (c > 0) fr.push(`${prog.name} ${c}/${all.length}`);
  }
  console.log(`  fragment nodes that read only u, v and the copy: ${fmt(vNodes)} of ${fmt(fNodes)}${fr.length ? `: ${fr.slice(0, 30).join(", ")}` : ""}`);
  if (top > 0) console.log(`    ${per.slice(0, 40).join(", ")}`);
}
process.exit(0);

// compile(scene) -> Artefact. One pass: every drawable emits its shaders and draws through the context (slots for
// inputs, params, curve rows and per-frame tables are registered as expressions are emitted, and a table is prepared
// the first time anything reads it); then the tables are packed, the shared WGSL is assembled, each shader module gets
// the library functions `sceneWgsl` does not already hold, the draws are ordered by phase and the pose function built.

import { DETAIL_SLOTS, type Artefact, type Detail, type Draw, type FrameState, type PostPass } from "../artefact.ts";
import { compileJs, type Env, type Expr, type RowSource, type TableFrame, type TablePrep, type TableSource, type V } from "../expr.ts";
import type { Scene } from "../scene.ts";
import { Slots } from "./bind.ts";
import type { Program } from "./rates.ts";
import { PASS_OF, PHASES, type CompileContext, type DetailSpec, type DrawSpec, type PostSpec, type Shader } from "./context.ts";
import { CORE_WGSL, styleWgsl } from "./scene_wgsl.ts";
import { INK_POST, MARK_WGSL } from "../draw/ink.ts";
import { measureRest } from "../draw/grid_detail.ts";
import { cpuPoseFunction, poseFrame, poseFunction, poseProfile, Tables, bufferName, type TableLayout } from "./tables.ts";

/** CPU evaluation of expressions over a posed frame; free variables bound per call. */
export type CpuFn = (frame: TableFrame, vars?: Env["vars"]) => (V | boolean)[];

/** The artefact, and the compiler's own view of it, for checks, tests and the baker. */
export type Compiled = {
  readonly artefact: Artefact;
  /** The pose pass's frame for a state: every table as the shaders will read it. */
  frame(state: FrameState): TableFrame;
  /** Expressions on the CPU over a frame. Their leaves must already be in the artefact (anything drawn reads them). */
  cpu(roots: readonly Expr[]): CpuFn;
  /** CPU milliseconds of one frame per `cpu` table, each without the tables it read (for `loft profile`). */
  poseProfile(state: FrameState): ReadonlyMap<string, number>;
  /** A per-frame table of the artefact, by name (for raw-WGSL tables, which no expression names). */
  table(name: string): TableSource;
  /** Every program the compiler lowered (src/compile/rates.ts), by group: for tools/rates_census.ts. */
  readonly programs: readonly (readonly Program[])[];
};

/**
 * Compiles a `Scene` to an `Artefact`: the WGSL shaders, draw list, and tables a WebGPU host draws, plus the CPU
 * functions that pose the per-frame tables. Called by a host or tool, once per scene; a scene author builds the
 * `Scene` and does not need to look inside the result.
 */
export function compile(scene: Scene): Artefact {
  return compileScene(scene).artefact;
}

export function compileScene(scene: Scene): Compiled {
  // The slots and the table registry need each other: a fetched table is declared on first sight, and classifying it
  // registers the leaves of its program (or compiles the CPU expressions of a hand-written fill).
  const slots: Slots = new Slots((t) => tables.declare(t, prep), (p) => tables.lower(p));
  const rows: RowSource = { kind: "table", slot: (r) => slots.row(r) };
  const tables = new Tables({ register: (roots) => slots.register(roots), cpu: (roots) => compileJs(roots, rows), wgsl: (vars) => slots.wgsl(vars) });
  const cpu = (roots: readonly Expr[]): CpuFn => {
    slots.register(roots);
    const run = compileJs(roots, rows);
    return (frame, vars = {}) => run({ ...frame.env, vars });
  };
  const prep: TablePrep = { compile: cpu };
  const posts: PostSpec[] = [...scene.style.post];
  let screenInk = false;
  const markOut = (mark: string, inked: boolean): string => {
    switch (scene.outline) {
      case "hull": return mark;
      case "screen": screenInk ||= inked; return `loft_mark_ink(${mark}, ${inked})`;
    }
  };

  const ctx: CompileContext = {
    slots, style: scene.style, ground: scene.ground, sun: scene.sun, sunAt: scene.sunAt, things: scene.things,
    table: (t) => tables.declare(t, prep),
    post: (p) => { posts.push(p); },
    outline: scene.outline, markOut,
  };

  const modules: Record<string, Shader> = {};
  const specs: DrawSpec[] = [];
  for (const t of scene.things) {
    const e = t.draws(ctx);
    for (const [k, shader] of Object.entries(e.shaders)) {
      if (k in modules) throw new Error(`compile: two drawables emit a shader named "${k}"`);
      modules[k] = shader;
    }
    for (const d of e.draws) {
      if (d.sceneDepth === true && PASS_OF[d.phase] !== "transparent") throw new Error(`compile: draw "${d.label}" reads scene depth but its phase "${d.phase}" is opaque`);
      if (!(d.shader in modules)) throw new Error(`compile: draw "${d.label}" names the shader "${d.shader}", which no drawable emitted`);
    }
    specs.push(...e.draws);
  }
  // The ink pass runs first: it restores the plain mark in alpha for the style's own passes.
  if (screenInk) posts.unshift({ label: "ink outline", wgsl: INK_POST });
  const style = styleWgsl(slots, scene.style, scene.ground, scene.sun, scene.sunAt);
  const layout = tables.layout();
  slots.seal();
  const shared = slots.libs();
  const sceneWgsl = [layout.wgsl, CORE_WGSL, MARK_WGSL, style, ...shared.map((l) => l.wgsl)].join("\n");
  const shaders: Record<string, string> = {};
  for (const [k, m] of Object.entries(modules)) {
    const own = m.libs.filter((l) => !shared.includes(l));
    shaders[k] = [...own.map((l) => l.wgsl), m.code].join("\n");
  }
  const post: PostPass[] = posts.map((p, i) => {
    const key = `post.${i}`;
    shaders[key] = p.wgsl;
    return { label: p.label, shader: key };
  });

  const leaves = slots.tables();
  const readEnv = slots.envReader();
  const envOf = (state: FrameState): Omit<Env, "tables"> => ({ vars: {}, ...readEnv(state.inputs, state.params), curves: state.curves });

  // Stable sort by phase: within a phase, the order drawables emitted.
  // Rest: time 0, every input and param at its default (as a static `tabulate` is filled).
  const restState: FrameState = {
    time: 0, curves: leaves.curves,
    inputs: (() => { const x = new Float32Array(leaves.inputFloats); for (const s of leaves.inputs) x.set(s.def, s.slot); return x; })(),
    params: (() => { const x = new Float32Array(leaves.params.reduce((n, q) => Math.max(n, q.slot + 1), 0)); for (const q of leaves.params) x[q.slot] = q.def; return x; })(),
  };
  const restFrame = poseFrame(layout, envOf, restState).frame;
  const detailOf = detailSlots(layout.placed, (roots) => cpu(roots)(restFrame));
  const draws: Draw[] = PHASES.flatMap((phase) => specs.filter((d) => d.phase === phase)).map(({ phase, detail, ...d }) => {
    const resolved = detailOf(detail, d);
    // The shader reads its level from `loft_detail[LOFT_DETAIL_SLOT + instance]` (an override, so one module serves
    // every slot it is drawn with).
    const constants = resolved.kind === "fixed" ? d.constants : { ...d.constants, LOFT_DETAIL_SLOT: resolved.slot };
    return { ...d, constants, detail: resolved, pass: PASS_OF[phase] };
  });
  const triangles = draws.filter((d) => d.layer === "scene").reduce((n, d) => n + (d.vertices / 3) * d.instances, 0);
  const artefact: Artefact = {
    version: 1,
    clear: scene.style.clear,
    inputs: leaves.inputs,
    inputFloats: leaves.inputFloats,
    params: leaves.params,
    curves: leaves.curves,
    dynamic: layout.dynamic,
    ...(layout.statics.length > 0 ? { statics: layout.statics } : {}),
    sceneWgsl,
    shaders,
    draws,
    ...(post.length > 0 ? { post } : {}),
    stages: layout.stages,
    tables: layout.info,
    cpuPose: cpuPoseFunction(layout, envOf),
    pose: poseFunction(layout, envOf),
    cameras: scene.cameras,
    loop: scene.loop,
    stats: { maxTriangles: triangles, draws: draws.length, curveRows: leaves.rows, stations: layout.stations },
  };
  const byName = new Map([...layout.placed.keys()].map((t) => [t.name, t]));
  const table = (name: string): TableSource => {
    const t = byName.get(name);
    if (!t) throw new Error(`compile: no table named "${name}" (tables: ${[...byName.keys()].join(", ")})`);
    return t;
  };
  return { artefact, frame: (state) => poseFrame(layout, envOf, state).frame, poseProfile: (state) => poseProfile(layout, envOf, state), cpu, table, programs: tables.programs };
}

/**
 * Slots in `loft_detail` for each draw's level of detail, its bound table's place in the dynamic buffers, and a grid's
 * shape measured at rest (`rest` evaluates expressions in the rest frame). One choice per bound table (a surface and its
 * ink outline name the same one), one per projected spec.
 */
function detailSlots(placed: TableLayout["placed"], rest: (roots: readonly Expr[]) => (V | boolean)[]): (spec: DetailSpec, d: Pick<Draw, "label" | "instances">) => Detail {
  const slots = new Map<object, number>();
  const measured = new Map<object, ReturnType<typeof measureRest>>();
  let next = 0;
  const slotFor = (key: object, n: number, label: string): number => {
    const known = slots.get(key);
    if (known !== undefined) return known;
    if (next + n > DETAIL_SLOTS) throw new Error(`compile: draw "${label}" needs ${n} level-of-detail slots; the scene has used ${next} of ${DETAIL_SLOTS}`);
    slots.set(key, next);
    next += n;
    return next - n;
  };
  return (spec, d) => {
    switch (spec.kind) {
      case "fixed": return spec;
      case "grid": {
        const p = placed.get(spec.bound);
        if (!p) throw new Error(`compile: draw "${d.label}" states bounds in table "${spec.bound.name}", which was never declared (ctx.table)`);
        if (spec.bound.entries !== d.instances || spec.bound.lanes !== 1) throw new Error(`compile: draw "${d.label}": its bound table must have 1 lane and one entry per instance (${d.instances}), got ${spec.bound.lanes} x ${spec.bound.entries}`);
        const m = measured.get(spec.bound) ?? (() => {
          const values = rest([...spec.rest.samples, spec.rest.anchor]) as number[][];
          const r = measureRest(values.slice(0, -1), values[values.length - 1]!);
          measured.set(spec.bound, r);
          return r;
        })();
        const levels = spec.counts.map((cells) => ({ cells, vertices: 6 * cells[0] * cells[1], cell: Math.max(m.lengths[0] / cells[0], m.lengths[1] / cells[1]) }));
        return { kind: "grid", slot: slotFor(spec.bound, d.instances, d.label), bound: { buffer: bufferName(p.buffer), offset: p.offset }, radius: m.radius, levels };
      }
      case "projected": return { ...spec, slot: slotFor(spec, 2, d.label) };
    }
  };
}

/**
 * The CPU reading of tables outside any scene (tests and tools): every table they read is declared and filled from its
 * program at time 0 with every input and param at its default, curve rows as authored.
 */
export function readTablesAlone(roots: readonly TableSource[]): (t: TableSource) => Float32Array {
  const slots: Slots = new Slots((t) => tables.declare(t, prep), (p) => tables.lower(p));
  const prep: TablePrep = { compile: (r) => { slots.register(r); const run = compileJs(r); return (frame, vars = {}) => run({ ...frame.env, vars }); } };
  const tables = new Tables({ register: (r) => slots.register(r), cpu: (r) => compileJs(r), wgsl: (v) => slots.wgsl(v) });
  for (const t of roots) tables.declare(t, prep);
  const layout = tables.layout();
  const state: FrameState = { time: 0, inputs: new Float32Array(0), params: new Float32Array(0), curves: new Float32Array(0) };
  const { frame } = poseFrame(layout, () => ({ vars: {}, inputs: {}, params: {} }), state);
  return (t) => frame.table(t);
}

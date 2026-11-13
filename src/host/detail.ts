// Level of detail (`Draw.detail`, src/artefact.ts): each frame, the draw calls to issue and the `loft_detail` slots the
// shaders read. One handler per kind of detail; the host's other code only sees the resulting plan.
//
// grid: the size on screen of a grid's cells is measured at the nearest point of the instance's bounding sphere,
// where the view is largest, so a body seen end-on is never under-sampled at its near end. Hysteresis keeps a level
// while its cells stay inside a band around the target (HYSTERESIS), so a slow dolly does not flicker between two
// levels; the previous level is the only memory, kept per slot and instance by the caller.
//
// projected: the rows of the image of a plane out to a view depth. Both the plane's rows and the margin are found here,
// on the CPU, so the shader only maps a vertex index to NDC (the sea, src/geom/sea.ts).

import { CELL_PIXELS, HYSTERESIS, type Detail, type View } from "../artefact.ts";
import { cameraMatrices, type CameraMatrices } from "./camera.ts";
import type { PlanDraw } from "./manifest.ts";

export type Run = { readonly vertices: number; readonly instances: number; readonly first: number };
/** A frame's draw calls, by index into the draws planned (`Manifest.plan`, `Artefact.draws`; a hidden draw has none). */
export type Plan = readonly (readonly Run[])[];
/** The level each instance of each grid slot drew last frame (-1: not drawn, or never). */
export type Memory = Map<number, Int16Array>;

/**
 * Where each grid's instances are this frame: (anchor xyz, scale) per instance, as the pose stages wrote them to the
 * grid's bound table and the host read them back (`Detail.bound`). The pose is on the GPU (docs/gpu_native.md), so a
 * host that cannot wait for it (an interactive frame) plans with the last bounds it read, or with none yet.
 */
export type Bounds =
  /** `at(slot)`: the vec4s of the grid with that slot, one per instance. */
  | { readonly kind: "read"; readonly at: (slot: number) => Float32Array }
  /** Nothing read yet (the first interactive frame): every grid is drawn at its finest level. */
  | { readonly kind: "none" };

/** Below this many pixels across, an instance is not drawn. */
const MIN_PIXELS = 1;

type Camera = { readonly m: CameraMatrices; readonly height: number; readonly width: number; readonly fy: number };

/** Pixels per world unit at view depth w (clip w), from the projection's y scale (as `pixel_world` in WGSL). */
const pixelsPerUnit = (c: Camera, w: number): number => (c.height * c.fy) / (2 * w);

/** Clip w of a world point, and the length of the row giving it (1 perspective, 0 orthographic). */
function clipW(c: Camera, x: number, y: number, z: number): { readonly w: number; readonly perspective: number } {
  const v = c.m.viewProj;
  return { w: v[3]! * x + v[7]! * y + v[11]! * z + v[15]!, perspective: Math.hypot(v[3]!, v[7]!, v[11]!) };
}

/**
 * The level for one instance, or -1 not to draw it. `prev` is last frame's (-1 for none). `cellPx(k)` is level k's
 * largest cell on screen at the instance's nearest point.
 */
export function chooseLevel(levels: number, cellPx: (k: number) => number, pxAcross: number, target: number, prev: number): number {
  if (pxAcross < MIN_PIXELS) return -1;
  let fresh = 0;
  while (fresh + 1 < levels && cellPx(fresh + 1) <= target) fresh++;
  if (prev < 0 || prev >= levels) return fresh;
  if (cellPx(prev) > target * HYSTERESIS) return fresh;
  if (prev + 1 < levels && cellPx(prev + 1) <= target / HYSTERESIS) return fresh;
  return prev;
}

/** Every instance at the finest level: the plan when no bounds have been read (Bounds "none"). */
function finestRuns(d: Extract<Detail, { kind: "grid" }>, draw: PlanDraw, out: Float32Array): Run[] {
  const cells = d.levels[0]!.cells;
  for (let i = 0; i < draw.instances; i++) out.set([cells[0], cells[1], 0, 0], (d.slot + i) * 4);
  return [{ vertices: d.levels[0]!.vertices, instances: draw.instances, first: 0 }];
}

function gridRuns(d: Extract<Detail, { kind: "grid" }>, draw: PlanDraw, c: Camera, bounds: Bounds, target: number, memory: Memory, out: Float32Array): Run[] {
  switch (bounds.kind) {
    case "none": return finestRuns(d, draw, out);
    case "read": return chosenRuns(d, draw, c, bounds.at(d.slot), target, memory, out);
  }
}

function chosenRuns(d: Extract<Detail, { kind: "grid" }>, draw: PlanDraw, c: Camera, t: Float32Array, target: number, memory: Memory, out: Float32Array): Run[] {
  const seen = memory.get(d.slot) ?? new Int16Array(draw.instances).fill(-1);
  const chosen = new Int16Array(draw.instances);
  for (let i = 0; i < draw.instances; i++) {
    const b = i * 4;
    const { w, perspective } = clipW(c, t[b]!, t[b + 1]!, t[b + 2]!);
    const scale = Math.abs(t[b + 3]!), r = scale * d.radius;
    const behind = w + r * perspective <= c.m.near;
    // The sphere's nearest point; at the eye or nearer than the near plane the view is as large as it gets.
    const near = pixelsPerUnit(c, Math.max(w - r * perspective, c.m.near));
    const level = behind ? -1 : chooseLevel(d.levels.length, (k) => scale * d.levels[k]!.cell * near, 2 * r * pixelsPerUnit(c, Math.max(w, c.m.near)), target, seen[i]!);
    chosen[i] = level;
    if (level >= 0) {
      const cells = d.levels[level]!.cells;
      out.set([cells[0], cells[1], 0, 0], (d.slot + i) * 4);
    }
  }
  memory.set(d.slot, chosen);
  // Runs of consecutive instances at one level: one draw call each.
  const runs: Run[] = [];
  for (let i = 0; i < draw.instances;) {
    const level = chosen[i]!;
    let j = i + 1;
    while (j < draw.instances && chosen[j] === level) j++;
    if (level >= 0) runs.push({ vertices: d.levels[level]!.vertices, instances: j - i, first: i });
    i = j;
  }
  return runs;
}

/** NDC of a world point (x, y). */
function ndc(c: Camera, p: readonly [number, number, number]): readonly [number, number] {
  const v = c.m.viewProj;
  const w = v[3]! * p[0] + v[7]! * p[1] + v[11]! * p[2] + v[15]!;
  return [(v[0]! * p[0] + v[4]! * p[1] + v[8]! * p[2] + v[12]!) / w, (v[1]! * p[0] + v[5]! * p[1] + v[9]! * p[2] + v[13]!) / w];
}

/** Where the ray through NDC (x, y) meets the plane y = h, and its view depth; undefined when it does not, ahead. */
function hit(c: Camera, x: number, y: number, h: number): { readonly p: readonly [number, number, number]; readonly depth: number } | undefined {
  const m = c.m.invViewProj;
  const un = (z: number): [number, number, number] => {
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    return [(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w, (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w, (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w];
  };
  const a = un(0), b = un(1);
  const dy = b[1] - a[1];
  if (Math.abs(dy) < 1e-12) return undefined;
  const t = (h - a[1]) / dy;
  if (!(t > 0)) return undefined;
  const p: [number, number, number] = [a[0] + t * (b[0] - a[0]), h, a[2] + t * (b[2] - a[2])];
  const f = c.m.forward, e = c.m.eye;
  return { p, depth: (p[0] - e[0]) * f[0] + (p[1] - e[1]) * f[1] + (p[2] - e[2]) * f[2] };
}

/**
 * The NDC rows [y0, y1] whose rays meet the plane y = h within view depth `reach`, over [lo, hi]. For a camera without
 * roll a row has one depth, monotone in y over the rows that meet the plane, so the set is an interval with an end at
 * lo or hi; its other end is found by bisection.
 */
function planeRows(c: Camera, h: number, reach: number, lo: number, hi: number): readonly [number, number] | undefined {
  const inside = (y: number) => { const r = hit(c, 0, y, h); return r !== undefined && r.depth <= reach; };
  const edge = (a: number, b: number): number => {
    // a inside, b outside: the boundary between them.
    for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (inside(m)) a = m; else b = m; }
    return a;
  };
  const inLo = inside(lo), inHi = inside(hi);
  if (inLo && inHi) return [lo, hi];
  if (inLo) return [lo, edge(lo, hi)];
  if (inHi) return [edge(hi, lo), hi];
  return undefined;
}

function projectedRuns(d: Extract<Detail, { kind: "projected" }>, c: Camera, target: number, out: Float32Array): Run[] {
  const cellPx = d.cell * (target > 0 ? target : CELL_PIXELS);
  // The margin: how far a point of the plane at the bottom centre moves on screen when lifted by `lift` (a crest
  // rising there would otherwise uncover a strip of the screen's edge), plus a little.
  const base = hit(c, 0, -1, d.plane);
  const lifted = base === undefined ? undefined : ndc(c, [base.p[0], base.p[1] + d.lift, base.p[2]]);
  const m = 0.02 + (lifted === undefined ? 0.1 : Math.min(Math.abs(lifted[1] + 1) * 1.25, 1));
  const rows = planeRows(c, d.plane, d.reach, -1 - m, 1 + m);
  if (rows === undefined) return [];
  const nx = Math.max(1, Math.ceil(((2 + 2 * m) / 2) * c.width / cellPx));
  const ny = Math.max(1, Math.ceil(((rows[1] - rows[0]) / 2) * c.height / cellPx));
  out.set([nx, ny, rows[0], rows[1]], d.slot * 4);
  out.set([m, 0, 0, 0], (d.slot + 1) * 4);
  return [{ vertices: 6 * nx * ny, instances: 1, first: 0 }];
}

/** The frame's plan and `loft_detail` contents. `memory` carries each grid's levels from frame to frame. */
export function planFrame(draws: readonly PlanDraw[], view: View, bounds: Bounds, memory: Memory, out: Float32Array): Plan {
  const m = cameraMatrices(view.camera, view.width / view.height);
  const c: Camera = { m, width: view.width, height: view.height, fy: Math.hypot(m.viewProj[1]!, m.viewProj[5]!, m.viewProj[9]!) };
  const target = view.cellPixels ?? CELL_PIXELS;
  // A surface and its outline share a slot: the first draw to reach it chooses, the second reuses the choice.
  const chosen = new Map<number, Run[]>();
  const runsOf = (d: PlanDraw): Run[] => {
    const detail = d.detail;
    switch (detail.kind) {
      case "fixed": return [{ vertices: d.vertices, instances: d.instances, first: 0 }];
      case "grid": {
        const known = chosen.get(detail.slot);
        if (known) return known;
        const runs = gridRuns(detail, d, c, bounds, target, memory, out);
        chosen.set(detail.slot, runs);
        return runs;
      }
      case "projected": return projectedRuns(detail, c, target, out);
    }
  };
  return draws.map((d) => (d.layer === "scene" || view.construction === true ? runsOf(d) : []));
}

/** Slots `loft_detail` must hold for these draws (checked against DETAIL_SLOTS by the compiler's allocation). */
export function slotsUsed(draws: readonly PlanDraw[]): number {
  return draws.reduce((n, d) => {
    switch (d.detail.kind) {
      case "fixed": return n;
      case "grid": return Math.max(n, d.detail.slot + d.instances);
      case "projected": return Math.max(n, d.detail.slot + 2);
    }
  }, 0);
}

/** The grids among these draws: each grid slot once, with where its bounds live and how many instances it has. */
export function gridBounds(draws: readonly PlanDraw[]): { readonly slot: number; readonly buffer: string; readonly offset: number; readonly instances: number }[] {
  const seen = new Map<number, { slot: number; buffer: string; offset: number; instances: number }>();
  for (const d of draws) {
    const detail = d.detail;
    switch (detail.kind) {
      case "fixed": case "projected": break;
      case "grid": seen.set(detail.slot, { slot: detail.slot, buffer: detail.bound.buffer, offset: detail.bound.offset, instances: d.instances }); break;
    }
  }
  return [...seen.values()];
}

/** Bounds read from whole dynamic buffers (the CPU reading, `Artefact.pose`): for tools and tests. */
export function boundsFrom(draws: readonly PlanDraw[], tables: Readonly<Record<string, Float32Array>>): Bounds {
  const at = new Map(gridBounds(draws).map((g) => [g.slot, tables[g.buffer]!.subarray(g.offset * 4, (g.offset + g.instances) * 4)]));
  return { kind: "read", at: (slot) => at.get(slot)! };
}

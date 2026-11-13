// Level of detail for a drawn surface (`Detail` kind "grid", src/artefact.ts): the levels its grid may be drawn at, the
// shape measured once at rest, and the per-frame table that says where each copy is.
//
// Levels halve both cell counts from the authored grid, each axis stopping at a floor: 8 cells round a closed
// direction (an octagon: at the sizes where the floor binds, under about 9 px of radius at the default target, its
// silhouette is within 0.7 px of the circle), 2 along an open one. A halving keeps every other vertex of the finer
// level where the counts divide, so a level change moves no vertex that both levels share.
//
// The shape is measured by the compiler at rest (time 0, every input and param at its default: the same rest as a
// static `tabulate`): the surface at 5 x 5 grid points gives the longest grid line along each axis (a level's cell is
// those lengths over its counts) and the reach of the surface from its anchor point. Per frame the pose pass posts only
// where each copy is: the anchor point (the grid's centre, or a copy's origin) and the copy's scale. Measuring every
// frame cost 16 surface evaluations per drawable: the fleet's pose went from 0.45 to 3.9 ms. What this gives up: a
// surface that grows or stretches far beyond its rest shape (a wing unfolding on an input) is sized by its rest shape.

import { f, lift, listOf, mapOf, vec4, type TableProgram, type TableSource } from "../expr.ts";
import type { DetailSpec } from "../compile/context.ts";
import { sizeBound } from "../map/chart.ts";
import type { F, P3, Poses, Surface, Topology } from "../map/types.ts";

const SAMPLES = 5;
const FLOOR = { closed: 8, open: 2 } as const;

/** Cell counts at each level, finest first, from the authored counts and the topology's closed directions. */
export function gridLevels(nu: number, nv: number, topology: Topology): readonly (readonly [number, number])[] {
  const floorU = Math.min(nu, topology.u === "periodic" ? FLOOR.closed : FLOOR.open);
  const floorV = Math.min(nv, topology.v === "periodic" ? FLOOR.closed : FLOOR.open);
  const levels: (readonly [number, number])[] = [];
  let u = nu, v = nv;
  for (;;) {
    levels.push([u, v]);
    const u2 = Math.max(floorU, Math.round(u / 2)), v2 = Math.max(floorV, Math.round(v / 2));
    if (u2 === u && v2 === v) return levels;
    u = u2; v = v2;
  }
}

/** One copy, or one per point (as the drawable draws it). */
export type BoundCopies = { readonly kind: "one" } | { readonly kind: "poses"; readonly poses: Poses };

/** Where the grid's (u, v) in [0, 1] goes in the surface's coordinates, as the drawable samples it. */
export type GridAt = { readonly u: (s: F) => F; readonly v: (s: F) => F };

/** The anchor point of the measurement: the grid's centre on the surface for one copy, the origin for copies. */
function anchorOf(surface: Surface, at: GridAt, copies: BoundCopies): P3 {
  switch (copies.kind) {
    case "one": return surface.point(at.u(f(0.5)), at.v(f(0.5)));
    case "poses": return lift<"vec3">([0, 0, 0]);
  }
}

/** Per frame, per copy: (anchor point, scale). A map: one copy's closed form in its index, or the one anchor. */
export function boundTable(name: string, surface: Surface, at: GridAt, copies: BoundCopies): TableSource {
  const program = (): TableProgram => {
    switch (copies.kind) {
      case "one": return listOf([[vec4(anchorOf(surface, at, copies), 1)]]);
      // A copy scaled along each axis is sized by its longest one.
      case "poses": return mapOf(copies.poses.count, (i) => { const p = copies.poses.at(i); return [vec4(p.frame.o, sizeBound(p.size))]; });
    }
  };
  return { name: `bound_${name}`, lanes: 1, entries: copies.kind === "one" ? 1 : copies.poses.count, role: "data", program: program() };
}

/**
 * The detail a lit surface states: its bound table, its levels, and the expressions the compiler measures at rest
 * (5 x 5 points of the grid, row-major with u fastest, and the anchor).
 */
export function gridDetail(bound: TableSource, surface: Surface, at: GridAt, copies: BoundCopies, nu: number, nv: number): DetailSpec {
  const samples: P3[] = [];
  for (let j = 0; j < SAMPLES; j++) for (let i = 0; i < SAMPLES; i++) samples.push(surface.point(at.u(f(i / (SAMPLES - 1))), at.v(f(j / (SAMPLES - 1)))));
  return { kind: "grid", bound, counts: gridLevels(nu, nv, surface.topology), rest: { samples, anchor: anchorOf(surface, at, copies) } };
}

/** From the rest samples (as `gridDetail` orders them) and anchor: the longest grid line per axis, and the reach. */
export function measureRest(samples: readonly (readonly number[])[], anchor: readonly number[]): { readonly lengths: readonly [number, number]; readonly radius: number } {
  const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  let lu = 0, lv = 0;
  for (let j = 0; j < SAMPLES; j++) {
    let a = 0, b = 0;
    for (let i = 0; i + 1 < SAMPLES; i++) {
      a += dist(samples[j * SAMPLES + i]!, samples[j * SAMPLES + i + 1]!);
      b += dist(samples[i * SAMPLES + j]!, samples[(i + 1) * SAMPLES + j]!);
    }
    lu = Math.max(lu, a); lv = Math.max(lv, b);
  }
  return { lengths: [lu, lv], radius: samples.reduce((r, q) => Math.max(r, dist(q, anchor)), 0) };
}

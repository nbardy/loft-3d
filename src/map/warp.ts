// Compose in front (DESIGN.md 7.2): `warp` evaluates a shape at a mapped coordinate. On a field or a paint this is
// folding (one motif, every copy, the same cost); on a surface or a curve it reparametrises; on points it maps the
// index. There is one function per signature because the signatures are plain functions and cannot be told apart at
// run time.

import { vec2 } from "../expr.ts";
import type { Folded } from "../lib/fold.ts";
import type { Curve, F, Field, P3, Paint, Placed, Points, Surface, Warp } from "./types.ts";

/**
 * Applies a fold (a `Warp`: a map from a point to its folded point, with the cell it fell in) to something that is a
 * function of position, so that thing repeats or mirrors wherever the fold sends points onto it. One member per kind
 * of thing: `paint`, `field`, `surface`, `curve`, `points`.
 */
export const warp = {
  /** The paint at the folded coordinate: the motif repeats wherever the fold sends points onto it. */
  paint: (paint: Paint, w: Warp<"vec2">): Paint => (u, v, at) => { const x = w(vec2(u, v)).x; return paint(x.x, x.y, at); },
  /** A distance field through a fold: evaluated at the folded point and turned back into a distance by the fold. */
  field: (field: Field, w: Warp<"vec3">): Field => (p) => { const q = w(p); return q.toWorld(field(q.x)); },
  /** A surface reparametrised: the same shape, its (u, v) moved by the map (its topology is the caller's to keep). */
  surface: (s: Surface, w: Warp<"vec2">): Surface => ({
    point: (u, v) => { const x = w(vec2(u, v)).x; return s.point(x.x, x.y); },
    normal: (u, v) => { const x = w(vec2(u, v)).x; return s.normal(x.x, x.y); },
    anchor: (u, v) => { const x = w(vec2(u, v)).x; return s.anchor(x.x, x.y); },
    topology: s.topology,
    skeleton: s.skeleton,
  }),
  /** A curve reparametrised by a map of [0, 1] (to concentrate samples toward a tip, say). */
  curve: (c: Curve, w: (u: F) => F): Curve => (u) => c(w(u as F)),
  /** Points whose index is mapped (a generator: index i becomes copy w(i)). */
  points: (p: Points, count: number, w: (i: F) => F): Points => ({ count, at: (i): Placed => p.at(w(i)) }),
};

/**
 * Paint from a motif drawn in one cell of a fold: the motif sees the folded point, the cell's identity (for per-copy
 * variation) and the stretch (to turn widths in the cell into widths on the surface).
 */
export function tile(w: Warp<"vec2">, motif: (cell: Folded<"vec2">) => P3): Paint {
  return (u, v) => motif(w(vec2(u, v)));
}

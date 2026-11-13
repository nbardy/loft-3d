// Many ropes as one stroke: rigging, ratlines, stays, washing lines, cables, webs. See `ropes`.
//
// The jumps between ropes are hidden in the stroke's own grid: each rope gets `segments` cells plus three more, a
// zero-width vertex before its first point and after its last, so the cells that join one rope to the next have zero
// width at both ends (zero area: nothing is drawn there).

import { add, clamp, f, fetch, floor, lift, listOf, max, mix, mul, step, sub, vec3, vec4, type Expr, type In, type TableSource } from "../expr.ts";
import { scopedName } from "../expr.ts";
import { draw } from "../draw/index.ts";
import type { Drawable } from "../compile/context.ts";
import { pixelWorld } from "../lib/wgsl.ts";
import type { F, P3 } from "../map/types.ts";

/** One rope: from a to b, sagging by `sag` (world units, at its middle, downward; an expression, so it can tighten). */
export type Rope = { readonly a: P3; readonly b: P3; readonly sag: In<"f32"> };

export type RopesSpec = {
  /** Half-width of every rope, world units (never thinner than about half a pixel on screen). */
  readonly width: number;
  readonly colour: readonly [number, number, number];
  /** Cells along each rope. Default 6. */
  readonly segments?: number;
};

/**
 * Many ropes as one stroke, so a rig of any number of ropes is one draw call however many ropes it has.
 *
 * The shape and its law. Each rope runs from `a` to `b` and hangs below the straight line by a parabola, `sag` at its
 * middle; it is at least about half a pixel wide on screen. The end points are evaluated once per frame into a table
 * (each rope its own expressions, filled by a pose stage), and one `draw.curve` stroke runs through every rope in turn.
 *
 * Parameters: end points and sag are expressions (they can move; a rope can tighten); width, colour and segments are
 * fixed.
 *
 * What it cannot do, because of the law:
 * - hang any way but straight down, or by any curve but a parabola (a true catenary, a rope blown sideways).
 * - pass through more than two points: no rope over a pulley, round a yard, or draped over a body.
 * - vary in width or colour from rope to rope.
 *
 * Going past it: a rope is a curve, and `draw.curve(name, curve, { width, paint, segments })` draws any curve as a
 * stroke, so a rope of your own is one function of u: `through(u, points)` for a rope over several points, `catenary`
 * (in `fan.ts`) across a gap for the hanging-chain curve, a wind term added for one that streams. Many such curves are
 * one stroke by the same trick as here: zero-width cells between them.
 */
export function ropes(given: string, ropes: readonly Rope[], spec: RopesSpec): Drawable {
  const name = scopedName(given);
  if (ropes.length < 1) throw new Error(`ropes "${name}": need at least one rope`);
  const S = spec.segments ?? 6;
  if (!(Number.isInteger(S) && S >= 1)) throw new Error(`ropes "${name}": segments must be a positive integer, got ${S}`);
  const N = ropes.length, per = S + 3, cells = N * per;
  const table: TableSource = { name: `ropes_${name}`, lanes: 2, entries: N, role: "data", program: listOf(ropes.map((r) => [vec4(r.a, r.sag), vec4(r.b, 0)])) };
  // Position along the stroke in cells, the rope it falls in, and the position within that rope's cells.
  const where = (u: F): { k: F; local: F } => {
    const x = mul(u, cells);
    const k = clamp(floor(mul(add(x, 0.5), 1 / per)), 0, N - 1);
    return { k, local: sub(x, mul(k, per)) };
  };
  const curve = (uu: In<"f32">): P3 => {
    const { k, local } = where(lift<"f32">(uu));
    const r = clamp(mul(sub(local, 1), 1 / S), 0, 1);
    const a = fetch(table, k, 0), b = fetch(table, k, 1);
    const sag = mul(mul(mul(r, sub(1, r)), 4), a.w);
    return sub(mix(a.xyz, b.xyz, r), vec3(0, sag, 0));
  };
  const width = (u: F): Expr<"f32"> => {
    const { local } = where(u);
    // Full width from the first point to the last; zero on the two extra vertices round each rope.
    const on = mul(step(0.5, local), step(local, S + 1.5));
    return mul(max(f(spec.width), mul(pixelWorld(curve(u)), 0.55)), on);
  };
  const [r, g, b] = spec.colour;
  return draw.curve(name, curve, { width, paint: () => vec3(r, g, b), segments: cells });
}

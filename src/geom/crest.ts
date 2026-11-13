// A sheet standing on a line of a body (a dorsal fin, a frill, a sail on a back, a ridge of plates). See `sheetOn`.
//
// It rises along the section's outward direction, not the skin normal: near a closing tip the normal turns to face
// along the spine, and a fin standing on it became a spike shooting out of the tail.

import { abs, add, lift, mix, mul, sin, smoothstep, sub, vec3, type Expr, type In } from "../expr.ts";
import type { Curve as KeyCurve } from "../curve.ts";
import { drawSurface, spacing, type SurfaceDrawable } from "../draw/surface.ts";
import { sheet } from "../map/surface.ts";
import type { Chart, Curve, F, Paint } from "../map/types.ts";
import type { Rgb } from "./strand.ts";

type Fn1 = (x: F) => F;

export type SheetOnSpec = {
  /** The body it stands on (any chart in body coordinates (m, v, rho)). */
  readonly on: Chart;
  /** Span on the host, in m. */
  readonly from: number;
  readonly to: number;
  /** Height along the span (x in [0, 1]): a keyed curve (its `.x`), a scalar function, or a number. */
  readonly height: KeyCurve<"vec4"> | ((x: F) => F) | number;
  /** Line on the host it stands on: a v, or v as a function of x along the span (a root that winds round the body). Default 0.25, the dorsal line. */
  readonly v?: number | Fn1;
  /** Membrane colour (rays are drawn darker), or colour as a function of (x, f). */
  readonly paint: Rgb | Paint;
  /** How far the edge sags between rays, as a share of height. Default 0.3. */
  readonly sag?: number;
  /** Supporting rays. Default 12. */
  readonly rays?: number;
  /** Lean toward increasing m, as a share of height: a number, or a function of x along the span. Default 0.4. */
  readonly rake?: number | Fn1;
  /** Sideways lean of the free edge as a share of height, as a function of host m (and time). Default none. */
  readonly flutter?: Fn1;
  readonly name: string;
  /** Rows along the span. Default 96. */
  readonly rows?: number;
};

/** Cells from the root to the free edge. */
const COLS = 3;

/**
 * A sheet standing on a line of a body: a dorsal fin, a frill, a sail on a back, a row of plates seen as one membrane.
 *
 * The shape and its law. A ruled sheet (straight from root to edge) between two curves over x in [0, 1]. The root runs
 * along the host's line v from m = `from` to `to`, slightly inside the skin (rho 0.85, so no gap shows where it meets
 * the body). The free edge stands `height(x)` off it along the section's outward direction plus `rake` along the
 * spine, cut back between `rays` evenly spaced rays by sag sin^2(pi rays x), and leaning sideways by `flutter`. Its
 * coordinates are (x, f): x along the span, f from the root (0) to the edge (1). It rides the host's chart, so it
 * bends, sways and dives with the body for free.
 *
 * Parameters: `height`, `v`, `rake` and `flutter` take functions (of x; `flutter` of the host's m) and so can vary along
 * the span and move; `from`, `to`, `sag` and `rays` are fixed numbers; `paint` is a colour or a function of (x, f).
 *
 * What it cannot do, because of the law:
 * - curve between root and edge: every line from root to edge is straight, so no cupped fin, no frill that curls over.
 * - stand on anything but the body's outward direction: no fin lying along the skin, no sheet hanging below a spar.
 * - a free edge other than the scallop: rays evenly spaced, each sag the same shape (sin^2), no spines past the edge.
 * - stand on a surface that is not a chart in body coordinates (m, v, rho), or span past m in [0, 1].
 *
 * Going past it is one step down: `sheetOnEdges` below gives the root and the edge as `sheet` takes them, so
 * `sheet(root, myEdge)` keeps the root and lets you write the edge (a sawtooth, spines past the membrane, an edge that
 * flaps), drawn with `drawSurface` as this one is. Relatives:
 * - a curved sheet: write `surface((x, f) => ...)` from the host's frame at the root (`on.frame(vec3(m, v, rho))` gives
 *   its origin and axes) and bend f along any curve in that frame: a cupped fin, a frill that rolls over (an arc in
 *   the frame's y-z plane), a collar.
 * - a membrane between rays you choose: `fan`, with the rays from `rayOf` or `bent` stalks standing on the body.
 * - a sheet on two bodies: `sheet(rayOf(a), rayOf(b))`, webbing between fingers or a skin between two tails.
 * - plates instead of one membrane: `strand.instanced` along the same line, one solid per ray.
 */
export function sheetOn(spec: SheetOnSpec): SurfaceDrawable {
  const { root, edge } = sheetOnEdges(spec);
  const p = spec.paint;
  const paint: Paint = typeof p === "function" ? p : membrane(p, spec.rays ?? 12);
  return drawSurface(spec.name, sheet(root, edge), {
    paint, grid: { u: spacing.even(spec.rows ?? 96), v: spacing.even(COLS) }, sides: "two", outline: "border",
  });
}

/**
 * `sheetOn`'s root and free edge over x in [0, 1], as `sheet(root, edge)` takes them: the mechanism one step down, so
 * a sheet that stands on a body is never a dead end (see `sheetOn` for the law, its limits and its relatives). Keep the
 * root and write your own edge (a sawtooth, spines past the membrane), or keep the edge and move it; then
 * `drawSurface(name, sheet(root, edge), ...)` as `sheetOn` does.
 *
 * What it cannot do is what `sheetOn` cannot (it is the same law without the paint):
 * - curve between root and edge: `sheet` is ruled, straight from each root point to its edge point.
 * - stand anywhere but on a body's chart in coordinates (m, v, rho), with 0 <= from < to <= 1.
 */
export function sheetOnEdges(spec: Omit<SheetOnSpec, "paint" | "name" | "rows"> & { readonly name?: string }): { readonly root: Curve; readonly edge: Curve } {
  const name = spec.name ?? "sheetOn";
  if (!(spec.from >= 0 && spec.to <= 1 && spec.from < spec.to)) throw new Error(`sheetOn "${name}": need 0 <= from < to <= 1, got ${spec.from}..${spec.to}`);
  const rays = spec.rays ?? 12, sag = spec.sag ?? 0.3, rakeOf = spec.rake ?? 0.4, vOf = spec.v ?? 0.25;
  const h = spec.height;
  // A keyed curve returns a vec4 (its value is in .x); a scalar function returns its value directly.
  const height: Fn1 = typeof h === "number" ? () => lift<"f32">(h)
    : (x) => { const e = (h as (x: F) => Expr)(x); return e.ty === "vec4" ? (e as Expr<"vec4">).x : (e as F); };
  // A number stays a number in the expressions, so a sheet built from numbers is the one it always was.
  const v = (x: F): In<"f32"> => (typeof vOf === "number" ? vOf : vOf(x));
  const rake = (x: F): In<"f32"> => (typeof rakeOf === "number" ? rakeOf : rakeOf(x));
  const flutter = spec.flutter ?? (() => lift<"f32">(0));
  const hostM = (x: F): F => mix(lift<"f32">(spec.from), lift<"f32">(spec.to), x);
  const at = (x: F) => spec.on.frame(vec3(hostM(x), v(x), 0.85));
  const root: Curve = (x) => at(lift<"f32">(x)).o;
  const edge: Curve = (xx) => {
    const x = lift<"f32">(xx), g = at(x);
    const between = sin(mul(x, Math.PI * rays));
    const tall = mul(height(x), sub(1, mul(mul(between, between), sag)));
    const rise = add(g.y, mul(g.x, rake(x)));
    return add(add(g.o, mul(rise, tall)), mul(g.z, mul(flutter(hostM(x)), tall)));
  };
  return { root, edge };
}

/** The default membrane: darker toward the root, with darker rays (as in `strand_kit::crest`). */
function membrane(c: Rgb, rays: number): Paint {
  const colour = vec3(c[0], c[1], c[2]);
  return (x, f) => {
    const sheetColour = mul(colour, add(0.62, mul(f, 0.38)));
    // A ray sits wherever sin(pi rays x) crosses 0: a thin line there, the same hue darkened.
    const line = mul(sub(1, smoothstep(0.06, 0.16, abs(sin(mul(x, Math.PI * rays))))), 0.8);
    return mix(sheetColour, mul(colour, 0.4), line);
  };
}

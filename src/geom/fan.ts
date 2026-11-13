// A fan: a membrane spanned between rays (a wing, a tail fluke, a frill). Its coordinates are (u, v): u across the
// rays (ray k at u = k / (n - 1)), v along them from the root (0) to the tips (1). Between two rays the membrane is
// the ruled surface between them, bellied out of that surface by `sag` and cut back along its free edge by
// `scallop`. Both use the catenary (the hanging-cloth curve) across the gap, not a sine or a zigzag: the free edge
// between two ray tips is a catenary hanging toward the root, and the belly is a catenary across the gap. The rays
// are curves, so they may be closed-form bones or the spines of flexing bodies (`rayOf`).

import { add, div, exp, floor, length, lift, lt, max, min, mix, mul, select, sub, clamp, cross, vec3, type In } from "../expr.ts";
import { surface } from "../map/surface.ts";
import type { Chart, Curve, F, P3, Surface } from "../map/types.ts";
import { unit } from "./limb.ts";

export type FanSpec = {
  /** Root (0) to tip (1), in order across the membrane. At least two. */
  readonly rays: readonly Curve[];
  /** Belly between rays, as a share of the gap, toward the front (the side d/du x d/dv faces). Negative bellies back. */
  readonly sag: In<"f32">;
  /** Depth of the free edge between two tips, as a share of the chord between them, toward the root. */
  readonly scallop: In<"f32">;
  /** How taut the cloth hangs: the catenary's parameter. Near 0 a parabola, larger flatter in the middle. Default 2. */
  readonly slack?: number;
};

const H = 1e-3;

/**
 * The catenary across a gap, normalised: the curve a hanging cloth or chain takes, 0 at f = 0 and f = 1 and 1 at the
 * middle, (cosh(k / 2) - cosh(k (f - 1/2))) / (cosh(k / 2) - 1). `fan` uses it for the belly and the scalloped edge;
 * use it for any sag between two fixed points. `k` (positive, fixed) sets how taut: near 0 a parabola, larger flatter
 * in the middle and steeper at the ends. It cannot be lopsided: the ends are at the same height, so a chain hung
 * between points at different heights needs the catenary shifted off centre, which this does not do.
 */
export function catenary(f: F, k: number): F {
  if (!(k > 0)) throw new Error(`catenary: the parameter must be positive, got ${k}`);
  const cosh = (x: F): F => mul(add(exp(x), exp(mul(x, -1))), 0.5);
  const c = Math.cosh(k / 2);
  return div(sub(c, cosh(mul(sub(f, 0.5), k))), c - 1);
}

/** The ray value at index k (an expression) from the rays' values: a select chain, so every ray is evaluated once. */
function pick(k: F, values: readonly P3[]): P3 {
  let out = values[values.length - 1];
  for (let j = values.length - 2; j >= 0; j--) out = select(lt(k, j + 0.5), values[j], out);
  return out;
}

/**
 * A membrane spanned between rays: a wing, a tail fluke, a frill, a gill, an umbrella's cloth, a webbed foot.
 *
 * The shape and its law. Coordinates (u, v): u across the rays (ray k at u = k / (n - 1)), v along them from the root
 * (0) to the tips (1). Between two neighbouring rays the cloth is the ruled surface between them, plus two catenaries
 * across the gap (the curve a hanging cloth takes): a belly of `sag` times the gap toward the front, and a cut of
 * `scallop` times the chord between the tips toward the root, weighted by v^2 so it is whole at the free edge.
 *
 * Parameters: the rays are curves (closed-form bones, the spines of flexing bodies, anything that moves); `sag` and
 * `scallop` take expressions and can move; `slack` (how taut the cloth hangs) is a fixed number.
 *
 * What it cannot do, because of the law:
 * - cloth that is not between neighbouring rays: no membrane past the outer rays, none skipping a ray.
 * - a gap whose profile is not a catenary, or a belly that differs between gaps (one `sag` for all).
 * - a free edge anywhere but at the tips (v = 1): no cloth that stops short of a ray's end.
 * - a root edge: every ray starts at v = 0 and the cloth runs right to it.
 *
 * Going past it: the rays are the open slot, so most variation is in choosing them: `rayOf` puts one on a body's
 * spine, `bent` gives stalks that bow and crook (a frill that curls), `chain` gives jointed ones (a bat's fingers).
 * For a different cloth, `catenary` below is the profile, and `surface((u, v) => ...)` with your own law across the gap
 * keeps the same coordinates. Relatives: a ruled sheet between two curves is `sheet`; between many curves smoothly is
 * `loft`; a sheet standing on one line of a body is `sheetOn`.
 */
export function fan(spec: FanSpec): Surface {
  const rays = spec.rays, n = rays.length;
  if (n < 2) throw new Error(`fan: need at least two rays, got ${n}`);
  const slack = spec.slack ?? 2;
  const sag = lift<"f32">(spec.sag), scallop = lift<"f32">(spec.scallop);
  const point = (u: F, v: F): P3 => {
    const x = mul(clamp(u, 0, 1), n - 1);
    const k = min(floor(x), n - 2), f = sub(x, k);
    const at = (w: In<"f32">) => { const vs = rays.map((r) => r(w)); return [pick(k, vs), pick(add(k, 1), vs)] as const; };
    const [a, b] = at(v);
    const [a0, b0] = at(clamp(sub(v, H), 0, 1)), [a1, b1] = at(clamp(add(v, H), 0, 1));
    const [ta, tb] = at(1), [na, nb] = at(1 - H);
    const across = sub(b, a);
    const along = mix(sub(a1, a0), sub(b1, b0), f);
    const shape = catenary(f, slack);
    const belly = mul(unit(cross(across, along)), mul(mul(sag, length(across)), shape));
    // Toward the root along the rays at their tips; the cut is weighted by v^2 so it is whole at the edge and fades in.
    const inward = mul(unit(mix(sub(ta, na), sub(tb, nb), f)), -1);
    const cut = mul(inward, mul(mul(mul(scallop, length(sub(tb, ta))), shape), mul(v, v)));
    return add(add(mix(a, b, f), belly), cut);
  };
  return surface(point, { u: ["free", "free"], v: "free" });
}

/**
 * A body's centre line as a curve m -> point (m from 0 at its root to 1 at its tip), so a `fan` can be spanned between
 * flexing bodies: the point is `body.frame(vec3(m, v, 0)).o`, which moves as the body moves.
 *
 * It cannot put the ray off the centre line: in a body's coordinates (m, v, rho) the third is the share of the way from
 * the centre line to the skin, here 0, so `v` changes nothing. For a ray along the skin on one side, write the curve
 * yourself: `(m) => body.frame(vec3(m, v, 1)).o`. Relatives: any `Curve` is a ray, so a `chain`'s `spine`, a `bent`
 * stalk's, or a `spiralLine`'s `spine` serve as well.
 */
export const rayOf = (body: Chart, v = 0.25): Curve => (m) => body.frame(vec3(m, v, 0)).o;

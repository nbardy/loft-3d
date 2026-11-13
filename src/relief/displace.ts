// Displacement in the vertex stage, and the local frame a shell tracer needs: both come from differentiating a
// surface's own expressions (src/grad.ts), so a displaced body's normal is the displaced map's normal, not a guess.

import { add, cross, div, length, max, mul, substitute, variable, vec2, type Expr } from "../expr.ts";
import { jacobian } from "../grad.ts";
import type { F, P3, Surface } from "../map/types.ts";
import type { Height } from "./height.ts";

/**
 * The point of the surface's parameter plane that every derivative here is taken at. One vec2 leaf (not two scalars)
 * so that moving back to the caller's (u, v) is one substitution: two would also rewrite a v that mentions u.
 */
const P = variable("relief_uv", "vec2");

/** The partial derivatives of `e` (built at P) along u and along v, at the caller's (u, v). */
function at<T extends readonly Expr[]>(es: T, u: F, v: F): T {
  return substitute(es, P, vec2(u, v)) as unknown as T;
}

/** A surface and its first derivatives at a point: what the shell tracer's local model is made of. */
export type ShellFrame = {
  /** The point on the surface. */
  readonly base: P3;
  /** d(point)/du and d(point)/dv. */
  readonly su: P3;
  readonly sv: P3;
  /** The unit normal (the surface's own, on the side su x sv points to) and its derivatives along u and v. */
  readonly n: P3;
  readonly nu: P3;
  readonly nv: P3;
};

/** The shell frame of `s` at (u, v), by symbolic differentiation of its point and normal. */
export function shellFrame(s: Surface, u: F, v: F): ShellFrame {
  const p = s.point(P.x, P.y), n = s.normal(P.x, P.y);
  const [su, sv] = jacobian(p, P), [nu, nv] = jacobian(n, P);
  const [base, su_, sv_, n_, nu_, nv_] = at([p, su, sv, n, nu, nv] as const, u, v);
  return { base, su: su_, sv: sv_, n: n_, nu: nu_, nv: nv_ };
}

/**
 * The surface moved along its normal by `height(u, v)` (world units; negative goes in). The normal is the displaced
 * map's own, `d/du x d/dv` of `point + height normal`, which needs the derivative of the base normal: exact where the
 * base normal is (a sweep's analytic one), first order in the step where it is a finite difference. Topology and
 * skeleton are the base's. For form at the scale of the grid; finer relief belongs to `draw.relief`.
 */
export function displace(s: Surface, height: Height): Surface {
  const moved = add(s.point(P.x, P.y), mul(s.normal(P.x, P.y), height(P.x, P.y)));
  const [du, dv] = jacobian(moved, P);
  const c = cross(du, dv);
  // A degenerate point (a pole, where the two derivatives are parallel) gives the zero vector rather than NaN, as mapNormal does.
  const normal = div(c, max(length(c), 1e-12));
  return {
    point: (u, v) => at([moved] as const, u, v)[0],
    normal: (u, v) => at([normal] as const, u, v)[0],
    anchor: s.anchor,
    topology: s.topology,
    skeleton: s.skeleton,
  };
}

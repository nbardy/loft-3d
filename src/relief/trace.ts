// Shell tracing in a surface's own coordinates (docs/folding_and_tracing.md 3.3), as expressions: the same march runs in
// the fragment stage and on the CPU (tests), so its accuracy is measured on the code that draws.
//
// The local model. Near the pixel's surface point B = S(u0, v0), a point at surface coordinates (u0 + du, v0 + dv) and
// height h above the surface is
//
//   X = S(u, v) + h N(u, v) ~ B + Su du + Sv dv + 1/2 (Suu du^2 + 2 Suv du dv + Svv dv^2) + h (N + Nu du + Nv dv).
//
// Inverting it to second order, with (du_l, dv_l, h_l) = J^-1 (X - B) for J = [Su Sv N]:
//
//   h  = h_l - 1/2 II(du_l, dv_l)            II the second fundamental form: L = -Su.Nu, M = -(Su.Nv + Sv.Nu)/2, N = -Sv.Nv
//   du = du_l - h (A du_l)                    A = J^-1 [Nu Nv] restricted to the tangent rows (the shape operator)
//
// (The tangential parts of Suu, Suv, Svv are dropped: they bend parameter lines within the surface and are third order
// in the height.) Along the view ray X(t) = E + t d the linear coordinates are linear in t, so h(t) is a quadratic: the
// ray's way into the shell, back out of it (a silhouette) and down to the base are roots of quadratics, and the march
// samples only where the ray is inside the shell. Exact on a plane; on a curved surface the error is what the dropped
// terms leave, measured in tests/relief.trace.test.ts and stated in DESIGN.md 8.
//
// What a frame needs is the surface's point, tangents, normal and the normal's derivatives at the pixel (shellFrame in
// displace.ts), all of which the vertex stage computes from the surface's own expressions and the rasteriser interpolates.

import {
  abs, add, and, cross, f, length, div, dot, ge, gt, iterate, le, lt, max, min, mix, mul, normalize, saturate, select, sqrt, sub, substitute,
  variable, vec2, vec3, type Expr,
} from "../expr.ts";
import { gradient } from "../grad.ts";
import type { F, P3 } from "../map/types.ts";
import type { ShellFrame } from "./displace.ts";
import type { Height } from "./height.ts";

/** The view ray where it enters the shell: `entry` on the shell's top at the pixel, `dir` a unit vector, `top` the shell's thickness. */
export type ShellRay = { readonly entry: P3; readonly dir: P3; readonly top: F };

/** What a trace found. `kind`: 1 a hit on the relief, 0.5 a near miss inside the ink width (the silhouette's ink), 0 a miss. */
export type Traced = {
  readonly kind: F;
  /** On the ray: the hit, or for ink the ray's closest approach to the relief. */
  readonly world: P3;
  /** Surface coordinates there and the height of the relief there. */
  readonly uvh: P3;
  /** The relief's unit normal there (for ink and the plain fallback, the surface's). */
  readonly normal: P3;
};
export const KIND = { miss: 0, ink: 0.5, hit: 1 } as const;

/** How far a march may run along the ray, in shell thicknesses: past this the second-order model is not trusted. */
const REACH = 12;
/**
 * How far a march may slide along the surface, as a fraction of the radius of curvature in the ray's direction. Past
 * it the second-order model invents hits: on the serpent's coils, rays grazing past the silhouette met relief that
 * hung off the body like curtains (2026-11-11, examples/serpent_relief.ts "graze" view). Rays cut off here miss.
 */
const SLIDE = 0.75;
/** The march ends a little below the base, so a ray that meets the base where the height is 0 is a hit, not a miss. */
const BELOW = 0.01;
const BIG = 1e20;
const ZERO = f(0);

/** The smallest root > 0 of a t^2 + b t + c, or BIG when there is none. Stable for either sign of b and for a -> 0. */
export function firstRoot(a: F, b: F, c: F): F {
  const disc = sub(mul(b, b), mul(mul(a, c), 4));
  const s = sqrt(max(disc, 0));
  const q = mul(add(b, select(ge(b, 0), s, mul(s, -1))), -0.5);
  // q / a is the root that runs off to infinity as a -> 0; c / q is the one that tends to -c / b.
  const r1 = select(gt(abs(a), 1e-12), div(q, select(ge(a, 0), max(a, 1e-12), min(a, -1e-12))), BIG);
  const r2 = select(gt(abs(q), 1e-20), div(c, select(ge(q, 0), max(q, 1e-20), min(q, -1e-20))), BIG);
  const pos = (r: F): F => select(gt(r, 1e-9), r, BIG);
  return select(ge(disc, 0), min(pos(r1), pos(r2)), BIG);
}

/** The local model of the shell along one ray: coordinates at distance t along it. */
export type ShellModel = {
  /** Surface coordinates and height at t. */
  at(t: F): { readonly u: F; readonly v: F; readonly h: F; readonly du: F; readonly dv: F };
  /** |d - (d.n) n|: how fast the ray slides along the surface per unit t. */
  readonly slide: F;
  /** h(t) = c0 + c1 t + c2 t^2. */
  readonly c0: F;
  readonly c1: F;
  readonly c2: F;
};

export function shellModel(fr: ShellFrame, uv0: Expr<"vec2">, ray: ShellRay): ShellModel {
  const det = dot(fr.su, cross(fr.sv, fr.n));
  // At a pole the tangents collapse: keep the inverse finite (the relief there should be zero anyway).
  const safe = select(ge(det, 0), max(det, 1e-12), min(det, -1e-12));
  const ru = div(cross(fr.sv, fr.n), safe), rv = div(cross(fr.n, fr.su), safe), rh = div(cross(fr.su, fr.sv), safe);
  const w0 = sub(ray.entry, fr.base), d = ray.dir;
  const p = vec3(dot(ru, w0), dot(rv, w0), dot(rh, w0));
  const q = vec3(dot(ru, d), dot(rv, d), dot(rh, d));
  const L = mul(dot(fr.su, fr.nu), -1), M = mul(add(dot(fr.su, fr.nv), dot(fr.sv, fr.nu)), -0.5), N = mul(dot(fr.sv, fr.nv), -1);
  const II = (a: Expr<"vec2">, b: Expr<"vec2">): F =>
    add(add(mul(mul(a.x, b.x), L), mul(add(mul(a.x, b.y), mul(a.y, b.x)), M)), mul(mul(a.y, b.y), N));
  const a00 = dot(ru, fr.nu), a01 = dot(ru, fr.nv), a10 = dot(rv, fr.nu), a11 = dot(rv, fr.nv);
  const c0 = sub(p.z, mul(II(p.xy, p.xy), 0.5));
  const c1 = sub(q.z, II(p.xy, q.xy));
  const c2 = mul(II(q.xy, q.xy), -0.5);
  const slide = length(sub(d, mul(fr.n, dot(d, fr.n))));
  return {
    c0, c1, c2, slide,
    at: (t) => {
      const l = add(p, mul(q, t));
      const h = add(c0, mul(t, add(c1, mul(c2, t))));
      const du = sub(l.x, mul(h, add(mul(a00, l.x), mul(a01, l.y))));
      const dv = sub(l.y, mul(h, add(mul(a10, l.x), mul(a11, l.y))));
      return { u: add(uv0.x, du), v: add(uv0.y, dv), h, du, dv };
    },
  };
}

/** The surface's normal moved to (du, dv) from the pixel's, to first order. */
const normalAt = (fr: ShellFrame, du: F, dv: F): P3 => normalize(add(fr.n, add(mul(fr.nu, du), mul(fr.nv, dv))));

/**
 * The relief's normal at (u, v) with height h there: d/du x d/dv of S + H N, i.e. (Su + Hu N + H Nu) x (Sv + Hv N + H Nv),
 * with the height's gradient taken symbolically.
 */
function reliefNormal(fr: ShellFrame, height: Height, n: P3, u: F, v: F): { h: F; normal: P3 } {
  const X = variable("relief_trace_uv", "vec2");
  const hx = height(X.x, X.y);
  const g = gradient(hx, X);
  const [h, gu, gv] = substitute([hx, g.x, g.y], X, vec2(u, v)) as [F, F, F];
  const pu = add(add(fr.su, mul(n, gu)), mul(fr.nu, h));
  const pv = add(add(fr.sv, mul(n, gv)), mul(fr.nv, h));
  return { h, normal: normalize(cross(pu, pv)) };
}

/** Where the march may run: from the entry to the first of the base (just below it), the way out of the shell, and the reach. */
function span(m: ShellModel, top: F): { end: F; exit: F } {
  const out = add(max(top, m.c0), mul(top, 1e-3));
  const base = firstRoot(m.c2, m.c1, add(m.c0, mul(top, BELOW)));
  // Curvature in the ray's direction is |II(q, q)| / slide^2 = 2 |c2| / slide^2; sliding SLIDE / curvature takes t = SLIDE slide / (2 |c2|).
  const bend = select(gt(abs(m.c2), 1e-9), div(mul(m.slide, SLIDE * 0.5), max(abs(m.c2), 1e-9)), BIG);
  const exit = min(min(firstRoot(m.c2, m.c1, sub(m.c0, out)), mul(top, REACH)), bend);
  return { end: min(base, exit), exit };
}

export type MarchBudget = {
  /** Linear-search samples along the ray (an expression: it falls with distance). 0 finds nothing. */
  readonly steps: F;
  /** Regula-falsi refinements of the bracketing interval. */
  readonly refine: F;
  /** Half-width of the silhouette's ink in world units (0 for none). */
  readonly ink: F;
  /** 0..1: how much of the relief's normal to use (1 near, toward 0 as the relief approaches a pixel). */
  readonly detail: F;
};

/**
 * March the shell: `steps` evenly spaced samples of f(t) = h(t) - H(u(t), v(t)) from the entry to the end of the
 * span, the first sign change bracketed and refined by safeguarded regula falsi. A ray that never crosses misses;
 * if it came within `ink` of the relief, it is ink at its closest approach.
 */
export function traceMarch(fr: ShellFrame, uv0: Expr<"vec2">, ray: ShellRay, height: Height, b: MarchBudget): Traced {
  const m = shellModel(fr, uv0, ray);
  const { end } = span(m, ray.top);
  const f = (t: F): F => { const c = m.at(t); return sub(c.h, height(c.u, c.v)); };
  const dt = div(end, max(b.steps, 1));
  const f0 = f(ZERO);
  // State: previous t and f, found (0/1), bracket [lo, hi] with f(lo) > 0 >= f(hi), closest approach (gap, t) of a miss.
  const [, , found, lo, flo, hi, fhi, gap, tGap] = iterate(b.steps, [ZERO, f0, ZERO, ZERO, f0, end, f0, f0, ZERO] as const,
    ([tp, fp, fd, l, fl, hh, fh, g, tg], i) => {
      const t = mul(add(i, 1), dt);
      const ft = f(t);
      const first = and(lt(fd, 0.5), le(ft, 0));
      const closer = and(lt(fd, 0.5), lt(ft, g));
      return [t, ft, select(le(ft, 0), 1, fd), select(first, tp, l), select(first, fp, fl), select(first, t, hh), select(first, ft, fh),
        select(closer, ft, g), select(closer, t, tg)] as const;
    });
  const hit = gt(found, 0.5);
  // A miss has nothing to refine: its loop runs no times.
  const [a, fa, c, fc] = iterate(select(hit, b.refine, 0), [lo, flo, hi, fhi] as const, ([x0, f0_, x1, f1]) => {
    const w = saturate(div(f0_, max(sub(f0_, f1), 1e-12)));
    const x = add(x0, mul(sub(x1, x0), min(max(w, 0.1), 0.9)));
    const fx = f(x);
    const above = gt(fx, 0);
    return [select(above, x, x0), select(above, fx, f0_), select(above, x1, x), select(above, f1, fx)] as const;
  });
  const tHit = add(a, mul(sub(c, a), saturate(div(fa, max(sub(fa, fc), 1e-12)))));
  const t = select(hit, tHit, tGap);
  const at = m.at(t);
  const nBase = normalAt(fr, at.du, at.dv);
  const r = reliefNormal(fr, height, nBase, at.u, at.v);
  const normal = select(hit, normalize(mix(nBase, r.normal, b.detail)), nBase);
  const kind = select(hit, KIND.hit, select(lt(gap, b.ink), KIND.ink, KIND.miss));
  return { kind, world: add(ray.entry, mul(ray.dir, t)), uvh: vec3(at.u, at.v, select(hit, r.h, at.h)), normal };
}

/**
 * Relief below a pixel: no march. The ray meets the surface lifted to the height at the pixel (one evaluation, so the
 * depth against the sea stays right), lit with the surface's normal; misses and ink as in `traceMarch`.
 */
export function tracePlain(fr: ShellFrame, uv0: Expr<"vec2">, ray: ShellRay, height: Height, ink: F): Traced {
  const m = shellModel(fr, uv0, ray);
  const h0 = height(uv0.x, uv0.y);
  const { exit } = span(m, ray.top);
  const tHit = firstRoot(m.c2, m.c1, sub(m.c0, h0));
  const hit = lt(tHit, exit);
  // Closest approach of the quadratic over [0, exit]: its vertex when it opens upward, else the far end.
  const tMin = select(gt(m.c2, 1e-12), min(max(div(mul(m.c1, -0.5), max(m.c2, 1e-12)), 0), exit), exit);
  const t = select(hit, tHit, tMin);
  const at = m.at(t);
  const kind = select(hit, KIND.hit, select(lt(sub(at.h, h0), ink), KIND.ink, KIND.miss));
  return { kind, world: add(ray.entry, mul(ray.dir, t)), uvh: vec3(at.u, at.v, h0), normal: normalAt(fr, at.du, at.dv) };
}

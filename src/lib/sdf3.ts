// 3D signed distances and the operators on them. Negative inside, zero on the surface, positive outside, in world
// units. Composed from expr.ts operators, so both backends agree by construction. The z axis is the axis of every
// shape that has one (cylinder, torus, revolve, extrude), matching the folds in fold.ts.
//
// "Exact" below means the value is the true Euclidean distance to the shape (Lipschitz 1, gradient of length 1);
// "bound" means it never exceeds the true distance by much but is not equal to it, and a tracer stepping by it is
// slower but safe only where the comment says so.
import {
  abs, add, compileJs, div, dot, f, gt, length, lift, lt, max, min, mul, neg, normalize, saturate, select, sign, sqrt, sub,
  variable, vec2, type Expr, type In,
} from "../expr.ts";
import { smax, smin } from "./util.ts";
import type { Fold, Folded, Vec } from "./fold.ts";

/** A distance function of a point of dimension V. */
export type Field<V extends Vec> = (p: Expr<V>) => Expr<"f32">;
export type Sdf3 = Field<"vec3">;

// ---- primitives ---------------------------------------------------------------------------------------------------

/** Exact distance to a sphere of radius r centred on the origin. */
export function sdSphere(p: In<"vec3">, r: In<"f32">): Expr<"f32"> {
  return sub(length(p), r);
}

/** Exact distance to an axis-aligned box centred on the origin with the given half extents. */
export function sdBox3(p: In<"vec3">, halfSize: In<"vec3">): Expr<"f32"> {
  const q = sub(abs(lift<"vec3">(p)), halfSize);
  return add(length(max(q, 0)), min(max(q.x, max(q.y, q.z)), 0));
}

/** Exact distance to a box with outer half extents `halfSize` whose edges and corners are rounded by radius r (r <= the smallest half extent). */
export function sdRoundBox(p: In<"vec3">, halfSize: In<"vec3">, r: In<"f32">): Expr<"f32"> {
  return sub(sdBox3(p, sub(halfSize, r)), r);
}

/** Exact distance to the capsule of radius r around the segment a-b (the endpoints must differ): -r on the axis. */
export function sdCapsule3(p: In<"vec3">, a: In<"vec3">, b: In<"vec3">, r: In<"f32">): Expr<"f32"> {
  const pa = sub(p, a), ba = sub(b, a);
  const h = saturate(div(dot(pa, ba), dot(ba, ba)));
  return sub(length(sub(pa, mul(ba, h))), r);
}

/**
 * Exact distance to the rounded cone: the convex hull of the sphere of radius r1 at `a` and the sphere of radius r2
 * at `b` (iq's formulation). The spheres must not contain one another: |r1 - r2| < |b - a|.
 */
export function sdRoundCone(p: In<"vec3">, a: In<"vec3">, b: In<"vec3">, r1: In<"f32">, r2: In<"f32">): Expr<"f32"> {
  const ba = sub(b, a);
  const l2 = dot(ba, ba), rr = sub(r1, r2);
  const a2 = sub(l2, mul(rr, rr)), il2 = div(1, l2);
  const pa = sub(p, a);
  const y = dot(pa, ba), z = sub(y, l2);
  const v = sub(mul(pa, l2), mul(ba, y));
  const x2 = dot(v, v), y2 = mul(mul(y, y), l2), z2 = mul(mul(z, z), l2);
  const k = mul(mul(sign(rr), mul(rr, rr)), x2);
  const nearB = sub(mul(sqrt(add(x2, z2)), il2), r2);
  const nearA = sub(mul(sqrt(add(x2, y2)), il2), r1);
  const side = sub(mul(add(sqrt(mul(mul(x2, a2), il2)), mul(y, rr)), il2), r1);
  return select(gt(mul(mul(sign(z), a2), z2), k), nearB, select(lt(mul(mul(sign(y), a2), y2), k), nearA, side));
}

/** Exact distance to a torus around the z axis in the xy plane: ring radius `major`, tube radius `minor`. */
export function sdTorus(p: In<"vec3">, major: In<"f32">, minor: In<"f32">): Expr<"f32"> {
  const q = lift<"vec3">(p);
  return sub(length(vec2(sub(length(vec2(q.x, q.y)), major), q.z)), minor);
}

/** Exact distance to a solid cylinder along the z axis, radius r, from z = -halfHeight to z = +halfHeight. */
export function sdCylinder(p: In<"vec3">, r: In<"f32">, halfHeight: In<"f32">): Expr<"f32"> {
  const q = lift<"vec3">(p);
  const d = sub(vec2(abs(length(vec2(q.x, q.y))), abs(q.z)), vec2(r, halfHeight));
  return add(min(max(d.x, d.y), 0), length(max(d, 0)));
}

/** Exact signed distance to the plane with normal `normal` (normalised here) at `offset` along it; negative on the side opposite the normal. */
export function sdPlane(p: In<"vec3">, normal: In<"vec3">, offset: In<"f32">): Expr<"f32"> {
  return sub(dot(p, normalize(lift<"vec3">(normal))), offset);
}

/**
 * A BOUND, not the exact distance, to the ellipsoid with semi-axes `radii` (iq's `k0 (k0 - 1) / k1`): zero on the
 * surface, correct sign everywhere, and close to the true distance near the surface; far away it overestimates along
 * the long axes by up to (longest / shortest semi-axis), so sphere-tracing it needs a step factor below 1 for
 * elongated shapes. At the exact centre the value is -0 (the formula is 0/0; the denominator is floored at 1e-20).
 */
export function sdEllipsoid(p: In<"vec3">, radii: In<"vec3">): Expr<"f32"> {
  const q = lift<"vec3">(p), r = lift<"vec3">(radii);
  const k0 = length(div(q, r));
  const k1 = max(length(div(q, mul(r, r))), 1e-20);
  return div(mul(k0, sub(k0, 1)), k1);
}

// ---- operators on distances ---------------------------------------------------------------------------------------

/** Union: min. Exact outside both shapes, a lower bound inside. */
export const union = (a: In<"f32">, b: In<"f32">): Expr<"f32"> => min(a, b);
/** `a` with `b` cut away: max(a, -b). A bound (exact away from the cut edge). */
export const subtract = (a: In<"f32">, b: In<"f32">): Expr<"f32"> => max(a, neg(lift<"f32">(b)));
/** Intersection: max. A bound. */
export const intersect = (a: In<"f32">, b: In<"f32">): Expr<"f32"> => max(a, b);
/** Union blended over a width `k` (> 0): `smin`. */
export const smoothUnion = (a: In<"f32">, b: In<"f32">, k: In<"f32">): Expr<"f32"> => smin(a, b, k);
/** `a` with `b` cut away, blended over a width `k`: `smax(a, -b, k)`. */
export const smoothSubtract = (a: In<"f32">, b: In<"f32">, k: In<"f32">): Expr<"f32"> => smax(a, neg(lift<"f32">(b)), k);
/** Intersection blended over a width `k`: `smax`. */
export const smoothIntersect = (a: In<"f32">, b: In<"f32">, k: In<"f32">): Expr<"f32"> => smax(a, b, k);

/** Grow the shape by r (shrink if negative): rounds its convex edges. Exact where d is exact. */
export const round = (d: In<"f32">, r: In<"f32">): Expr<"f32"> => sub(d, r);

/** A thin skin around the level set d = 0 of total thickness `thickness`: negative within `thickness / 2` of the surface. */
export const shell = (d: In<"f32">, thickness: In<"f32">): Expr<"f32"> => sub(abs(lift<"f32">(d)), mul(thickness, 0.5));

// ---- operators on fields ------------------------------------------------------------------------------------------

/**
 * Stretch a shape by `h` (per axis) along the axes: the shape is cut at the origin planes and the halves pulled apart,
 * with a slab of constant cross-section between them (iq's elongation, the exact form). `sdf` must be mirror
 * symmetric about the origin in every axis (sphere, box, ellipsoid, a z-axis cylinder or torus); for other shapes the
 * result is not a distance.
 */
export function elongate(sdf: Sdf3, h: In<"vec3">): Sdf3 {
  return (p) => {
    const q = sub(abs(p), h);
    return add(sdf(max(q, 0)), min(max(q.x, max(q.y, q.z)), 0));
  };
}

/**
 * Lift a 2D distance function into 3D by revolving it about the z axis: the 2D shape lives in (x = distance from the
 * axis - `offset`, y = z). Exact where the 2D function is exact, provided the 2D shape stays at x >= -offset (does not
 * cross the axis); a shape that does cross would be mirrored onto itself.
 */
export function revolve(sdf2: Field<"vec2">, offset: In<"f32">): Sdf3 {
  return (p) => sdf2(vec2(sub(length(vec2(p.x, p.y)), offset), p.z));
}

/** Lift a 2D distance function into 3D by extruding it along z from -halfHeight to +halfHeight. Exact where the 2D function is exact. */
export function extrude(sdf2: Field<"vec2">, halfHeight: In<"f32">): Sdf3 {
  return (p) => {
    const d = sdf2(vec2(p.x, p.y));
    const w = vec2(d, sub(abs(p.z), halfHeight));
    return add(min(max(w.x, w.y), 0), length(max(w, 0)));
  };
}

/**
 * The distance function of `sdf` seen through `fold`: `fold(p).toWorld(sdf(fold(p).x))`, which is
 * `sdf(x) * stretch` for every fold but `inversion`. Whether it is a safe
 * distance for sphere tracing depends on the fold (each fold's doc comment says whether its stretch is exact or a
 * bound, and where the motif must stay); check it with `lipschitz`.
 */
export function fieldOf<V extends Vec>(fold: Fold<V>, sdf: Field<V>): (p: In<V>) => Expr<"f32"> {
  return (p) => {
    const g: Folded<V> = fold(p);
    return g.toWorld(sdf(g.x));
  };
}

/**
 * The nearest of several views of the same motif: the minimum of `fieldOf(fold, sdf)` over `folds`. A fold shows a
 * point only its own cell's copy; list the neighbouring copies as extra folds (`compose(repeat(c), translate(...))`,
 * `compose(screw(..), helix(..))`) and the result is correct for motifs that reach across cell walls.
 */
export function nearest<V extends Vec>(folds: readonly Fold<V>[], sdf: Field<V>): (p: In<V>) => Expr<"f32"> {
  if (folds.length === 0) throw new Error("nearest: needs at least one fold");
  const fields = folds.map((fold) => fieldOf(fold, sdf));
  return (p) => fields.slice(1).reduce((d, field) => min(d, field(p)), fields[0](p));
}

// ---- the check that a distance function is safe to march on (docs/folding_and_tracing.md section 6) ---------------

export type LipschitzSpec = {
  /** Number of random pairs of nearby points. */
  readonly samples: number;
  /** The box the first point of each pair is drawn from; its length (2 or 3) sets the dimension of the field. */
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] };
  /** Seed of the generator: the result is a pure function of (field, spec). */
  readonly seed: number;
  /** Largest pair separation as a fraction of the box's diagonal; separations are log-uniform down to a thousandth of it. Default 0.02. */
  readonly separation?: number;
};

/** A deterministic generator in [0, 1) (32-bit LCG). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Evaluate `field` on the CPU at `samples` pairs of nearby points and return the largest observed
 * `|d(a) - d(b)| / |a - b|`. A true distance function gives at most 1; a value above 1 means a tracer stepping by this
 * distance can overshoot a surface. This is a sampled lower bound of the Lipschitz constant, so a pass is evidence, not
 * proof; sample many pairs and include the regions with seams. Throws if the field returns a non-finite value, naming the point.
 */
export function lipschitz<V extends Vec>(field: Field<V>, spec: LipschitzSpec): number {
  const dim = spec.bounds.min.length;
  if ((dim !== 2 && dim !== 3) || spec.bounds.max.length !== dim) throw new Error(`lipschitz: bounds must be two arrays of length 2 or 3, got ${dim} and ${spec.bounds.max.length}`);
  const p = variable("p", dim === 2 ? "vec2" : "vec3") as unknown as Expr<V>;
  const run = compileJs([field(p)]);
  const at = (q: number[]): number => {
    const d = run({ vars: { p: q }, inputs: {}, params: {} })[0] as number;
    if (!Number.isFinite(d)) throw new Error(`lipschitz: the field is ${d} at (${q.join(", ")})`);
    return d;
  };
  const rand = lcg(spec.seed);
  const diag = Math.hypot(...spec.bounds.min.map((lo, i) => spec.bounds.max[i] - lo));
  const top = spec.separation ?? 0.02;
  let worst = 0;
  for (let n = 0; n < spec.samples; n++) {
    const a = spec.bounds.min.map((lo, i) => lo + rand() * (spec.bounds.max[i] - lo));
    // A uniform direction (Gaussian lanes), and a separation log-uniform over three decades.
    const g = a.map(() => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()));
    const norm = Math.hypot(...g) || 1;
    const len = diag * top * Math.pow(10, -3 * rand());
    const b = a.map((v, i) => v + (g[i] / norm) * len);
    worst = Math.max(worst, Math.abs(at(a) - at(b)) / len);
  }
  return worst;
}

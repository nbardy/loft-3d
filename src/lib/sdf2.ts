// 2D signed distances for markers painted on a plane: negative inside, zero on the contour, positive outside, in the
// units of the plane. Composed from expr.ts operators, so both backends agree by construction.
import { abs, and, atan2, cos, div, dot, f, ge, le, length, lift, max, min, mod, mul, saturate, select, sin, sub, add, TAU, vec2, type Expr, type In } from "../expr.ts";

/** Distance to a circle of radius r centred on the origin: |p| - r. */
export function sdCircle(p: In<"vec2">, r: In<"f32">): Expr<"f32"> {
  return sub(length(p), r);
}

/** Exact distance to an axis-aligned box centred on the origin with the given half extents. */
export function sdBox(p: In<"vec2">, halfSize: In<"vec2">): Expr<"f32"> {
  const q = sub(abs(lift<"vec2">(p)), halfSize);
  return add(length(max(q, 0)), min(max(q.x, q.y), 0));
}

/** Unsigned distance (>= 0) to the segment from a to b. The endpoints must differ. */
export function sdSegment(p: In<"vec2">, a: In<"vec2">, b: In<"vec2">): Expr<"f32"> {
  const pa = sub(p, a), ba = sub(b, a);
  const h = saturate(div(dot(pa, ba), dot(ba, ba)));
  return length(sub(pa, mul(ba, h)));
}

/** Distance to the capsule of radius r around the segment a-b: -r on the axis, 0 on the surface. */
export function sdCapsule(p: In<"vec2">, a: In<"vec2">, b: In<"vec2">, r: In<"f32">): Expr<"f32"> {
  return sub(sdSegment(p, a, b), r);
}

/** Distance to a ring of radius r and total thickness 2 * halfWidth around the origin: -halfWidth on the circle |p| = r. */
export function sdRing(p: In<"vec2">, r: In<"f32">, halfWidth: In<"f32">): Expr<"f32"> {
  return sub(abs(sub(length(p), r)), halfWidth);
}

/**
 * Exact distance to the isosceles triangle with base on y = 0 from x = -halfWidth to x = +halfWidth and apex at
 * (0, height). Mirror symmetry in x halves the work: only the right half's two outer edges are measured.
 */
export function sdTriangleIsosceles(p: In<"vec2">, halfWidth: In<"f32">, height: In<"f32">): Expr<"f32"> {
  const q = vec2(abs(lift<"vec2">(p).x), lift<"vec2">(p).y);
  const w = lift<"f32">(halfWidth), h = lift<"f32">(height);
  const d = min(sdSegment(q, [0, 0], vec2(w, 0)), sdSegment(q, vec2(w, 0), vec2(0, h)));
  // Above the base and on the origin side of the slanted edge x/w + y/h = 1.
  const inside = and(ge(q.y, 0), le(add(mul(h, q.x), mul(w, q.y)), mul(w, h)));
  return mul(d, select(inside, f(-1), f(1)));
}

/**
 * Fold the plane into `count` equal sectors, the first centred on the +x axis, and return the point's position in
 * that sector (same radius). Measure a distance to one tooth in the result and the whole ring of teeth appears.
 * Points exactly on a sector boundary land on one of its two sides.
 */
export function repeatAngle(p: In<"vec2">, count: In<"f32">): Expr<"vec2"> {
  const q = lift<"vec2">(p);
  const sector = div(TAU, lift<"f32">(count));
  const half = mul(sector, 0.5);
  const a = sub(mod(add(atan2(q.y, q.x), half), sector), half);
  return mul(length(q), vec2(cos(a), sin(a)));
}

/** Distance to the band of half-width `halfWidth` around the contour d = 0: negative within the band. */
export function stroke(d: In<"f32">, halfWidth: In<"f32">): Expr<"f32"> {
  return sub(abs(lift<"f32">(d)), halfWidth);
}

/** Antialiased inside-ness in [0, 1] from a signed distance and the width of one pixel in the same units: 0.5 on the contour. */
export function coverage(d: In<"f32">, pixelWidth: In<"f32">): Expr<"f32"> {
  return saturate(sub(f(0.5), div(d, pixelWidth)));
}

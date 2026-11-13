// Remapping, coordinates and colour helpers, all composed from the operators in expr.ts (so both backends agree by
// construction; the tests check the composition, not the operators).
import {
  abs, add, atan2, clamp, cos, div, dot, f, length, lift, max, min, mix, mod, mul, neg, normalize, pow, saturate, sin, sub,
  vec2, vec3, type Expr, type In,
} from "../expr.ts";

/** Linear map of x from [inLo, inHi] to [outLo, outHi], unclamped (extrapolates). inHi must differ from inLo. */
export function remap(x: In<"f32">, inLo: In<"f32">, inHi: In<"f32">, outLo: In<"f32">, outHi: In<"f32">): Expr<"f32"> {
  const t = div(sub(x, inLo), sub(inHi, inLo));
  return add(outLo, mul(t, sub(outHi, outLo)));
}

/** Like `remap`, but x is held to [inLo, inHi] first, so the result stays between outLo and outHi. */
export function remapClamped(x: In<"f32">, inLo: In<"f32">, inHi: In<"f32">, outLo: In<"f32">, outHi: In<"f32">): Expr<"f32"> {
  const t = saturate(div(sub(x, inLo), sub(inHi, inLo)));
  return add(outLo, mul(t, sub(outHi, outLo)));
}

/** (radius >= 0, angle in [-pi, pi]) of a 2D point. The angle of the origin is not meaningful. */
export function polar(p: In<"vec2">): Expr<"vec2"> {
  const q = lift<"vec2">(p);
  return vec2(length(q), atan2(q.y, q.x));
}

/** The inverse of `polar`: the point at (radius, angle). */
export function cartesian(pr: In<"vec2">): Expr<"vec2"> {
  const q = lift<"vec2">(pr);
  return mul(q.x, vec2(cos(q.y), sin(q.y)));
}

/** p rotated counter-clockwise by `angle` radians about the origin; the length is preserved. */
export function rotate2(p: In<"vec2">, angle: In<"f32">): Expr<"vec2"> {
  const q = lift<"vec2">(p);
  const c = cos(angle), s = sin(angle);
  return vec2(sub(mul(c, q.x), mul(s, q.y)), add(mul(s, q.x), mul(c, q.y)));
}

/**
 * Edge-glow term in [0, 1]: (1 - |n . v|)^power for the unit directions of `normal` and `view` (view points from the
 * surface toward the eye). 0 when looking straight at the surface, 1 at grazing angles; a larger power narrows the rim.
 * The absolute value makes it independent of which side of the surface the normal points to.
 */
export function fresnel(normal: In<"vec3">, view: In<"vec3">, power: In<"f32">): Expr<"f32"> {
  const facing = abs(dot(normalize(normal), normalize(view)));
  // saturate: rounding can push |n . v| a hair above 1, and pow of a negative base is undefined in WGSL.
  return pow(saturate(sub(f(1), facing)), power);
}

/**
 * Polynomial smooth minimum: <= min(a, b) and within k / 4 of it, equal to min(a, b) once |a - b| >= k.
 * `k` is the blend width and must be positive.
 */
export function smin(a: In<"f32">, b: In<"f32">, k: In<"f32">): Expr<"f32"> {
  const h = div(max(sub(k, abs(sub(a, b))), 0), k);
  return sub(min(a, b), mul(mul(h, h), mul(k, 0.25)));
}

/** Polynomial smooth maximum: >= max(a, b) and within k / 4 of it, equal to max(a, b) once |a - b| >= k. */
export function smax(a: In<"f32">, b: In<"f32">, k: In<"f32">): Expr<"f32"> {
  return neg(smin(neg(a), neg(b), k));
}

/** Rec. 709 relative luminance of a linear rgb colour: in [0, 1] for rgb in [0, 1]. */
export function luminance(rgb: In<"vec3">): Expr<"f32"> {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

/** rgb in [0, 1] for hue h (a turn: 0 and 1 are both red, wraps outside [0, 1]), saturation s and value v in [0, 1]. */
export function hsv(h: In<"f32">, s: In<"f32">, v: In<"f32">): Expr<"vec3"> {
  const k = abs(sub(mod(add(mul(h, 6), vec3(0, 4, 2)), 6), 3));
  const rgb = clamp(sub(k, 1), 0, 1);
  return mul(v, mix(vec3(1, 1, 1), rgb, s));
}

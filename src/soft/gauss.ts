// The closed forms soft things are made of: the optical depth of a Gaussian density along a straight ray.
//
// A Gaussian puff has density d0 exp(-|K (p - c)|^2), K diagonal (inverse radii; a zero entry means "unbounded on that
// axis", which is how a fog layer is the same object as a blob). Along p = o + t d the exponent is a quadratic in t,
//   q(t) = |O + D t|^2,  O = K (o - c),  D = K d,
// so the integral over [t0, t1] is erf-shaped:
//   int exp(-q) dt = exp(-qmin) / s * G(s (t0 - tm), s (t1 - tm)),  s = |D|, tm = -O.D / |D|^2, qmin = |O + D tm|^2,
// with G(a, b) = int_a^b exp(-x^2) dx. Optical depths add, so a whole volume of puffs is a sum of these: no marching.
// The quadratic is written in 4D so a puff with a soft half-space edge (a fog bank) adds one more squared term and
// stays the same object (`src/soft/medium.ts`).
//
// Each function exists twice, once in WGSL and once as its JavaScript twin (the CPU light pass evaluates millions of
// these per second, too many for a compiled expression with an environment per call). Both are tested against a fine
// numerical integration (tests/soft.gauss.test.ts), which is what keeps them the same function.
//
// Numerics (both backends):
// - erfc is Numerical Recipes' Chebyshev fit `erfcc`: fractional error below 1.2e-7 everywhere, so the far tails used
//   by G when both ends lie on one side of the centre keep their relative accuracy (erf(b) - erf(a) is computed as a
//   difference of erfc values of the same sign).
// - When the segment is short against the Gaussian (s L < SIMPSON), G is a difference of nearly equal numbers and its
//   relative error grows as 1 / (s L). There the integrand is smooth over the segment and Simpson's rule on q(t) itself
//   is better than 1e-7. This branch also covers s -> 0 (a ray parallel to a layer), where the closed form divides by 0.

/** Below this s L the segment integral uses Simpson's rule (relative error of the closed form there would be ~1e-5). */
export const SIMPSON = 0.05;
const SQRT_PI_2 = Math.sqrt(Math.PI) / 2;
/** An optical depth's own ray never reaches further than this (a stand-in for infinity in "toward the sun"). */
export const FAR = 1e4;

/** erfc(z) for z >= 0 (Numerical Recipes `erfcc`, fractional error < 1.2e-7). */
export function erfcPos(z: number): number {
  const t = 1 / (1 + 0.5 * z);
  return t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
}

/** int_a^b exp(-x^2) dx for a <= b, accurate in the tails. */
export function gseg(a: number, b: number): number {
  const d = a >= 0 ? erfcPos(a) - erfcPos(b) : b <= 0 ? erfcPos(-b) - erfcPos(-a) : 2 - erfcPos(-a) - erfcPos(b);
  return SQRT_PI_2 * d;
}

/** int_a^infinity exp(-x^2) dx. */
export function gtail(a: number): number {
  return SQRT_PI_2 * (a >= 0 ? erfcPos(a) : 2 - erfcPos(-a));
}

/** What a segment integral returns: unit-density optical depth, its centroid along the ray, and its spread (one sigma). */
export type Seg = { tau: number; tc: number; spread: number };

/**
 * int_{t0}^{t1} exp(-|O + D t|^2) dt (O, D given as 4 components; pass 0 for unused ones), with the centroid of the
 * integrand on the segment and a spread. t1 <= t0 gives 0 (and the centroid t0).
 */
export function gaussRay(O: readonly number[], D: readonly number[], t0: number, t1: number): Seg {
  const L = Math.max(t1 - t0, 0);
  const alpha = D[0] * D[0] + D[1] * D[1] + D[2] * D[2] + D[3] * D[3];
  const al = Math.max(alpha, 1e-20);
  const od = O[0] * D[0] + O[1] * D[1] + O[2] * D[2] + O[3] * D[3];
  const tm = -od / al;
  const s = Math.sqrt(al);
  const q = (t: number) => (O[0] + D[0] * t) ** 2 + (O[1] + D[1] * t) ** 2 + (O[2] + D[2] * t) ** 2 + (O[3] + D[3] * t) ** 2;
  if (s * L < SIMPSON) {
    const tmid = t0 + 0.5 * L;
    const w0 = Math.exp(-q(t0)), wm = 4 * Math.exp(-q(tmid)), w1 = Math.exp(-q(t0 + L));
    const sum = w0 + wm + w1;
    const tc = sum > 0 ? (t0 * w0 + tmid * wm + (t0 + L) * w1) / sum : tmid;
    return { tau: (L / 6) * sum, tc, spread: Math.min(L * 0.288675, 0.707107 / s) };
  }
  const qmin = q(tm);
  const a = s * (t0 - tm), b = s * (t0 + L - tm);
  const g = gseg(a, b);
  const e = Math.exp(-qmin);
  // Centroid: int x exp(-x^2) = (exp(-a^2) - exp(-b^2)) / 2, in units of 1 / s.
  const tc = g > 1e-30 ? tm + (Math.exp(-a * a) - Math.exp(-b * b)) / (2 * s * g) : Math.min(Math.max(tm, t0), t0 + L);
  return { tau: (e / s) * g, tc, spread: Math.min(L * 0.288675, 0.707107 / s) };
}

/** The optical depth part of `gaussRay` alone (no centroid), allocating nothing: what the CPU light pass calls. */
export function gaussDepth(O: readonly number[], D: readonly number[], t0: number, t1: number): number {
  const L = Math.max(t1 - t0, 0);
  const alpha = D[0] * D[0] + D[1] * D[1] + D[2] * D[2] + D[3] * D[3];
  const al = Math.max(alpha, 1e-20);
  const tm = -(O[0] * D[0] + O[1] * D[1] + O[2] * D[2] + O[3] * D[3]) / al;
  const s = Math.sqrt(al);
  const q = (t: number): number => {
    const x = O[0] + D[0] * t, y = O[1] + D[1] * t, z = O[2] + D[2] * t, w = O[3] + D[3] * t;
    return x * x + y * y + z * z + w * w;
  };
  if (s * L < SIMPSON) return (L / 6) * (Math.exp(-q(t0)) + 4 * Math.exp(-q(t0 + 0.5 * L)) + Math.exp(-q(t0 + L)));
  return (Math.exp(-q(tm)) / s) * gseg(s * (t0 - tm), s * (t0 + L - tm));
}

/** int_0^infinity exp(-|O + D t|^2) dt, 3 components (toward the sun from a point). */
export function gaussTail(O: readonly number[], D: readonly number[]): number {
  const alpha = Math.max(D[0] * D[0] + D[1] * D[1] + D[2] * D[2], 1e-12);
  const tm = -(O[0] * D[0] + O[1] * D[1] + O[2] * D[2]) / alpha;
  const s = Math.sqrt(alpha);
  const qmin = (O[0] + D[0] * tm) ** 2 + (O[1] + D[1] * tm) ** 2 + (O[2] + D[2] * tm) ** 2;
  return (Math.exp(-qmin) / s) * gtail(-s * tm);
}

/**
 * The same functions in WGSL. `loft_gauss_ray` returns (tau, centroid, spread); `loft_gauss_tail` the semi-infinite
 * integral. Kept line for line with the JavaScript above.
 */
export const GAUSS_WGSL = /* wgsl */ `
fn loft_erfcp(z: f32) -> f32 {
  let t = 1.0 / (1.0 + 0.5 * z);
  return t * exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
}
fn loft_gseg(a: f32, b: f32) -> f32 {
  // erfc at |a| and |b| once each; the three cases (both ends above the centre, both below, astride) are differences
  // of those two of the same sign, so the tails keep their relative accuracy.
  let pa = loft_erfcp(abs(a));
  let pb = loft_erfcp(abs(b));
  return ${SQRT_PI_2} * select(select(2.0 - pa - pb, pb - pa, b <= 0.0), pa - pb, a >= 0.0);
}
fn loft_gtail(a: f32) -> f32 {
  let pa = loft_erfcp(abs(a));
  return ${SQRT_PI_2} * select(2.0 - pa, pa, a >= 0.0);
}
fn loft_q4(o: vec4<f32>, d: vec4<f32>, t: f32) -> f32 { let p = o + d * t; return dot(p, p); }
fn loft_gauss_ray(o: vec4<f32>, d: vec4<f32>, t0: f32, t1: f32) -> vec3<f32> {
  let L = max(t1 - t0, 0.0);
  let al = max(dot(d, d), 1e-20);
  let tm = -dot(o, d) / al;
  let s = sqrt(al);
  let spread = min(L * 0.288675, 0.707107 / s);
  if (s * L < ${SIMPSON}) {
    let tmid = t0 + 0.5 * L;
    let w0 = exp(-loft_q4(o, d, t0));
    let wm = 4.0 * exp(-loft_q4(o, d, tmid));
    let w1 = exp(-loft_q4(o, d, t0 + L));
    let sum = w0 + wm + w1;
    let tc = select(tmid, (t0 * w0 + tmid * wm + (t0 + L) * w1) / sum, sum > 0.0);
    return vec3<f32>((L / 6.0) * sum, tc, spread);
  }
  let qmin = loft_q4(o, d, tm);
  let a = s * (t0 - tm);
  let b = s * (t0 + L - tm);
  let g = loft_gseg(a, b);
  let tc = select(clamp(tm, t0, t0 + L), tm + (exp(-a * a) - exp(-b * b)) / (2.0 * s * g), g > 1e-30);
  return vec3<f32>(exp(-qmin) / s * g, tc, spread);
}
fn loft_gauss_tail(o: vec3<f32>, d: vec3<f32>) -> f32 {
  let al = max(dot(d, d), 1e-12);
  let tm = -dot(o, d) / al;
  let s = sqrt(al);
  let p = o + d * tm;
  return exp(-dot(p, p)) / s * loft_gtail(-s * tm);
}
`;

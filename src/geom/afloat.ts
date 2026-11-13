// Afloat: a rigid placement on the water whose height, pitch and roll come from the water under it, so a floating
// thing rides the swell (or a whirlpool's funnel wall) with no animation code of its own.
//
// The water is sampled at four points: front and back (half the length either side of the centre, along the heading)
// and left and right (half the beam either side). The origin sits at the mean of the four heights; the forward axis
// climbs by the front-to-back difference over the length (pitch), the right axis by the right-to-left difference over
// the beam (roll). A wind heels the thing further, away from the wind, in proportion to how much of it comes across.
//
// Local coordinates of the placed thing: x forward, y up, z to the right (= x cross y), origin at the water level
// at its centre.

import { add, cos, cross, dot, lift, mul, normalize, sin, sub, substitute, time, vec2, vec3, type Expr, type In } from "../expr.ts";
import { rigid } from "./rig.ts";
import type { Chart, F, Frame, P3 } from "../map/types.ts";

type V2 = Expr<"vec2">;

/**
 * Water something can float on: the sea, or a deformation of it in its own coordinates (`pool.in(sea)`). `carry` takes
 * a point given in the water's own plane coordinates to the sea plane now, with how far a thing there has been turned;
 * `height` is the surface height at a sea-plane point.
 */
export interface Waters {
  carry(at: V2): { readonly xz: V2; readonly turn: F };
  height(xz: V2): F;
}

export type AfloatSpec = {
  /** Where, in the water's own plane coordinates (x, z). */
  readonly at: In<"vec2">;
  /** Heading of the forward axis, radians from +x toward +z, in the water's coordinates (it turns with the water). */
  readonly heading: In<"f32">;
  /** The span the water is sampled over: length (front to back) and beam (side to side). */
  readonly length: number;
  readonly beam: number;
  /** How high the local origin sits above the mean water level. Default 0. */
  readonly lift?: number;
  /**
   * A wind: the direction it blows toward (x, z) and the heel, radians, it gives when it comes straight across. The
   * heel is away from the wind and breathes a little with gusts (a fixed 12% wobble in time). Default no wind.
   */
  readonly wind?: { readonly direction: readonly [number, number]; readonly heel: number };
};

/**
 * `afloat`'s frame without the chart: origin at the water level under the thing's centre, x forward, y up, z to the
 * right, all expressions. One step down from `afloat` (see it for the law and limits): turn it, lift it, blend it with
 * another frame (`turnedAbout`, `blendFrames`), then place with `rigid`. It cannot see the water between its four
 * samples, nor lag behind it: it is the surface's tilt now, under those four points.
 */
export function afloatFrame(w: Waters, spec: AfloatSpec): Frame {
  if (!(spec.length > 0 && spec.beam > 0)) throw new Error(`afloat: length and beam must be positive, got ${spec.length}, ${spec.beam}`);
  const c = w.carry(lift<"vec2">(spec.at));
  const h = add(lift<"f32">(spec.heading), c.turn);
  const fwd = vec2(cos(h), sin(h)), stbd = vec2(mul(sin(h), -1), cos(h));
  const at = (d: V2, k: number): F => w.height(add(c.xz, mul(d, k)));
  const bow = at(fwd, spec.length / 2), stern = at(fwd, -spec.length / 2);
  const star = at(stbd, spec.beam / 2), port = at(stbd, -spec.beam / 2);
  const level = mul(add(add(bow, stern), add(star, port)), 0.25);
  const x = normalize(vec3(fwd.x, div0(sub(bow, stern), spec.length), fwd.y));
  const side = normalize(vec3(stbd.x, div0(sub(star, port), spec.beam), stbd.y));
  // Orthonormal, x exact: z is the starboard direction made perpendicular to the bow, y = z cross x.
  const z0 = normalize(sub(side, mul(x, dot(side, x))));
  const y0 = cross(z0, x);
  const lean = heelOf(spec, stbd);
  const y = add(mul(y0, cos(lean)), mul(z0, sin(lean))), z = sub(mul(z0, cos(lean)), mul(y0, sin(lean)));
  return { o: vec3(c.xz.x, add(level, spec.lift ?? 0), c.xz.y), x, y, z };
}

const div0 = (a: F, k: number): F => mul(a, 1 / k);

/** No wind: nothing heels the hull (the direction is arbitrary). */
const CALM = { direction: [1, 0], heel: 0 } as const;

/** Heel to starboard, radians: the wind's component toward starboard times the heel, with a slow gust. */
function heelOf(spec: AfloatSpec, stbd: V2): F {
  const wind = spec.wind ?? CALM;
  const l = Math.hypot(wind.direction[0], wind.direction[1]);
  if (!(l > 0)) throw new Error("afloat: the wind needs a direction");
  const across = add(mul(stbd.x, wind.direction[0] / l), mul(stbd.y, wind.direction[1] / l));
  const gust = add(1, mul(add(sin(mul(time, 0.53)), mul(sin(mul(time, 1.37)), 0.5)), 0.12));
  return mul(mul(across, wind.heel), gust);
}

/**
 * A rigid placement that floats on water: its height, pitch and roll are read from the surface under it, so it rides a
 * swell, a whirlpool's funnel wall or a passing ring wave with no motion of its own.
 *
 * The shape and its law. The water (`sea`, or `pool.in(sea)` for water that carries things round) is sampled at four
 * points, half the length ahead and behind along the heading and half the beam to either side. The origin sits at the
 * mean of the four heights (plus `lift`); the forward axis climbs by (front - back) / length, the right axis by
 * (right - left) / beam; then a wind heels it about the forward axis by heel times the share of the wind coming across.
 *
 * Parameters: `at` and `heading` take expressions (it can be driven across the water); `length`, `beam`, `lift` and the
 * wind are fixed numbers. On a whirlpool's chart `at` is in the whirlpool's coordinates and the water carries it.
 *
 * What it cannot do, because it is four samples of a height:
 * - respond with weight or inertia: it sits exactly on the water now, with no lag, no bobbing after a wave passes, no
 *   sinking deeper when loaded.
 * - see water shorter than itself: a wave whose length is near `length` or `beam` puts samples on crest and trough
 *   alike, and the thing sits level or jerks; detail between the four points is not seen at all.
 * - be pushed by the water: where it is comes from `at` (and a whirlpool's carry), never from the slope or a wave.
 * - tilt about anything but the sampled axes, or bend: it is one rigid frame.
 *
 * Going past it: `afloatFrame` gives the same frame as expressions, to change before placing with `rigid`. Relatives,
 * each by changing how the frame is read from the water:
 * - more samples, with the plane fitted to them by least squares: a long thing on short waves, averaged instead of
 *   aliased.
 * - the frame read at an earlier time, height(xz, t - lag), and blended with the present (`blendFrames`): a heavy thing
 *   that lags and overshoots the swell.
 * - `at` driven by the water's own velocity (a whirlpool chart's `drift`, a ring wave's `pushed`): flotsam that drifts.
 */
export function afloat(w: Waters, spec: AfloatSpec): Chart {
  return rigid(afloatFrame(w, spec));
}

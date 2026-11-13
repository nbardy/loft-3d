// Motion helpers, closed form in time (or in a 0..1 progress input): no state, so any of them can be read at another
// time for a telegraph or a smear, and superpose.

import { add, atan2, clamp, cos, dot, length, lift, mul, sin, smoothstep, sub, TAU, time, type In } from "../expr.ts";
import type { F, Frame, P3 } from "../map/types.ts";
import { unit } from "./limb.ts";

export type LookSpec = {
  /** The frame looking: its x is straight ahead, y up, z to the side. */
  readonly from: Frame;
  readonly target: In<"vec3">;
  /** Largest turn either way, radians: sideways (about y) and up or down (about z). */
  readonly yaw: number;
  readonly pitch: number;
};

/**
 * The direction toward a target as yaw and pitch, each held within its limit, and the unit direction they give: where
 * an eye, a head or a turret points.
 *
 * The law. With d = target - from.o: yaw = clamp(atan2(d . z, d . x), -yaw, yaw) (positive toward `from`'s z),
 * pitch = clamp(atan2(d . y, |d without its y part|), -pitch, pitch), and dir = y sin pitch + (x cos yaw + z sin yaw)
 * cos pitch. It is the target's direction in `from`'s spherical coordinates, held in a box; no time enters it.
 *
 * Parameters: `from` (a frame of expressions) and `target` can move; the limits `yaw` and `pitch` are fixed numbers.
 *
 * What it cannot do, because of the law:
 * - lag, ease or overshoot: it is where the target is now, so a target that jumps is followed in one frame.
 * - pass behind smoothly: as the target crosses straight behind, atan2 goes from +pi to -pi and the held yaw jumps
 *   from one limit to the other.
 * - soften at its limits: the clamp stops dead, with a corner in the motion.
 * - roll, or say anything when the target is at `from.o` (no direction).
 *
 * Going past it: yaw and pitch are returned, so a softer limit is your own function of the raw angle in place of the
 * clamp (yawMax tanh(a / yawMax) eases into the stop), and a lag is the same call with a target read on a later clock.
 * Relatives:
 * - eyes and head sharing a look: the head takes this with small limits, the eyes take the remainder of the angle
 *   with their own, so the eyes lead and the head follows.
 * - saccades: a target chosen per hold of `dart` (`chosen` of its `now`), so the gaze is still and then elsewhere.
 * - smooth pursuit: the target read at t - lag, or passed through `response` per angle, so the look trails and
 *   settles.
 */
export function lookAt(spec: LookSpec): { readonly yaw: F; readonly pitch: F; readonly dir: P3 } {
  const f = spec.from, d = sub(lift<"vec3">(spec.target), f.o);
  const ahead = dot(d, f.x), side = dot(d, f.z), up = dot(d, f.y);
  const yaw = clamp(atan2(side, ahead), -spec.yaw, spec.yaw);
  const flat = length(add(mul(f.x, ahead), mul(f.z, side)));
  const pitch = clamp(atan2(up, flat), -spec.pitch, spec.pitch);
  const dir = add(mul(f.y, sin(pitch)), mul(add(mul(f.x, cos(yaw)), mul(f.z, sin(yaw))), cos(pitch)));
  return { yaw, pitch, dir: unit(dir) };
}

export type BreathSpec = { readonly rate: In<"f32">; readonly depth: In<"f32">; readonly phase?: In<"f32">; readonly t?: In<"f32"> };

/**
 * A breathing scale, 1 at rest out to 1 + depth, for a chest, a body or anything that swells and empties.
 *
 * The law. theta = 2 pi (rate t + phase), and the scale is 1 + depth (1 - cos(theta + 0.4 sin theta)) / 2. The warp
 * theta + 0.4 sin theta runs the first half of each cycle faster than the second, so the breath in is quicker than
 * the breath out and it reads as breathing, not as a pulse. Smooth everywhere, and it repeats every 1 / rate seconds.
 *
 * Parameters: `rate` (breaths per second), `depth`, `phase` and the clock `t` (default `time`) all take expressions.
 *
 * What it cannot do, because of the law:
 * - pause: there is no rest at the top or the bottom of a breath; it is always moving.
 * - vary one breath from the next: every breath is the same, with no sigh and no catch.
 * - change rate smoothly by moving `rate`: the phase is rate * t, so a rate that changes makes the phase leap. Count
 *   the phase yourself (a clock you integrate) and pass it as `t` with `rate` 1.
 * - shrink below rest, or change the in-to-out ratio (the skew is fixed at 0.4).
 *
 * Going past it: it is one line of the clock, so the one step down is to write the line with your own warp. Relatives:
 * - a breath with a pause: hold the phase still for part of the cycle (theta through a `slowInOut` of its fraction),
 *   so the chest rests empty before it fills.
 * - a heartbeat: two narrow bumps a cycle (lub, dub) instead of one wide one: a sum of two `pulse`s on the cycle's
 *   fraction.
 * - a sigh: an occasional larger breath, its depth chosen per hold of `dart`.
 * - the moving hold of a whole pose: `alive`, two slow sines that never line up.
 */
export function breathe(spec: BreathSpec): F {
  const th = mul(add(mul(spec.t ?? time, spec.rate), spec.phase ?? 0), TAU);
  const skewed = add(th, mul(sin(th), 0.4));
  return add(1, mul(spec.depth, mul(sub(1, cos(skewed)), 0.5)));
}

export type BeatSpec = {
  /** Beats per second. */
  readonly rate: In<"f32">;
  /** Peak angle either side of `bias`, radians. */
  readonly amplitude: In<"f32">;
  /** Seconds the tip (r = 1) runs behind the root (r = 0). */
  readonly lag: In<"f32">;
  /** Mean angle, radians. Default 0. */
  readonly bias?: In<"f32">;
  /** About the share of the cycle the downstroke takes (0.5 symmetric; below, a quick downstroke and a slow recovery), 0.25 to 0.75. Default 0.5. */
  readonly down?: number;
  readonly t?: In<"f32">;
};

/**
 * A wing beat: the angle at r in [0, 1] along the wing, +angle up. Also a fin, a flipper or any limb that flaps.
 *
 * The law. theta = 2 pi rate (t - lag r) and angle = bias + amplitude sin(theta + c sin theta), c = (down - 0.5) pi.
 * Each point reads the same beat on a clock delayed by lag r (as `retarded` does along a body), so the tip trails the
 * root and the wing flexes through each stroke; the warp moves the top of the stroke earlier and the bottom later by
 * about c, so the downstroke takes about (pi + 2c) / 2 pi of the cycle. It repeats every 1 / rate seconds.
 *
 * Parameters: `rate`, `amplitude`, `lag`, `bias`, the clock `t` and `r` take expressions; `down` is a fixed number in
 * [0.25, 0.75].
 *
 * What it cannot do, because of the law:
 * - leave its plane: it is one angle, so no sweep fore and aft and no twist of the wing about its own length (the
 *   figure-eight stroke of a hovering wing is out of reach on its own).
 * - change shape along the wing: every point swings the same amplitude, only later.
 * - change rate smoothly by moving `rate`: the phase is rate * t, so a rate that changes makes the beat leap.
 * - vary one stroke from the next, or stop and glide, except by the caller blending `amplitude` to 0.
 *
 * Going past it: the law is one sine of a delayed clock, so another stroke is the same clock with your own function
 * of the phase. Relatives:
 * - a twist (feathering): a second `beat` about the wing's length on a clock a quarter cycle off (`t` minus
 *   0.25 / rate), so the wing turns most while it moves fastest and lies flatter on the way up.
 * - the figure eight of a hover: a sweep angle fore and aft at twice the rate of this one.
 * - a swimming body or a waving flag: the same delayed clock with r along the body and the amplitude growing with r,
 *   a travelling wave (`wave` writes it as a displacement).
 */
export function beat(r: In<"f32">, spec: BeatSpec): F {
  const down = spec.down ?? 0.5;
  if (!(down >= 0.25 && down <= 0.75)) throw new Error(`beat: down must be in [0.25, 0.75], got ${down}`);
  const th = mul(sub(spec.t ?? time, mul(spec.lag, r)), mul(lift<"f32">(spec.rate), TAU));
  // A phase warp psi = theta + c sin(theta) moves the top (psi = pi / 2) earlier by about c and the bottom later by
  // about c, so the downstroke takes about (pi + 2c) / 2 pi of the cycle; |c| < 1 keeps the warp monotone.
  const c = (down - 0.5) * Math.PI;
  return add(spec.bias ?? 0, mul(spec.amplitude, sin(add(th, mul(sin(th), c)))));
}

export type StrikeSpec = {
  /** How far the wind-up goes the wrong way, as a share of the strike. */
  readonly anticipation: In<"f32">;
  /** How far past the hit the follow-through carries, as a share of the strike. */
  readonly follow: In<"f32">;
  /** Progress at which the wind-up is full, the hit lands, the follow-through peaks and the recovery starts. */
  readonly timing?: readonly [number, number, number, number];
};

/**
 * A strike envelope over its progress s in [0, 1]: a number to drive any pose that winds up, hits and recovers.
 *
 * The law. With keys [a, i, f, r] = `timing` (default [0.35, 0.5, 0.6, 0.75]), it is 0 at s = 0, -anticipation at a
 * (the wind-up), 1 at i (the hit), 1 + follow at f (the follow-through), 1 again at r, and 0 at s = 1 (the recovery).
 * Between keys it is a smoothstep, so it is continuous with zero speed at every key; outside [0, 1] it is 0.
 *
 * Parameters: `s`, `anticipation` and `follow` take expressions (the game decides when and how fast by driving s);
 * `timing` is fixed numbers.
 *
 * What it cannot do, because of the law:
 * - land at speed: every key is reached with zero speed, the hit included, so it eases into the blow.
 * - more or fewer phases than five: no double wind-up, no hold before the hit, no second blow.
 * - say where the pose goes: it is one number, and the caller maps it onto angles or positions.
 *
 * Going past it: it is a sum of smoothsteps between keys, so another envelope is the same sum with your own keys and
 * your own ease per segment. Relatives:
 * - a blow that lands at speed: the wind-up-to-hit segment by `slowIn` instead of a smoothstep.
 * - a springy recovery: from the hit, `response` or `swing` on seconds since it, so the part rings and settles.
 * - the same three parts on a clock in seconds instead of a progress: `beats` to split the clock, `anticipated` for
 *   the action, `overshot` for the arrival.
 * - a combination: several strikes on shifted progresses, summed.
 */
export function strike(s: In<"f32">, spec: StrikeSpec): F {
  const [a, i, f, r] = spec.timing ?? [0.35, 0.5, 0.6, 0.75];
  if (!(0 < a && a < i && i < f && f < r && r < 1)) throw new Error(`strike: timing must increase within (0, 1), got [${a}, ${i}, ${f}, ${r}]`);
  const x = lift<"f32">(s), A = lift<"f32">(spec.anticipation);
  const windup = mul(A, smoothstep(0, a, x));
  const hit = mul(add(A, 1), smoothstep(a, i, x));
  const over = mul(spec.follow, sub(smoothstep(i, f, x), smoothstep(f, r, x)));
  return sub(add(sub(hit, windup), over), smoothstep(r, 1, x));
}

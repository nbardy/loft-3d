// A hanging thing's swing, in closed form (docs/animation_principles.md, "Stalks and hanging things").
//
// A bob on an arm of length L under gravity g, lightly damped, hung from a pivot that something else moves. For small
// swings its angle from plumb, psi (radians, positive the way the pivot's positive displacement points), obeys
//
//   psi'' + 2 zeta w0 psi' + w0^2 psi = -x_p'' / L        w0 = sqrt(g / L)
//
// which is linear, so its answer to several drives is the sum of its answers to each, and each is a closed form of the
// clock (no state between frames):
//
//   sway   the pivot moves A sin(w t + phase), for ever (a walk's sway). The bob has settled into
//          psi = G sin(w t + phase - lag), with G = (A w^2 / L) / sqrt((w0^2 - w^2)^2 + (2 zeta w0 w)^2) and
//          lag = atan2(2 zeta w0 w, w0^2 - w^2). Near w = w0 the swing is large and a quarter turn late.
//   jolt   the pivot's velocity changes by v at an instant (a slam, a snatch, a throw's release). The bob is left
//          behind: psi = -(v / (L wd)) exp(-zeta w0 s) sin(wd s), s seconds later; wd = w0 sqrt(1 - zeta^2).
//
// Nothing here is chosen but the damping: how fast it swings follows from its length and the world's gravity, how far
// from how hard its pivot was moved. Two bobs of different lengths drift in and out of step by themselves.
//
// Inherited: the damped driven oscillator, a first-year result. Mine: using its steady state and impulse response as
// the animation itself, so a hanging part's swing is derived from the rig's own sway and attack clocks rather than keyed.

import { add, exp, lift, lt, max, mul, select, sin, type Expr, type In } from "../expr.ts";

type F = Expr<"f32">;

export type PendulumSpec = {
  /** The arm's length, world units, and the world's gravity, units / s^2. */
  readonly length: number; readonly gravity: number;
  /** Damping ratio, 0 (swings for ever) to below 1; 0.1 dies away over about three swings. */
  readonly damping: number;
};

/** What moves the pivot. One dispatcher reads the kind (`answer`). */
export type Drive =
  /** The pivot sways `amplitude` sin(2 pi t / period + phase), world units, and has for a long time. */
  | { readonly kind: "sway"; readonly amplitude: In<"f32">; readonly period: number; readonly phase?: number }
  /** The pivot's velocity changed by `speed` (units / s) when `after` (seconds) passed 0; nothing before. */
  | { readonly kind: "jolt"; readonly after: In<"f32">; readonly speed: In<"f32"> };

/**
 * A pivot that sways: x_p = amplitude sin(2 pi t / period + phase), and has been swaying long enough that the bob has
 * settled into its steady answer, G sin(w t + phase - lag) (see `pendulum`).
 *
 * The law. The steady state of the damped driven oscillator: the bob swings at the pivot's own rate, by
 * G = (A w^2 / L) / sqrt((w0^2 - w^2)^2 + (2 zeta w0 w)^2) per unit, late by atan2(2 zeta w0 w, w0^2 - w^2) / w.
 * Near w = w0 it swings most and a quarter turn late; far faster than w0 it swings against the pivot.
 *
 * Parameters: `amplitude` takes an expression; `period` and `phase` are fixed numbers (the gain and lag are computed
 * from the period on the CPU).
 *
 * What it cannot do, because of the law:
 * - start or stop: it has always been swaying; a start from rest leaves out the ringing a real start would set off.
 * - follow an amplitude that changes fast: the answer is the steady one for whatever the amplitude is now, which is
 *   right only while it changes slowly against the swing.
 * - change its period in time: the period is a number.
 *
 * Going past it: a `Drive` is a variant read by `pendulum`'s `answer`, so the one step down is several drives summed
 * (the law is linear). Relatives:
 * - a pivot that sways in a figure of two rates: two `sway`s, one per rate, summed.
 * - a pivot keyed by hand: a `jolt` at each key of a piecewise-linear path.
 */
export const sway = (amplitude: In<"f32">, period: number, phase = 0): Drive => ({ kind: "sway", amplitude, period, phase });
/**
 * A pivot whose speed changes by `speed` (units / s) at the instant `after` passes 0: a slam, a snatch, a throw's
 * release. Nothing before.
 *
 * The law. The impulse answer of the damped oscillator: psi = -(speed / (L wd)) e^(-zeta w0 s) sin(wd s), s = after
 * seconds on, wd = w0 sqrt(1 - zeta^2). The bob is left behind (the minus sign), starts at plumb with speed, and rings
 * down. The angle is continuous at the instant; its speed jumps.
 *
 * Parameters: `after` (seconds since the change, from any clock: an attack's beat, `time` minus a cue) and `speed`
 * take expressions.
 *
 * What it cannot do, because of the law:
 * - spread the change over time: it is instant; a push over a while is several jolts in a row, or a sway.
 * - start the bob anywhere but plumb at rest: it is the answer to one change from stillness.
 * - happen twice: one instant per jolt; several are several `jolt`s.
 *
 * Going past it: the law is linear, so any piecewise-linear pivot path is exactly a list of jolts at its keys, each
 * with that key's change of speed. Relatives:
 * - a `swing` from `lively.ts`: the same ringing with a chosen rate, for a part that has no length to derive one from.
 * - a stop: a jolt whose speed is minus the speed the pivot had, so a part swings forward when its carrier halts.
 */
export const jolt = (after: In<"f32">, speed: In<"f32">): Drive => ({ kind: "jolt", after, speed });

/**
 * Raised by `pendulum` for a length or gravity that is not a positive number, a damping outside [0, 1), and by its
 * `gain` (and so `answer` with a sway) for a sway period that is not a positive number. It carries only the message,
 * which names the value.
 */
export class PendulumError extends Error {}

export type Pendulum = {
  /** Its own swings per second, and seconds per swing. */
  readonly hz: number; readonly period: number;
  /** A sway's steady answer in plain numbers: radians of swing per unit of the pivot's sway, and seconds late. */
  readonly gain: (period: number) => { readonly perUnit: number; readonly late: number };
  /** The angle from plumb at clock t, radians: the sum of its answers to the drives. */
  readonly answer: (t: In<"f32">, drives: readonly Drive[]) => F;
};

/**
 * A hanging thing's swing: a bob on an arm under gravity, lightly damped, hung from a pivot something else moves.
 *
 * The law. The angle from plumb psi obeys the small-swing damped driven oscillator
 * psi'' + 2 zeta w0 psi' + w0^2 psi = -x_p'' / L, with w0 = sqrt(gravity / length), zeta the damping and x_p the
 * pivot's displacement. It is linear in the drives, so `answer(t, drives)` sums the closed-form answer to each: a
 * sway's steady state, a jolt's ringing. How fast it swings follows from length and gravity; how far from how hard
 * the pivot moves. No state: every answer is a function of the clock.
 *
 * Parameters: `length`, `gravity`, `damping` are fixed numbers (they decide the natural frequency on the CPU); a
 * sway's amplitude and a jolt's time and speed are expressions, so the drives can come from any clock.
 *
 * What it cannot do, because of the law:
 * - large swings: the law is linearised, so a swing past about half a radian is too regular and never goes over the
 *   top.
 * - a pivot path that is neither a steady sway nor a list of sudden changes of speed: a sway that starts or stops,
 *   or a smooth push, except as many small jolts.
 * - more than one degree of freedom: no swing in two planes at once (a conical swing), no double pendulum, no chain.
 * - a bob that hits something, or a length that changes.
 *
 * Going past it: the law is linear and `answer` sums the drives, so a new motion of the pivot is a sum of the two
 * kinds where it can be: a pivot path that is piecewise linear in time is exactly a jolt at each key (the change of
 * speed there), so any keyed path is a list of `jolt`s. A sway that starts from rest at an instant is not such a sum:
 * it is the steady answer plus a free ringing that cancels the steady answer's angle and speed at the start, which is
 * one more closed form (e^(-zeta w0 s) times a cosine and a sine of wd s) and so one more `Drive` kind with its case in
 * `answer`. Relatives:
 * - a swing in two planes: two pendulums on the same pivot, one per horizontal axis (exact for small swings).
 * - a stiff stalk instead of a hanging arm: the same oscillator with w0 from the stalk's stiffness instead of g / L
 *   (pass `gravity` = w0^2 L to choose it), the pivot's push the same; drive `bent`'s `bow` by its angle.
 * - a whip: `bent`'s `bow` and `crook` each driven by a pendulum's angle, the crook on a later clock than the bow.
 * - a part that just rings after a stop, with a rate chosen rather than derived: `swing`.
 */
export function pendulum(spec: PendulumSpec): Pendulum {
  const { length: L, gravity: g, damping: zeta } = spec;
  if (!(L > 0 && Number.isFinite(L))) throw new PendulumError(`pendulum: length must be a positive number, got ${L}`);
  if (!(g > 0 && Number.isFinite(g))) throw new PendulumError(`pendulum: gravity must be a positive number, got ${g}`);
  if (!(zeta >= 0 && zeta < 1)) throw new PendulumError(`pendulum: damping must be in [0, 1) (at 1 and over it does not swing), got ${zeta}`);
  const w0 = Math.sqrt(g / L), wd = w0 * Math.sqrt(1 - zeta * zeta);
  const gain = (period: number) => {
    if (!(period > 0 && Number.isFinite(period))) throw new PendulumError(`pendulum: a sway's period must be a positive number of seconds, got ${period}`);
    const w = (2 * Math.PI) / period, re = w0 * w0 - w * w, im = 2 * zeta * w0 * w;
    return { perUnit: (w * w) / L / Math.hypot(re, im), late: Math.atan2(im, re) / w };
  };
  const answer = (t: In<"f32">, drives: readonly Drive[]): F => drives.map((d): F => {
    // The one place a drive's kind is read.
    switch (d.kind) {
      case "sway": {
        const k = gain(d.period), w = (2 * Math.PI) / d.period;
        return mul(mul(d.amplitude, k.perUnit), sin(add(mul(lift<"f32">(t), w), (d.phase ?? 0) - k.late * w)));
      }
      case "jolt": {
        const s = max(d.after, 0);
        const ring = mul(exp(mul(s, -zeta * w0)), sin(mul(s, wd)));
        return mul(mul(mul(d.speed, -1 / (L * wd)), ring), select(lt(lift<"f32">(d.after), 0), 0, 1));
      }
    }
  }).reduce((acc, x) => add(acc, x), lift<"f32">(0));
  return { hz: w0 / (2 * Math.PI), period: (2 * Math.PI) / w0, gain, answer };
}

// A pose struck and held (docs/animation_principles.md, Expressions; the timing of kabuki's mie).
//
// A mie is three parts: the face is driven into a pose in a few frames, holds it dead still, then lets it go. `struck`
// is that as one weight of a clock, for a score's `show` layer (src/geom/expression.ts). The snap leaves the wrong way
// (anticipation), arrives at speed and stops in one frame; through the hold the weight is exactly 1; the release eases.
//
// Stillness needs no switch. A `show` at weight exactly 1 replaces every channel with the expression's own number, so
// whatever was laid before it (a blink, a tremble, a moving hold) is covered while the pose is held. The rule a score
// keeps is one of order: lay what flows first and what is struck after it. `holdsStill` checks that it did: through
// each hold every channel is the cast's number, to a stated tolerance.
//
// A part that reads the score late (`score.at(time - lag)`) strikes late: in a mie every part lands on one beat, so a
// struck face reads its score on one clock. `since` is the beat for whatever is loose and may keep swinging after it
// (`swing(pose.since, ...)`): cords and tassels moving beside a face that does not is what makes the stillness read.

import type { Check, Tolerance } from "../check.ts";
import { div, lift, lt, mul, select, smoothstep, sub, time, type Expr, type In } from "../expr.ts";
import type { Score } from "./expression.ts";
import { anticipated } from "./lively.ts";

type F = Expr<"f32">;

/**
 * Raised by `struck` for a snap or release that is not a positive number of seconds, a hold below 0, a cue that is not
 * finite or a recoil below 0; and by `holdsStill` when given no poses or a pose the cast does not name. It carries only
 * the message, which names the value.
 */
export class StruckError extends Error {}

/** A struck pose's timing on its clock, seconds. */
export type StruckSpec = {
  /** The cue: the clock's value when the snap begins. */
  readonly from: number;
  /** Seconds from the cue to the pose: a few frames (0.13 s is four at 30 a second). */
  readonly snap: number;
  /** Seconds the pose is held dead still. */
  readonly hold: number;
  /** Seconds to let it go. A pose struck over this one before then covers the release. */
  readonly release: number;
  /** How hard the snap first goes the wrong way (`anticipated`'s `back`): 0 none, 1.7 (the default) about a tenth. */
  readonly recoil?: number;
};

export type Struck = {
  readonly spec: StruckSpec;
  /** How much of the face the pose is: 0 until the cue, below 0 as it recoils, exactly 1 from its arrival through the
   * hold, eased to 0 over the release. */
  readonly weight: F;
  /** 1 while the pose is held (from its arrival to the end of the hold), else 0. */
  readonly still: F;
  /** Seconds since the pose arrived (negative before): the beat loose parts swing from. */
  readonly since: F;
};

/**
 * A pose struck on `clock` (any expression of seconds: an attack's `tau`, the scene's `time`): driven into a pose in a
 * few frames, held dead still, then let go. The weight is for a score's `show` layer.
 *
 * What it assumes of the subject: one drawn from a `score`, where a `show` at weight exactly 1 replaces every channel.
 * Used for anything else (a pose's angle), the weight is still an envelope, but nothing guarantees stillness.
 *
 * The law. With arrive = from + snap and leave = arrive + hold: before arrive the weight is `anticipated`((t - from) /
 * snap, recoil), which dips below 0 and reaches 1 at full speed; from arrive to leave it is exactly 1 (a separate
 * branch, so f32 rounding of the snap's polynomial lets nothing under the pose show through); after, it is
 * 1 - smoothstep(leave, leave + release, t). `still` is 1 through the hold, and `since` is t - arrive.
 *
 * Parameters: the clock takes an expression; `from`, `snap`, `hold`, `release` and `recoil` are fixed numbers.
 *
 * What it cannot do, because of the law:
 * - ease into the pose: it arrives at full speed and stops in one frame (the snap is the point).
 * - hold for a time the game decides: the hold is fixed seconds on its clock; drive the clock to stretch it.
 * - keep anything moving under it during the hold: everything laid before it is covered; what must move goes after.
 * - strike twice: one cue per `struck`; a second pose is a second `struck` laid over the first's release.
 *
 * Going past it: the weight is three branches of one clock, so another timing is the same shape with your own
 * segments. Relatives:
 * - loose parts that keep moving through the hold: `swing(since, ...)`, so cords and tassels swing beside a face that
 *   does not.
 * - a softer arrival: `overshot` in place of the snap, for a pose that lands and settles instead of locking.
 * - a pose that comes and goes without a hold: `during`, or `strike` on a progress.
 */
export function struck(clock: In<"f32">, o: StruckSpec): Struck {
  for (const k of ["snap", "release"] as const) if (!(o[k] > 0 && Number.isFinite(o[k]))) throw new StruckError(`struck: ${k} must be a positive number of seconds, got ${o[k]}`);
  if (!(o.hold >= 0 && Number.isFinite(o.hold))) throw new StruckError(`struck: hold must be a finite number of seconds, at least 0; got ${o.hold}`);
  if (!Number.isFinite(o.from)) throw new StruckError(`struck: from must be a finite clock value, got ${o.from}`);
  const recoil = o.recoil ?? 1.7;
  if (!(recoil >= 0 && Number.isFinite(recoil))) throw new StruckError(`struck: recoil must be a finite number, at least 0; got ${recoil}`);
  const t = lift<"f32">(clock), arrive = o.from + o.snap, leave = arrive + o.hold;
  // Two branches, so the held weight is the release's own 1 and not the snap's polynomial at its end: in f32 that is
  // 2.7 - 1.7, one part in ten million over 1, and that much of whatever lies under the pose would show through.
  const weight = select(lt(t, arrive), anticipated(div(sub(t, o.from), o.snap), recoil), sub(1, smoothstep(leave, leave + o.release, t)));
  const still = mul(select(lt(t, arrive), 0, 1), select(lt(t, leave), 1, 0));
  return { spec: o, weight, still, since: sub(t, arrive) };
}

/**
 * Through each struck pose's hold, over one `period` of the scene's clock, every channel of the score is the named
 * expression's own number to `within` (units of the channel, or a share of the channel's spread across the cast). It
 * fails if a layer laid after the pose moves under it, if the pose's weight is not 1 there, or if a pose is never held.
 *
 * The law. A `Check`: on the CPU it samples the clock at `rate` per second (default 30) over [0, period), keeps the
 * samples where a pose's `still` is 1 at the sample and half a sample either side, and measures the largest distance of
 * any channel of `score.at(time)` from that pose's numbers. It passes when every pose was held at some sample and no
 * distance passed the allowance.
 *
 * Parameters: the score and the poses as built; `period`, `within` (a `tolerance`) and `rate` are fixed.
 *
 * What it cannot do, because of the law:
 * - follow a score or pose driven by anything but the scene clock `time`: the probe steps only the clock, and every
 *   host input stays where the probe set it (its default unless the check's caller set it).
 * - see a hold shorter than about two samples, or a flicker between samples.
 * - check a pose with `hold` 0: it is never still, so it fails as never held.
 *
 * Going past it: it is one `Check`, so a check of your own on the same probe follows its pattern. Relatives:
 * - a check that the pose is reached at all, whenever it is shown: the same sampling, with the weight above a
 *   threshold in place of `still`.
 * - a check that loose parts do move during the hold: the same samples, measuring their spread instead of a bound.
 */
export function holdsStill<K extends string, N extends string>(score: Score<K, N>, poses: Readonly<Partial<Record<N, Struck>>>, o: { readonly period: number; readonly within: Tolerance; readonly rate?: number }): Check {
  const names = Object.keys(poses) as N[];
  if (names.length === 0) throw new StruckError("holdsStill: no poses to measure");
  for (const n of names) if (score.cast.named[n] === undefined) throw new StruckError(`holdsStill: no expression "${n}" in the cast (named: ${Object.keys(score.cast.named).join(", ")})`);
  const rate = o.rate ?? 30, channels = score.cast.channels;
  const posed = score.at(time);
  const roots = [...names.map((n) => poses[n]!.still), ...channels.map((k) => posed[k])];
  const everyone = [score.cast.rest, ...Object.values<Readonly<Record<K, number>>>(score.cast.named)];
  /** What `within` allows on a channel. */
  const allowed = (k: K): number => {
    switch (o.within.kind) {
      case "units": return o.within.units;
      case "share": { const xs = everyone.map((e) => e[k]); return o.within.share * (Math.max(...xs) - Math.min(...xs)); }
    }
  };
  return {
    name: `struck poses hold still (${names.join(", ")})`,
    run(probe) {
      const held = names.map(() => 0);
      let worst = { over: -Infinity, off: 0, pose: "", channel: "", t: 0 };
      const steps = Math.round(o.period * rate);
      for (let i = 0; i < steps; i++) {
        const t = i / rate, row = probe.eval(roots, t) as number[];
        for (const [p, name] of names.entries()) {
          // Strictly inside the hold: a sample on its first or last instant may round to either side of the edge.
          if (row[p]! < 1 || (probe.eval(roots, t - 0.5 / rate) as number[])[p]! < 1 || (probe.eval(roots, t + 0.5 / rate) as number[])[p]! < 1) continue;
          held[p] = held[p]! + 1 / rate;
          const want = score.cast.named[name];
          for (const [c, k] of channels.entries()) {
            const off = Math.abs(row[names.length + c]! - want[k]), over = off - allowed(k);
            if (over > worst.over) worst = { over, off, pose: name, channel: k, t };
          }
        }
      }
      const never = names.filter((_, p) => held[p]! <= 0);
      const said = names.map((n, p) => `${n} ${held[p]!.toFixed(2)} s`).join(", ");
      return {
        name: this.name, pass: never.length === 0 && worst.over <= 0, value: worst.off,
        measured: `${never.length > 0 ? `never held: ${never.join(", ")}; ` : ""}held ${said}; furthest from its pose ${worst.off.toExponential(1)} (${worst.pose}, ${worst.channel}, t=${worst.t.toFixed(2)})`,
        limit: `every pose held; every channel within ${o.within.kind === "units" ? `${o.within.units} units` : `${(o.within.share * 100).toFixed(2)}% of its spread`} of its pose`,
      };
    },
  };
}

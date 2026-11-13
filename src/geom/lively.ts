// Lively motion: the twelve principles of animation (Johnston and Thomas, The Illusion of Life, 1981) as formulas.
// docs/animation_principles.md says what each principle is and which helper serves it. Everything here is a pure
// function of a clock, so it runs wherever pose runs and keeps no state between frames.
//
// What was already in the library and is used as is: `response` (a damped spring's answer to a step: follow through,
// overshoot, and anticipation with r < 0), `retarded` (the clock a part further along a body reads: drag), `pulse`,
// `ease`, `breathe` (a moving hold), `strike`, `lookAt`.

import { add, clamp, cos, div, exp, lift, max, min, mix, mul, pow, select, lt, sin, sqrt, sub, vec3, type Expr, type In, namespaceSeed } from "../expr.ts";
import { hash3 } from "../lib/noise.ts";
import { size } from "../map/chart.ts";
import type { Size } from "../map/types.ts";

type F = Expr<"f32">;
type P3 = Expr<"vec3">;
const TAU = Math.PI * 2;

// ---- timing: an action is three beats -------------------------------------------------------------------------------

/** How long each beat of an action lasts, seconds. An action with no wind-up or no settle gives that beat 0. */
export type Beats = { readonly anticipate: number; readonly act: number; readonly settle: number };

/** Where a clock is in each beat: 0 before it, 1 after it, rising across it. `since` is seconds since the action began. */
export type Beat = {
  /** The wind-up: the audience is told what is coming. */
  readonly anticipate: F;
  /** The action itself. */
  readonly act: F;
  /** After the action: loose parts catch up and come to rest. */
  readonly settle: F;
  /** Seconds since the action ended its `act` beat (negative before). Feed it to `response` for follow through. */
  readonly after: F;
};

/**
 * Timing. Split one clock into wind-up, action and settle. Fewer seconds in `act` reads as fast and light, more as
 * slow and heavy; a long `anticipate` before a short `act` is what makes a hit read as a hit.
 *
 * The law. With A, B, C the three durations, each beat is a linear ramp of the clock held to [0, 1]: anticipate =
 * clamp(since / A), act = clamp((since - A) / B), settle = clamp((since - A - B) / C), and after = since - A - B. A
 * beat of 0 seconds is a step at its start. Each ramp is continuous, with a corner at each end.
 *
 * Parameters: `since` takes an expression (seconds since the action began, from any clock); the three durations are
 * fixed numbers, `act` above 0.
 *
 * What it cannot do, because of the law:
 * - ease: each beat is linear, so its shape comes from what the caller passes it through (`slowInOut`, `anticipated`,
 *   `overshot`).
 * - stretch at run time: the durations are numbers, so a game cannot make one action slower; it can only drive
 *   `since` faster or slower.
 * - more than three beats, a hold between them, or repeat: it is one shot from since = 0.
 *
 * Going past it: the beats are three clamps of one clock, so more beats or a hold are more clamps of your own.
 * Relatives:
 * - a looping action: `since` = mod(t, A + B + C), so the three beats repeat.
 * - a pose struck and held: `struck` is snap, hold and release on the same plan, with a hold that is exactly still.
 * - a window of seconds on any clock with eased edges: `during`.
 * - follow-through after the act: `swing(after, ...)` or `response(after, ...)`, which start where the act ends.
 */
export function beats(since: In<"f32">, b: Beats): Beat {
  for (const [k, v] of Object.entries(b)) if (!(v >= 0 && Number.isFinite(v))) throw new Error(`beats: ${k} must be a finite number of seconds, at least 0; got ${v}`);
  if (!(b.act > 0)) throw new Error(`beats: act must be positive (an action takes time); got ${b.act}`);
  const t = lift<"f32">(since);
  const span = (from: number, len: number): F => (len > 0 ? clamp(div(sub(t, from), len), 0, 1) : select(lt(t, from), 0, 1));
  return {
    anticipate: span(0, b.anticipate),
    act: span(b.anticipate, b.act),
    settle: span(b.anticipate + b.act, b.settle),
    after: sub(t, b.anticipate + b.act),
  };
}

// ---- slow in and slow out, anticipation, overshoot: shapes of 0..1 -------------------------------------------------------

/**
 * Slow in and slow out. 0..1 with zero speed at both ends; `power` 2 is gentle, 4 holds the extremes longer: two
 * halves of x^power, (2u)^p / 2 below the middle and its mirror above it, with u held to [0, 1].
 *
 * It cannot overshoot or go the wrong way (that is `overshot` and `anticipated`), and its two halves are always mirror
 * images, so it cannot ease out more than it eases in; `power` is a fixed number, at least 1.
 */
export function slowInOut(u: In<"f32">, power = 2): F {
  if (!(power >= 1)) throw new Error(`slowInOut: power must be at least 1, got ${power}`);
  const x = clamp(u, 0, 1);
  const rise = mul(0.5, pow(mul(x, 2), power)), fall = sub(1, mul(0.5, pow(mul(sub(1, x), 2), power)));
  return select(lt(x, 0.5), rise, fall);
}

/**
 * Slow out only: 1 - (1 - u)^power, u held to [0, 1]. Starts at speed, arrives gently. For something already moving
 * that comes to rest. It cannot overshoot, and the speed it starts at (power times the average) is set by `power`.
 */
export const slowOut = (u: In<"f32">, power = 2): F => sub(1, pow(sub(1, clamp(u, 0, 1)), power));
/**
 * Slow in only: u^power, u held to [0, 1]. Leaves gently, arrives at speed (power times the average). For a blow that
 * lands. It cannot stop at the end: the speed drops to 0 in one frame at u = 1, which is what an impact looks like.
 */
export const slowIn = (u: In<"f32">, power = 2): F => pow(clamp(u, 0, 1), power);

/**
 * Anticipation. 0..1 that first goes the wrong way, then drives through to 1. Use it for the action itself when the
 * wind-up and the action are one move.
 *
 * The law. With x = u held to [0, 1] and b = `back`: x^2 ((b + 1) x - b). It leaves 0 with zero speed, dips to
 * -4 b^3 / (27 (b + 1)^2) at x = 2b / (3 (b + 1)) (for b = 1.7, about -0.1 a third of the way), and arrives at 1 with
 * speed b + 3 times the average.
 *
 * Parameters: `u` takes an expression; `back` is a fixed number.
 *
 * What it cannot do, because of the law:
 * - set the dip's depth and its place apart: one number sets both, and a deeper dip comes later.
 * - settle: it arrives at full speed and stops dead at 1 (held there), so pair it with `overshot`, `impact` or a
 *   `swing` after.
 * - wind up more than once, or hold at the bottom of the wind-up.
 *
 * Going past it: it is one cubic, so the one step down is a polynomial of your own with p(0) = 0, p(1) = 1 and a
 * negative lobe. Relatives:
 * - `overshot` is its mirror, 1 - f(1 - u): it leaves at speed and runs past 1 instead.
 * - both in one move (wind up, then overshoot): `anticipated` on the first half and `overshot` on the second, each on
 *   its half of u.
 * - the same thing from a spring: `response` with r below 0 goes the wrong way first, then overshoots and settles, as
 *   a function of seconds rather than progress.
 */
export function anticipated(u: In<"f32">, back = 1.7): F {
  const x = clamp(u, 0, 1);
  return mul(mul(x, x), sub(mul(back + 1, x), back));
}

/**
 * Overshoot. 0..1 that runs past 1 and comes back. For an arrival with weight behind it.
 *
 * The law. With y = u - 1 (u held to [0, 1]) and b = `back`: 1 + y^2 ((b + 1) y + b), the mirror of `anticipated`
 * (1 - anticipated(1 - u)). It leaves 0 at speed b + 3 times the average, peaks at 1 + 4 b^3 / (27 (b + 1)^2) at
 * y = -2b / (3 (b + 1)) (for b = 1.7, about 1.1 two thirds of the way), and arrives at 1 with zero speed.
 *
 * Parameters: `u` takes an expression; `back` is a fixed number.
 *
 * What it cannot do, because of the law:
 * - ring: it passes 1 once and comes back once; a wobble that dies away is `response` or `swing`.
 * - set the overshoot's height and its place apart: one number sets both.
 * - start from rest: it leaves 0 at full speed (it is the end of a move, not the whole of one).
 *
 * Going past it: one cubic, so a polynomial of your own with p(0) = 0, p(1) = 1 and a lobe above 1. Relatives:
 * - `anticipated`, its mirror: the wrong way first instead of too far at the end.
 * - several overshoots dying away: a damped spring, `response` on seconds since the move began.
 * - an overshoot in space rather than value: an `arc` whose end point is pushed past the target by this curve.
 */
export function overshot(u: In<"f32">, back = 1.7): F {
  const y = sub(clamp(u, 0, 1), 1);
  return add(1, mul(mul(y, y), add(mul(back + 1, y), back)));
}

// ---- squash and stretch ---------------------------------------------------------------------------------------------

/**
 * Squash and stretch, with volume kept: a `Size` to give a placed copy.
 *
 * The law. With s = max(along, 0.001), the copy's y axis is scaled by s and its x and z axes by 1 / sqrt(s), so the
 * product of the three, the volume, is 1 for every s.
 *
 * Parameters: `along` takes an expression (drive it by `stretchOf` while moving and `impact` at a stop).
 *
 * What it cannot do, because of the law:
 * - squash along any axis but the copy's own y: turn the copy so its y lies along the motion.
 * - squash the two across axes differently: they are always equal, so a flattening that spreads one way only is out.
 * - bend or shear: a body smeared along a curved path, or leaning into its motion, is not a scale.
 *
 * Going past it: it is one `size.axes` call, so the one step down is `size.axes` with factors of your own. Relatives:
 * - area kept instead of volume (a flat thing, a sheet): across = 1 / along on the one other axis.
 * - squash along a direction d: the same factors applied in a frame whose y is d, by turning the copy into that frame
 *   first.
 * - a swelling with no squash: `breathe` scales all three axes up together.
 */
export function squash(along: In<"f32">): Size {
  const s = max(along, 1e-3), across = div(1, sqrt(s));
  return size.axes(vec3(across, s, across));
}

/**
 * The length factor a moving thing should wear: min(1 + per * speed, most). 1 at rest, longer the faster it goes,
 * never beyond `most`. `speed` is in the thing's own lengths per second. Pair it with `squash` and an `impact` at the
 * stop.
 *
 * It cannot tell direction (pass the speed's size: a negative speed shortens the thing), and it reaches `most` with a
 * corner, not an ease; `per` and `most` are fixed numbers.
 */
export const stretchOf = (speed: In<"f32">, per = 0.15, most = 1.6): F => min(add(1, mul(per, speed)), most);

/**
 * The squash at an impact: a length factor for `squash`, 1 before contact, 1 - `depth` at the moment of contact
 * (`after` = 0), sprung back out over the seconds after.
 *
 * The law. With w = 2 pi hz and zeta = damping: 1 - depth e^(-zeta w t) cos(w sqrt(1 - zeta^2) t) for t = after >= 0,
 * and 1 before. A damped spring released from full squash: it springs back past 1 (a stretch), then rings down.
 *
 * Parameters: `after` takes an expression (seconds since contact, from any clock); `depth`, `hz` and `damping` are
 * fixed numbers.
 *
 * What it cannot do, because of the law:
 * - squash gradually: it jumps from 1 to 1 - depth in one frame at contact (this is the point of it).
 * - answer how hard the thing hit: the squash is `depth` whatever the speed; scale it yourself.
 * - land more than once, or settle without ringing (damping must stay below 1).
 *
 * Going past it: it is a damped cosine on one clock, so the one step down is the same line with your own amplitude
 * and rate. Relatives:
 * - `swing` is the same spring with a sine: it starts at rest position with speed (a part flung), where this starts
 *   displaced at rest (a part pressed).
 * - a squash that scales with the hit: depth from the speed just before contact, as `stretchOf` scales the stretch.
 * - a bounce: hops of falling height, an `arc` per hop on a clock cut by each landing, with an impact at each.
 */
export function impact(after: In<"f32">, depth = 0.35, hz = 3, damping = 0.35): F {
  const t = max(after, 0), w = hz * TAU;
  const ring = mul(exp(mul(t, -damping * w)), cos(mul(t, w * Math.sqrt(Math.max(1 - damping * damping, 1e-4)))));
  return sub(1, mul(mul(depth, ring), select(lt(lift<"f32">(after), 0), 0, 1)));
}

// ---- arcs ---------------------------------------------------------------------------------------------------------------

/**
 * Arc. From a to b along an arch, not a line: `lift` is how far the middle stands off along `up`.
 *
 * The law. With x = u held to [0, 1]: mix(a, b, x) + up * lift * 4 x (1 - x). A parabola through a and b, highest at
 * the middle; progress along the chord is linear in u.
 *
 * Parameters: `a`, `b`, `u`, `lift` and `up` (default world up) all take expressions.
 *
 * What it cannot do, because of the law:
 * - an arch whose top is not at the middle, or which is not a parabola (a circle, a hook over at the end).
 * - ease: speed along the chord is constant in u; ease it by passing `slowInOut(u)` or `slowIn(u)`.
 * - stand square to the chord when `up` is not perpendicular to b - a: the arch leans with `up`.
 *
 * Going past it: one line, so the one step down is your own bump in place of 4 x (1 - x). Relatives:
 * - a thrown thing: a ballistic flight from a to b in T seconds is exactly this with u = t / T and lift = g T^2 / 8.
 * - an arch that peaks late (a pounce) or early (a toss): 4 x (1 - x) replaced by c x^p (1 - x)^q, peaking at
 *   p / (p + q).
 * - a path through several points: `through`.
 */
export function arc(a: In<"vec3">, b: In<"vec3">, u: In<"f32">, lift_: In<"f32">, up: In<"vec3"> = [0, 1, 0]): P3 {
  const x = clamp(u, 0, 1);
  return add(mix(lift<"vec3">(a), lift<"vec3">(b), x), mul(lift<"vec3">(up), mul(lift_, mul(4, mul(x, sub(1, x))))));
}

// ---- follow through, overlap, drag, secondary action ----------------------------------------------------------------------

/**
 * Follow through. A loose part's swing after its parent stops: 0 before `after` = 0, then a decaying swing of
 * `amount` that dies away. Add it to the part's angle or offset. Heavier, floppier parts take a lower `hz`.
 *
 * The law. With w = 2 pi hz and zeta = damping: amount e^(-zeta w t) sin(w sqrt(1 - zeta^2) t) for t = after >= 0, and
 * 0 before: a damped spring's answer to a sudden push. It leaves 0 at speed (continuous in place, not in speed) and
 * its first swing is a little under `amount`.
 *
 * Parameters: `after` (seconds since the parent stopped, from any clock) and `amount` take expressions; `hz` and
 * `damping` are fixed numbers.
 *
 * What it cannot do, because of the law:
 * - derive its rate from the part: `hz` is chosen, not given by a length or a weight.
 * - answer more than one stop: one push from one instant; later stops need more swings, summed.
 * - swing in two directions at once, or big: it is one linear number to add.
 *
 * Going past it: a damped sine on one clock, so the one step down is your own line of `after`. Relatives:
 * - `pendulum`: the same spring with its rate from length and gravity and its push from the pivot's change of speed
 *   (its `jolt`), so a part's swing follows from the rig.
 * - `impact`: the cosine of the same spring, starting displaced instead of moving.
 * - `response`: the same spring's answer to a step, for a part that moves to a new rest instead of returning.
 * - a swing travelling down a chain: each link reads `after` on a `dragged` clock.
 */
export function swing(after: In<"f32">, amount: In<"f32">, hz = 1.4, damping = 0.25): F {
  const t = max(after, 0), w = hz * TAU, wd = w * Math.sqrt(Math.max(1 - damping * damping, 1e-4));
  return mul(mul(amount, mul(exp(mul(t, -damping * w)), sin(mul(t, wd)))), select(lt(lift<"f32">(after), 0), 0, 1));
}

/**
 * Overlap and drag. The clock a part reads when it trails the lead by `lag` seconds per unit of `along` (distance
 * down a tail, index down a chain). The same motion formula read on this clock arrives later the further along.
 *
 * The law. t - along * lag: a pure shift of the clock, linear in `along`. Every motion here is a function of a clock,
 * so reading it on this one delays it without stored state.
 *
 * Parameters: `t`, `along` and `lag` take expressions.
 *
 * What it cannot do, because of the law:
 * - change the motion: the trailing part does exactly what the lead did, only later, at the same size (no fading,
 *   no extra bend).
 * - delay unevenly: the lag grows in proportion to `along`, a constant speed down the body.
 * - stay well behaved if `lag` moves fast: a lag that grows faster than the clock runs this clock backward.
 *
 * Going past it: it is one subtraction, so any other delay is your own function of `along`. Relatives:
 * - `retarded`: the same clock given a speed instead of a lag per unit.
 * - fading down the body: the motion read on this clock times e^(-k along), so a tail tip moves less than its root.
 * - `echo`: a delay with a gain, for a smaller later copy rather than a trailing part.
 * - a delay that grows toward the tip (a whip): along^2 in place of along.
 */
export const dragged = (t: In<"f32">, along: In<"f32">, lag: In<"f32">): F => sub(t, mul(along, lag));

/**
 * Secondary action. A smaller, later echo of a main motion `f` of the clock: `f(t - delay) * gain`.
 *
 * The law. One copy of f, shifted in time and scaled. f must be a function of the clock alone (as everything in this
 * layer is), so the echo needs no state.
 *
 * Parameters: `t`, `delay` and `gain` take expressions; `f` is any function from a clock to a number.
 *
 * What it cannot do, because of the law:
 * - change the shape: the echo is the same motion, smaller; a secondary action of a different kind is a different f.
 * - echo more than once: one copy; a train of echoes is a sum.
 * - echo a motion that keeps state: f must give its value at any time it is asked.
 *
 * Going past it: a sum of these is a filter. Relatives:
 * - a train of echoes with gains g, g^2, g^3 at delays d, 2d, 3d: a ringing that dies away, a step toward a damped
 *   spring (`swing`, `response`) built from the motion itself.
 * - `dragged`: the delay without the gain, for a part that trails.
 * - an echo in another channel: f read late and fed to a different part (a tail answering a head's turn).
 */
export const echo = (f: (t: F) => F, t: In<"f32">, delay: In<"f32">, gain: In<"f32">): F => mul(f(sub(t, delay)), gain);

// ---- loops -------------------------------------------------------------------------------------------------------------

/** Whether what is being built must loop: free (any rates), or every `seconds` (every idle swing takes whole turns in it). */
type Looping = { readonly kind: "free" } | { readonly kind: "loop"; readonly seconds: number };
let loop: Looping = { kind: "free" };
/**
 * Build something that must loop every `seconds`: while `build` runs, every `alive` not given a period of its own takes
 * this one, so idle motion written without a thought for looping comes round exactly.
 *
 * The law. A motion loops in T seconds when every rate in it is a whole number of turns per T. Inside `build`, each
 * `alive` replaces its two rates hz and 1.618 hz by k_a / T and k_b / T, with k_a = max(1, round(hz T)) and
 * k_b = max(k_a + 1, round(1.618 hz T)). The setting is in force while `build` runs and is restored after (an inner
 * `looping` wins over an outer one).
 *
 * Parameters: `seconds` is a fixed number; `build` is a function run once, now.
 *
 * What it cannot do, because of the law:
 * - make anything but `alive` loop: `breathe`, `beat`, `tremor`, a gait and any sine of your own keep the rates they
 *   are given; choose them as whole turns per period yourself.
 * - reach expressions built after `build` returns (in a callback run later): the setting is read when `alive` is
 *   called, not when the expression is drawn.
 * - keep the rates asked for in a short loop: rounding to whole turns moves each rate by up to half a turn per
 *   period, so 0.23 Hz in a 2 second loop becomes 0.5 Hz.
 *
 * Going past it: the rule is one line, rate = round(hz T) / T, so any motion can be made to loop by passing its rate
 * through it. Relatives:
 * - `dart` fits a whole number of holds into its `period`, and its warp a whole number of turns, by the same rounding.
 * - an idle stance (`carriage`'s idle) rounds its breaths to whole breaths per loop.
 * - a gait loops when a whole number of cycles fit the period: period = T / round(T / period).
 */
export function looping<T>(seconds: number, build: () => T): T {
  if (!(seconds > 0 && Number.isFinite(seconds))) throw new Error(`looping: the period must be a positive number of seconds, got ${seconds}`);
  const before = loop;
  loop = { kind: "loop", seconds };
  try { return build(); } finally { loop = before; }
}
/** The two rates of a moving hold: as asked, or the nearest whole numbers of turns in the loop that differ. */
function swings(hz: number, l: Looping): { readonly hzA: number; readonly hzB: number } {
  switch (l.kind) {
    case "free": return { hzA: hz, hzB: hz * 1.618 };
    case "loop": {
      if (!(l.seconds > 0)) throw new Error(`alive: period must be positive, got ${l.seconds}`);
      const ka = Math.max(1, Math.round(hz * l.seconds)), kb = Math.max(ka + 1, Math.round(hz * 1.618 * l.seconds));
      return { hzA: ka / l.seconds, hzB: kb / l.seconds };
    }
  }
}

// ---- the moving hold, exaggeration, twins ----------------------------------------------------------------------------------

/**
 * The moving hold. A still pose kept alive: two slow swings that never line up, in -1..1 times `amount`. `seed` gives
 * each part its own, so nothing breathes in step. With `period` (seconds) the two swings take whole numbers of turns
 * in it, the nearest to `hz` and to 1.618 `hz` that differ, so a motion that must loop in `period` still loops.
 *
 * The law. With phi = 2 pi hash(seed): amount (0.62 sin(2 pi hzA t + phi) + 0.38 sin(2 pi hzB t + 2.3 phi)). Free,
 * hzA = hz and hzB = 1.618 hz, a ratio near the golden one, so the two never come back into step; with a period (its
 * own or `looping`'s) both are rounded to whole turns of it. Inside a namespace the seed is offset by the namespace's
 * own, so copies built by one function do not move together.
 *
 * Parameters: `t`, `amount` and `seed` take expressions; `hz` and `period` are fixed numbers.
 *
 * What it cannot do, because of the law:
 * - arrive anywhere or hold: it is always drifting, smoothly, never still and never sudden (still-then-jump is `dart`).
 * - hide its rhythm for long: it is two sines, so over a few of the slower swings the pattern can be seen.
 * - stay aperiodic with a period: the rounded rates repeat exactly in it (that is what the period is for).
 *
 * Going past it: a sum of sines of a clock, so more terms or other weights are the same line extended. Relatives:
 * - three or more sines at rates in golden ratio to each other: a drift with no visible rhythm.
 * - `tremor`: the same two-sine idea at a fast rate, a shake instead of a sway.
 * - `dart`: holds and jumps on an uneven clock, for a nervous thing instead of a calm one.
 * - noise of the clock (a smooth hash along t): a wander that is not a sum of sines, at the price of looping.
 */
export function alive(t: In<"f32">, amount: In<"f32">, seed: In<"f32"> = 0, hz = 0.23, period?: number): F {
  // In a namespace each instance has its own seeds (four bodies built by one rig do not idle in step); outside any, the
  // seed is the one given.
  const ns = namespaceSeed(), s = ns === 0 ? lift<"f32">(seed) : add(seed, ns), ph = mul(hash3(vec3(s, 17.3, 4.1)), TAU);
  const { hzA, hzB } = swings(hz, period === undefined ? loop : { kind: "loop", seconds: period });
  const a = sin(add(mul(t, hzA * TAU), ph)), b = sin(add(mul(t, hzB * TAU), mul(ph, 2.3)));
  return mul(amount, add(mul(a, 0.62), mul(b, 0.38)));
}

/**
 * Exaggeration. Push a value away from its rest by `by`: 1 leaves it, 2 doubles the departure.
 *
 * The law. rest + (x - rest) by: a scale about the rest, the same at every size of departure.
 *
 * Parameters: `x`, `rest` and `by` all take expressions.
 *
 * What it cannot do, because of the law:
 * - keep a value in its range: a doubled angle can pass a joint's limit; hold the result yourself.
 * - push the big moves more than the small: the factor is the same for a twitch and a lunge, noise included.
 * - exaggerate timing: it scales values, not when they happen.
 *
 * Going past it: one line, so any other map of the departure d = x - rest. Relatives:
 * - rest + sign(d) |d|^p: p above 1 keeps small moves small and makes big ones bigger, p below 1 the reverse.
 * - exaggerated timing: the clock scaled about the moment of the action (shorter `act` in `beats`, a longer
 *   `anticipate`).
 * - a vector departure: the same line on each axis of a position.
 */
export const exaggerated = (x: In<"f32">, rest: In<"f32">, by: In<"f32">): F => add(rest, mul(sub(x, rest), by));

/**
 * Against twins. A factor near 1 that differs per part (and so per side): multiply a size, an angle or a clock rate by
 * it and the left and right of a pair stop mirroring each other. `spread` 0.15 gives 0.85..1.15.
 *
 * The law. 1 + spread (2 hash(part) - 1): a hash of the part's number, spread evenly over [1 - spread, 1 + spread].
 *
 * Parameters: `part` takes an expression; `spread` is a fixed number.
 *
 * What it cannot do, because of the law:
 * - change in time: it is fixed per part (a time-varying difference is `alive` with a seed per part).
 * - differ between two uses on one part: the same `part` gives the same factor everywhere; offset the part number per
 *   use (part + 100 for sizes, part + 200 for rates) to make them independent.
 * - favour small differences: every value in the range is as likely as any other.
 *
 * Going past it: a hash of a number, so any distribution is a function of that hash. Relatives:
 * - a factor per hold of a motion rather than per part: `chosen` of a `dart`'s `now`.
 * - a difference that drifts: `alive` with the part as its seed, added to 1.
 * - differences mostly small with rare large ones: the hash through a curve that is flat near the middle.
 */
export const uneven = (part: In<"f32">, spread = 0.15): F => add(1, mul(sub(mul(hash3(vec3(part, 3.7, 9.2)), 2), 1), spread));

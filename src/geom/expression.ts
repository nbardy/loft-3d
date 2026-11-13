// Expressions as values (docs/animation_principles.md, Appeal).
//
// A face is drawn from a few named channels (how far a lid is down, how tall a stalk stands, where it looks). An
// expression is one number per channel. A score lays expressions over one another by weights that are closed forms of
// a clock (an attack's beats, a window of seconds), so the posed channels are closed forms of the clock too: no state
// between frames, readable at any other time (a part that lags reads `score.at(sub(time, lag))`).
//
// Nothing here knows what a channel means: the face that draws them does.

import { add, lift, mix, mul, smoothstep, sub, type In } from "../expr.ts";
import type { F } from "../map/types.ts";

/** An expression: one number per channel. */
export type Expression<K extends string> = Readonly<Record<K, number>>;
/** Channels as closed forms of the clock: what a face is drawn from. */
export type Posed<K extends string> = Readonly<Record<K, F>>;

/** A cast: the rest expression and the named ones, each complete (one number for every channel). */
export type Cast<K extends string, N extends string> = {
  readonly channels: readonly K[];
  readonly rest: Expression<K>;
  readonly named: Readonly<Record<N, Expression<K>>>;
};

/**
 * Raised when a cast or a score is given something it does not know: a named expression with a channel the rest lacks,
 * a number that is not finite, an expression named "rest", a layer naming an expression or channel the cast lacks
 * (raised when the score is read), or a `during` window with no rise, no fall or an end before its start. It carries
 * only the message, which names the expression, the channel and the ones that exist.
 */
export class ExpressionError extends Error {}

/**
 * A cast from its rest expression and each named expression's departures from rest: a channel a named expression does
 * not mention is the rest's. A named expression that mentions a channel the rest lacks, or a number that is not finite,
 * is an `ExpressionError`.
 *
 * What it assumes of the subject: whatever it is (a face, a body's mood, a flower opening) is drawn from a fixed set
 * of named numbers, its channels, and the drawing code reads them; nothing here knows what a channel means. A subject
 * that is not drawn from a few numbers (a face made of free strokes) does not fit.
 *
 * The law. Channels are the rest's keys; each named expression is the rest with its departures written over it, so
 * every expression is complete: one finite number per channel. A cast is the space a `score` mixes in.
 *
 * Parameters: plain numbers, fixed when the cast is made; what moves is the score's weights.
 *
 * What it cannot do, because of the law:
 * - hold a channel that is not a number (a choice of shape, a texture): a discrete choice is a number the drawing
 *   code thresholds.
 * - name an expression that moves by itself (a trembling fear): a named expression is a point; the motion is an `added`
 *   layer in the score.
 * - add a channel later: the channels are the rest's.
 *
 * Going past it: a cast is a plain record, so one built by hand or from data is the same thing. Relatives:
 * - a cast of poses rather than faces: channels that are joint angles, so `score` mixes body poses the same way.
 * - one expression per hold of a `dart`: the named expression chosen by `chosen(now, seed)`, shown by `arrive`.
 */
export function cast<K extends string, N extends string>(rest: Expression<K>, named: Readonly<Record<N, Partial<Expression<K>>>>): Cast<K, N> {
  const channels = Object.keys(rest) as K[];
  const finite = (who: string, k: string, x: number) => { if (!Number.isFinite(x)) throw new ExpressionError(`expression "${who}": channel "${k}" is ${x}, not a finite number`); };
  for (const k of channels) finite("rest", k, rest[k]);
  const out = {} as Record<N, Expression<K>>;
  for (const name of Object.keys(named) as N[]) {
    if (name === "rest") throw new ExpressionError(`an expression cannot be named "rest": that is the cast's own`);
    const departs = named[name] as Readonly<Record<string, number>>;
    for (const k of Object.keys(departs)) {
      if (!(k in rest)) throw new ExpressionError(`expression "${name}": no channel "${k}" (channels: ${channels.join(", ")})`);
      finite(name, k, departs[k]!);
    }
    out[name] = { ...rest, ...departs } as Expression<K>;
  }
  return { channels, rest, named: out };
}

/** One layer of a score. Layers apply in order, later over earlier. */
export type Layer<K extends string, N extends string> =
  /** The whole face goes toward a named expression by `weight` (0 not at all, 1 entirely). */
  | { readonly kind: "show"; readonly show: N; readonly weight: In<"f32"> }
  /** Only the listed channels go toward it: a blink moves the lids and leaves the rest of the face alone. */
  | { readonly kind: "only"; readonly show: N; readonly channels: readonly K[]; readonly weight: In<"f32"> }
  /** The listed channels go toward the numbers given, not a named expression's: a shut lid that is no face of its own. */
  | { readonly kind: "toward"; readonly to: Partial<Readonly<Record<K, number>>>; readonly weight: In<"f32"> }
  /** Added on top of whatever is showing, `by` per channel times `weight`: a tremble, a breath. */
  | { readonly kind: "add"; readonly by: Partial<Readonly<Record<K, In<"f32">>>>; readonly weight: In<"f32"> };

/**
 * A layer that takes the whole face toward a named expression by `weight` (0 not at all, 1 entirely).
 *
 * The law. Every channel c becomes mix(c so far, expression's c, weight): a straight line in channel space from what
 * the layers below made to the named expression. At weight exactly 1 everything below is covered (which is how a
 * `struck` pose holds still).
 *
 * Parameters: `name` is fixed; `weight` takes an expression (a closed form of the score's clock).
 *
 * What it cannot do, because of the law:
 * - move some channels and not others: that is `only`.
 * - pass anywhere but the straight line between the two faces: halfway between two expressions is their average.
 * - keep what was laid before it at weight 1: a later `show` covers every earlier layer, so order the layers with
 *   what flows first and what is struck last.
 *
 * Going past it: a layer is a variant of `Layer`, read in one place (`score`), so a new kind of mixing is a new variant
 * with its case there. Relatives:
 * - `only`: the same mix on a list of channels.
 * - `added`: an offset instead of a mix, for motion on top of a pose.
 * - a mix that is not a straight line: two `show`s in a row (to an in-between expression, then to the target), the
 *   first weight rising and falling.
 */
export const show = <N extends string>(name: N, weight: In<"f32">): Layer<never, N> => ({ kind: "show", show: name, weight });
/**
 * Only some channels move: toward a named expression's numbers (`only("wince", ["upper", "lower"], w)`), or toward
 * numbers given here (`only({ lid: 1 }, w)`). The second form is for a state that is no expression of its own (a
 * shut lid): naming it one would make checks that read the score expect it to be shown whole.
 *
 * The law. For each listed channel c, mix(c so far, target c, weight); the other channels are left as they are. Named,
 * the targets are the expression's numbers on those channels; given, they are the numbers passed.
 *
 * Parameters: the name, the channel list and the numbers are fixed; `weight` takes an expression.
 *
 * What it cannot do, because of the law:
 * - give each channel its own weight: one weight for the list (several `only` layers for several weights).
 * - count toward `shares`: the face never becomes the named expression by it.
 * - target a moving number: the given numbers are fixed (a moving offset is `added`).
 *
 * Going past it: it is `show` restricted to channels, so a layer of your own follows the same shape. Relatives:
 * - a blink: `only({ lid: 1 }, w)` with w a short `during` window on the clock, or a pulse at each hold of a `dart`.
 * - a look that leaves the rest of the face: `only` on the gaze channels toward an expression that looks.
 */
export function only<K extends string, N extends string>(name: N, channels: readonly K[], weight: In<"f32">): Layer<K, N>;
export function only<K extends string>(to: Partial<Readonly<Record<K, number>>>, weight: In<"f32">): Layer<K, never>;
export function only<K extends string, N extends string>(a: N | Partial<Readonly<Record<K, number>>>, b: readonly K[] | In<"f32">, c?: In<"f32">): Layer<K, N> {
  // Classified once, here: a name with its channels, or the numbers themselves.
  if (typeof a === "string") return { kind: "only", show: a, channels: b as readonly K[], weight: c as In<"f32"> };
  for (const [k, x] of Object.entries(a)) if (!Number.isFinite(x)) throw new ExpressionError(`only: channel "${k}" is ${x}, not a finite number`);
  return { kind: "toward", to: a, weight: b as In<"f32"> };
}
/**
 * A layer added on top of whatever is showing, `by` per channel times `weight`: a tremble, a breath.
 *
 * The law. For each channel c in `by`, c so far + by[c] * weight. An offset, not a mix: it moves the face from wherever
 * the layers below left it, and a later `show` at weight 1 covers it.
 *
 * Parameters: each channel's `by` and the `weight` (default 1) take expressions, so `by` can be a motion of the clock
 * (`tremor`, `alive`, `breathe` minus 1).
 *
 * What it cannot do, because of the law:
 * - keep a channel in range: an offset can take a lid past shut; hold the channel where it is drawn.
 * - count toward `shares`.
 * - survive a `show` at weight 1 laid after it (lay it after the struck pose if it must move during the hold).
 *
 * Going past it: the offsets are expressions, so any motion of the clock is one. Relatives:
 * - a trembling expression: `show` the expression, then `added` a `tremor` on the channels that shake.
 * - a breathing face: `added` with `breathe(...) - 1` on a mouth or a nostril channel.
 * - a moving hold on a held face: `added` with `alive` per channel, its seed per channel.
 */
export const added = <K extends string>(by: Partial<Readonly<Record<K, In<"f32">>>>, weight: In<"f32"> = 1): Layer<K, never> => ({ kind: "add", by, weight });

/**
 * A weight from a clock: 0 before `from`, rising over `rise` seconds, 1 until `to`, falling over `fall` seconds after
 * it. The clock is any expression of seconds (an attack's `tau`, a beat's `after`); `to` may be omitted for a weight
 * that stays.
 *
 * The law. smoothstep(from, from + rise, clock) times (1 - smoothstep(to, to + fall, clock)): a window with eased
 * edges, zero speed at each corner. `fall` defaults to `rise`.
 *
 * Parameters: the clock takes an expression; `from`, `to`, `rise` and `fall` are fixed numbers.
 *
 * What it cannot do, because of the law:
 * - move its edges at run time: the window is fixed seconds on its clock (drive the clock instead).
 * - overshoot or anticipate: it stays within [0, 1].
 * - fall before it has risen: with `to` earlier than `from + rise` the fall starts during the rise and the weight
 *   never reaches 1.
 *
 * Going past it: a product of two smoothsteps, so another edge is another ease in its place. Relatives:
 * - a sharp arrival held still: `struck`'s weight, which snaps in and holds exactly 1.
 * - a window that repeats: the clock passed through mod(t, period).
 * - an action's beats on the same clock: `beats`, three ramps instead of one window.
 */
export function during(clock: In<"f32">, o: { readonly from: number; readonly to?: number; readonly rise: number; readonly fall?: number }): F {
  if (!(o.rise > 0)) throw new ExpressionError(`during: rise must be a positive number of seconds, got ${o.rise}`);
  const up = smoothstep(o.from, o.from + o.rise, lift<"f32">(clock));
  if (o.to === undefined) return up;
  const fall = o.fall ?? o.rise;
  if (!(fall > 0)) throw new ExpressionError(`during: fall must be a positive number of seconds, got ${fall}`);
  if (!(o.to >= o.from)) throw new ExpressionError(`during: the window ends (${o.to}) before it starts (${o.from})`);
  return mul(up, sub(1, smoothstep(o.to, o.to + fall, lift<"f32">(clock))));
}

export type Score<K extends string, N extends string> = {
  readonly cast: Cast<K, N>;
  /** The channels at clock t. */
  readonly at: (t: In<"f32">) => Posed<K>;
  /**
   * How much of the face each named expression is at clock t, after every later `show` layer has taken its share; the
   * shares and `rest` sum to 1. `only` and `add` layers do not count: they never make the face a named expression.
   */
  readonly shares: (t: In<"f32">) => Readonly<Record<N | "rest", F>>;
};

/**
 * A score: the cast's rest expression under the layers `layersAt(t)` gives for a clock, applied in order. The layers'
 * weights are the caller's closed forms of that clock, so the same score read at `t - lag` is the same performance late.
 *
 * What it assumes of the subject: what `cast` does, a subject drawn from a few named numbers; nothing here reads what
 * a channel means.
 *
 * The law. `at(t)` starts every channel at rest and applies each layer in order: `show` mixes all channels toward an
 * expression, `only` some channels, `toward` some channels toward given numbers, `add` offsets them. Each step is
 * linear in the channels, so the result is a closed form of the clock with no state. `shares(t)` tracks how much of
 * the face each named expression is through the `show` layers alone: each show scales every share by (1 - weight)
 * and adds its weight to its own, so the shares and rest sum to 1.
 *
 * Parameters: the cast is fixed; `layersAt` is a function of the clock, called whenever the score is read, and its
 * weights and offsets are expressions.
 *
 * What it cannot do, because of the law:
 * - remember: a layer's weight cannot depend on what the face did before, only on the clock.
 * - blend other than in straight lines: every mix is linear in channel space, so an in-between face is an average.
 * - reorder by priority: later layers win by order, not by weight; a struck pose must be laid last to hold.
 *
 * Going past it: the layers are a sum type read in one place (`at`), so a new way to change channels is a new variant
 * and its case. Relatives:
 * - parts that lag: each part reads `score.at(sub(time, lag))`, so a face's parts arrive one after another.
 * - a pose held dead still: `struck` gives the weight for a `show`, and `holdsStill` checks the hold.
 * - a body instead of a face: a cast whose channels are joint angles, scored the same way.
 */
export function score<K extends string, N extends string>(cast_: Cast<K, N>, layersAt: (t: F) => readonly Layer<NoInfer<K>, NoInfer<N>>[]): Score<K, N> {
  const known = (name: N): Expression<K> => {
    const e = cast_.named[name];
    if (e === undefined) throw new ExpressionError(`score: no expression "${name}" in the cast (named: ${Object.keys(cast_.named).join(", ")})`);
    return e;
  };
  const channel = (k: K): K => {
    if (!cast_.channels.includes(k)) throw new ExpressionError(`score: no channel "${k}" (channels: ${cast_.channels.join(", ")})`);
    return k;
  };
  const at = (t: In<"f32">): Posed<K> => {
    const posed = Object.fromEntries(cast_.channels.map((k) => [k, lift<"f32">(cast_.rest[k])])) as Record<K, F>;
    for (const layer of layersAt(lift<"f32">(t))) {
      // The one place a layer's kind is read.
      switch (layer.kind) {
        case "show": { const e = known(layer.show); for (const k of cast_.channels) posed[k] = mix(posed[k], e[k], layer.weight); break; }
        case "only": { const e = known(layer.show); for (const k of layer.channels) posed[channel(k)] = mix(posed[k], e[k], layer.weight); break; }
        case "toward": { for (const k of Object.keys(layer.to) as K[]) posed[channel(k)] = mix(posed[k], layer.to[k] as number, layer.weight); break; }
        case "add": {
          for (const k of Object.keys(layer.by) as K[]) posed[channel(k)] = add(posed[k], mul(layer.by[k] as In<"f32">, layer.weight));
          break;
        }
      }
    }
    return posed;
  };
  const shares = (t: In<"f32">): Readonly<Record<N | "rest", F>> => {
    const names = Object.keys(cast_.named) as N[];
    const share = Object.fromEntries([["rest", lift<"f32">(1)], ...names.map((n) => [n, lift<"f32">(0)])]) as Record<N | "rest", F>;
    for (const layer of layersAt(lift<"f32">(t))) {
      switch (layer.kind) {
        case "show": {
          known(layer.show);
          for (const n of Object.keys(share) as (N | "rest")[]) share[n] = mul(share[n], sub(1, layer.weight));
          share[layer.show] = add(share[layer.show], layer.weight);
          break;
        }
        case "only": case "toward": case "add": break;
      }
    }
    return share;
  };
  return { cast: cast_, at, shares };
}

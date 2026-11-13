// An emote: an action with no hit (a taunt, a dance, a roar). It has a schedule, as an attack has (`once`, `every`), and
// accents: the instants, in seconds after it arms, that its moves land on. A body and a face read its beats as they
// read an attack's; nothing is hit, nothing is warned, nothing is checked against a target. Everything is a closed form
// of the clock, so the game and the art read the same performance and it runs wherever pose runs.
//
// What a dance needs of each accent is three things, and they are the readouts: a pulse that rises into the accent and
// falls away from it (`wave`: the move itself, at its top on the accent), where the clock is within that move, signed
// (`turn`: -1 at its start, 0 on the accent, 1 at its end, so a limb can go out one way and come back the other), and a
// side that alternates accent by accent and changes on the off-beat (`step`: a shuffle).

import { Expr, add, clamp, div, f, floor, max, mul, sub, time, type In } from "../expr.ts";
import { slowInOut } from "../geom/lively.ts";
import { once, type Arming } from "./attack.ts";

type F = Expr<"f32">;

export type EmoteSpec = {
  readonly name: string;
  /** When it arms: its first accent is `accents[0]` seconds after. A time (seconds) is `once(time)`. */
  readonly arm: In<"f32"> | Arming;
  /** Seconds after arming of each accent, ascending, the first at least `lead`. */
  readonly accents: readonly number[];
  /** Seconds a move takes to rise into its accent, seconds it is held there after it (0 lets go at once), and seconds to fall away. */
  readonly lead: number;
  readonly hold: number;
  readonly fall: number;
  /** How sharply a move arrives and leaves: the power of its ease (2 gentle, 6 or more snapped). At least 1. */
  readonly snap: number;
  /** Seconds after an accent that the side changes (the off-beat), and how long the change takes. */
  readonly offbeat: number;
  readonly shuffle: number;
  /** Seconds to come into the emote's posture before the first move, and out of it after the last. */
  readonly settle: number;
};

/** An emote's beats at a clock. */
export type EmoteBeat = {
  /** How far the body is in the emote: 0 outside it, 1 from the first move's start to the last move's end. */
  readonly on: F;
  /** The move: 0 between moves, rising to 1 on each accent and falling after. */
  readonly wave: F;
  /** Where the clock is in a move: -1 at its start, 0 on the accent, 1 at its end; -1 between moves. Use it through sin(pi turn) or with `wave`. */
  readonly turn: F;
  /** The side: 0 outside the emote, then alternating +1, -1 from accent to accent, changing on the off-beat after each. */
  readonly step: F;
};

/**
 * A scheduled performance with no hit, as `emote` builds it: `beats(t)` gives its four readouts at a clock (`on`,
 * `wave`, `turn`, `step`, see `EmoteBeat`), `armAt(t)` the arming time of the cycle t is in, and `span` the seconds it
 * moves before and after arming.
 */
export class Emote {
  readonly name: string;
  readonly arming: Arming;
  /** Seconds from the first movement to the last, around the arming time. */
  readonly span: { readonly before: number; readonly after: number };

  constructor(readonly spec: EmoteSpec) {
    const { name, accents, lead, hold, fall, snap, offbeat, shuffle, settle } = spec;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`emote "${name}": names must be identifiers`);
    for (const [k, v] of Object.entries({ lead, fall, shuffle, settle })) if (!(v > 0 && Number.isFinite(v))) throw new Error(`emote "${name}": ${k} must be a positive, finite number of seconds; got ${v}`);
    if (!(hold >= 0 && Number.isFinite(hold))) throw new Error(`emote "${name}": hold must be a finite number of seconds, at least 0; got ${hold}`);
    if (!(snap >= 1 && Number.isFinite(snap))) throw new Error(`emote "${name}": snap must be at least 1, got ${snap}`);
    if (!(offbeat >= 0 && Number.isFinite(offbeat))) throw new Error(`emote "${name}": offbeat must be a finite number of seconds, at least 0; got ${offbeat}`);
    if (accents.length < 1) throw new Error(`emote "${name}": no accents`);
    accents.forEach((a, i) => {
      if (!Number.isFinite(a) || a < 0 || (i > 0 && !(a > accents[i - 1]!))) throw new Error(`emote "${name}": accents must be seconds after arming, ascending; got [${accents.join(", ")}]`);
    });
    this.name = name;
    const arm = spec.arm;
    this.arming = typeof arm === "number" || arm instanceof Expr ? once(arm) : arm;
    const last = accents[accents.length - 1]!;
    this.span = { before: Math.max(lead + settle - accents[0]!, 0), after: last + Math.max(hold + fall, offbeat + shuffle) + settle };
    const s = this.arming;
    switch (s.kind) {
      case "once": break;
      case "every":
        if (!(this.span.before + this.span.after < s.period)) throw new Error(`emote "${name}": it does not fit its period of ${s.period} s (${this.span.before.toFixed(2)} s before arming, ${this.span.after.toFixed(2)} s after)`);
    }
  }

  /** The arming time of the cycle clock t is in. A cycle runs from the emote's first movement to the next one's. */
  armAt(t: In<"f32">): F {
    const s = this.arming;
    switch (s.kind) {
      case "once": return s.at;
      case "every": return add(s.first, mul(floor(div(add(sub(t, s.first), this.span.before), s.period)), s.period));
    }
  }

  /** The beats at clock t (`time` for now). */
  beats(t: In<"f32"> = time): EmoteBeat {
    const { accents, lead, hold, fall, snap, offbeat, shuffle, settle } = this.spec;
    const tau = sub(t, this.armAt(t)), first = accents[0]!, last = accents[accents.length - 1]!;
    const span = (from: number, len: number): F => clamp(div(sub(tau, from), len), 0, 1);
    // Each accent's own move; they are summed by max (moves a full `lead + fall` apart or more do not overlap).
    const moves = accents.map((a) => ({ rise: span(a - lead, lead), drop: span(a + hold, fall) }));
    const wave = moves.reduce<F>((w, m) => max(w, mul(slowInOut(m.rise, snap), sub(1, slowInOut(m.drop, snap)))), f(0));
    // The clock within a move: each move counts 0 before it, 1 on its accent, 2 after it, so the sum over moves is 2k
    // after k moves and 2k + (0 .. 2) through the next; its remainder by 2, less 1, runs -1 .. 1 through each move and
    // rests at -1 between moves. (It steps from 1 to -1 as a move ends, where `wave` is 0 and sin(pi turn) is 0 both sides.)
    const count = moves.reduce<F>((c, m) => add(c, add(m.rise, m.drop)), f(0));
    const turn = sub(sub(count, mul(floor(mul(count, 0.5)), 2)), 1);
    // The side: +1 after the first accent's off-beat, then flipped at each later one, and back to 0 after the last move.
    const flips = accents.map((a, i) => mul(slowInOut(span(a + offbeat, shuffle)), i === 0 ? 1 : i % 2 === 1 ? -2 : 2));
    const home = mul(slowInOut(span(last + Math.max(hold + fall, offbeat + shuffle), settle)), accents.length % 2 === 1 ? -1 : 1);
    const step = add(flips.reduce<F>((s, x) => add(s, x), f(0)), home);
    const on = mul(slowInOut(span(first - lead - settle, settle)), sub(1, slowInOut(span(last + hold + fall, settle))));
    return { on, wave, turn, step };
  }
}

/**
 * An emote: an action with no hit (a taunt, a dance, a bow, a roar), on a schedule as an attack is (`once`, `every`),
 * with accents, the instants its moves land on. Nothing is hit, warned or checked against a target; a body and a face
 * read its beats as numbers, so the game and the art read the same performance.
 *
 * What it assumes about the body: nothing but that it has something to move and, for `step`, two sides to alternate
 * between (left and right, two feet, two hands, a lean one way and the other). It gives numbers, not a pose, so any
 * subject fits; tried so far on a legged body's taunt and on a floating thing rocking onto each clang of a bell.
 *
 * The law. Move i rises over [a_i - lead, a_i] and falls over [a_i + hold, a_i + hold + fall] (a_i the accents, seconds
 * after arming), each eased by slowInOut with power `snap`, and
 *   wave = max_i rise_i(t) (1 - fall_i(t)),
 *   turn = (sum_i (rise_i + fall_i)) mod 2 - 1   (-1 at a move's start, 0 on its accent, 1 at its end),
 *   step = +1 after the first accent's off-beat, flipped after each later one, back to 0 after the last move,
 * each flip eased over `shuffle` seconds from `offbeat` after its accent; `on` eases from 0 to 1 over `settle` seconds
 * before the first move and back after the last.
 *
 * Parameters: `arm` takes a time, an expression, a host input, `once` or `every`; the accents, `lead`, `hold`, `fall`,
 * `snap`, `offbeat`, `shuffle` and `settle` are fixed numbers. A repeating emote must fit its period (checked).
 *
 * What it cannot do, because of the law:
 * - vary a move by accent: every move has the same rise, hold, fall and size (scale a move yourself by which accent it
 *   is).
 * - overlap moves: they are combined by max, so accents closer than `lead + fall` merge into one longer move.
 * - alternate among more than two sides: `step` is +1 or -1.
 * - change tempo or take accents decided at run time: they are fixed seconds after arming.
 * - pose anything: it says when and how much; which limb goes where is the body's.
 *
 * Going past it: `beats(t)` at any clock (a delayed clock for a part that follows, `time - 0.1`) and the shapes it is
 * made of, `slowInOut`, `anticipated`, `overshot`, are public, so a readout of your own is a few lines of the same
 * form.
 * Relatives worth trying:
 * - a move per accent of its own size: weights indexed by floor(count / 2) of the moves passed, multiplied into `wave`.
 * - three sides (left, middle, right): the number of off-beats passed, mod 3.
 * - swing: accents placed long-short (2/3 and 1/3 of each beat) instead of even.
 * - a group on counts with unison and canon checked: `routine`.
 */
export function emote(spec: EmoteSpec): Emote {
  return new Emote(spec);
}

// Stance: a heavy legged body standing on its feet (docs/stance.md). The feet are fixed points in the world and the body
// is a frame that rises, sinks, shifts and tilts over them; the legs (`chain`) join the two, so the knees take up every
// change. Two things, both closed forms of the clock with nothing stored:
//
// - a carriage: the body's offset from its rest over the feet (surge forward, rise, sway to its right, roll, pitch,
//   yaw, in the ground frame under it), from a list of stances: what the creature is doing. `carriage` is the one
//   dispatcher; each kind has one handler.
// - a footing: where each foot is and whether it bears weight. A foot leaves its home only by a named event: a
//   re-plant (idle; scheduled when the creature is built, in the fight's own idle time, and gated at run time), a stamp
//   (on a dance's accent, in place), or the walk's gait blended in by a weight.

import { add, clamp, compileJs, div, floor, ge, gt, lift, lt, max, min, mix, mul, pow, select, sin, smoothstep, sub, time, variable, vec3, type In } from "../expr.ts";
import { rotate } from "../map/chart.ts";
import { rotateAbout } from "../map/transport.ts";
import type { F, Frame, P3 } from "../map/types.ts";
import type { Gait } from "./gait.ts";
import { alive } from "./lively.ts";

// ---- the carriage ---------------------------------------------------------------------------------------------------

/** The body's offset from its rest over its feet, in the ground frame (x forward, y up, z to its right). Angles in radians: roll > 0 lowers the right side, pitch > 0 lifts the nose, yaw > 0 turns the nose left. */
export type Carriage = { readonly surge: F; readonly rise: F; readonly sway: F; readonly roll: F; readonly pitch: F; readonly yaw: F };
const KEYS = ["surge", "rise", "sway", "roll", "pitch", "yaw"] as const;
const zero = (): Carriage => ({ surge: lift<"f32">(0), rise: lift<"f32">(0), sway: lift<"f32">(0), roll: lift<"f32">(0), pitch: lift<"f32">(0), yaw: lift<"f32">(0) });
const plus = (a: Carriage, b: Carriage): Carriage => Object.fromEntries(KEYS.map((k) => [k, add(a[k], b[k])])) as Carriage;
const times = (a: Carriage, w: F): Carriage => Object.fromEntries(KEYS.map((k) => [k, mul(a[k], w)])) as Carriage;

/** A level direction in the ground frame (unit): x forward, z to the right. */
export type Toward = { readonly x: F; readonly z: F };
/**
 * The level direction from the ground frame's origin toward a world point, in the ground frame (unit): what a brace's
 * `toward` takes. It cannot see height (the vertical part is dropped), it reads only the x and z parts of the ground's
 * axes (so the ground frame should be level), and a point straight above the origin gives no true direction.
 */
export function towardIn(ground: Frame, p: P3): Toward {
  const d = sub(p, ground.o), x = add(mul(d.x, ground.x.x), mul(d.z, ground.x.z)), z = add(mul(d.x, ground.z.x), mul(d.z, ground.z.z));
  const l = max(pow(add(mul(x, x), mul(z, z)), 0.5), 1e-6);
  return { x: div(x, l), z: div(z, l) };
}
/**
 * A world direction made level and given in the ground frame (unit): a velocity or a facing as a brace's `toward`. It
 * cannot see the vertical part, it reads only the x and z parts of the ground's axes (so the ground frame should be
 * level), and a straight up or down direction gives no true heading.
 */
export function headingIn(ground: Frame, v: P3): Toward {
  const x = add(mul(v.x, ground.x.x), mul(v.z, ground.x.z)), z = add(mul(v.x, ground.z.x), mul(v.z, ground.z.z));
  const l = max(pow(add(mul(x, x), mul(z, z)), 0.5), 1e-6);
  return { x: div(x, l), z: div(z, l) };
}

/** What a body on its feet is doing with its weight. Every kind but `idle` says how far it is in it (`on`, 0..1). */
export type Stance =
  /**
   * Standing: breathing (`breath.rise` at `breath.period`, made whole turns of `loop`), a slow shift of weight side to
   * side and fore and aft (`alive`, own `seed`), tilting toward the loaded side by `tilt` radians per unit of shift, a
   * small turn; plus what the footing asks (the body leaving a foot about to step: `footing.unload`).
   */
  | {
    readonly kind: "idle"; readonly t?: In<"f32">; readonly loop: number; readonly seed: number;
    readonly breath: { readonly rise: number; readonly period: number };
    readonly shift: { readonly side: number; readonly fore: number; readonly hz: number };
    readonly tilt: { readonly roll: number; readonly pitch: number }; readonly turn: number;
    readonly unload: Carriage;
  }
  /**
   * Braced for an action toward a target: `load` (0..1) sinks the body `sink` and coils it `coil` back from the target;
   * `drive` (0..1, or below 0 to sit back) throws it `reach` toward it while it sinks `settle`; `spring` lifts it `lift`
   * as the legs straighten; `absorb` is a rise (units, negative at an impact) the knees take; `lean` tilts it toward
   * the target by `pitch` and `roll` radians a unit; `turn` is a yaw.
   */
  | {
    readonly kind: "brace"; readonly on: F; readonly toward: Toward;
    readonly load: F; readonly drive: F; readonly spring: F; readonly absorb: F; readonly lean: F; readonly turn: F;
    readonly size: { readonly sink: number; readonly coil: number; readonly reach: number; readonly settle: number; readonly lift: number; readonly pitch: number; readonly roll: number };
  }
  /** Dancing on planted feet, with the hips: `lift` a rise (or a bow, below 0), `pitch` the body's nose down (below 0) into a bow, `side` the weight's side (-1..1) swayed `sway` and rolled `roll` onto, `turn` a yaw. */
  | { readonly kind: "dance"; readonly on: F; readonly lift: F; readonly pitch: F; readonly side: F; readonly turn: F; readonly size: { readonly sway: number; readonly roll: number } }
  /** Walking: the gait's own bob (twice a cycle), sway, roll and turn on its cycles, by `on`. */
  | { readonly kind: "walk"; readonly on: F; readonly gait: Gait; readonly size: { readonly bob: number; readonly sway: number; readonly roll: number; readonly yaw: number } };

/**
 * The body's carriage over its feet: every stance's, summed; `idle` takes what the others leave (1 - the largest `on`).
 *
 * What it assumes of the body: a body carried over legs whose feet are fixed in the world, standing on a level ground
 * frame (x forward, y up, z to its right), so that six numbers (surge, rise, sway, roll, pitch, yaw) say where the body
 * is relative to its rest over the feet. Nothing here knows the legs; the caller's legs (`chain`s) reach from the
 * carried body to the feet and take up the change. A body that is not carried over feet (a swimmer, a flier, a body
 * hanging from something) has no rest over feet to offset from, and this is not its model.
 *
 * The law. Each stance kind gives a `Carriage` (one handler per kind) and the result is their sum. idle: a breath
 * rise sin(2 pi n t / loop) with n whole breaths in the loop, plus `alive` shifts side to side and fore and aft, a roll
 * and a pitch proportional to them (the loaded side sinks), a small `alive` yaw, plus the footing's `unload`; all of
 * it times (1 - max on of the others). brace: linear in its weights, surge and sway along `toward` by
 * drive reach - load coil, rise -load sink - drive settle + spring lift + absorb, a lean toward the target. dance: its
 * channels as given, scaled by `size`. walk: on times a bob cos(2u) (twice a cycle), sway and roll sin(u), yaw
 * sin(u / 2), with u = 2 pi gait.cycles. Every part is a closed form of the clock and of the stances' weights.
 *
 * Parameters: the weights (`on`, `load`, `drive`, `spring`, `absorb`, `lean`, `turn`, a dance's channels) and
 * `toward` take expressions; every `size`, idle's breath, shift, tilt and turn, and its `loop` and `seed` are fixed
 * numbers.
 *
 * What it cannot do, because of the law:
 * - give one stance priority over another: busy stances add, so two at once sum their offsets; only idle yields.
 * - know whether the legs reach: a rise or surge past what the legs can span is returned all the same.
 * - shape the walk's body motion: bob, sway, roll and yaw are fixed sines of the gait's cycle, only scaled.
 * - carry a body that leaves its feet (a jump): the carriage is an offset from rest over planted feet.
 *
 * Going past it: a `Carriage` is a plain record of six expressions, so one written by hand (or one returned here plus
 * one of your own, field by field) is turned into the body's frame by `carriedFrame`; a new kind of stance is a new
 * variant with its handler. Relatives:
 * - a hop: rise from an `arc` on a `beats` clock, with an `impact` taken by `absorb` at the landing.
 * - a recoil: a brace with `drive` below 0 (sitting back), driven by `swing` on seconds since the hit.
 * - a body swaying on soft legs: roll and sway driven by a `pendulum`'s angle under a `sway` drive.
 */
export function carriage(stances: readonly Stance[]): Carriage {
  const busy = stances.reduce<F>((b, s) => max(b, onOf(s)), lift<"f32">(0));
  return stances.reduce((c, s) => plus(c, carried(s, busy)), zero());
}
function onOf(s: Stance): F {
  switch (s.kind) {
    case "idle": return lift<"f32">(0);
    case "brace": case "dance": case "walk": return s.on;
  }
}
function carried(s: Stance, busy: F): Carriage {
  switch (s.kind) {
    case "idle": return idleOf(s, busy);
    case "brace": return braceOf(s);
    case "dance": return danceOf(s);
    case "walk": return walkOf(s);
  }
}
const TAU = Math.PI * 2;
function idleOf(s: Extract<Stance, { kind: "idle" }>, busy: F): Carriage {
  const t = lift<"f32">(s.t ?? time);
  // Whole breaths in the loop, so it closes.
  const breaths = Math.max(1, Math.round(s.loop / s.breath.period));
  const rise = add(mul(sin(mul(t, (TAU * breaths) / s.loop)), s.breath.rise), alive(t, s.breath.rise * 0.4, s.seed + 1, 0.23, s.loop));
  const sway = alive(t, s.shift.side, s.seed + 2, s.shift.hz, s.loop), surge = alive(t, s.shift.fore, s.seed + 3, s.shift.hz * 0.8, s.loop);
  // The loaded side sinks: roll toward the sway, the nose down over a forward shift.
  const own: Carriage = {
    surge, rise, sway, roll: mul(sway, s.tilt.roll), pitch: mul(surge, -s.tilt.pitch), yaw: alive(t, s.turn, s.seed + 4, 0.17, s.loop),
  };
  return times(plus(own, s.unload), sub(1, busy));
}
function braceOf(s: Extract<Stance, { kind: "brace" }>): Carriage {
  const z = s.size, along = sub(mul(s.drive, z.reach), mul(s.load, z.coil));
  return {
    surge: mul(s.toward.x, along), sway: mul(s.toward.z, along),
    rise: add(add(sub(mul(s.load, -z.sink), mul(s.drive, z.settle)), mul(s.spring, z.lift)), s.absorb),
    // Leaning toward the target: the nose down for a target ahead, the right side down for one to the right.
    pitch: mul(mul(s.lean, s.toward.x), -z.pitch), roll: mul(mul(s.lean, s.toward.z), z.roll), yaw: s.turn,
  };
}
function danceOf(s: Extract<Stance, { kind: "dance" }>): Carriage {
  return { surge: lift<"f32">(0), rise: s.lift, sway: mul(s.side, s.size.sway), roll: mul(s.side, s.size.roll), pitch: s.pitch, yaw: s.turn };
}
/**
 * The body's frame over `ground` carried by `c`: offset by surge (x), rise (y) and sway (z), then turned by yaw about up,
 * roll about the turned forward, pitch about the rolled right, with the signs `Carriage` states. The step from a
 * `carriage` to something a rig can hang parts on.
 *
 * It cannot turn in another order (yaw, then roll, then pitch is fixed, which matters at large angles), and the offsets
 * are along the ground's axes, not the turned body's: a surge is forward over the ground, whatever the yaw.
 */
export function carriedFrame(ground: Frame, c: Carriage): Frame {
  const yx = rotateAbout(ground.x, ground.y, c.yaw), yz = rotateAbout(ground.z, ground.y, c.yaw);
  const ry = rotateAbout(ground.y, yx, c.roll), rz = rotateAbout(yz, yx, c.roll);
  const o = add(add(add(ground.o, mul(ground.y, c.rise)), mul(ground.z, c.sway)), mul(ground.x, c.surge));
  return { o, x: rotateAbout(yx, rz, c.pitch), y: rotateAbout(ry, rz, c.pitch), z: rz };
}

function walkOf(s: Extract<Stance, { kind: "walk" }>): Carriage {
  const u = mul(s.gait.cycles, TAU), z = s.size;
  return times({
    surge: lift<"f32">(0), rise: mul(sin(add(mul(u, 2), Math.PI / 2)), z.bob), sway: mul(sin(u), z.sway),
    roll: mul(sin(u), z.roll), pitch: lift<"f32">(0), yaw: mul(sin(mul(u, 0.5)), z.yaw),
  }, s.on);
}

// ---- re-plants: scheduled once, in the fight's idle time --------------------------------------------------------------

/** One foot stepping away at `out` and back home at `back` (seconds in the loop, back after out), placed `to` (ground x, z) away. */
export type Replant = { readonly foot: number; readonly out: number; readonly back: number; readonly to: readonly [number, number] };

export type ReplantSpec = {
  /** Each foot's home on the ground (x forward, z right), in the ground frame. */
  readonly homes: readonly (readonly [number, number])[];
  /** The loop the schedule repeats in (seconds). */
  readonly loop: number;
  /** How busy the body is at a clock (0 idle .. 1), at the inputs' defaults: its actions' weights, a dance's `on`. */
  readonly busy: (t: F) => F;
  /** Below this the body is idle. */
  readonly idleBelow: number;
  /** About one step per this many seconds of idle time a step can start in. */
  readonly every: number;
  /** A step's own times: the body leaves the foot `lead` before it lifts, the foot is up `seconds`, the body is back `settle` after. */
  readonly step: StepTiming;
  /** How far a re-plant puts a foot from its home. */
  readonly reach: number;
  readonly seed: number;
};
export type StepTiming = { readonly lead: number; readonly seconds: number; readonly settle: number };

/** A small seeded generator (mulberry32): the schedule's jitter and choices, the same every build for a seed. */
function rng(seed: number): () => number {
  let a = (Math.floor(seed * 7919) + 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The re-plants of one loop: when an idle legged body shifts a foot to a new place and later puts it back, scheduled
 * once on the CPU for `footing` to play.
 *
 * What it assumes of the body: feet with homes on a level ground (x forward, z to the right), on both sides of the
 * body (a foot is on the left when its home's z is below 0), and a loop the whole performance repeats in.
 *
 * The law. `busy` is evaluated on the CPU over the loop, 20 times a second, at the inputs' defaults; a step may start
 * at s when the body is idle (busy below `idleBelow`) from s - lead to s + seconds + settle. The number of steps is
 * 2 round(idle start time / (2 every)): even, since each foot that goes comes back. They are spread evenly through the
 * feasible starts with a seeded jitter of a third of a slot, at least one whole step apart, and paired out and back
 * interleaved (A out, B out, A back, B back); the feet are shuffled by the seed and taken from the left and right in
 * turn. Each foot goes `reach` from its home, outward along its home's direction from the body's centre turned by up
 * to 0.8 radians either way. The same seed gives the same schedule every build.
 *
 * Parameters: all fixed numbers, and `busy`, a function of a clock evaluated now; the result is a plain list of
 * `Replant`s, so it can be read, edited or written by hand.
 *
 * What it cannot do, because of the law:
 * - answer the game at run time: the schedule is made once from the inputs' defaults; a body made busy by an input
 *   only has steps gated off (in `footing`), never moved.
 * - see an action shorter than a twentieth of a second in `busy`: it is sampled.
 * - put a foot anywhere but outward from its home by `reach`, or leave it there past its pair's `back` time.
 * - schedule a body whose feet are all on one side: the feet are taken from the left and right in turn.
 *
 * Going past it: the result is data, so the one step down is a list of `Replant`s of your own (on a music's beats, at
 * chosen places). Relatives:
 * - steps on a cycle instead of a schedule: `gait`, where which plant is a floor of the clock.
 * - steps in place on an accent: a `footing`'s stamps.
 * - a shuffle that never lifts: a re-plant played with `height` 0 (the foot slides to its new place).
 */
export function replants(spec: ReplantSpec): readonly Replant[] {
  const { loop, step } = spec, rate = 20, n = Math.round(loop * rate);
  const x = variable("stance_t", "f32");
  const run = compileJs([spec.busy(x)]);
  const idle = Array.from({ length: n }, (_, i) => (run({ vars: { stance_t: i / rate }, inputs: {}, params: {} })[0] as number) < spec.idleBelow);
  const span = (s: number) => { for (let k = Math.floor((s - step.lead) * rate); k <= Math.ceil((s + step.seconds + step.settle) * rate); k++) if (!idle[((k % n) + n) % n]) return false; return true; };
  const starts = Array.from({ length: n }, (_, i) => i / rate).filter(span);
  const count = 2 * Math.floor(starts.length / rate / (2 * spec.every) + 0.5);
  if (count === 0) return [];
  const r = rng(spec.seed + 1);
  // Even through the feasible starts (by their index: idle time), jittered by a third of a slot, kept a step apart.
  const apart = step.lead + step.seconds + step.settle;
  const times: number[] = [];
  for (let j = 0; j < count; j++) {
    const want = starts[Math.min(starts.length - 1, Math.floor(((j + 0.5 + (r() - 0.5) * 0.66) / count) * starts.length))]!;
    const at = starts.find((s) => s >= want && (times.length === 0 || s >= times[times.length - 1]! + apart));
    if (at === undefined) break;
    times.push(at);
  }
  const pairs = Math.floor(times.length / 2);
  // Feet: shuffled, then taken alternately from each side.
  const order = spec.homes.map((_, i) => i).sort(() => r() - 0.5);
  const left = order.filter((i) => spec.homes[i]![1] < 0), right = order.filter((i) => spec.homes[i]![1] >= 0);
  const feet = Array.from({ length: pairs }, (_, p) => (p % 2 === 0 ? left : right)[Math.floor(p / 2) % (p % 2 === 0 ? left : right).length]!);
  return feet.map((foot, p) => {
    const [hx, hz] = spec.homes[foot]!, l = Math.hypot(hx, hz), a = (r() - 0.5) * 1.6;
    // Out from the body, turned up to 0.8 rad either way.
    const dx = (hx / l) * Math.cos(a) - (hz / l) * Math.sin(a), dz = (hx / l) * Math.sin(a) + (hz / l) * Math.cos(a);
    return { foot, out: times[p]!, back: times[p + pairs]!, to: [dx * spec.reach, dz * spec.reach] as const };
  });
}

// ---- the footing ------------------------------------------------------------------------------------------------------

/** A stamp: foot `foot` lifts `lead` seconds before an accent and comes down on it, in place. `since` is seconds since the accent (negative before). */
export type Stamp = { readonly foot: number; readonly since: F; readonly lead: number; readonly height: number };

export type FootingSpec = {
  /** The frame the feet are homed in (the body's place on the ground). */
  readonly ground: Frame;
  /** Each foot's home in the ground frame (on the ground). */
  readonly homes: readonly (readonly [number, number, number])[];
  readonly t?: In<"f32">;
  /**
   * The re-plants, run every `loop` seconds; each pair only if `busy` is idle at its four times (both steps' leads and
   * settles). Absent: the feet never re-plant (a body that only stands and walks).
   */
  readonly replant?: { readonly schedule: readonly Replant[]; readonly loop: number; readonly step: StepTiming; readonly height: number; readonly busy: (t: F) => F; readonly idleBelow: number; readonly unload: number; readonly dip: number };
  /** Absent: no stamps. */
  readonly stamps?: readonly Stamp[];
  /** The walk: its gait (homed in the ground frame, whose course starts at the origin), its weight, and the seconds a cycle is taken to last for `since`. */
  readonly walk: { readonly gait: Gait; readonly on: F; readonly secondsPerCycle: number };
};

export type Footing = {
  /** Foot i in the world. */
  foot(i: number): P3;
  /** 1 while foot i bears weight, 0 while it is in the air. */
  planted(i: number): F;
  /** Seconds since foot i last planted (large if it has not stepped), and since it lifted (negative while planted). */
  since(i: number): { readonly sincePlant: F; readonly sinceLift: F };
  /** What the body does about the steps: leaves a foot before it lifts, comes back after, dips as it plants. An idle carriage. */
  readonly unload: Carriage;
};

/** Seconds since a foot last planted when it has not stepped: long enough that every reaction to a plant has died away. */
const LONG_AGO = 1000;
const wrap = (x: F, p: number): F => sub(x, mul(floor(div(x, p)), p));

/**
 * Where each foot of a standing, stepping, walking body is, and whether it bears weight: one function of the clock for
 * every foot, from its home and the named events that move it.
 *
 * What it assumes of the body: legs ending in feet that are points on a level ground frame (x forward, y up, z to its
 * right), each with a home there; the host or a course moves the body, and the feet are given in the ground frame
 * that goes with it. A body with no feet on the ground, or with contacts that are not feet (hands on a wall), fits only
 * by treating those contacts as feet.
 *
 * The law. A foot stands at its home plus the offsets of its events, mixed with the walk by the walk's weight:
 * foot_i = ground(mix(home_i + sum of events, walk_i, on)). Events: a re-plant moves the foot to `to` by a smoothstep
 * over `seconds` and lifts it `height` sin(pi u), then the same back, repeating every `loop`, each pair gated (all or
 * nothing, for that turn of the loop) by `busy` being idle at its four times; a stamp lifts the foot in place,
 * `height` sin(pi u^0.6) (up fast, down hard on the accent). walk_i is the gait's foot in its body's own axes, so the
 * course's travel is the host's and only the step is the foot's. A foot is planted per the gait while `on` is above
 * 0.5, else while no event has it in the air. `unload` is what the body does about the re-plants (leaves the foot
 * before it lifts, comes back after, dips as it plants), an idle `Carriage` for `carriage`.
 *
 * Parameters: `ground`, `t`, each stamp's `since` and the walk's `on` take expressions; the homes, the schedule, the
 * timings, heights, `unload` and `dip` are fixed numbers; `busy` is a function of a clock.
 *
 * What it cannot do, because of the law:
 * - follow terrain: a foot is on the ground frame's plane plus an event's lift.
 * - leave a foot where it was moved: a re-plant always brings it home, and a stamp never moves it.
 * - blend into the walk cleanly: positions are mixed linearly, so mid-blend feet slide, and planted switches at
 *   on = 0.5 in one frame.
 * - turn a foot: feet are points.
 * - keep two events on one foot apart: their offsets and lifts add.
 *
 * Going past it: a foot is home plus a sum of events, so an event of your own is one more term in the sum (an offset
 * and a lift as functions of the clock). Relatives:
 * - feet on a cycle instead of events: `gait`, the walk this blends in.
 * - a kick: a stamp whose offset is an `arc` forward and back instead of in place.
 * - a hand or a tail tip braced on something: the same home-plus-events law for any contact point.
 */
export function footing(spec: FootingSpec): Footing {
  const t = lift<"f32">(spec.t ?? time);
  type Event = { readonly foot: number; readonly offset: P3; readonly up: F; readonly air: F; readonly sincePlant: F; readonly sinceLift: F };
  const events: Event[] = [];
  const unloads: Carriage[] = [];
  // An absent section is no events of its kind (read once, here).
  const R = spec.replant;
  if (R !== undefined) for (const p of R.schedule) {
    const S = R.step, P = R.loop;
    const idleAt = (at: F): F => select(lt(R.busy(at), R.idleBelow), 1, 0);
    // One clock per pair, so its two steps reset together at the loop's turn (both done, both 0: no jump).
    const tau = wrap(sub(t, p.out), P), start = sub(t, tau), gap = p.back - p.out;
    const g = [-S.lead, S.seconds + S.settle, gap - S.lead, gap + S.seconds + S.settle].reduce<F>((acc, dt) => mul(acc, idleAt(add(start, dt))), lift<"f32">(1));
    const u = (from: number) => clamp(div(sub(tau, from), S.seconds), 0, 1);
    const air = (v: F): F => select(gt(v, 0), select(lt(v, 1), 1, 0), 0);
    const uo = u(0), ub = u(gap), airO = air(uo), airB = air(ub);
    const to = vec3(p.to[0], 0, p.to[1]);
    const sincePlant = select(ge(tau, gap + S.seconds), sub(tau, gap + S.seconds), select(ge(tau, S.seconds), sub(tau, S.seconds), add(tau, P - gap - S.seconds)));
    const sinceLift = select(gt(airO, 0.5), tau, select(gt(airB, 0.5), sub(tau, gap), -1));
    events.push({
      foot: p.foot, offset: mul(to, mul(g, sub(smoothstep(0, 1, uo), smoothstep(0, 1, ub)))),
      up: mul(g, mul(R.height, add(sin(mul(uo, Math.PI)), sin(mul(ub, Math.PI))))), air: mul(g, add(airO, airB)),
      sincePlant: select(gt(g, 0.5), sincePlant, LONG_AGO), sinceLift: select(gt(g, 0.5), sinceLift, -1),
    });
    // The body leaves the foot before it lifts and comes back after it plants (anticipation, follow-through), away
    // from the foot's home, and dips as it plants (the knees take the weight back).
    const [hx, , hz] = spec.homes[p.foot]!, l = Math.hypot(hx, hz);
    for (const s0 of [0, gap]) {
      const away = mul(g, mul(smoothstep(s0 - S.lead, s0, tau), sub(1, smoothstep(s0 + S.seconds, s0 + S.seconds + S.settle, tau))));
      const plant = clamp(div(sub(tau, s0 + S.seconds), S.settle), 0, 1);
      unloads.push({
        surge: mul(away, (-hx / l) * R.unload), sway: mul(away, (-hz / l) * R.unload), rise: mul(g, mul(sin(mul(plant, Math.PI)), -R.dip)),
        roll: lift<"f32">(0), pitch: lift<"f32">(0), yaw: lift<"f32">(0),
      });
    }
  }
  for (const s of spec.stamps ?? []) {
    const u = div(add(s.since, s.lead), s.lead), air = select(gt(u, 0), select(lt(u, 1), 1, 0), 0);
    // Up fast and down hard on the accent: the height rises as sin(pi u^0.6), its top a third of the way.
    events.push({
      foot: s.foot, offset: vec3(0, 0, 0), up: mul(air, mul(sin(mul(pow(clamp(u, 0, 1), 0.6), Math.PI)), s.height)), air,
      sincePlant: select(ge(s.since, 0), s.since, LONG_AGO), sinceLift: select(gt(air, 0.5), add(s.since, s.lead), -1),
    });
  }
  const unload = unloads.reduce(plus, zero());
  const W = spec.walk, walking = gt(W.on, 0.5);
  const inGround = (p: P3): P3 => add(spec.ground.o, rotate(spec.ground, p));
  const mine = (i: number) => events.filter((e) => e.foot === i);
  return {
    unload,
    foot: (i) => {
      const es = mine(i);
      const stand = es.reduce<P3>((p, e) => add(add(p, e.offset), vec3(0, e.up, 0)), vec3(...spec.homes[i]!));
      // The walk's feet relative to where its course has the body now, in that body's axes (the host moves the creature
      // itself). Taken in the course's own axes so that a course that turns (an arc, a dance's path) puts each foot where
      // its body is turned now; for a straight course whose frame is the ground's this is the old difference.
      const d = sub(W.gait.foot(i), W.gait.body.o), b = W.gait.body;
      const walk = vec3(add(add(mul(d.x, b.x.x), mul(d.y, b.x.y)), mul(d.z, b.x.z)), add(add(mul(d.x, b.y.x), mul(d.y, b.y.y)), mul(d.z, b.y.z)), add(add(mul(d.x, b.z.x), mul(d.y, b.z.y)), mul(d.z, b.z.z)));
      return inGround(mix(stand, walk, W.on));
    },
    planted: (i) => select(walking, W.gait.planted(i), sub(1, min(mine(i).reduce<F>((a, e) => add(a, e.air), lift<"f32">(0)), 1))),
    since: (i) => {
      const es = mine(i), g = W.gait.since(i);
      const sp = es.reduce<F>((a, e) => min(a, e.sincePlant), lift<"f32">(LONG_AGO)), sl = es.reduce<F>((a, e) => max(a, e.sinceLift), lift<"f32">(-1));
      return { sincePlant: select(walking, mul(g.sincePlant, W.secondsPerCycle), sp), sinceLift: select(walking, mul(g.sinceLift, W.secondsPerCycle), sl) };
    },
  };
}

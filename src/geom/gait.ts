// A gait: foot targets for many legs from one cycle, as a pure function of time. The body travels a `course` (its
// pose after walking a distance s, any closed-form function); each foot is planted, for the `duty` share of its
// cycle, where the body's frame put its home at the middle of that stance, and swings to the next such place on an
// arc. So a planted foot is fixed in the world while the body moves over it, with no state: the plant is a function
// of which cycle it is, `floor(cycles + phase)`. The cycles are counted by the clock (`pace` time: t / period) or by
// the distance walked (`pace` distance: travelled / stride, for a host that moves the creature and says how far).

import { add, cos, floor, length, lift, mix, mul, sin, smoothstep, step, sub, saturate, div, vec3, time, type In } from "../expr.ts";
import { rotate } from "../map/chart.ts";
import type { F, Frame, P3 } from "../map/types.ts";

export type Course = (s: F) => Frame;

export type GaitSpec = {
  /** Each foot's home in the body's course frame (x the body's forward, y up), on the ground. */
  readonly feet: readonly In<"vec3">[];
  /** Each foot's phase offset, as a share of the cycle (one per foot). */
  readonly phase: readonly number[];
  /** The body's pose after travelling a distance s along the ground. */
  readonly course: Course;
  /** Distance the body travels in one full cycle. */
  readonly stride: In<"f32">;
  /** What counts the cycles: the clock, or the distance walked. */
  readonly pace: Pace;
  /** Share of the cycle each foot is planted (above 0.5 keeps more feet down than up). */
  readonly duty: In<"f32">;
  /** Peak height of a swinging foot above the line between its plants. */
  readonly lift: In<"f32">;
  /**
   * A step shorter than this does not lift the foot (in proportion below it): a body that stops on its course stands on
   * its feet, and one whose course turns or moves again steps. Absent: every foot steps every cycle.
   */
  readonly minStep?: number;
};

/**
 * What counts a gait's cycles. `time`: `period` seconds a cycle on the clock `t` (default `time`); the body travels
 * `stride` a cycle, so it walks away along its course. `distance`: one cycle per `stride` of `travelled`, a distance
 * a host sets (it moves the body itself and says how far it has walked); the stride must not be 0.
 */
export type Pace =
  | { readonly kind: "time"; readonly period: In<"f32">; readonly t?: In<"f32"> }
  | { readonly kind: "distance"; readonly travelled: In<"f32"> };

export type Gait = {
  /** Distance travelled. */
  readonly travelled: F;
  /** The body's course frame now. */
  readonly body: Frame;
  /** Foot i's target in the world. */
  foot(i: number): P3;
  /** 1 while foot i is planted, 0 while it swings. */
  planted(i: number): F;
  /** Cycles counted so far (the pace's clock): what a body's bob and sway on the step read. */
  readonly cycles: F;
  /** Foot i's step, in shares of a cycle: since it last planted, and since it lifted (negative while planted). */
  since(i: number): { readonly sincePlant: F; readonly sinceLift: F };
};

/** A point given in a frame's coordinates, in the world. */
const inFrame = (g: Frame, p: In<"vec3">): P3 => add(g.o, rotate(g, lift<"vec3">(p)));

/**
 * Foot targets for a legged body with any number of limbs, from one cycle: each foot planted fixed in the world while
 * the body moves over it, then swung to its next plant.
 *
 * The law. Foot i reads the cycle c = cycles + phase[i], with k = floor(c) and s = c - k. Plant k is the foot's home
 * carried by the course frame at distance stride (k + duty / 2 - phase[i]): where the body is at the middle of that
 * stance. For s < duty the foot sits on plant k; after that, with w = (s - duty) / (1 - duty), it moves from plant k to
 * plant k + 1 by smoothstep(w) and rises lift sin(pi w) along the plant frame's up. The body is the course frame at
 * stride * cycles. So a planted foot is fixed while the body passes over it, its position is continuous through every
 * lift and landing, and nothing is stored: which plant is a floor of the clock. `cycles` is t / period (`Pace` time)
 * or travelled / stride (`Pace` distance).
 *
 * Parameters: `feet`, `stride`, `duty`, `lift` and the pace's `period`, `t` or `travelled` take expressions; `phase`
 * and `minStep` are fixed numbers; `course` is any closed-form function from distance to a frame.
 *
 * What it cannot do, because of the law:
 * - feet that follow terrain: a plant is wherever the course frame puts the home, at the course's own height.
 * - change rhythm (walk to gallop): the phases are fixed numbers, so the footfall pattern is one per gait; blending two
 *   gaits' `foot(i)` mixes positions, and mid-blend feet slide.
 * - change speed smoothly under `pace` time by moving `period`: cycles = t / period, so a period that changes makes
 *   the count leap. A speed that changes is `pace` distance with a `travelled` the host accumulates.
 * - a step of another shape: along is always smoothstep and up a half sine, so a foot lands with downward speed and
 *   stops in one frame; a foot is a point and never turns as it lands.
 * - stop with feet anywhere but their plants: `minStep` scales a short step's lift down, nothing more.
 *
 * Going past it: the result is a target per foot, so legs are `chain`s reaching for `foot(i)`, and `since(i)` gives
 * each step's phase to drive a toe curl or a stomp. The one step down is the course: any function from distance to a
 * frame, so terrain is a course whose origin follows a height function, and a figure eight is a course whose yaw is a
 * sine of s. Relatives:
 * - all phases equal and `duty` below 0.5: every foot leaves the ground together, a hop or a bound; add the body's
 *   rise from `carriage`'s walk or an `arc` on the cycle's fraction.
 * - phase[i] = i * q for a row of many limbs: a wave of steps running down the body (a metachronal wave), its speed
 *   set by q.
 * - the same plant law without a cycle: feet that stay home and leave only on named events, scheduled ones and ones on
 *   a beat, are `footing` with `replants`.
 */
export function gait(spec: GaitSpec): Gait {
  if (spec.phase.length !== spec.feet.length) throw new Error(`gait: ${spec.feet.length} feet need as many phases, got ${spec.phase.length}`);
  const duty = lift<"f32">(spec.duty), stride = lift<"f32">(spec.stride);
  const cycles = cyclesOf(spec.pace, spec.stride);
  const cycle = (i: number) => add(cycles, spec.phase[i]);
  // The distance at a count of cycles: a stride each, whatever counts them.
  const at = (u: F): F => mul(stride, u);
  return {
    travelled: at(cycles),
    body: spec.course(at(cycles)),
    cycles,
    planted: (i) => sub(1, mul(step(duty, sub(cycle(i), floor(cycle(i)))), going(i))),
    since: (i) => { const s = sub(cycle(i), floor(cycle(i))); return { sincePlant: s, sinceLift: sub(s, duty) }; },
    foot: (i) => {
      const { here, next, s } = plants(i);
      const swing = saturate(div(sub(s, duty), sub(1, duty)));
      // In stance swing is 0, so this is the plant itself: no branch between stance and swing.
      const arc = mul(here.y, mul(mul(spec.lift, going(i)), sin(mul(swing, Math.PI))));
      return add(mix(inFrame(here, spec.feet[i]), inFrame(next, spec.feet[i]), smoothstep(0, 1, swing)), arc);
    },
  };
  /** Foot i's plant this cycle and the next one's: where the body's frame puts its home at the middle of each stance. */
  function plants(i: number) {
    const c = cycle(i), k = floor(c), s = sub(c, k);
    const uMid = sub(add(k, mul(duty, 0.5)), spec.phase[i]);
    return { here: spec.course(at(uMid)), next: spec.course(at(add(uMid, 1))), s };
  }
  /** How far foot i's step goes toward lifting it: 1 for every step without `minStep`, else its length over `minStep`, at most 1. */
  function going(i: number): F {
    const m = spec.minStep;
    if (m === undefined) return lift<"f32">(1);
    if (!(m > 0)) throw new Error(`gait: minStep must be more than 0, got ${m}`);
    const { here, next } = plants(i);
    return saturate(div(length(sub(inFrame(next, spec.feet[i]), inFrame(here, spec.feet[i]))), m));
  }
}

/** Cycles counted by a pace. Classified once, here. */
function cyclesOf(p: Pace, stride: In<"f32">): F {
  switch (p.kind) {
    case "time": return div(lift<"f32">(p.t ?? time), p.period);
    case "distance":
      if (stride === 0) throw new Error("gait: a gait paced by distance needs a stride that is not 0 (a creature that walks in place is paced by time)");
      return div(lift<"f32">(p.travelled), stride);
  }
}

/**
 * Courses: the body's frame after travelling a distance s, for a `gait`. Two are given: a straight line and an arc of
 * constant turning.
 *
 * The law. A course frame has its origin on the path and its x level at a yaw (radians counter-clockwise from +x seen
 * from above), y straight up, z to the body's right. `line(origin, heading, facing)`: origin + s (cos h, 0, -sin h),
 * yaw = heading + facing. `arc(origin, heading, radius, facing)`: with phi = s / radius, dir = (cos h, 0, -sin h) and
 * left = (-sin h, 0, -cos h), origin + radius (dir sin phi + left (1 - cos phi)), yaw = heading + phi + facing; a
 * negative radius turns right. In both, s is arc length, so a
 * stride is a true distance along the path.
 *
 * Parameters: `origin` takes an expression (it can move); `heading`, `radius` and `facing` are fixed numbers.
 * `facing` turns the body from its direction of travel: a quarter turn walks sideways.
 *
 * What it cannot do, because of the law:
 * - leave level ground: the path stays at origin.y, and the frame never pitches or rolls.
 * - any curvature but 0 or one constant: no path that straightens out, no S-bend, no stop.
 * - face anywhere but a fixed angle off its direction of travel.
 *
 * Going past it: a course is only a function `(s) => Frame`, so a path of your own is one function: put the origin
 * where the path is after s and the yaw along its tangent. Relatives:
 * - yaw growing as s^2 (a clothoid): a path that bends tighter and tighter, a body turning into a spiral. Its position
 *   is a Fresnel integral with no closed form: sample it once with `tabulate`.
 * - yaw = A sin(2 pi s / L): a weave, and with the right A a figure eight; its position is again an integral of
 *   (cos yaw, -sin yaw), tabulated.
 * - a path through points: `through(s / total, points)` for the origin and its difference for the yaw; s is then not
 *   arc length, so the stride stretches where points are far apart.
 * - terrain: any course with origin.y replaced by a height function of origin.x and origin.z.
 */
export const course = {
  line(origin: In<"vec3">, heading: number, facing = 0): Course {
    return (s) => frameAt(add(lift<"vec3">(origin), mul(vec3(Math.cos(heading), 0, -Math.sin(heading)), s)), lift<"f32">(heading + facing));
  },
  /** Turning left (counter-clockwise seen from above) at `radius`; a negative radius turns right. */
  arc(origin: In<"vec3">, heading: number, radius: number, facing = 0): Course {
    const dir = vec3(Math.cos(heading), 0, -Math.sin(heading)), left = vec3(-Math.sin(heading), 0, -Math.cos(heading));
    return (s) => {
      const phi = div(s, radius);
      const o = add(lift<"vec3">(origin), mul(add(mul(dir, sin(phi)), mul(left, sub(1, cos(phi)))), radius));
      return frameAt(o, add(phi, heading + facing));
    };
  },
};

/** A frame at o whose x is the horizontal direction at `yaw` (radians counter-clockwise from +x seen from above). */
function frameAt(o: P3, yaw: F): Frame {
  const x = vec3(cos(yaw), 0, mul(sin(yaw), -1));
  return { o, x, y: lift<"vec3">([0, 1, 0]), z: vec3(sin(yaw), 0, cos(yaw)) };
}

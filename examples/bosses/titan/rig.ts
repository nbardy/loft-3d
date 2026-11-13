// The Reefback Titan's rig: everything the game reads and the checks measure, for any variant. The walk in place, Claw
// Crush (whose ring wave shoves the second boat) and the Grab (which throws the first), each defined once, the sea and
// the two ships, the body and shell frames that every slot is drawn in, the claws' shoulders, the warnings, the crash
// and the splash. It reads the numbers and what the claws offer (slots.ts, `ClawsOffer`), never which options were
// chosen. The throw and the wave: docs/throw_and_shove.md.
//
// Crab coordinates: x forward, y up, z to its right; the body frame rides `ride` above the still water.

import {
  add, alive, atan2, attack, carriage, footing, headingIn, namespaceSeed, replants, towardIn, type Footing, blendFrames, clamp, course, cos, cross, div, dragged, emote, every, exp, gait, ge, gt, handTurn, hit, hold, hosted, impact, input, lift,
  floor, lt, max, mix, mul, overshot, slowOut,
  normalize, placedBy, poseFrame, rigid, ring, rotateAbout, sea, select, sin, size, slowIn, slowInOut, smoothstep, sqrt, STAND_IN, sub, swing, telegraph, thrown,
  time, tumbled, tumbleRate, turnedAbout, vec2, vec3, type Attack, type BodyAttack, type Drawable, type Expr, type F, type Frame, type Gait, type GripSpec, type Hold, type P3, type Placer,
  type Pose, type Ring, type RingWave, type Sea, type SeaDeform, type SeaSpec, type Target, type Thrown,
} from "../../../src/index.ts";
import { rotate } from "../../../src/map/chart.ts";
import { impactFoam, type ImpactPaint } from "../lib/impact.ts";
import { scaleShip, scaleShipNamed } from "../lib/scale_ship.ts";
import { PRINT_WARNING } from "../lib/warning.ts";
import { perFrame, sides, type V3 } from "./ink.ts";
import type { Numbers } from "./numbers.ts";
import type { Dancer, RoutineSpec, Stance } from "../../../src/index.ts";
import type { BoatsOption, ClawsOffer } from "./slots.ts";

type V2 = Expr<"vec2">;

export type Rig = {
  readonly n: Numbers;
  /**
   * Where each foot stands (`foot(k)`, world), whether it bears weight (`planted(k)`), and its step clock (`since(k)`:
   * seconds since it last planted, and since it lifted, negative while planted). Feet are planted; they step only to
   * re-plant in the idle, to stamp on a taunt's accent, or when a game walks the crab (docs/stance.md). Options that react
   * to a step (foam, a swinging lantern) read `since`.
   */
  readonly walk: Footing;
  /** Claw Crush. Its aftermath is a ring wave: `crush.pushed(place)` is how far a thing afloat there has been shoved. */
  readonly crush: BodyAttack<Ring>;
  /** Seconds since this cycle's slam (0 before it): the body's thud, the shell's follow-through, the eyes' whip. */
  readonly crushAfter: F;
  /** The Grab: a hold that ends thrown (`grab.toss()` says where and when the ship lands, `grab.flight()` whether it is in the air). */
  readonly grab: Attack<GripSpec, Hold<Thrown>>;
  /** How far the cutter is given over to the grab: the attack's posture, 0 idle, 1 from the end of its wind-up until it lets go. */
  readonly grabOn: F;
  readonly grabEnv: ReturnType<Attack["envelope"]>;
  /** The grab's beats; `settle` is the eye's 1.5 s to look away, `after` counts from the end of the release. */
  readonly grabBeat: ReturnType<Attack["beats"]>;
  /** The cutter's own axis in the Grab (unit, world): the first ship's keel as the socket has it, level along the `boat1.heading` input until the throw's stroke, then turning with the hand. */
  readonly keel: P3;
  /** The held ship's own up as the socket has it (world up until the throw's stroke, then turning with the hand): the gripping palm lies flat on it. */
  readonly gripUp: P3;
  /** Where the cutter is raised to, in the grab's posture (world). */
  readonly gripRest: P3;
  /** The first ship's middle (world), wherever the Grab has put it: afloat, held, in the air, or where it landed. */
  readonly shipNow: P3;
  /** The host inputs both placers read, whose defaults are the show (`grab.arm`, `crush.arm`, `crush.centre`, `boat1.at`, `boat1.heading`, `boat1.beam`, `throw.land`). */
  readonly inputs: Inputs;
  /** Where the second boat is before the ring reaches it (x, z): the stand-in's `boat2.at` input, or the host's pose. */
  readonly boatTwoAt: V2;
  /** A point in the boss's own axes (x forward, y up, z to its right; the boss at rest, no sway) in the world: `place` in space, `place2` on the water (x, z). At home they are the identity. */
  readonly place: (p: V3 | P3) => P3;
  readonly place2: (p: V2 | readonly [number, number]) => V2;
  /** Where the boss's audience is (world): what a face that plays to the camera looks at. */
  readonly audience: P3;
  /** The taunt's dance, each readout once per frame (all 0, and `raised` the identity, for a boss that does not taunt). */
  readonly dance: Dance;
  /** The centre of Claw Crush's disc on the water (world x, z): the `crush.centre` input, carried by the boss's pose. What a face looks at when it eyes the slam. */
  readonly crushCentre: V2;
  /** The first ship's hull as it is drawn (afloat, in the socket, in the air), as a target: what the claw's fingers must stay out of once they let go. */
  readonly shipTarget: Target;
  /** Who places each boat when the crab does not hold it (the `boats` slot's choice). */
  readonly placer: { readonly boat1: Placer; readonly boat2: Placer };
  /** What a game that runs its own boats reads. */
  readonly handoff: Handoff;
  readonly body: Frame;
  /** The atoll's frame: the body's, with the lean read late and a follow-through pitch. */
  readonly shell: Frame;
  /** A crab-coordinate point (or offset from the body's origin) in the world. */
  readonly local: (p: V3 | P3) => P3;
  /** The claw shoulder on a side (crab coordinates): -1 the cutter's (left), 1 the crusher's. */
  readonly shoulder: (side: 1 | -1) => V3;
  /** Drawn by the scene, not the crab: the sea, the two ships, the two warnings, the slam's crash and the thrown ship's splash (the stand-in's). */
  readonly world: { readonly sea: Sea; readonly warnings: readonly Drawable[]; readonly crash: Drawable; readonly splash: readonly Drawable[]; readonly boat: readonly Drawable[] };
};

/** The host inputs (docs/throw_and_shove.md lists their names, units and defaults). */
export type Inputs = {
  readonly grabArm: F; readonly crushArm: F; readonly crushCentre: V2;
  readonly boat1At: V2; readonly boat1Heading: F; readonly boat1Beam: F; readonly throwLand: V2;
};

/**
 * The hand-off: closed forms a game evaluates each frame. Places are of a ship's origin (its waterline amidships),
 * world units; velocities units per second; times seconds on the scene's clock, of the attack's cycle now.
 */
export type Handoff = {
  /** While `held` is 1 the first ship is the crab's: its frame is `socket` (origin, bow x, mast y, starboard z) and its size `squeeze` (along its own x, y, z). */
  readonly socket: Frame; readonly held: F; readonly squeeze: P3;
  /** The release: its instant, the ship's place and velocity then, and the spin the stand-in gives it (radians per second about the vector; the claw itself gives none). */
  readonly release: { readonly time: F; readonly at: P3; readonly velocity: P3; readonly spin: P3 };
  /** Where and when the stand-in's flight lands and comes to rest: a prediction under this scene's gravity for a host that flies its own. */
  readonly landing: { readonly time: F; readonly at: P3; readonly rest: P3 };
  /** Claw Crush's ring as a field: `arrival(place)` seconds after `crush.arm`, `lifts(place, t)` units, `impulse(place)` units per second at arrival. */
  readonly wave: RingWave;
};

// ---- staging: where a boss stands, how its show ends, whether it taunts (docs/lineup.md) ---------------------------

/** How the stand-in boats get back to their places for the next cycle. */
export type Show =
  /** They are back at their places when an attack's cycle turns: a jump, at the loop's seam if the scene arranges it. */
  | { readonly kind: "cut" }
  /**
   * No jump, so the scene can loop. The thrown boat goes down where it landed (`sink.after` seconds after touchdown,
   * over `sink.seconds`, to `sink.depth` under: an opaque sea hides it) and a new boat sails in, straight from
   * `sailIn.from` (an offset from its place, in the boss's axes: somewhere out of frame) over the last `sailIn.seconds`
   * of the Grab's cycle, rounding up to its own heading over the last `sailIn.round` share of the way, and is home as
   * the next warning starts. The shoved boat sails back to its place, starting `sailBack.after` seconds after the
   * slam, over `sailBack.seconds`.
   */
  | {
    readonly kind: "loop"; readonly sink: { readonly after: number; readonly seconds: number; readonly depth: number };
    readonly sailIn: { readonly from: readonly [number, number]; readonly seconds: number; readonly round: number };
    readonly sailBack: { readonly after: number; readonly seconds: number };
  };

/**
 * Whether the boss taunts: not at all; a dance of its own whose moves land `accents` seconds after `first` (every
 * `crushPeriod`), in its own manner (`temper`); or a member's part in a group's routine (src/spacetime/routine.ts): the
 * group's key poses, path and groove, in the group's manner, and its solo in `own` manner.
 */
export type Taunt =
  | { readonly kind: "none" }
  /** `pulse`: the seconds of the scene's subdivision, which a twitchy crab ticks on (absent: 0.25, the eighths at 120 a minute). */
  | { readonly kind: "dance"; readonly first: number; readonly accents: readonly number[]; readonly pulse?: number }
  | { readonly kind: "routine"; readonly dancer: Dancer; readonly size: RoutineSpec["size"]; readonly beat: number; readonly own: Numbers["temper"] };

/** Where the boss's audience is (what a face that plays to it looks at): its own, a point in its axes that moves with it; or a place in the world (a camera's eye). */
export type Audience = { readonly kind: "own" } | { readonly kind: "at"; readonly eye: V3 };

export type Staging = {
  /** The defaults of the `boss.at` (world x, z) and `boss.heading` (radians from +x toward +z) inputs. */
  readonly at: readonly [number, number]; readonly heading: number;
  /** How far ahead of the scene's clock the walk treads, as a share of its cycle. */
  readonly walkAhead: number;
  readonly show: Show; readonly taunt: Taunt; readonly audience: Audience;
};
/** The crab on its own: at the origin, facing +x, its boats jumping home, no taunt, its own audience. */
export const AT_HOME: Staging = { at: [0, 0], heading: 0, walkAhead: 0, show: { kind: "cut" }, taunt: { kind: "none" }, audience: { kind: "own" } };

/** The first stage's product: the boss's deformations of the sea, the sea it would have alone, and the second stage. */
export type StagedRig = { readonly deforms: readonly SeaDeform[]; readonly sea: SeaSpec; readonly finish: (water: Sea) => Rig };

/** A dance's readouts, each once per frame: all 0 for a boss that does not taunt. */
export type Dance = {
  /** In the taunt (0..1), the move (0..1..0 on each accent), its sideways swing (out one way rising, back the other falling), the side stepped to (-1..1). */
  readonly on: F; readonly wave: F; readonly swing: F; readonly step: F;
  /** The same move half a beat late: what the small claw answers with. */
  readonly answer: F;
  /** How far the body is in the taunt at any clock (what the stance's idle time is measured from). */
  readonly onAt: (t: F) => F;
  /** Seconds since each accent of the cycle in progress (negative before it): a stamp lands on each. */
  readonly accents: readonly F[];
  /** What a great claw that has a display of its own should show: its own when there is no taunt, the dance's move when there is. */
  readonly display: (own: F) => F;
  /**
   * The great claw's finger opening (radians, as the claw draws it) under a routine's clicks: `own` when there is no
   * routine; in one, opened to `wide` before each click and snapped to `shut` on it (src/spacetime/routine.ts, `click`).
   * A crab outside a routine never clicks.
   */
  readonly clicked: (own: F, shut: number, wide: number) => F;
  /** x with k times one of the readouts above added: x itself for a boss that does not taunt. */
  readonly plus: (x: F, k: number, of: F) => F;
  /**
   * A claw's rest wrist (crab coordinates) moved by the dance: in a dance of its own the great claw (side 1) up, out and
   * forward on each move, swinging out one way and back the other, the small claw (side -1) the same, smaller, half a
   * beat late; in a routine, to the score's aim from its shoulder in arm spans (`span`, the arm's two segments). The
   * wrist itself for a boss that does not taunt.
   */
  readonly raised: (side: 1 | -1, wrist: P3, span: number) => P3;
  /** Where the boss stands and faces, from the `boss.at` and `boss.heading` inputs: the inputs themselves, or with a routine's path added. */
  readonly carry: { readonly at: (input: V2) => V2; readonly heading: (input: F) => F };
  /** The dance's stance on the body (docs/stance.md), given how far the attacks have the body (0..1). */
  readonly stance: (attacking: F) => Stance;
  /** The feet's walk: the gait a game drives by `legs.walking` (`feet` its weight in the footing, `body` in the carriage at a clock), or the routine's path, stepped on the beat. */
  readonly legs: { readonly gait: Gait; readonly feet: F; readonly body: (t: F) => F };
};
/** What `tauntOf` needs of the crab: its numbers, its own walk (the gait a game drives), and its pose inputs and feet for a routine's path. */
type TauntContext = {
  readonly n: Numbers;
  readonly walk: { readonly gait: Gait; readonly walking: F };
  readonly pose: { readonly at: V2; readonly heading: F };
  readonly feet: { readonly homes: readonly P3[]; readonly phase: readonly number[] };
  readonly shoulder: (side: 1 | -1) => V3;
};
function tauntOf(t: Taunt, c: TauntContext): Dance {
  const { n } = c, T = n.temper, ST = n.stance, period = n.crushPeriod;
  const zero = lift<"f32">(0);
  // The crab's own taunt and its own walk: one stance each, as before a routine existed (docs/stance.md).
  const own = (d: Pick<Dance, "on" | "wave" | "swing" | "step">, T: Numbers["temper"]) => (): Stance => ({
    // A crab that bows (`rise` below 0) also pitches forward into it on each move: 0.14 rad per unit of drop (the spider
    // crab's 2.2 is 0.31 rad, 18 degrees). Forward is negative pitch, the slam's direction. A crab that rises does not.
    kind: "dance", on: d.on, lift: sub(mul(d.wave, T.rise), mul(d.on, ST.dance.crouch)), pitch: mul(d.wave, -0.14 * Math.max(0, -T.rise)), side: d.step, turn: mul(d.swing, 0.06),
    size: { sway: ST.dance.sway, roll: ST.dance.roll },
  });
  const walked = { gait: c.walk.gait, feet: c.walk.walking, body: () => c.walk.walking };
  const still = { at: (x: V2) => x, heading: (x: F) => x };
  switch (t.kind) {
    case "none": {
      const d = { on: zero, wave: zero, swing: zero, step: zero };
      return { ...d, answer: zero, onAt: () => zero, accents: [], display: (o) => o, clicked: (o) => o, plus: (x) => x, raised: (_side, wrist) => wrist, carry: still, stance: own(d, T), legs: walked };
    }
    case "dance": {
      const d = danceOf(t, period, T);
      return { ...d, clicked: (o) => o, carry: still, stance: own(d, T), legs: walked };
    }
    case "routine": {
      // A member of a group: the group's score in the group's manner (the crab's `temper` is the group's in a lineup);
      // its solo, if it has one, is its own dance in its own manner (`own`) on the solo's accents.
      const D = t.dancer, P = period;
      if (Math.abs(P - Math.round(P / t.beat) * t.beat) > 1e-9) throw new Error(`taunt: the routine's counts do not fill the crab's loop (${P} s)`);
      const solo = D.solo.length === 0 ? undefined : danceOf({ first: D.solo[0]! - 1, accents: D.solo.map((a) => a - D.solo[0]! + 1) }, P, t.own);
      // The solo's own dance has the member inside its window (`soloing`); the score's claws give way to it there.
      const soloOn = perFrame("titan_s_routine_solo", D.soloing());
      const claw = (side: 1 | -1) => { const k = D.claw(side); return { weight: perFrame(`titan_s_routine_w${side > 0 ? "R" : "L"}`, mul(k.weight, sub(1, soloOn))), aim: perFrame(`titan_routine_aim${side > 0 ? "R" : "L"}`, k.aim) }; };
      const great = claw(1), small = claw(-1);
      const tab = (name: string, x: F): F => perFrame(`titan_s_routine_${name}`, x);
      const click = D.click(), clickOn = tab("clickOn", click.weight), clickOpen = tab("clickOpen", click.open);
      const rise = tab("rise", D.rise()), lean = tab("lean", D.lean());
      // The feet step along the member's path: the gait's course is where the routine has the boss at a clock (in the
      // world), paced two cycles a count, and a foot lifts only when its next plant is somewhere else (`minStep`), so the
      // crab stands planted while the path is still and scuttles sideways, a step every half count, while it travels or
      // turns. The feet are drawn in to 0.85 of the crab's own spread: travelling sideways moves a planted foot along its
      // own leg, and at the full spread a travel of 3.6 a step stretched the middle legs to 1.09 of their span.
      const homes = c.feet.homes.map((h) => vec3(h.x, h.y, mul(h.z, 0.85)));
      const at = (tau: F): V2 => add(c.pose.at, D.place(tau)), heading = (tau: F): F => add(c.pose.heading, D.face(tau));
      const path = gait({
        feet: homes, phase: c.feet.phase, stride: 1, pace: { kind: "time", period: t.beat / 2 }, duty: n.duty, lift: n.lift, minStep: 1,
        course: (s) => {
          const tau = mul(s, t.beat / 2), p = at(tau), h = heading(tau);
          return { o: vec3(p.x, 0, p.y), x: vec3(cos(h), 0, sin(h)), y: vec3(0, 1, 0), z: vec3(mul(sin(h), -1), 0, cos(h)) };
        },
      });
      const sh = { 1: c.shoulder(1), [-1]: c.shoulder(-1) } as const;
      return {
        on: lift<"f32">(1), wave: great.weight, swing: solo?.swing ?? zero, step: solo?.step ?? zero, answer: small.weight, onAt: () => lift<"f32">(1), accents: [],
        display: () => great.weight, plus: (x, k, of) => add(x, mul(of, k)),
        clicked: (o, shut, wide) => mix(o, add(shut, mul(clickOpen, wide - shut)), clickOn),
        raised: (side, wrist, span) => {
          const k = side === 1 ? great : small, s = sh[side];
          // The aim's third part is out from the claw's own side: the small claw's is to the crab's left.
          const target = vec3(add(s[0], mul(k.aim.x, span)), add(s[1], mul(k.aim.y, span)), add(s[2], mul(k.aim.z, span * side)));
          return mix(solo === undefined ? wrist : add(wrist, mul(sub(solo.raised(side, wrist, span), wrist), soloOn)), target, k.weight);
        },
        carry: { at: (x) => add(x, D.place()), heading: (x) => add(x, D.face()) },
        // The body: the groove, the level and the lean, given up to the attacks while they have it; never idle (the
        // routine is the crab's whole loop). Its solo adds its own rise and side.
        stance: (attacking) => {
          const free = sub(1, attacking);
          return {
            kind: "dance", on: lift<"f32">(1), lift: mul(add(rise, solo === undefined ? 0 : mul(mul(solo.wave, t.own.rise), soloOn)), free), pitch: lift<"f32">(0),
            side: mul(add(lean, mul(mul(solo?.step ?? zero, 0.6), soloOn)), free), turn: mul(mul(solo?.swing ?? zero, 0.06), soloOn), size: { sway: t.size.lean, roll: t.size.roll },
          };
        },
        // The body's motion is the groove: no walk carriage (its sway and roll are each crab's legs' numbers, which put a
        // per-crab size into the unison keys made while travelling: measured 4.5% and 50 ms on the spider crab).
        legs: { gait: path, feet: lift<"f32">(1), body: () => zero },
      };
    }
  }
}

/** A dance of the crab's own (the first lineup's taunt; a routine's solo): an emote on its accents in its manner `T`. */
function danceOf(t: { readonly first: number; readonly accents: readonly number[]; readonly pulse?: number }, period: number, T: Numbers["temper"]): Omit<Dance, "carry" | "stance" | "legs" | "clicked"> {
  // The accents are the scene's (on its beats); how the crab arrives on them is its temperament: how long before the
  // accent it starts (so a slow mover still lands on the beat), how sharply, how long it holds the pose, how long it
  // takes to leave. The side changes a half beat (0.25 s at 120 a minute) after each accent.
  const e = emote({ name: "taunt", arm: every(period, t.first), accents: t.accents, lead: T.arrive, hold: T.hold, fall: T.leave, snap: T.snap, offbeat: 0.25, shuffle: 0.22, settle: 0.4 });
  const b = e.beats(time), late = e.beats(sub(time, T.lag));
  const tab = (name: string, x: F): F => perFrame(`titan_s_taunt_${name}`, x);
  const wave = tab("wave", b.wave), on = tab("on", b.on), swing = tab("swing", mul(sin(mul(b.turn, Math.PI)), b.wave));
  // The small claw: late after the great one, or (together = 1) up with it.
  const answer = tab("answer", mix(late.wave, b.wave, T.together));
  // A twitch for a crab that has any: on each subdivision of the beat it snaps to the other side, overshoots and
  // settles (a tick, then stillness till the next), not a shake. The side alternates (-1)^n, so the position is
  // continuous: s_n (2 overshot(u) - 1) starts each tick where the last one settled. An even number of ticks in
  // the loop (96 in 24 s at 0.25) keeps it periodic. (It was a sine at 8 a second, which read as a shake.)
  const pulse = t.pulse ?? 0.25, ticks = div(time, pulse), n = floor(ticks), sign = sub(1, mul(sub(div(n, 2), floor(div(n, 2))), 4));
  const tick = mul(sign, sub(mul(overshot(clamp(div(mul(sub(ticks, n), pulse), 0.14), 0, 1), 3), 2), 1));
  const twitch = mul(mul(tick, T.jitter), add(mul(wave, 0.6), mul(on, 0.25)));
  // How far the claws go: `reach` for the whole move, `lift` again for its height (both tongs high over the spider
  // crab's body, which stands 6.8 up: its rest wrists are near the water).
  const R = T.reach, L = T.lift;
  const lifts = {
    great: perFrame("titan_taunt_great", vec3(mul(wave, 0.3 * R), add(mul(wave, 2.4 * R * L), mul(on, 0.8)), add(add(mul(wave, 1.0 * R), mul(swing, 0.9 * R)), mul(twitch, 0.6)))),
    small: perFrame("titan_taunt_small", vec3(mul(answer, 0.2 * R), add(mul(answer, (1.7 + 0.7 * T.together) * R * L), mul(on, 0.5)), sub(mul(answer, -0.8 * R), mul(twitch, 0.4)))),
  };
  const raised = (side: 1 | -1, wrist: P3): P3 => { switch (side) { case 1: return add(wrist, lifts.great); case -1: return add(wrist, lifts.small); } };
  const tau = tab("tau", sub(time, e.armAt(time)));
  return {
    on, wave, swing, step: tab("step", add(b.step, mul(twitch, 0.5))), answer, onAt: (at) => e.beats(at).on, accents: t.accents.map((a) => sub(tau, a)),
    display: () => wave, plus: (x, k, of) => add(x, mul(of, k)), raised,
  };
}

/** The audience's place in the world, given the boss's own carrying. */
function audienceOf(a: Audience, place: (p: V3) => P3): P3 {
  switch (a.kind) {
    case "own": return place(OWN_AUDIENCE);
    case "at": return vec3(...a.eye);
  }
}
/** The audience of a boss on its own, in its axes: where the game camera stands when the boss is at home. */
const OWN_AUDIENCE: V3 = [23, 27, 21];

/** The crab on its own, at home: its attacks, then its own sea with its ring on it, then the rest. */
export function rig(n: Numbers, offer: ClawsOffer, boats: BoatsOption, burst: (reach: number) => ImpactPaint): Rig {
  const s = stage(n, offer, boats, AT_HOME, burst);
  return s.finish(sea({ ...s.sea, deform: s.deforms }));
}

/**
 * The crab in two stages (docs/lineup.md): first its attacks, which is where its ring wave comes from; then, on a sea
 * made with every ring that will run on it (its own, and any other boss's in the scene), everything else. `how` is where
 * the boss stands, how its show ends and whether it taunts.
 */
export function stage(n: Numbers, offer: ClawsOffer, boats: BoatsOption, how: Staging, burst: (reach: number) => ImpactPaint): StagedRig {
  const I = n.ink;

  // ==== the boss's pose: where it stands and which way it faces, inputs whose defaults are `how.at`, `how.heading` ====
  // Everything below is authored in the boss's own axes (x forward, z to its right) and carried to the world by this
  // pose. At the default pose (0, 0; 0) the turn is by cos 0 = 1 and sin 0 = 0 and the shift by 0: the same numbers.
  const atInput = input("boss.at", "vec2", [...how.at]), headingInput = input("boss.heading", "f32", [how.heading]);
  // The feet's homes in the boss's axes, and the walk a game drives (below); a routine's path is stepped from the same feet.
  const feetHome = sides.flatMap((s) => n.legFeet.map(([x, z]) => [x, n.floor, s * z] as const));
  // The walk, for a crab a game moves: alternating tetrapods, each side a small wave toward the front, phased by the
  // distance the game says the crab has walked along its own z (sideways), the game moving `boss.at` by the same.
  // Its weight `legs.walking` (0 stands, 1 walks) is the game's; the default stands. `walkAhead` staggers a line's crabs.
  const phase = sides.flatMap((s) => n.legFeet.map((_, i) => ((i % 2 === 0) === (s < 0) ? 0 : 0.5) + 0.06 * i + how.walkAhead));
  const walking = input("legs.walking", "f32", [0]), travelled = input("legs.travelled", "f32", [0]);
  const strode = gait({
    feet: feetHome.map((f) => vec3(...f)), phase, course: course.line([0, 0, 0], -Math.PI / 2, Math.PI / 2),
    stride: n.stance.walk.stride, pace: { kind: "distance", travelled }, duty: n.duty, lift: n.lift,
  });
  const shoulder = (side: 1 | -1): V3 => [n.carapace.to - 1.1, -0.1, side * n.carapace.width * 0.55];

  // ---- the taunt: none, a dance of its own, or its part in a routine (docs/lineup.md) ----
  const taunt = tauntOf(how.taunt, { n, walk: { gait: strode, walking }, pose: { at: atInput, heading: headingInput }, feet: { homes: feetHome.map((f) => vec3(...f)), phase }, shoulder });
  const bossAt = taunt.carry.at(atInput), bossHeading = taunt.carry.heading(headingInput);
  const hc = perFrame("titan_s_boss_cos", cos(bossHeading)), hs = perFrame("titan_s_boss_sin", sin(bossHeading));
  /** A direction in the boss's axes, in the world's (a turn about up). */
  const turn3 = (v: P3): P3 => vec3(sub(mul(v.x, hc), mul(v.z, hs)), v.y, add(mul(v.x, hs), mul(v.z, hc)));
  /** A point in the boss's axes, in the world: on the water (x, z), or in space. */
  const place2 = (p: V2 | readonly [number, number]): V2 => { const q = lift<"vec2">(p); return add(bossAt, vec2(sub(mul(q.x, hc), mul(q.y, hs)), add(mul(q.x, hs), mul(q.y, hc)))); };
  const place = (p: V3 | P3): P3 => { const q = turn3(lift<"vec3">(p)); return vec3(add(q.x, bossAt.x), q.y, add(q.z, bossAt.y)); };
  const placeFrame = (g: Frame): Frame => ({ o: place(g.o), x: turn3(g.x), y: turn3(g.y), z: turn3(g.z) });

  // ==== the stance (docs/stance.md): feet planted at their homes, the body carried over them ====
  // The ground frame is the boss's pose.
  const ground = placeFrame({ o: vec3(0, 0, 0), x: vec3(1, 0, 0), y: vec3(0, 1, 0), z: vec3(0, 0, 1) });
  const g = ground;

  // ---- what a game sets: host inputs, whose defaults are this show (docs/throw_and_shove.md, "The contract") ----
  //
  // Where the first ship floats by default, the cutter can reach it. DERIVATION (the grab check measures it at the
  // closing instant): the cutter's shoulder is at crab (3.9, -0.1, -2.26), 1.25 above the still water; its arm segments
  // are 2.5 and 2.4, so the wrist reaches 4.9 at most. At 4.2 out and 1.0 down it is 4.32 away: in reach, the elbow
  // still bent. The grip's middle closed on the beam lies `closedDepth(beam)` beyond the wrist along the palm: the
  // claws' offer (claws/base.ts derives it for the base claw, 4.81). So the ship's default place is 4.2 + 4.81 = 9.01
  // from the shoulder along its keel bearing, and the claw arrives along the keel with a finger down each side of the
  // hull. A game that puts its ship elsewhere is trusted to arm the Grab only where the claw reaches (`gripReaches`
  // measures the default).
  const shoulderL = shoulder(-1);
  const shipFar = n.grabWristReach + offer.cutter.closedDepth(scaleShip.hull.lines.beam);
  const B2 = n.boatTwo, TH = n.throw;
  const start = {
    boat1: { at: [shoulderL[0] + Math.cos(n.grabBearing) * shipFar, shoulderL[2] + Math.sin(n.grabBearing) * shipFar] as const, heading: n.grabBearing },
    boat2: { at: [n.crushCentre[0] + Math.cos(B2.bearing) * (n.crushRadius + B2.beyond), n.crushCentre[1] + Math.sin(B2.bearing) * (n.crushRadius + B2.beyond)] as const, heading: B2.heading },
  };
  // Places and headings are given in the boss's own axes (their defaults are numbers, and a number cannot follow a
  // pose that is itself an input); `IN` holds them carried to the world, which is what everything below reads.
  const boat1HeadingOwn = input("boat1.heading", "f32", [start.boat1.heading]);
  const IN = {
    /** When each attack arms (seconds; it repeats every `crushPeriod`): the Grab's grip closes, Claw Crush lands. */
    grabArm: input("grab.arm", "f32", [n.grabClose]), crushArm: input("crush.arm", "f32", [n.crushFirst]),
    /** The slam's disc on the water (x, z). */
    crushCentre: place2(input("crush.centre", "vec2", [...n.crushCentre])),
    /** The first ship when the Grab arms: where it floats (x, z), its heading (radians from +x toward +z), its beam. */
    boat1At: place2(input("boat1.at", "vec2", [...start.boat1.at])), boat1Heading: add(boat1HeadingOwn, bossHeading),
    boat1Beam: input("boat1.beam", "f32", [scaleShip.hull.lines.beam]),
    /** Where the throw is aimed to land (x, z). */
    throwLand: place2(input("throw.land", "vec2", [...TH.land])),
  };
  /** Who places each boat when the crab does not hold it: classified once, by the `boats` slot. */
  const placer = { boat1: boats.placer("boat1", start.boat1), boat2: boats.placer("boat2", start.boat2) };

  // ---- Claw Crush: the attack, defined once (here, since the body's lean reads its arming time) ----
  // The lunge law poses a two-point spine from the wrist (m = 0) back to the shoulder: its m = 0 end is the wrist's
  // target. During the wind-up it pulls back by `coil` and rises by `rise` (the claw lifts high), then lands `lead` short
  // of the disc's centre exactly at the arming time (so the palm, reaching on, covers the centre), and recovers.
  const crushDisc = hit.disc({ centre: IN.crushCentre, radius: n.crushRadius });
  const crush = attack({
    name: "crush", arm: every(n.crushPeriod, IN.crushArm), warn: n.crushWarn,
    target: { kind: "disc", centre: crushDisc.centre, radius: crushDisc.radius },
    part: "crusherPalm",
    motion: { kind: "lunge", hit: crushDisc, reach: 1, lead: offer.crushLead, height: 0.7, coil: n.crushCoil, rise: n.crushRise, approach: 0.3, neck: 1 },
    timing: { windup: n.crushSeconds.windup, strike: n.crushSeconds.strike, zeta: 0.55, hold: 0.45, recover: 0.5, travel: 50 },
    // The slam raises a ring wave from the disc's edge. Its speed is not chosen: the crab stands on the bottom, so this
    // is shallow water and the wave runs at sqrt(g depth) under the same gravity as the thrown ship.
    // The front is a bore, faster the taller it is: one speed is kept, the slowest it has while it carries anything,
    // sqrt(g (depth + holding height)).
    aftermath: ring({ speed: Math.sqrt(n.gravity * (n.seaDepth + n.wave.hold)), ...n.wave }),
  });

  // ---- the sea is the scene's: this boss's own, with its ring on it, or one shared with other bosses and their rings.
  // Everything from here on floats on it or reads it, so it is the second stage.
  const ownSea: SeaSpec = {
    swell: [{ direction: [1, 0.3], length: 13, height: 0.2, speed: 0.9 }, { direction: [-0.3, 1], length: 6, height: 0.07, speed: 0.7, phase: 1.3 }],
    foam: 0.85,
  };
  return { deforms: crush.deforms(), sea: ownSea, finish: (water: Sea): Rig => {
  const WIND: readonly [number, number] = [0.35, 1.0];
  const UP = vec3(0, 1, 0);
  const scaleShipTwo = scaleShipNamed("scaleShipTwo", B2.sail);

  // ---- the Grab: the first ship in its own axes, where it is taken, drawn back to and thrown ----
  /** The height of the hull's middle, where the grip takes it, above its own origin (the waterline amidships). */
  const GRIP_Y = 0.25;
  /** The ship's keel (unit, level, toward the bow) and its starboard side, from the heading it has when taken. */
  const keel = vec3(cos(IN.boat1Heading), 0, sin(IN.boat1Heading)), stbd = vec3(mul(sin(IN.boat1Heading), -1), 0, cos(IN.boat1Heading));
  /** The keel in the boss's own axes: what the cutter's raised rest place is set along (crab coordinates). */
  const keelOwn = vec3(cos(boat1HeadingOwn), 0, sin(boat1HeadingOwn));
  const taken = vec3(IN.boat1At.x, GRIP_Y, IN.boat1At.y);
  // The throw. The carry ends at the wind-back place: drawn back along the keel toward the crab, a little to starboard
  // (toward the face) and up, in the ship's own axes. The release point and velocity are not stated: they follow from
  // the wind-back, the landing place and the flight time (`grab.toss()`).
  const windback = add(add(sub(taken, mul(keel, TH.back)), mul(stbd, TH.side)), mul(UP, TH.up));
  const land = vec3(IN.throwLand.x, GRIP_Y, IN.throwLand.y);
  /** A host's pose is of the ship's origin; the attack's thing is the hull's middle, `GRIP_Y` up the ship's own mast. */
  const middleOf = (p: Pose): Pose => ({ ...p, at: add(p.at, mul(poseFrame(p).y, GRIP_Y)) });

  // The Grab as an attack that holds. Its arming is the instant the grip closes; the warning is the same print-palette
  // marker as Claw Crush's, on the water where the ship is taken. Beats (seconds): wind-up 0.9 (the claw rises 3.3 over
  // its shoulder: the posture), reach 1.3 (it first draws back, the wrong way, then down and out on an arc, opening to 1.5
  // beams by two thirds of the way), close 0.22 (fast: it lands), hold 3.1 (2.7 lifted on an arc and squeezed twice to
  // half the beam while it is drawn back and cocked, then 0.4 of whip: uniform acceleration to the release velocity),
  // release 1.3 (0.25 following the throw through, opening, then home); then the posture lets go and the arm swings
  // once. The stand-in's ship flies 3.2 s, lands, skids and bobs; a host's ship is the host's from the release.
  const GS = n.grabSeconds;
  const grab = attack({
    name: "grab", arm: every(n.crushPeriod, IN.grabArm), warn: n.grabWarn,
    // What the claw must not pass into: the hull where it floats when taken.
    target: scaleShip.target(scaleShip.afloatChart(water, { at: IN.boat1At, heading: IN.boat1Heading, wind: WIND })),
    motion: {
      kind: "grip", hit: hit.disc({ centre: IN.boat1At, radius: scaleShip.hull.lines.length * 0.85 }),
      reachLift: 1.2, restGap: offer.cutter.restGap, windup: n.grabDrawBack, close: GS.close, release: GS.release,
    },
    effect: hold({
      seconds: GS.hold, at: taken, radius: div(IN.boat1Beam, 2), carry: { kind: "arc", to: windback, lift: n.grabLift }, squeeze: n.grabSqueeze, pulses: n.grabPulses,
      end: thrown({
        land, flight: TH.flight, gravity: TH.gravity, stroke: TH.stroke, follow: TH.follow, drag: TH.drag, heave: TH.heave,
        placer: placedBy<Placer>(placer.boat1, { standIn: () => STAND_IN, host: (p) => hosted(middleOf(p)) }),
      }),
    }),
    // The posture lets go at once after the release, over about a second (99% by 1.17 s).
    timing: { windup: GS.windup, strike: GS.reach + GS.close, hold: 0, recover: 0.9 },
  });
  // Scalars read by many tables (the body and shell frames, the claws) are themselves evaluated once per frame: inline,
  // every frame table re-evaluated the grab's and the crush's clocks.
  const tabS = (name: string, e: F): F => perFrame(`titan_s_${name}`, e);
  const grabEnv = grab.envelope(time);
  const grabOn = tabS("grabOn", grabEnv.p);
  const grabBeat = grab.beats(time, 1.5);

  // ---- the footing (docs/stance.md): planted feet; re-plants in the fight's idle time, stamps on the taunt's accents ----
  const ST = n.stance;
  /** How busy the crab is at a clock: the attacks' postures, the taunt, the walk. Idle below `idleBelow`. */
  const busyAt = (at: F): F => max(max(crush.envelope(at).p, grab.envelope(at).p), max(taunt.onAt(at), taunt.legs.body(at)));
  const stepT = { lead: ST.replant.lead, seconds: ST.replant.seconds, settle: ST.replant.settle };
  const schedule = replants({
    homes: feetHome.map(([x, , z]) => [x, z] as const), loop: n.crushPeriod, busy: busyAt, idleBelow: ST.replant.idleBelow,
    every: ST.replant.every, step: stepT, reach: ST.replant.reach, seed: namespaceSeed() + 3,
  });
  // A stamp on each accent: a foot on the side the body is about to move onto (the taunt's side is +1 after the first
  // accent and alternates), the legs taken in turn, lifted over the move's rise and down on the beat.
  const STAMP_LEGS = [1, 0, 2] as const;
  const stamps = taunt.accents.map((since, i) => ({
    foot: (i % 2 === 0 ? 4 : 0) + STAMP_LEGS[i % STAMP_LEGS.length]!, since, lead: Math.max(n.temper.arrive, 0.15), height: n.lift * ST.dance.stamp,
  }));
  const footed = footing({
    ground, homes: feetHome, stamps,
    replant: { schedule, loop: n.crushPeriod, step: stepT, height: n.lift, busy: busyAt, idleBelow: ST.replant.idleBelow, unload: ST.replant.unload, dip: ST.replant.dip },
    walk: { gait: taunt.legs.gait, on: taunt.legs.feet, secondsPerCycle: n.period },
  });
  // Each foot once per frame (every leg, foam and lantern reads the same table).
  const feetNow = feetHome.map((_, k) => ({
    foot: perFrame(`titan_foot_${k}`, footed.foot(k)), planted: tabS(`planted_${k}`, footed.planted(k)),
    since: { sincePlant: tabS(`sincePlant_${k}`, footed.since(k).sincePlant), sinceLift: tabS(`sinceLift_${k}`, footed.since(k).sinceLift) },
  }));
  const walk: Footing = { foot: (k) => feetNow[k]!.foot, planted: (k) => feetNow[k]!.planted, since: (k) => feetNow[k]!.since, unload: footed.unload };

  // ---- the body: Claw Crush in three beats ----
  //
  // Wind-up (1.15 s): the whole crab rears back and up, away from the target (anticipation). Act (0.3 s): it drives
  // down and forward into the slam. Contact: it drops 0.45 and springs back once and a half (impact, a heavy 2 Hz).
  // Settle (1.8 s): it eases back to the walk. The atoll is a separate frame on the same clock read 0.25 s late (drag),
  // and pitches on after the body stops (follow-through), swinging twice.
  const crushBeat = (t: F) => crush.beats(t, n.crushSettle);
  /** The lean: -0.6 reared back at the end of the wind-up, 1 driven into the slam, 0 at rest. */
  const leanAt = (t: F): F => {
    const b = crushBeat(t);
    // How sharply it rears into the wind-up is its temperament (`snap`: 2 is the gentle ease it always had).
    return mul(mix(mix(0, -0.6, slowInOut(b.anticipate, n.temper.snap)), 1, slowIn(b.act)), sub(1, slowInOut(b.settle)));
  };
  const lean = tabS("lean", leanAt(time)), crushAfter = tabS("crushAfter", crushBeat(time).after);
  /** The drop at contact: 0 before, -0.45 at the slam, springing back past 0. (0.3 did not read from the game camera.) */
  const thud = mul(sub(impact(crushAfter, 1, 2.0, 0.3), 1), 0.45);
  // The taunt, if there is one (each term is 0 without): the body rises on its legs with each wave of the claw (a little
  // crouched between), sidesteps on the off-beat and rolls into the step.
  /** The idle's size: doubled for a crab that is all twitch. */
  const idle = 1 + n.temper.jitter;
  // The body's carriage over its feet (docs/stance.md): the idle fills what the attacks, the taunt and the walk leave.
  // The slam's lean and thud are its brace; the Grab's turn toward the working claw is its brace's; the taunt's moves
  // are the dance's. The slam's pitch stays `pitchOf(lean)` below (the shell reads it late), so its brace adds none.
  const cb = crushBeat(time), whip = grab.flight().whip;
  const early = slowInOut(clamp(div(grabEnv.tau, ST.grab.early), 0, 1));
  /** Sitting back under the ship: from the hold's start until it has let go. */
  const sitting = mul(early, sub(1, slowInOut(grabBeat.release)));
  const toShip = sub(mul(slowInOut(grabBeat.act), sub(1, early)), mul(sitting, ST.grab.sitBack));
  /** The carry draws the ship back toward the wind-back place until the whip: the body coils away from the throw. */
  const carry = slowInOut(clamp(div(grabEnv.tau, GS.hold - TH.stroke), 0, 1));
  const throwLoad = mul(carry, sub(1, slowIn(whip))), throwDrive = mul(slowIn(whip), sub(1, slowInOut(grabBeat.release)));
  const C = carriage([
    {
      kind: "idle", loop: n.crushPeriod, seed: 11, breath: { rise: n.bob * idle, period: n.period },
      shift: { side: ST.idle.side * idle, fore: ST.idle.fore * idle, hz: ST.idle.hz }, tilt: { roll: ST.idle.roll, pitch: ST.idle.pitch }, turn: ST.idle.turn * idle,
      unload: footed.unload,
    },
    {
      kind: "brace", on: crush.envelope(time).p, toward: towardIn(ground, vec3(IN.crushCentre.x, 0, IN.crushCentre.y)),
      load: mul(slowInOut(cb.anticipate, n.temper.snap), sub(1, slowIn(cb.act))), drive: mul(slowIn(cb.act), sub(1, slowInOut(cb.settle))),
      spring: sin(mul(cb.act, Math.PI)), absorb: thud, lean, turn: mul(lean, -0.1), size: { ...ST.slam, pitch: 0 },
    },
    {
      kind: "brace", on: grabOn, toward: towardIn(ground, taken),
      load: mul(slowInOut(grabBeat.anticipate), sub(1, slowInOut(grabBeat.act))), drive: toShip, spring: lift<"f32">(0),
      absorb: sub(mul(sitting, -ST.grab.sit), mul(sub(1, grab.crush()), ST.grab.squeeze / n.grabSqueeze)), lean: toShip, turn: mul(grabOn, 0.14),
      size: { sink: ST.grab.sink, coil: ST.grab.coil, reach: ST.grab.reach, settle: ST.grab.settle, lift: 0, pitch: ST.grab.pitch, roll: ST.grab.roll },
    },
    {
      kind: "brace", on: grabOn, toward: headingIn(ground, grab.toss().velocity),
      load: throwLoad, drive: throwDrive, spring: throwDrive, absorb: lift<"f32">(0), lean: sub(throwDrive, mul(throwLoad, 0.5)), turn: lift<"f32">(0),
      size: { sink: ST.throw.sink, coil: ST.throw.coil, reach: ST.throw.reach, settle: 0, lift: ST.throw.lift, pitch: ST.throw.pitch, roll: ST.throw.roll },
    },
    taunt.stance(max(crush.envelope(time).p, grabOn)),
    { kind: "walk", on: taunt.legs.body(time), gait: taunt.legs.gait, size: { bob: n.bob, sway: n.sway, roll: n.roll, yaw: n.yaw } },
  ]);
  const bob = tabS("rise", C.rise), roll = tabS("roll", C.roll), yaw = tabS("yaw", C.yaw), sway = tabS("sway", C.sway), surge = tabS("surge", C.surge), tilt = tabS("tilt", C.pitch);
  const yx = rotateAbout(g.x, g.y, yaw), yz = rotateAbout(g.z, g.y, yaw);
  // Roll about the body's x, then pitch (the lean) about the rolled z: an orthonormal frame, as draw.copies' carry needs.
  const ry = rotateAbout(g.y, yx, roll), rz = rotateAbout(yz, yx, roll);
  // The slam's lean pitches the body (and, read late, the shell); every other stance's pitch is the carriage's `tilt`.
  const pitchOf = (l: F): F => add(mul(l, -0.12), tilt);
  const origin = add(add(add(g.o, mul(g.y, add(n.ride, bob))), mul(g.z, sway)), mul(g.x, surge));
  const pitched = (p: F): Frame => ({ o: origin, x: rotateAbout(yx, rz, p), y: rotateAbout(ry, rz, p), z: rz });
  const bodyNow: Frame = pitched(pitchOf(lean));
  // The atoll: the lean read a quarter second late, then a pitch that keeps going forward after the slam and swings back.
  // (How late, and how far it swings on, is the crab's temperament: `lag`, 0.25 s as first drawn.)
  const shellNow: Frame = pitched(tabS("shellPitch", add(pitchOf(leanAt(dragged(time, 1, n.temper.lag))), swing(sub(crushAfter, 0.2), (-0.09 * n.temper.lag) / 0.25, 1.0, 0.25))));
  const tab = (name: string, e: P3) => perFrame(`titan_frame_${name}`, e);
  const body: Frame = { o: tab("o", bodyNow.o), x: tab("x", bodyNow.x), y: tab("y", bodyNow.y), z: tab("z", bodyNow.z) };
  const shell: Frame = { o: tab("shell_o", shellNow.o), x: tab("shell_x", shellNow.x), y: tab("shell_y", shellNow.y), z: tab("shell_z", shellNow.z) };
  const local = (p: V3 | P3): P3 => add(body.o, rotate(body, lift<"vec3">(p)));

  // ---- the ships, the warnings, the crash and the splash ----
  const gripRest = local(add(vec3(shoulderL[0], shoulderL[1] + 3.3, shoulderL[2]), mul(keelOwn, 4.5)));
  const tabV = (name: string, e: P3) => perFrame(`titan_grab_${name}`, e);
  const tabFrame = (name: string, g: Frame): Frame => ({ o: tabV(`${name}_o`, g.o), x: tabV(`${name}_x`, g.x), y: tabV(`${name}_y`, g.y), z: tabV(`${name}_z`, g.z) });
  const flight = grab.flight(), toss = grab.toss(), grabTau = grabEnv.tau;
  // How the show ends for the two stand-in boats (`Show`): one record per kind, read below without asking which.
  const show = ((): { readonly ship: (thing: P3) => P3; readonly heading: (landed: F) => F; readonly kept: (tau: F) => F } => {
    const h = how.show, released = lt(grabTau, GS.hold);
    switch (h.kind) {
      // Back at their places when an attack's cycle turns; the shoved boat is kept where it ended for `keep` seconds.
      case "cut": return { ship: (thing) => thing, heading: (landed) => select(released, IN.boat1Heading, landed), kept: (tau) => select(lt(tau, B2.keep), 1, 0) };
      case "loop": {
        // The Grab's cycle ends when its next warning starts: `crushPeriod` after this one's did.
        const cycleEnd = n.crushPeriod - n.grabWarn, sails = cycleEnd - h.sailIn.seconds, last = GS.hold + TH.flight + h.sink.after + h.sink.seconds;
        if (!(sails > last)) throw new Error(`show: the new boat would sail in (${sails.toFixed(2)} s after the grip closes) before the thrown one has gone down (${last.toFixed(2)} s)`);
        const sailing = ge(grabTau, sails), u = clamp(div(sub(grabTau, sails), h.sailIn.seconds), 0, 1);
        const sunk = mul(slowIn(clamp(div(sub(flight.landed, h.sink.after), h.sink.seconds), 0, 1)), -h.sink.depth);
        // It comes straight in, slowing to a stop at its place, pointing the way it travels; then rounds up to its own
        // heading (the shorter way round).
        const from = turn3(vec3(h.sailIn.from[0], 0, h.sailIn.from[1]));
        const course = Math.atan2(-h.sailIn.from[1], -h.sailIn.from[0]);
        const round = ((start.boat1.heading - course + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        const sailed = add(add(course, bossHeading), mul(round, slowInOut(clamp(div(sub(u, 1 - h.sailIn.round), h.sailIn.round), 0, 1))));
        return {
          ship: (thing) => select(sailing, add(taken, mul(from, sub(1, slowOut(u)))), add(thing, mul(UP, sunk))),
          heading: (landed) => select(sailing, sailed, select(released, IN.boat1Heading, landed)),
          kept: (tau) => sub(1, slowInOut(clamp(div(sub(tau, h.sailBack.after), h.sailBack.seconds), 0, 1))),
        };
      }
    }
  })();
  const shipNow = tabV("ship", show.ship(grab.thing()));

  // The socket: the first ship's frame while the claw has it, and what a game attaches its boat to. The ship keeps the
  // heading it was taken at, level, until the stroke; over the stroke the hand turns it toward the release velocity,
  // about one axis (keel x release velocity) with uniform angular acceleration, up to exactly the rate of the tumble
  // that carries on through the flight: angular velocity is continuous at the release, as velocity is. For `turns`
  // whole turns in the air that turn is pi turns stroke / flight (45 degrees of the 71 between keel and velocity for
  // two turns: all of it would put the wrist 6.2 from a shoulder whose arm spans 4.9). It turns about its middle (the
  // point that flies), not about its origin a quarter unit below it.
  const spinAxis = normalize(cross(keel, toss.velocity));
  const turned = tumbled({ o: shipNow, x: keel, y: UP, z: stbd }, spinAxis, TH, TH.turns, flight);
  const socket: Frame = { o: sub(shipNow, mul(turned.y, GRIP_Y)), x: turned.x, y: turned.y, z: turned.z };
  /** The claw's own axis: along the ship's keel as the socket has it (the taken heading until the stroke, then turning with the hand). */
  const inHand = tumbled({ o: shipNow, x: keel, y: UP, z: stbd }, spinAxis, TH, TH.turns, { whip: flight.whip, u: 0 });
  const gripAxis = tabV("axis", inHand.x), gripUp = tabV("up", inHand.y);
  /** Where the ship points when it comes down: as it left the hand (whole turns later), laid level. */
  const landedHeading = (() => { const x = turnedAbout({ o: shipNow, x: keel, y: UP, z: stbd }, spinAxis, handTurn(TH, TH.turns)).x; return atan2(x.z, x.x); })();

  // The first ship when the crab does not hold it, by who places it. One record per handler: its frame, how much its
  // hull gives on touchdown, and the splash.
  const free1 = placedBy(placer.boat1, {
    // The stand-in. Afloat, it rides the water under its middle (so it floats again where it lands, and plunges through
    // the surface on touchdown), lifted by its middle's height above where that floats. In the air it is the socket's
    // frame carried along the flight, still turning at the rate the hand gave it, so it leaves the grip exactly as it
    // was held and comes down as it left; over 0.4 s from touchdown it is given back to the water, on that heading.
    standIn: () => {
      const under = scaleShip.afloatChart(water, { at: vec2(shipNow.x, shipNow.z), heading: show.heading(landedHeading), wind: WIND }).frame(vec3(0, 0, 0));
      const floating: Frame = { o: add(under.o, mul(UP, sub(shipNow.y, GRIP_Y))), x: under.x, y: under.y, z: under.z };
      const afloatAgain = select(lt(grabTau, GS.hold), 1, smoothstep(0, 0.4, flight.landed));
      // The hull squashes on touchdown: a swing from 1, so it gives as it goes under and springs back; volume kept.
      const give = sub(1, swing(flight.landed, n.splash.squash, 1.6, 0.35));
      /** The splash: the crash's clawed foam where the thrown ship touches down, from that instant. */
      const splash = impactFoam("splash", water, {
        area: hit.disc({ centre: IN.throwLand, radius: n.splash.reach * 0.5 }), pad: n.splash.reach * 0.5 + 1,
        splashes: [{ at: IN.throwLand, since: flight.landed }],
        reach: n.splash.reach, seconds: n.splash.seconds, foam: I.cream, line: I.black, paint: burst(n.splash.reach),
      });
      return { frame: blendFrames(socket, floating, afloatAgain), give, splash: [splash] as readonly Drawable[] };
    },
    // The host: drawn where the game says, as it is.
    host: (p) => ({ frame: poseFrame(p), give: lift<"f32">(1), splash: [] as readonly Drawable[] }),
  });
  // Whose the ship is: the crab's from the closing of the grip (taken off the water over the close, not in one frame)
  // until the release, then at once its placer's again (the stand-in's flight starts as the socket was; a host's own
  // physics starts from the release point at the release velocity).
  const owned = select(lt(grabTau, GS.hold), smoothstep(-GS.close, 0, grabTau), 0);
  const shipFrame = tabFrame("ship", blendFrames(free1.frame, socket, owned));
  const wide = div(1, sqrt(free1.give));
  const squeeze = grab.squeezed(1, "z").k;
  const boatOne = scaleShip.placed(rigid(shipFrame), WIND, size.axes(tabV("squeeze", mul(squeeze, vec3(wide, free1.give, wide)))));

  // The second boat floats outside the crush disc, its bow toward the slam. Its stand-in is the ring's own ride
  // (`crush.pushed`: the rule a game integrates, solved): lifted as the front's edge passes under it, taken by the face,
  // carried stern first at the wave's speed until the crest can no longer hold it, then dropped to coast. It floats on
  // the sea at its forced place, so its rise and its lie on the wave's face come from the sea's own height, ring
  // included. What the stand-in adds as art: the hull's own answer to being hit (a pitch that throws the bow up and
  // rings down, `kick`), a slew as it coasts to a stop (`slew`), and a burst of spray where the face takes it. It keeps
  // the boat where it ended for `keep` seconds after the slam, then the boat is back at its place (in this show that is
  // the loop's seam, while the Grab plays).
  const free2 = placedBy(placer.boat2, {
    // The stand-in's own inputs: where the second boat floats when Claw Crush arms (x, z), and its heading.
    standIn: () => {
      const at = place2(input("boat2.at", "vec2", [...start.boat2.at])), heading = add(input("boat2.heading", "f32", [start.boat2.heading]), bossHeading);
      const tau = sub(time, crush.arm), kept = perFrame("titan_s_boat2_kept", show.kept(tau)), ride = crush.wave().ride(at);
      const forced = crush.pushed(at), shove = tabV("boat2_shove", mul(vec3(forced.x, 0, forced.y), kept));
      const now = vec2(add(at.x, shove.x), add(at.y, shove.z));
      /** Seconds since the face took it, and since it was dropped (each negative before, and once the boat is back at its place). */
      const taken = perFrame("titan_s_boat2_taken", select(gt(kept, 0), sub(tau, ride.taken), -1)), dropped = sub(taken, ride.seconds);
      const slewed = add(heading, mul(mul(B2.slew, kept), sub(1, exp(mul(max(dropped, 0), -1 / n.wave.drag)))));
      const afloat2 = scaleShipTwo.afloatChart(water, { at: now, heading: slewed, wind: WIND }).frame(vec3(0, 0, 0));
      // Bow up about the ship's own beam (z = bow x mast), by a swing from 0 that rings down.
      const frame = turnedAbout(afloat2, afloat2.z, swing(taken, B2.kick, 0.8, 0.3));
      const spray = impactFoam("spray", water, {
        area: hit.disc({ centre: at, radius: 4 }), pad: 4,
        splashes: [{ at: now, since: taken }],
        reach: 3.2, seconds: 1.3, foam: I.cream, line: I.black, paint: burst(3.2),
      });
      return { at, frame, spray: [spray] as readonly Drawable[] };
    },
    host: (p) => ({ at: vec2(p.at.x, p.at.z), frame: poseFrame(p), spray: [] as readonly Drawable[] }),
  });
  const boatTwo = scaleShipTwo.placed(rigid(tabFrame("boat2", free2.frame)), WIND);
  const boat = [...boatOne, ...boatTwo, ...free2.spray];

  const warnStyle = { ...PRINT_WARNING, spacing: 1.2, edge: 0.22, line: 0.09 };
  /** The crash: clawed cream foam bursting from the disc's centre at the slam and running out past its edge (lib/impact.ts). */
  const crashOuter = n.crushRadius * n.crashReach;
  const crash = impactFoam("crash", water, {
    area: crushDisc, pad: crashOuter - n.crushRadius + 1,
    splashes: [{ at: IN.crushCentre, since: sub(time, crush.arm) }],
    reach: crashOuter, seconds: n.crashSeconds, foam: I.cream, line: I.black, paint: burst(crashOuter),
  });
  /** What a game that runs its own boats reads (docs/throw_and_shove.md, "The contract"); the stand-ins above read the same. */
  const handoff: Handoff = {
    socket, held: grab.held(), squeeze,
    release: { time: toss.releasedAt, at: sub(toss.release, mul(UP, GRIP_Y)), velocity: toss.velocity, spin: mul(spinAxis, tumbleRate(TH, TH.turns)) },
    landing: { time: toss.landsAt, at: sub(toss.land, mul(UP, GRIP_Y)), rest: sub(toss.rest, mul(UP, GRIP_Y)) },
    wave: crush.wave(),
  };

  return {
    n, walk, crush, crushAfter, grab, grabOn, grabEnv, grabBeat, keel: gripAxis, gripUp, gripRest, shipNow, body, shell, local, shoulder,
    inputs: IN, placer, handoff, boatTwoAt: free2.at, crushCentre: IN.crushCentre, shipTarget: scaleShip.target(rigid(shipFrame)),
    place, place2, audience: audienceOf(how.audience, place), dance: taunt,
    world: { sea: water, warnings: [telegraph(crush, { style: warnStyle }), telegraph(grab, { style: warnStyle })], crash, splash: free1.splash, boat },
  };
  } };
}

// The jitter: the fiddler's face (docs/art_direction/DIRECTION.md, "Round 4: the fiddler's and the spider crab's
// faces"). Temperament: manic, twitchy, bug-eyed; a show-off who cannot keep still.
//
// What it is, and what every feature is for:
// - two bone-white bug eyes with big black pupils and a glint, on very tall thin vermilion stalks ringed black (the
//   great claw's ink: the two things it shows off). No iris, almost no lid at rest: a lid is a thin vermilion line on
//   top of the ball until fury or a flinch brings it down;
// - the stalks act. Each is a bent spine (src/geom/bend.ts): it leans at the root, bows, and crooks at the tip, by the
//   expression, so the pose of the stalks is the expression before any lid moves: craned and crossed toward the ship
//   (wanting), ramrod straight and shaking (straining), shot up and apart (triumph), short and spread in a V (fury), one
//   thrown back in an S while the other ducks (the wince);
// - the eyes swivel separately. Each has its own restless clock (src/geom/restless.ts, `dart`): at uneven intervals
//   it jumps to something else (you, its own great claw, the other boat, the ship, nothing), overshoots, and its stalk
//   flicks after it; it blinks on some jumps, one eye at a time. The more an expression fixes it on one thing (`roam`
//   toward 0), the less it wanders;
// - nothing rests: the stalks tremble in bursts, harder the more the expression shakes; they whip after the slam and
//   pop at the throw;
// - a tiny two-plate mouth high on the pebble's front: two cream teeth that part, chatter, splay at the top (a grin)
//   or at the bottom (a sneer).
//
// The face is a score (src/geom/expression.ts), as the islander's is. Where it looks is part of each expression: the
// ship is `rig.shipNow`, the slam's place `rig.crushCentre`, the other boat `rig.boatTwoAt` and how far the slam's wave
// has pushed it, the audience `rig.audience`; every other place is in the crab's own axes, so the face sits and looks
// rightly on a crab that is placed and turned (examples/bosses/crab_lineup.ts). Its triumph also plays through a taunt
// (`rig.dance`), where there is one.
//
// Inherited: the eyeball, sliding pupil and lune lids (the islander's, by way of lib/stalk_eyes.ts); the audience-facing
// socket; a score over the fight's clocks. Mine: stalks whose bending is the pose, eyes on separate restless clocks,
// a flinch that is not the same on both sides, the teeth.

import {
  abs, add, added, alive, cast, clamp, div, dot, expressionsRead, floor, fract, lt, max, minScreenSize, mix, mul, pick, score, select,
  show, sin, smoothstep, staysInView, strand, sub, swing, time, tolerance, unit, vec3, during,
  type Expression, type F, type P3, type Posed, type Score,
} from "../../../../src/index.ts";
import { bent } from "../../../../src/geom/bend.ts";
import { chosen, dart, tremor } from "../../../../src/geom/restless.ts";
import { lookOf, stalkEye } from "../../lib/stalk_eyes.ts";
import { cut, perFrame, TAU, type V3 } from "../ink.ts";
import type { Rig } from "../rig.ts";
import type { FaceOption } from "../slots.ts";

/** How far below its audience (`rig.audience`: the game camera, when the crab is at home) the sockets face when nothing
 * turns them: the sine of about 10 degrees (face/dandy.ts found that squarely at a camera 40 degrees up the eyes showed
 * the lower cameras their undersides). */
export const BELOW = 0.17;
/** How far the socket turns toward what it looks at (a share of the way), and how far the pupil slides when the look
 * is square to the socket (a share of the radius). SLIDE plus the largest pupil stays under 1. */
export const TURN = 0.2, SLIDE = 0.32;

// ---- the channels, and the cast ----

/**
 * What the face is drawn from. Angles are radians; a bend's side is toward the great claw (the crab's right).
 * - upper, lower: how far each lid has come over the eye: 0 out of the way, 1 at its middle line; shut when they sum to 2.
 * - slant: the lid line's tip, positive down toward the middle (a scowl).
 * - pupil: the pupil's radius as a share of the eye's. swell: the eyeball's size, times its own.
 * - flinch: how far the face has flinched from a blow on its great claw's side. It is not the same on both sides
 *   (`EyeSpec.flinch`): the near eye shuts and its stalk is thrown back; the far one ducks and peeks.
 * - tall: the stalks' length, times their own. lean: both tip forward at the root; aside: both toward the great claw;
 *   spread: apart.
 * - bow: both bend near the root toward the great claw's side (negative: toward the ship's). crane: the tips curl
 *   forward. cross: the tips curl toward each other.
 * - jaw: the teeth, 0 shut to 1 parted. sneer: their bottoms splay (1), or their tops (-1: a grin).
 * - ship, disc, boat: how far its look goes from the audience to the ship, to the slam's place, or to the second boat
 *   (which the slam's wave carries off). roam: how much each eye wanders off on its own restless clock.
 * - shake: how hard it trembles. flush: how red its lids are: bone at 0 (a shut eye is a pale ball with a lash line,
 *   as on the sheet), the great claw's vermilion at 1 (rage).
 */
export type Channel =
  | "upper" | "lower" | "slant" | "pupil" | "swell" | "flinch" | "tall" | "lean" | "aside" | "spread" | "bow" | "crane" | "cross"
  | "jaw" | "sneer" | "ship" | "disc" | "boat" | "roam" | "shake" | "flush";

export const CAST = cast<Channel, "want" | "strain" | "triumph" | "fury" | "wince">(
  // At rest it cannot rest: bug eyes wide open, wandering separately, the stalks a little apart and twitching.
  { upper: 0.1, lower: 0, slant: 0, pupil: 0.42, swell: 1, flinch: 0, tall: 1, lean: 0.06, aside: 0, spread: 0.1, bow: 0, crane: 0.12, cross: 0, jaw: 0.1, sneer: 0, ship: 0, disc: 0, boat: 0, roam: 1, shake: 0.4, flush: 0 },
  {
    // It wants the ship: both stalks bowed hard over toward it and craned, pupils swollen. (The tips first crowded
    // together, as on the sheet: from the face camera one eye then hid the other.)
    want: { upper: 0, pupil: 0.46, swell: 1.12, tall: 1.1, lean: 0.2, aside: -0.25, spread: 0.12, bow: -0.55, crane: 0.5, jaw: 0.6, ship: 1, roam: 0.2, shake: 0.5 },
    // The squeeze: eyes screwed shut, stalks ramrod straight, short and thick, shaking; teeth clenched and bared.
    strain: { upper: 1, lower: 1, slant: 0.5, pupil: 0.3, swell: 0.95, tall: 0.76, lean: 0, spread: 0.04, crane: 0, jaw: 0, sneer: 0.4, ship: 1, roam: 0, shake: 1, flush: 0.3 },
    // Let go: the stalks shoot up and apart, the eyes pop, the teeth part in a grin; it looks half after the ship and
    // half at you (looking all the way after it put the pupils on the far edge of the eye: tools/faces_fs_theory.ts).
    // Both lean a little away from the great claw: spread evenly, the popped right eye stood behind the claw's raised
    // finger from the game camera for 0.75 s (staysInView).
    triumph: { upper: 0, pupil: 0.3, swell: 1.3, tall: 1.15, lean: -0.05, aside: -0.22, spread: 0.2, crane: -0.15, jaw: 1, sneer: -1, ship: 0.5, roam: 0.25, shake: 0.2 },
    // Before the slam: stalks short and spread in a V, thrust at the disc; lids hard down to the middle over pinpoints.
    fury: { upper: 0.85, lower: 0.2, slant: 0.75, pupil: 0.18, tall: 0.62, lean: 0.3, aside: 0.25, spread: 0.5, crane: 0.1, jaw: 0.3, sneer: 1, disc: 1, roam: 0, shake: 0.6, flush: 1 },
    // The blow: the near eye shut on a stalk kinked into an S, the far one ducked and half-lidded, peeking at the damage.
    wince: { flinch: 1, upper: 0.55, lower: 0.35, slant: -0.35, pupil: 0.3, swell: 0.92, tall: 0.85, lean: -0.1, spread: 0.1, crane: 0, jaw: 0, sneer: 0.6, disc: 1, roam: 0, shake: 0.4, flush: 0.45 },
  },
);
export type Mood = keyof typeof CAST.named;

// ---- the two eyes ----

export type EyeSpec = {
  readonly tag: "L" | "R"; readonly side: 1 | -1;
  /** The stalk's root on the carapace (crab coordinates), its length, its radius at root and tip; the eye's radius. */
  readonly root: V3; readonly length: number; readonly girth: readonly [number, number]; readonly radius: number;
  /** What `flinch` does to this eye: its lids (added to the upper and the lower: the shut eye's meet at its middle
   * line, where the lash line shows; met lower, a shut eye was a plain ball); its stalk's lean, bow and crook (each: toward the great
   * claw, and forward; the bow is sideways only); and the share of its length it ducks by. A fore-and-aft kink does not
   * show from in front, so the near eye's S is sideways: bowed out, the tip curled back in. */
  readonly flinch: { readonly lid: readonly [number, number]; readonly lean: readonly [number, number]; readonly bow: number; readonly crook: readonly [number, number]; readonly duck: number };
  /** Seconds late it reads the score; its restless clock (seconds a hold, seconds a jump, a seed); how fast it trembles
   * (Hz) and how it whips after the slam (radians, Hz). */
  readonly lag: number; readonly restless: { readonly every: number; readonly snap: number; readonly seed: number };
  readonly tremble: number; readonly whip: readonly [number, number];
};
// Not twins: the great claw's side stands taller on a bigger eye and leads; each has its own clocks.
export const EYES: readonly EyeSpec[] = [
  { tag: "R", side: 1, root: [4.35, 0.9, 0.95], length: 4.0, girth: [0.2, 0.13], radius: 0.72,
    flinch: { lid: [0.47, 0.67], lean: [0.1, -0.35], bow: 0.65, crook: [-0.85, 0.4], duck: 0 }, lag: 0, restless: { every: 0.6, snap: 0.08, seed: 3 }, tremble: 9.3, whip: [0.5, 2.3] },
  { tag: "L", side: -1, root: [4.3, 0.9, -0.95], length: 3.6, girth: [0.19, 0.12], radius: 0.66,
    flinch: { lid: [0, 0], lean: [0.15, 0.1], bow: 0, crook: [0, 0.2], duck: 0.32 }, lag: 0.09, restless: { every: 0.8, snap: 0.1, seed: 8 }, tremble: 11.1, whip: [0.65, 1.7] },
];
/** How far a bend trembles at full shake, radians. At rest (shake 0.4, in bursts) the tip travels about 0.15, 5 px from the
 * game camera; straining, about 0.28. (0.055 was planned: 2 px at rest, which nobody would see.) */
const TREMBLE = 0.12;
/** How far a stalk's tip curls after its eye's look, radians at a look square to the stalk: what makes a jump a flick. */
const FOLLOW = 0.45;
/** A lid's least angle, radians: fully raised it is a thin line on top of the ball. */
const LID_MIN = 0.06;

type Arith<T> = { readonly add: (a: T | number, b: T | number) => T; readonly mul: (a: T | number, b: T | number) => T; readonly clamp: (x: T, lo: number, hi: number) => T };
const JS: Arith<number> = { add: (a, b) => a + b, mul: (a, b) => a * b, clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi) };
const GPU: Arith<F> = { add: (a, b) => add(a, b), mul: (a, b) => mul(a, b), clamp: (x, lo, hi) => clamp(x, lo, hi) };

/** One eye's drawn quantities from the channels: the lids' angles, the slant, the stalk's length, its lean and its
 * crook (each: toward the great claw, and forward) and its bow (toward the great claw). One formula for the picture and for the theory (tools/faces_fs_theory.ts). */
function eyeFrom<T>(o: Arith<T>, c: Readonly<Record<Channel, T>>, e: EyeSpec) {
  const fl = e.flinch;
  return {
    upper: o.clamp(o.mul(o.add(c.upper, o.mul(c.flinch, fl.lid[0])), Math.PI / 2), LID_MIN, Math.PI),
    lower: o.clamp(o.mul(o.add(c.lower, o.mul(c.flinch, fl.lid[1])), Math.PI / 2), LID_MIN, Math.PI),
    slant: o.mul(c.slant, e.side),
    length: o.mul(o.mul(c.tall, e.length), o.add(1, o.mul(c.flinch, -fl.duck))),
    lean: [o.add(o.add(c.aside, o.mul(c.spread, e.side)), o.mul(c.flinch, fl.lean[0])), o.add(c.lean, o.mul(c.flinch, fl.lean[1]))] as const,
    bow: o.add(c.bow, o.mul(c.flinch, fl.bow)),
    crook: [o.add(o.mul(c.cross, -e.side), o.mul(c.flinch, fl.crook[0])), o.add(c.crane, o.mul(c.flinch, fl.crook[1]))] as const,
  };
}
/** The same in plain numbers: what tools/faces_fs_theory.ts predicts from. */
export const poseOf = (c: Expression<Channel>, e: EyeSpec) => eyeFrom(JS, c, e);

// ---- the score: the cast laid over the fight ----

/** Seconds after the thrown ship lands for the look to leave it (the grab's `settle` beat). */
const LOOK_AWAY = 1.0;

export function scoreOf(rig: Rig): Score<Channel, Mood> {
  const { n, crush, grab, dance } = rig;
  return score(CAST, (t) => {
    const cb = crush.beats(t, n.crushSettle), ctau = crush.envelope(t).tau;
    const gb = grab.beats(t, LOOK_AWAY), gtau = grab.envelope(t).tau;
    // Everything arrives fast: it has no patience. From the Grab's warning the ship has it, until the ship is down.
    const attending = mul(during(add(gtau, grab.warn), { from: 0, rise: 0.18 }), sub(1, smoothstep(0.2, 0.8, gb.settle)));
    // Each squeeze, 0 to 1 at its tightest: the strain eases to three quarters between them.
    const squeeze = clamp(div(sub(1, grab.crush(t)), n.grabSqueeze), 0, 1);
    const straining = mul(mul(smoothstep(0, 0.03, gb.hold), sub(1, smoothstep(0, 0.12, gb.release))), mix(0.75, 1, squeeze));
    const triumphant = mul(smoothstep(0.02, 0.14, gb.release), sub(1, smoothstep(0.3, 0.9, gb.settle)));
    const furious = mul(smoothstep(0, 0.15, cb.anticipate), sub(1, smoothstep(-0.05, 0.01, ctau)));
    const wincing = during(ctau, { from: -0.05, rise: 0.06, to: 0.45, fall: 0.3 });
    // It cackles: the stalks bob and the teeth chatter, six times a second; and they chatter when it strains.
    const laugh = sin(mul(t, TAU * 6));
    // The pop: at the release the stalks overshoot upward and ring; the eyes with them.
    const sinceThrow = sub(gtau, n.grabSeconds.hold);
    // Once it has winced it must see what it did: both eyes go to the second boat as the wave carries it off.
    const gloating = during(ctau, { from: 0.5, rise: 0.2, to: 3.2, fall: 0.6 });
    // The taunt (rig.dance.on is 0 for a crab that has none): triumph all through it, to the audience, bobbing up on
    // every move and leaning with its swing.
    const pleased = max(triumphant, dance.on);
    return [
      show("want", attending), show("strain", straining), show("triumph", pleased), show("fury", furious), show("wince", wincing),
      added({ boat: 1, roam: -0.85 }, gloating),
      added({ ship: -0.5, tall: mul(dance.wave, 0.12), aside: mul(dance.swing, 0.25), crane: mul(dance.wave, -0.2) }, dance.on),
      added({ tall: mul(laugh, 0.04), jaw: mul(sub(laugh, 1), 0.22) }, pleased),
      added({ jaw: mul(max(tremor(t, 8, 3), 0), 0.3) }, straining),
      added({ tall: swing(sinceThrow, 0.22, 2.6, 0.2), swell: swing(sinceThrow, 0.12, 3.1, 0.3) }),
    ];
  });
}

// ---- the face ----

/** The teeth's place on the pebble's front (crab coordinates): the hinge line's middle, and the tips' at rest. */
const MOUTH = { hinge: [4.74, 0.8, -0.1] as V3, tip: [4.99, 0.18, -0.1] as V3 };

export const jitter: FaceOption = {
  about: "manic and bug-eyed: two white eyes on very tall thin vermilion stalks that bend, cross and twitch, each wandering on its own; two teeth",
  // The face camera stands 1.9 higher for it: the stalks are 1.6 times the islander's and left that frame's top.
  numbers: { faceRise: 1.9 },
  draw: (rig, _carapace, claws) => {
    const { n, body, local, shipNow, crushAfter } = rig;
    const I = n.ink;
    const theScore = scoreOf(rig);
    const tabF = (name: string, e: F): F => perFrame(`jitter_${name}`, e);
    const tabV = (name: string, e: P3): P3 => perFrame(`jitter_${name}`, e);
    const audience = rig.audience;
    const disc = vec3(rig.crushCentre.x, 0, rig.crushCentre.y);
    // The second boat, where the slam's wave has carried it (rig.ts: its stand-in rides `crush.pushed`).
    const carried = rig.crush.pushed(rig.boatTwoAt);
    const otherBoat = tabV("otherBoat", vec3(add(rig.boatTwoAt.x, carried.x), 0.6, add(rig.boatTwoAt.y, carried.y)));
    const fixedOn = (c: Posed<Channel>): P3 => mix(mix(mix(audience, shipNow, c.ship), disc, c.disc), otherBoat, c.boat);
    // What an eye may wander off to: you (most often), its own great claw at rest, the other boat, the ship, the sky,
    // the light on its own back, nothing. (Half of each list was first the audience: two holds in three then chose the
    // same place as the last, and the eye did not move.)
    const claw = local([5.6, 0.4, 4.2]), sky = local([6, 14, 3]), light = local([-6, 7, -5]), nothing = local([3, 4, -16]);
    const haunts: readonly (readonly P3[])[] = [
      [audience, claw, otherBoat, audience, shipNow, sky],
      [audience, shipNow, nothing, otherBoat, audience, light],
    ];

    const eye = (e: EyeSpec, i: number) => {
      const c: Posed<Channel> = theScore.at(sub(time, e.lag)), q = eyeFrom(GPU, c, e);
      const base = local(e.root);
      // Its restless clock: which hold it is in and the last one, and how far the jump has gone (past 1, then back).
      const d = dart(time, { every: e.restless.every, snap: e.restless.snap, period: n.crushPeriod, seed: e.restless.seed });
      const place = (hold: F): P3 => pick(floor(mul(chosen(hold, e.restless.seed), haunts[i]!.length)), haunts[i]!);
      const wander = mix(place(d.before), place(d.now), d.arrive);
      const roam = tabF(`${e.tag}_roam`, clamp(c.roam, 0, 1));
      const target = tabV(`${e.tag}_target`, mix(fixedOn(c), wander, roam));
      // The stalk leans after its look (from the root: the tip's own place depends on this), so every jump flicks it.
      const toward = unit(sub(target, base));
      // It trembles in bursts, each stalk at its own rate; whips after the slam, the tip against the root.
      const shake = tabF(`${e.tag}_shake`, mul(c.shake, mix(0.3, 1, clamp(mul(tremor(time, 0.7, e.restless.seed), 1.6), 0, 1))));
      const tr = (k: number): F => mul(mul(tremor(time, e.tremble, k + 10 * i), TREMBLE), shake);
      const whip = swing(crushAfter, e.whip[0], e.whip[1], 0.22);
      const idle = (k: number): F => alive(time, 0.04, 31 + k + 10 * i, 0.31, n.crushPeriod);
      const stalk = bent({
        root: base, along: body.y, a: body.z, b: body.x,
        length: tabF(`${e.tag}_length`, q.length),
        lean: [tabF(`${e.tag}_leanA`, add(q.lean[0], idle(0))), tabF(`${e.tag}_leanB`, add(q.lean[1], idle(1)))],
        bow: [tabF(`${e.tag}_bowA`, add(q.bow, tr(0))), tabF(`${e.tag}_bowB`, add(tr(1), mul(whip, -0.5)))],
        crook: [
          tabF(`${e.tag}_crookA`, add(add(q.crook[0], mul(dot(toward, body.z), FOLLOW)), tr(2))),
          tabF(`${e.tag}_crookB`, add(add(add(q.crook[1], mul(dot(toward, body.x), FOLLOW)), tr(3)), whip)),
        ],
      });
      // It blinks on four jumps in ten, as the jump starts: one eye at a time, since each has its own clock.
      const lookAt = (at: P3) => (middle: P3) => lookOf({ from: middle, audience, below: BELOW, target: at, up: body.y, turn: TURN, slide: SLIDE });
      const flush = tabF(`${e.tag}_flush`, mix(0.22, 1, clamp(c.flush, 0, 1)));
      const blink = mul(mul(select(lt(chosen(d.now, e.restless.seed + 3), 0.4), 1, 0), sub(1, smoothstep(0.05, 0.14, d.since))), roam);
      const shut = Math.PI / 2 + 0.08;
      return stalkEye({
        tag: e.tag, prefix: "jitter",
        stalk: {
          bent: stalk, girth: e.girth,
          // Vermilion, a black ring at every seventh, a dark collar where it leaves the shell.
          paint: (m) => mix(mix(vec3(...I.accent), vec3(...I.black), sub(1, cut(abs(sub(fract(mul(m, 7)), 0.5)), 0.08))), vec3(...I.brickDark), sub(1, cut(m, 0.07))),
        },
        radius: e.radius, swell: c.swell, hang: 0, up: body.y,
        look: lookAt(target),
        pupil: c.pupil,
        // White all round: these are periscopes, and from behind a dark back made them dark balls (face/base.ts found the same).
        ink: { white: I.cream, pupil: I.black, back: I.cream, glint: 0.34, ring: 0.06 },
        lids: {
          upper: mix(q.upper, shut, blink), lower: mix(q.lower, shut, blink), slant: q.slant,
          // Bone with a heavy black edge, flushing to the great claw's vermilion with rage: a shut eye is a pale ball
          // with a lash line (all vermilion, two shut eyes beside the great claw were two more red lumps).
          ink: (edge) => mix(mix(vec3(...I.cream), vec3(...I.accent), flush), vec3(...I.black), sub(1, cut(edge, 0.2))),
        },
        // The marks are the expression's own pose: no wandering, no tremble, no whip, no blink.
        posed: {
          bent: bent({ root: base, along: body.y, a: body.z, b: body.x, length: q.length, lean: q.lean, bow: [q.bow, 0], crook: q.crook }),
          look: lookAt(fixedOn(c)), upper: q.upper, lower: q.lower,
        },
      });
    };
    const [right, left] = EYES.map(eye) as [ReturnType<typeof eye>, ReturnType<typeof eye>];

    // The teeth read the score on the right eye's clock.
    const face = theScore.at(time);
    const jaw = tabF("jaw", clamp(add(face.jaw, mul(max(sin(mul(time, 2.7)), 0), 0.1)), 0, 1.2));
    const sneer = tabF("sneer", face.sneer);
    const tooth = (s: 1 | -1) => {
      const grin = max(mul(sneer, -1), 0), frown = max(sneer, 0);
      const hinge = local(vec3(MOUTH.hinge[0], MOUTH.hinge[1], add(MOUTH.hinge[2], mul(add(0.23, mul(grin, 0.22)), s))));
      const tip = local(vec3(add(MOUTH.tip[0], mul(jaw, 0.28)), sub(MOUTH.tip[1], mul(jaw, 0.22)), add(MOUTH.tip[2], mul(add(0.23, mul(frown, 0.3)), s))));
      return strand({
        name: `tooth${s < 0 ? "L" : "R"}`, spine: (m) => mix(hinge, tip, m), stations: 4,
        girth: (m) => mul(0.25, sub(1, mul(m, 0.15))), section: { aspect: 0.4, squareness: 2.6 }, up: body.x,
        tips: [{ round: 0.12 }, { round: 0.3 }], paint: () => vec3(...I.cream), detail: { along: 8, around: 12 },
      });
    };

    return {
      things: [...right.things, ...left.things, tooth(1), tooth(-1)],
      checks: [
        // Each eye is big enough to read from the game camera (the periscope's measured 34 px).
        minScreenSize(right.ball, "game", 48), minScreenSize(left.ball, "game", 40),
        // Every named expression shows in a cycle, and any two differ on screen by a quarter of the right eye's width.
        expressionsRead(theScore, { ...right.marks, ...left.marks }, { camera: "game", period: n.crushPeriod, apart: tolerance.share(0.25), of: right.width }),
        // Neither eye is behind a claw from the game camera for longer than half a second at a stretch.
        staysInView({ eyeR: right.middle, eyeL: left.middle }, claws.things, { camera: "game", period: n.crushPeriod, hidden: tolerance.units(0.5) }),
      ],
    };
  },
};

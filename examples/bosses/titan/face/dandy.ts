// The dandy: the islander's face (docs/art_direction/DIRECTION.md, Round 3). Temperament: vain, a show-off and a bully.
// It performs for whoever is watching and never quite takes its eyes off them.
//
// What it is, and what every feature is for:
// - two big round eyes on tall bone-white ringed stalks, moss-green irises (the island's own ink), black pupils with a
//   glint. They are what reads from the game camera, so they are large: the right one 1.6 across, the left 1.24;
// - not twins: everything on its great claw's side is bigger. The right eye is larger, stands higher, wears its lid
//   higher (one raised brow, the smug look) and leads; the left reads the same score 0.14 s late;
// - each eye has two lids, an upper one (the brow) and a lower one (the cheek), painted coral like eye-shadow. Between
//   them they make every shape a face needs: half-lowered and uneven (posing), flung wide (greed), squeezed to slits (straining), pushed up
//   from below into arches (glee), slanted hard down to the middle (the glare), shut (the wince);
// - the eyes face the audience, always: the socket turns only a quarter of the way to what it looks at and the iris
//   slides the rest of the way across the white, so it watches the ship and the disc from the side of its eye. That is the
//   temperament (it is performing), and it is why a camera high above still sees white, iris and pupil when the crab
//   looks down at the water (an eye that truly faced the ship showed that camera the back of its head);
// - a handlebar moustache: two antennae curled up at the ends, that bristle, flare and droop with the mood;
// - the mouth is the base face's door plates (faceKit), driven by the same score.
//
// The face is a score (src/geom/expression.ts): a cast of named expressions over one rest, layered by the fight's own
// clocks (`rig.crush`, `rig.grab`). It eyes the ship from the Grab's warning (covet), strains with each squeeze, is
// gleeful from the let-go, glares through Claw Crush's wind-up, winces at the slam, and goes back to posing. Where it
// looks is part of each expression: the ship is `rig.shipNow`, wherever the rig says the ship is.
//
// Inherited: the eyeball-on-a-stalk recipe, the lid as a spherical lune, the stalks' whip after the slam and the mouth
// plates are faceKit's (face/base.ts); watching the audience at rest and the stalks trailing the walk's sway are the
// periscope's. New here: the lower lid, the audience-facing socket with a sliding iris, the green iris, the coral
// lids, the size and the lopsidedness, the moustache, and expressions as values.

import {
  abs, add, added, alive, cast, clamp, cos, cross, div, dot, draw, during, expressionsRead, fract, spiralTube, length, max, minScreenSize, mix, mul,
  only, place, rigid, rotateAbout, score, show, sin, smoothstep, spacing, sqrt, strand, sub, surface, time, tolerance, unit, vec2, vec3,
  type Expression, type F, type P3, type Posed, type Score,
} from "../../../../src/index.ts";
import { cut, perFrame, TAU, type V3 } from "../ink.ts";
import type { Rig } from "../rig.ts";
import type { FaceOption } from "../slots.ts";
import { faceKit } from "./base.ts";

/** Where the audience is: the game camera's eye (reefback_titan.ts, the `game` camera). It looks there at rest. */
/** Where the audience stands when the crab is at home (the game camera). A placed crab reads `rig.audience`. */
export const AUDIENCE = [23, 27, 21] as const;
/** Where the sockets face at rest: the audience's bearing, 10 degrees lower. Faced square at a camera 40 degrees up, the
 * eyes showed the lower cameras (`face`, `far`) their undersides and their brows sat behind them: stargazing. */
export const FACING = [23, 19, 16] as const;

// ---- the channels, and the cast ----

/**
 * What the face is drawn from.
 * - upper, lower: how far each lid has come over the eye: 0 out of the way, 1 at its middle line. The eye is shut when
 *   they sum to 2.
 * - slant: radians the lid line tips, positive down toward the middle (a scowl), negative down at the outside.
 * - pupil: the pupil's radius as a share of the eye's (the iris is IRIS).
 * - tall: the stalks' height, times their own; spread: how far each tip moves outward; lean: forward; aside: both to the
 *   crusher's side (negative: toward the ship's side).
 * - cock: how lopsided it is: 1 the right eye stands higher and wears its lid higher, -1 the other way.
 * - jaw: the mouth plates, 0 clamped to 1 flared; whisk: radians the moustache lifts.
 * - ship, disc: how far its look goes from the audience to the ship, or to the crush disc.
 * - shake: a tremble, world units.
 */
export type Channel = "upper" | "lower" | "slant" | "pupil" | "tall" | "spread" | "lean" | "aside" | "cock" | "jaw" | "whisk" | "ship" | "disc" | "shake";

export const CAST = cast<Channel, "covet" | "strain" | "glee" | "glare" | "wince">(
  // Posing: lids half down and uneven, one eye cocked higher, looking straight at you.
  { upper: 0.9, lower: 0.3, slant: 0.1, pupil: 0.3, tall: 1, spread: 0, lean: 0, aside: 0, cock: 1, jaw: 0.08, whisk: 0, ship: 0, disc: 0, shake: 0 },
  {
    // It wants the ship: eyes flung wide, pupils swollen, both stalks craned up, together and toward it; drooling.
    covet: { upper: 0.15, lower: 0.15, slant: -0.12, pupil: 0.44, tall: 1.15, spread: -0.3, lean: 0.7, aside: -0.7, cock: 0.2, jaw: 0.55, whisk: 0.25, ship: 1 },
    // The squeeze: eyes screwed to slits under a scowl, stalks drawn down and trembling, the mouth clamped.
    strain: { upper: 0.85, lower: 0.75, slant: 0.45, pupil: 0.24, tall: 0.7, spread: -0.15, lean: 0.3, aside: -0.3, cock: 0.4, jaw: 0, whisk: -0.2, ship: 1, shake: 0.06 },
    // Let go: the cheeks push the eyes into arches, stalks flung apart and back, laughing; it watches the ship go.
    glee: { upper: 0.3, lower: 0.95, slant: -0.3, pupil: 0.38, tall: 1.1, spread: 0.5, lean: -0.5, aside: 0, cock: 0.6, jaw: 1, whisk: 0.5, ship: 0.5 },
    // Before the slam: the brows drop hard to the middle over pinpoint pupils, stalks low and thrust at the disc, a roar.
    glare: { upper: 0.9, lower: 0.25, slant: 0.7, pupil: 0.16, tall: 0.78, spread: -0.25, lean: 1.0, aside: 0.5, cock: 0, jaw: 0.85, whisk: 0.35, disc: 1 },
    // The impact: eyes shut tight, the brows up in the middle, stalks jolted down, the lopsidedness thrown over. The lids
    // meet at the eye's middle line, not below it: from the game camera, above, a brow pulled right down showed only
    // its own top, a plain ball with no lash line.
    wince: { upper: 0.95, lower: 1.2, slant: -0.45, pupil: 0.24, tall: 0.85, spread: 0.15, lean: -0.1, aside: -0.3, cock: -0.5, jaw: 0, whisk: -0.6, disc: 1 },
  },
);
export type Mood = keyof typeof CAST.named;

// ---- the two eyes ----

export type EyeSpec = {
  readonly tag: "L" | "R"; readonly side: 1 | -1;
  /** The stalk's root on the carapace, and where its tip stands from there at rest (crab coordinates). */
  readonly root: V3; readonly reach: V3;
  readonly radius: number;
  /** What `cock` does to this eye: the height it gains and the share of the upper lid it sheds. */
  readonly cockRise: number; readonly cockLid: number;
  /** Seconds late this eye reads the score, and how its stalk whips after the slam (amount, Hz). */
  readonly lag: number; readonly whip: readonly [number, number];
};
// Rooted off the middle, toward the little claw: the great claw stands at the crab's right and, from the game camera,
// in front of anything on that side.
export const EYES: readonly EyeSpec[] = [
  { tag: "R", side: 1, root: [4.45, 0.85, 0.5], reach: [1.0, 2.5, -0.05], radius: 0.8, cockRise: 0.3, cockLid: 0.26, lag: 0, whip: [0.35, 1.5] },
  { tag: "L", side: -1, root: [4.35, 0.85, -1.6], reach: [0.9, 2.15, -0.5], radius: 0.62, cockRise: -0.2, cockLid: -0.08, lag: 0.14, whip: [0.5, 1.2] },
];
/** The iris's radius as a share of the eye's. */
const IRIS = 0.5;
/** How far the socket turns from the audience toward what it looks at (a share of the way), and how far the iris slides
 * across the eye when the look is square to the socket (a share of the eye's radius). SLIDE + IRIS stays under 1. */
const TURN = 0.25, SLIDE = 0.4;
/** Which way a strand's section runs across the eyeball's front, against `side0`. */
const BALL_ACROSS = 1;
/** A lid's least angle, radians: fully raised it still shows as a rim. */
const LID_MIN = 0.25;

type Arith<T> = { readonly add: (a: T | number, b: T | number) => T; readonly mul: (a: T | number, b: T | number) => T; readonly clamp: (x: T, lo: number, hi: number) => T };
const JS: Arith<number> = { add: (a, b) => a + b, mul: (a, b) => a * b, clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi) };
const GPU: Arith<F> = { add: (a, b) => add(a, b), mul: (a, b) => mul(a, b), clamp: (x, lo, hi) => clamp(x, lo, hi) };

/** One eye's drawn quantities from the channels: the lids' angles (radians from the eye's top and bottom, toward its
 * front), the slant, the pupil, and where the tip stands from the root. One formula for the picture and for the theory
 * (tools/face_theory.ts): `T` is a number there and an expression here. */
function eyeFrom<T>(o: Arith<T>, c: Readonly<Record<Channel, T>>, e: EyeSpec) {
  return {
    upper: o.clamp(o.mul(o.add(c.upper, o.mul(c.cock, -e.cockLid)), Math.PI / 2), LID_MIN, Math.PI),
    lower: o.clamp(o.mul(c.lower, Math.PI / 2), LID_MIN, Math.PI),
    slant: o.mul(c.slant, e.side),
    pupil: c.pupil,
    reach: [o.add(c.lean, e.reach[0]), o.add(o.mul(c.tall, e.reach[1]), o.mul(c.cock, e.cockRise)), o.add(o.add(o.mul(c.spread, e.side), c.aside), e.reach[2])] as const,
  };
}
/** The same in plain numbers, with the look's two constants: what tools/face_theory.ts predicts from. */
export const lookOf = (c: Expression<Channel>, e: EyeSpec) => ({ ...eyeFrom(JS, c, e), turn: TURN, slide: SLIDE });

// ---- the score: the cast laid over the fight ----

/** Seconds after the Grab lets go for the look to leave the ship (the grab's `settle` beat). */
const LOOK_AWAY = 1.5;

export function scoreOf(rig: Rig): Score<Channel, Mood> {
  const { n, crush, grab } = rig;
  return score(CAST, (t) => {
    const cb = crush.beats(t, n.crushSettle), ctau = crush.envelope(t).tau;
    const gb = grab.beats(t, LOOK_AWAY), gtau = grab.envelope(t).tau;
    // From the Grab's warning until it has looked away: the ship has its attention, and the three moods of the Grab lie
    // over one another on it.
    const attending = mul(during(add(gtau, grab.warn), { from: 0, rise: 0.5 }), sub(1, smoothstep(0.3, 1, gb.settle)));
    // Each squeeze, 0 to 1 at its tightest: the strain eases to six tenths between them and bites with each.
    const squeeze = clamp(div(sub(1, grab.crush(t)), n.grabSqueeze), 0, 1);
    const straining = mul(mul(smoothstep(0, 0.04, gb.hold), sub(1, smoothstep(0, 0.25, gb.release))), mix(0.6, 1, squeeze));
    const gleeful = mul(smoothstep(0.05, 0.3, gb.release), sub(1, smoothstep(0.35, 1, gb.settle)));
    const glaring = mul(smoothstep(0, 0.25, cb.anticipate), sub(1, smoothstep(-0.06, 0.02, ctau)));
    const wincing = during(ctau, { from: -0.06, rise: 0.08, to: 0.5, fall: 0.6 });
    // A slow, superior blink three times a cycle (so the performance loops with the fight), seen only while it poses:
    // the lids of a wince and nothing else.
    const every = n.crushPeriod / 3;
    const sinceBlink = abs(sub(mul(fract(div(t, every)), every), 1.2));
    const blink = mul(mul(sub(1, smoothstep(0.05, 0.2, sinceBlink)), sub(1, attending)), sub(1, max(glaring, wincing)));
    // It laughs: the stalks bob and the mouth chatters, five times a second.
    const laugh = sin(mul(t, TAU * 5));
    return [
      // Glee after the throw, and all through a taunt (rig.dance.on is 0 for a crab that has none).
      show("covet", attending), show("strain", straining), show("glee", max(gleeful, rig.dance.on)), show("glare", glaring), show("wince", wincing),
      only("wince", ["upper", "lower"], blink),
      added({ tall: mul(laugh, 0.05), jaw: mul(sub(laugh, 1), 0.2) }, gleeful),
    ];
  });
}

// ---- the face ----

export const dandy: FaceOption = {
  about: "a vain bully: two big uneven eyes on tall ringed stalks that face the audience, two lids each, a moustache",
  draw: (rig) => {
    const { n, body, local, shipNow } = rig;
    const I = n.ink, k = faceKit(rig);
    const theScore = scoreOf(rig);
    const tabF = (name: string, e: F): F => perFrame(`dandy_${name}`, e);
    const tabV = (name: string, e: P3): P3 => perFrame(`dandy_${name}`, e);
    /** The channels a part reads, `lag` seconds late, each evaluated once a frame. */
    const posed = (tag: string, lag: number): Posed<Channel> => {
      const c = theScore.at(sub(time, lag));
      return Object.fromEntries(CAST.channels.map((ch) => [ch, tabF(`${tag}_${ch}`, c[ch])])) as Posed<Channel>;
    };
    const w = TAU / n.period;
    const audience = rig.audience, disc = vec3(rig.crushCentre.x, 0, rig.crushCentre.y);

    const eye = (e: EyeSpec, i: number) => {
      const c = posed(e.tag, e.lag), q = eyeFrom(GPU, c, e), R = e.radius;
      const base = local(e.root);
      // The stalk never holds still (each its own seed), trails the walk's sway a beat late, trembles when the mood says
      // so, and whips after the slam.
      const idle = k.inBody(alive(time, 0.05, 31 + i), alive(time, 0.04, 41 + i), add(alive(time, 0.06, 51 + i), mul(cos(sub(mul(time, w), 1.1 + 0.3 * e.side)), 0.22)));
      const tremble = k.inBody(mul(sin(mul(time, TAU * 9 + i)), c.shake), mul(sin(add(mul(time, TAU * 11), 2 * i)), mul(c.shake, 0.5)), mul(cos(mul(time, TAU * 10 + i)), c.shake));
      const tip = tabV(`${e.tag}_tip`, add(add(add(add(base, k.inBody(q.reach[0], q.reach[1], q.reach[2])), idle), tremble), k.stalkWhip(e.whip[0], e.whip[1])));
      // The look: from the audience to the ship or the disc as the mood says. The socket turns part of the way; the iris
      // slides the rest across the eye, in the socket's own across and up.
      const look = unit(sub(mix(mix(audience, shipNow, c.ship), disc, c.disc), tip));
      const front = tabV(`${e.tag}_front`, unit(mix(unit(sub(vec3(...FACING), tip)), look, TURN)));
      const side0 = unit(cross(front, body.y)), up0 = cross(side0, front);
      const gx = tabF(`${e.tag}_gx`, mul(dot(look, side0), SLIDE)), gy = tabF(`${e.tag}_gy`, mul(dot(look, up0), SLIDE));
      const upper = tabF(`${e.tag}_upperAngle`, q.upper), lower = tabF(`${e.tag}_lowerAngle`, q.lower), slant = tabF(`${e.tag}_slantAngle`, q.slant);
      // The lids' hinge, tipped by the slant: `side0` points to the crab's right, so the right eye's outer corner is +side.
      const side = add(mul(side0, cos(slant)), mul(up0, sin(slant))), up = sub(mul(up0, cos(slant)), mul(side0, sin(slant)));

      const mid = add(add(base, mul(sub(tip, base), 0.55)), mul(body.y, 0.4));
      const stalk = strand({
        name: `stalk${e.tag}`, spine: (m) => mix(mix(base, mid, m), mix(mid, tip, m), m), stations: 6,
        girth: (m) => mix(R * 0.4, R * 0.27, m), tips: ["open", "round"], detail: { along: 18, around: 10 },
        // Bone white, a black ring at every sixth, a brick collar at the root: light, so the stalks' pose reads on the body.
        paint: (m) => mix(mix(vec3(...I.cream), vec3(...I.black), sub(1, cut(abs(sub(fract(mul(m, 6)), 0.5)), 0.07))), vec3(...I.brick), sub(1, cut(m, 0.1))),
      });
      const ball = strand({
        name: `eye${e.tag}`, spine: (m) => add(tip, mul(front, mul(sub(m, 0.5), R * 2))), stations: 4, girth: R,
        tips: [{ round: 0.5 }, { round: 0.5 }], up: body.y, detail: { along: 18, around: 24 },
        paint: (m, v) => {
          // The front cap's own coordinates: across (toward `side0`) and up, each -1 to 1.
          const z = sub(mul(m, 2), 1), r = sqrt(max(sub(1, mul(z, z)), 0));
          const x = mul(mul(r, cos(mul(v, TAU))), BALL_ACROSS), y = mul(r, sin(mul(v, TAU)));
          const d = length(vec2(sub(x, gx), sub(y, gy))), onFront = cut(m, 0.5);
          const iris = mul(cut(sub(IRIS, d), 0), onFront), ring = mul(sub(1, cut(abs(sub(d, IRIS)), 0.045)), onFront);
          const pupil = mul(cut(sub(c.pupil, d), 0), onFront);
          const glint = mul(cut(sub(mul(c.pupil, 0.32), length(vec2(sub(x, sub(gx, mul(c.pupil, 0.35))), sub(y, add(gy, mul(c.pupil, 0.45)))))), 0), onFront);
          const white = mix(mix(mix(mix(vec3(...I.cream), vec3(...I.moss), iris), vec3(...I.black), ring), vec3(...I.black), pupil), vec3(...I.cream), glint);
          // Dark behind: the white is a socket's opening, so from the side and from behind it reads as an eye facing away.
          return mix(vec3(...I.brickDark), white, cut(m, 0.36));
        },
      });
      // A lid: a spherical lune hinged on the eye's corners, from behind the eye's top (or bottom) forward to `angle`.
      const BACK = -0.4;
      const lid = (name: string, angle: F, from: 1 | -1, radius: number, paint: (edge: F) => P3) => draw.surface(name, surface((u, v) => {
        const a = mix(BACK, angle, u), b = mix(0.1, Math.PI - 0.1, v);
        const ringAt = add(mul(up, mul(cos(a), from)), mul(front, sin(a)));
        return add(tip, mul(add(mul(side, cos(b)), mul(ringAt, sin(b))), radius));
      }, { u: ["free", "free"], v: "free" }), {
        // `edge` is radians back from the lid's edge.
        paint: (u) => paint(mul(sub(1, u), sub(angle, BACK))), grid: { u: spacing.even(10), v: spacing.even(14) }, sides: "two", outline: "border",
      });
      // Painted lids, coral (the island's coral heads): lighter than the body and darker than the white, so a lid reads
      // against both, and a shut eye is a pink ball with a black lash line. (In the body's dark brick, shut eyes were two
      // dark balls on a brick body.) A heavy black rim at the edge and nothing else: with a crease behind it, a lowered
      // lid was a striped ball.
      const lidInk = (edge: F): P3 => mix(vec3(...I.coral), vec3(...I.black), sub(1, cut(edge, 0.2)));
      // The drawn points a viewer compares (and `expressionsRead` measures): the same expressions the parts are made of.
      const on = (dir: P3): P3 => add(tip, mul(dir, R));
      const marks = {
        [`stalk${e.tag}`]: { from: base, to: tip },
        [`upper${e.tag}`]: { from: tip, to: on(add(mul(up, cos(upper)), mul(front, sin(upper)))) },
        [`lower${e.tag}`]: { from: tip, to: on(add(mul(up, mul(cos(lower), -1)), mul(front, sin(lower)))) },
        [`pupil${e.tag}`]: { from: tip, to: on(add(add(mul(side0, gx), mul(up0, gy)), mul(front, sqrt(max(sub(1, add(mul(gx, gx), mul(gy, gy))), 0))))) },
        [`corner${e.tag}`]: { from: tip, to: on(side) },
      };
      return {
        ball, marks, channels: c, width: { from: on(mul(side0, -1)), to: on(side0) },
        things: [stalk, ball, lid(`cheek${e.tag}`, lower, -1, R * 1.07, lidInk), lid(`lid${e.tag}`, upper, 1, R * 1.12, lidInk)],
      };
    };
    const [right, left] = EYES.map(eye) as [ReturnType<typeof eye>, ReturnType<typeof eye>];

    // The mouth and the moustache read the score on the right eye's clock.
    const face = right.channels;
    const chew = mul(max(sin(mul(time, 2.1)), 0), 0.12);
    const jaw = clamp(add(face.jaw, chew), 0, 1);
    // The moustache: two antennae from under the eyes, out to each side and curled up at the ends. `whisk` lifts them.
    const moustache = (s: 1 | -1) => {
      // Lopsided with the rest of the face: the great claw's side rides higher, a smirk.
      const lift_ = add(add(add(face.whisk, mul(face.cock, 0.14 * s)), alive(time, 0.05, 61 + s)), mul(sin(mul(time, TAU * 9 + s)), mul(face.shake, 1.5)));
      // About the body's x, a positive turn takes +z toward -y: each side lifts by turning the other way.
      const y = rotateAbout(body.y, body.x, mul(lift_, -s)), z = rotateAbout(body.z, body.x, mul(lift_, -s));
      return place(spiralTube({
        name: `moustache${s < 0 ? "L" : "R"}`, length: 2.3, curl: 1.9, taper: 0.3, girth: 0.12, out: [0.25, -0.1, s], toward: [0, 1, 0],
        paint: () => vec3(...I.black), detail: { along: 16, around: 6 },
      }), rigid({ o: local([4.95, 0.2, -0.5 + s * 0.35]), x: body.x, y, z }));
    };

    return {
      things: [...right.things, ...left.things, k.plate(1, jaw), k.plate(-1, jaw), k.gullet(), moustache(1), moustache(-1)],
      checks: [
        // Each eye is big enough to read from the game camera (the periscope's measured 34 px).
        minScreenSize(right.ball, "game", 50), minScreenSize(left.ball, "game", 38),
        // Every named expression shows in a cycle, and any two differ on screen by a quarter of the right eye's width.
        expressionsRead(theScore, { ...right.marks, ...left.marks }, { camera: "game", period: n.crushPeriod, apart: tolerance.share(0.25), of: right.width }),
      ],
    };
  },
};

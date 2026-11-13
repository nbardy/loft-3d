// The brow: a face that is a head (docs/art_direction/DIRECTION.md, Round 4; references in
// docs/art_direction/crab_round4/). Temperament, as the dandy's: vain, a show-off and a bully.
//
// What it is, and what every part is for:
// - a head: a broad heavy mass on the front of the carapace (a boxy superellipsoid, `dome` in ../../lib/face_parts.ts),
//   placed and sized from the carapace's numbers and carried by the body's frame. Its face is tilted 40 degrees up, so
//   a camera high above sees brows, eyes and mouth together. Its relief (sockets, a muzzle, cheeks that bunch, a mouth
//   that deepens) and its paint (the dark sockets, the maroon mouth and tongue, nostrils, creases) are written once, in
//   the face's own coordinates;
// - two big eyes sunk in it, not twins (the great claw's side is larger, higher and leads by 0.14 s), each a ball with
//   a green iris that slides to look: truly under its target while the target is in front of the eye, held at the rim
//   past that (`gazeOf`), so it follows the ship thrown behind its ear and still shows iris and pupil;
// - a brow half over each eye, its own moving part: a thick dark ridge that rides the eye's sphere, from raised clear
//   to clamped down over it, slanted either way. The brows are what reads from far away;
// - two lids an eye (coral, as the dandy's: a lid in the body's ink is lost on the body);
// - a mouth: two cream mandible plates that sit like buck teeth at rest, part into tusks and clench; behind them the
//   head's own surface sinks into a dark maroon mouth with a tongue, and the head's lower half drops with the jaw;
// - the dandy's handlebar moustache, on the muzzle, which rises with a grin and sinks with a wince;
// - two long antennae from the crown, loose: they trail the walk, flick at the throw and whip after the slam.
// One number, `stalk`, raises the eyes out of the head on short thick stalks with their brows as hoods (0: in the head).
//
// The face is a score (src/geom/expression.ts): a cast over one rest, layered by the fight's own clocks. It is greedy
// from the Grab's warning, strains with each squeeze, is gleeful from the let-go until its thrown ship lands, furious
// through Claw Crush's wind-up, winces at the slam, then gloats at the second boat its wave shoved, and goes back to
// posing. Where it looks is part of each expression, and each place is the rig's: `rig.shipNow`, `rig.inputs.crushCentre`,
// `rig.boatTwoAt` with `rig.crush.pushed`.
//
// Inherited: the references; the dandy's moustache, its score's shape, its coral lids, its sliding iris and its
// audience (face/dandy.ts); the eyeball and the lid as a spherical lune (face/base.ts, faceKit). New here: the head
// with its relief, the brows as hoods on the eyes' spheres, the gaze held at the rim, the mandible mouth with a jaw
// that drops, the antennae, and the checks of the mouth's width and of the claws keeping off the face.

import {
  abs, add, added, alive, cast, clamp, cos, cross, div, during, expressionsRead, fract, lift, max, minScreenSize, mix, mul, only, score, show, sin, smoothstep, spansOnScreen,
  staysInView, strand, sub, swing, time, tolerance, unit, vec3, type Drawable, type Expression, type F, type Frame, type P3, type Posed, type Score,
} from "../../../../src/index.ts";
import { bump, crisp, dome, ell, eyeball, gazeOf, handlebar, hoodBrow, inked, inkLine, lid, lidHinge, shellOut, tusk, type EyeAxes } from "../../lib/face_parts.ts";
import { mottle, perFrame, TAU } from "../ink.ts";
import type { Numbers } from "../numbers.ts";
import type { Rig } from "../rig.ts";
import type { FaceOption } from "../slots.ts";
import { AUDIENCE } from "./dandy.ts";

// ---- the head: where it is and how big, from the carapace ----

/**
 * The head, in the carapace's own measures: half-sizes as shares of the carapace's half-width (`across`) and
 * half-height (`up`, `down`, `out`); its middle `back` half-heights behind the carapace's front end and `rise` above
 * its mid-height. `tilt` is how far the face is turned up from facing straight ahead, radians. Every length of the
 * face below is in face units: world units on the base carapace (half-width 4.1), scaled with any other.
 */
export const HEAD = { across: 0.68, up: 1.6, down: 1.72, out: 1.2, back: 0.56, rise: 0.36, tilt: 0.7, power: 3, jawDrop: 0.4 } as const;
const BASE_WIDTH = 4.1, BASE_HEIGHT = 1.25;
/** The head's half-sizes in face units. */
export const RADII = { across: HEAD.across * BASE_WIDTH, up: HEAD.up * BASE_HEIGHT, down: HEAD.down * BASE_HEIGHT, out: HEAD.out * BASE_HEIGHT } as const;
/** Where the head's middle is and how large a face unit is, for a carapace: crab coordinates and world units. */
export const headOf = (C: Numbers["carapace"]) => ({ at: [C.to - HEAD.back * C.height, HEAD.rise * C.height, 0] as const, unit: C.width / BASE_WIDTH });

// ---- the channels, and the cast ----

/**
 * What the face is drawn from.
 * - upper, lower: how far each lid has come over the eye: 0 out of the way, 1 at its middle line.
 * - brow: how far the brows have come down over the eyes: 0 raised clear, 1 clamped on. slant: how far their inner ends
 *   drop (a V; the lids tip with them); negative lifts them (pain). cock: lopsidedness: 1 the right brow up and the left down.
 * - pupil: the pupil's radius as a share of the eye's. pop: how far the eyes start out of the head.
 * - cheek: how far the cheeks bunch up under the eyes.
 * - jaw: the mouth, 0 shut to 1 gaping (the mandibles part into tusks, the head's lower half drops). grit: clenched.
 *   skew: pulled to one side (a grimace). whisk: radians the moustache lifts, and the muzzle with it.
 * - perk: the antennae, 1 pricked up, -1 laid back.
 * - ship, disc, boat: how far its look goes from the audience to the ship, the crush disc, the second boat.
 * - shake: a tremble, face units.
 */
export type Channel = "upper" | "lower" | "brow" | "slant" | "cock" | "pupil" | "pop" | "cheek" | "jaw" | "grit" | "skew" | "whisk" | "perk" | "ship" | "disc" | "boat" | "shake";

export const CAST = cast<Channel, "greedy" | "straining" | "gleeful" | "furious" | "wincing" | "gloating">(
  // Posing: smug. One brow up, lids half down and uneven, a closed smirk, looking straight at you.
  { upper: 1.0, lower: 0.25, brow: 0.42, slant: 0.12, cock: 1, pupil: 0.3, pop: 0, cheek: 0.25, jaw: 0.04, grit: 0, skew: 0, whisk: 0.05, perk: 0, ship: 0, disc: 0, boat: 0, shake: 0 },
  {
    // It wants the ship: brows flung up, eyes wide and starting out of its head on small pupils, the mouth fallen open.
    greedy: { upper: 0.02, lower: 0.05, brow: 0.05, slant: -0.12, cock: 0.2, pupil: 0.2, pop: 1, cheek: 0, jaw: 0.4, whisk: 0.2, perk: 1, ship: 1 },
    // The squeeze: brows clamped down, eyes slits between lid and bunched cheek, mandibles clenched, trembling.
    straining: { upper: 0.9, lower: 0.9, brow: 0.9, slant: 0.6, cock: 0.3, pupil: 0.22, cheek: 1, jaw: 0, grit: 1, whisk: -0.15, perk: -0.4, ship: 1, shake: 0.05 },
    // It threw it: brows high and apart, the cheeks push the eyes into arches, the mouth gapes in a laugh; it watches it fly.
    gleeful: { upper: 0.3, lower: 0.9, brow: 0.1, slant: -0.35, cock: 0.5, pupil: 0.34, pop: 0.4, cheek: 1, jaw: 1, whisk: 0.45, perk: 0.7, ship: 1 },
    // Before the slam: the brows in a deep V over pinpoint pupils, a roar, antennae laid flat.
    furious: { upper: 0.55, lower: 0.3, brow: 0.8, slant: 0.9, cock: 0, pupil: 0.15, pop: 0.3, cheek: 0.5, jaw: 0.92, whisk: 0.15, perk: -1, disc: 1 },
    // The impact: eyes screwed shut on the middle line, the brows' inner ends thrown up, the mouth dragged sideways.
    wincing: { upper: 1.0, lower: 1.05, brow: 0.3, slant: -0.8, cock: -0.6, pupil: 0.24, cheek: 1, jaw: 0.3, skew: 1, whisk: -0.6, perk: -0.7, disc: 1 },
    // It looks at what its wave did to the other boat: side-long under one high brow, cheeks up, a chuckle.
    gloating: { upper: 0.95, lower: 0.7, brow: 0.35, slant: 0.2, cock: 1.4, pupil: 0.3, cheek: 0.9, jaw: 0.25, whisk: 0.35, perk: 0.4, boat: 1 },
  },
);
export type Mood = keyof typeof CAST.named;

// ---- the two eyes ----

export type EyeSpec = {
  readonly tag: "L" | "R"; readonly side: 1 | -1;
  /** Where it is on the face: how far to its own side of the middle line and how far up, face units from the head's middle. */
  readonly at: readonly [number, number];
  readonly radius: number;
  /** What `cock` does to this eye: radians its brow rises and the share of its upper lid it sheds. */
  readonly cockBrow: number; readonly cockLid: number;
  /** Seconds late this eye reads the score. */
  readonly lag: number;
};
// Not twins: the great claw's side is larger, sits higher, wears its brow and lid higher, and leads.
export const EYES: readonly EyeSpec[] = [
  { tag: "R", side: 1, at: [1.2, 0.95], radius: 0.85, cockBrow: 0.3, cockLid: 0.15, lag: 0 },
  { tag: "L", side: -1, at: [1.15, 0.82], radius: 0.72, cockBrow: -0.12, cockLid: -0.08, lag: 0.14 },
];
/** How deep an eye's middle sits under the head's surface, and how far `pop` brings it out, as shares of its radius. */
export const SINK = 0.38, POP = 0.22;
/** Which way a stalk carries an eye, in the face's coordinates (up the face and out of it), per unit of `stalk` and of the eye's radius. */
export const STALK_WAY = [0, 0.55, 0.95] as const;
/** The eyes face a little to the crab's right of the face's own normal: the game, face and far cameras all stand there. */
export const FACE_RIGHT = 0.27;
/** The iris's radius as a share of the eye's, and how far from the eye's own facing its middle may go (`gazeOf`). */
export const IRIS = 0.45, GAZE_REACH = 0.45;
/** A lid's least angle, radians; and how much of the brows' slant the lid line takes. */
const LID_MIN = 0.25, LID_SLANT = 0.6;
/** The brow's place over the eye, radians forward from above it: raised clear, and clamped down. */
export const BROW_UP = 0.15, BROW_DOWN = 1.2;
/** The brow: how far round the eye its ends are (the thick end by the nose first), its half-widths there and its depth. */
export const BROW = { span: [-0.9, 1.0] as const, girth: [0.34, 0.2] as const, depth: 0.62 } as const;
/** Lid radii as shares of the eye's (the cheek lid under the brow lid). */
const LID_OVER = [1.07, 1.12] as const;

type Arith<T> = { readonly add: (a: T | number, b: T | number) => T; readonly mul: (a: T | number, b: T | number) => T; readonly clamp: (x: T, lo: number, hi: number) => T };
const JS: Arith<number> = { add: (a, b) => a + b, mul: (a, b) => a * b, clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi) };
const GPU: Arith<F> = { add: (a, b) => add(a, b), mul: (a, b) => mul(a, b), clamp: (x, lo, hi) => clamp(x, lo, hi) };

/** One eye's drawn quantities from the channels: lid angles, the lid line's tip, the brow's three places over the eye
 * (thick end, middle, thin end) and how far the eye has come out. One formula for the picture and for the theory
 * (tools/brow_theory.ts): `T` is a number there and an expression here. */
function eyeFrom<T>(o: Arith<T>, c: Readonly<Record<"upper" | "lower" | "brow" | "slant" | "cock" | "pop", T>>, e: EyeSpec) {
  const over = o.add(o.add(BROW_UP, o.mul(c.brow, BROW_DOWN - BROW_UP)), o.mul(c.cock, -e.cockBrow));
  return {
    upper: o.clamp(o.mul(o.add(c.upper, o.mul(c.cock, -e.cockLid)), Math.PI / 2), LID_MIN, Math.PI),
    lower: o.clamp(o.mul(c.lower, Math.PI / 2), LID_MIN, Math.PI),
    slant: o.mul(c.slant, e.side * LID_SLANT),
    brow: [o.clamp(o.add(over, o.mul(c.slant, 0.65)), 0, 1.7), o.clamp(o.add(over, -0.08), 0, 1.5), o.clamp(o.add(o.add(over, o.mul(c.slant, -0.3)), 0.12), 0, 1.5)] as const,
    out: o.mul(c.pop, POP),
  };
}

/** Where the mouth's top edge is, face units up from the head's middle; and the muzzle the moustache rides, above it. */
export const MOUTH_TOP = -0.95, MUZZLE = -0.55;
/** The mouth from the channels, in face coordinates (X to the viewer's right): its middle, half-width and half-height,
 * and each mandible's hinge and tip (`s` 1 the viewer's right) with how far its tip stands off the face. */
function mouthFrom<T>(o: Arith<T>, c: Readonly<Record<"jaw" | "grit" | "skew", T>>) {
  // A grimace drags the mouth toward the crab's right (the viewer's left): the side the cameras stand on.
  const x0 = o.mul(c.skew, -0.3);
  const plate = (s: 1 | -1) => {
    const hingeY = o.add(MOUTH_TOP + 0.1, o.mul(c.grit, 0.06));
    return {
      hinge: [o.add(x0, o.mul(o.add(o.add(0.34, o.mul(c.jaw, 0.8)), o.mul(c.grit, -0.05)), s)), hingeY] as const,
      tip: [o.add(o.add(x0, o.mul(o.add(o.add(0.3, o.mul(c.jaw, 0.75)), o.mul(c.grit, -0.08)), s)), o.mul(c.skew, -0.25)), o.add(o.add(hingeY, -1.05), o.mul(c.grit, 0.08))] as const,
      proud: o.add(0.2, o.mul(c.jaw, 0.25)),
    };
  };
  return {
    x0, wide: o.add(o.add(0.5, o.mul(c.jaw, 0.85)), o.mul(c.skew, 0.15)), tall: o.add(0.05, o.mul(c.jaw, 0.62)),
    plates: [plate(-1), plate(1)] as const,
  };
}
/** The same in plain numbers: what tools/brow_theory.ts predicts from. */
export const lookOf = (c: Expression<Channel>, e: EyeSpec) => eyeFrom(JS, c, e);
export const mouthOf = (c: Expression<Channel>) => mouthFrom(JS, c);

// ---- the score: the cast laid over the fight ----

/** Seconds after the thrown ship lands for the look to leave it (the grab's `settle` beat). */
const LOOK_AWAY = 1.5;

export function scoreOf(rig: Rig): Score<Channel, Mood> {
  const { n, crush, grab } = rig;
  return score(CAST, (t) => {
    const cb = crush.beats(t, n.crushSettle), ctau = crush.envelope(t).tau;
    const gb = grab.beats(t, LOOK_AWAY), gtau = grab.envelope(t).tau;
    // From the Grab's warning until the ship it threw is down and it has looked away: the ship has its attention, and
    // the Grab's three moods lie over one another on it.
    const attending = mul(during(add(gtau, grab.warn), { from: 0, rise: 0.5 }), sub(1, smoothstep(0.3, 1, gb.settle)));
    // Each squeeze, 0 to 1 at its tightest: the strain eases to six tenths between them and bites with each.
    const squeeze = clamp(div(sub(1, grab.crush(t)), n.grabSqueeze), 0, 1);
    const straining = mul(mul(smoothstep(0, 0.04, gb.hold), sub(1, smoothstep(0, 0.2, gb.release))), mix(0.6, 1, squeeze));
    // Glee from the let-go, through the whole flight (`flight` is the hold's own beat: a hold that sets its thing down
    // has none, and glee then ends with the release as before), fading as it looks away after the landing.
    const gleeful = mul(smoothstep(0.02, 0.2, gb.release), sub(1, smoothstep(0.25, 1, gb.settle)));
    const furious = mul(smoothstep(0, 0.25, cb.anticipate), sub(1, smoothstep(-0.06, 0.02, ctau)));
    const wincing = during(ctau, { from: -0.06, rise: 0.08, to: 0.5, fall: 0.6 });
    // After the wince it turns to the second boat, which the ring has reached by then, and enjoys it for three seconds.
    const gloating = during(ctau, { from: 0.9, rise: 0.5, to: 3.9, fall: 1.0 });
    // A slow, superior blink five times a loop (so the performance loops with the fight), seen only while it poses.
    const every = n.crushPeriod / 5;
    const sinceBlink = abs(sub(mul(fract(div(t, every)), every), 3.3));
    const blink = mul(mul(sub(1, smoothstep(0.05, 0.2, sinceBlink)), sub(1, attending)), sub(1, max(max(furious, wincing), gloating)));
    // It laughs: the jaw chatters five times a second; the gloat is the same laugh, slower and smaller.
    const laugh = sin(mul(t, TAU * 5)), chuckle = sin(mul(t, TAU * 3));
    return [
      show("greedy", attending), show("straining", straining), show("gleeful", gleeful),
      show("furious", furious), show("wincing", wincing), show("gloating", gloating),
      only("wincing", ["upper", "lower"], blink),
      added({ jaw: mul(sub(laugh, 1), 0.16), cheek: mul(laugh, 0.08) }, gleeful),
      added({ jaw: mul(sub(chuckle, 1), 0.08) }, gloating),
    ];
  });
}

// ---- the face ----

type V3 = readonly [number, number, number];

/** The brow face. `stalk` raises each eye out of the head by that many of its own radii, on a short thick stalk under a
 * brow that has become its hood: 0 is in the head. */
export function browFace(o: { readonly stalk: number }): FaceOption {
  if (!(o.stalk >= 0 && Number.isFinite(o.stalk))) throw new Error(`browFace: stalk must be a finite number of eye radii, at least 0; got ${o.stalk}`);
  return {
    about: o.stalk === 0
      ? "a head: heavy brows over big sunk eyes, cheeks, a mandible mouth that gapes, a moustache, long antennae"
      : `the brow face with its eyes raised ${o.stalk} radii on short thick stalks, hooded by their brows`,
    draw: (rig, _carapace, claws) => {
      const { n, body, local, shipNow, crush, crushAfter, grabEnv } = rig;
      const I = n.ink, H = headOf(n.carapace), k = H.unit;
      const theScore = scoreOf(rig);
      const tabF = (name: string, e: F): F => perFrame(`brow_${name}`, e);
      const tabV = (name: string, e: P3): P3 => perFrame(`brow_${name}`, e);
      /** The channels a part reads, `lag` seconds late, each evaluated once a frame. */
      const posed = <K extends Channel>(tag: string, lag: number, channels: readonly K[]): Readonly<Record<K, F>> => {
        const c = theScore.at(sub(time, lag));
        return Object.fromEntries(channels.map((ch) => [ch, tabF(`${tag}_${ch}`, c[ch])])) as Readonly<Record<K, F>>;
      };
      // The face (head, mouth, moustache, antennae) reads the score on the right eye's clock.
      const face: Posed<Channel> = posed("R", 0, CAST.channels);
      const mouth = mouthFrom(GPU, face);
      const w = TAU / n.period;

      // ---- the head's frame: the body's, tilted up; x to the viewer's right (the crab's left), so it is right-handed ----
      const ct = Math.cos(HEAD.tilt), st = Math.sin(HEAD.tilt);
      const out = tabV("out", add(mul(body.x, ct), mul(body.y, st))), upFace = tabV("up", sub(mul(body.y, ct), mul(body.x, st)));
      const frame: Frame = { o: tabV("o", local(H.at)), x: mul(body.z, -1), y: upFace, z: out };

      // ---- the head ----
      const muzzleY = add(MUZZLE, mul(face.whisk, 0.1)), cheekY = add(-0.6, mul(face.cheek, 0.3));
      /** The mouth's edge at a face coordinate: below 0 inside it. Tipped by the grimace. */
      const mouthEdge = (X: F, Y: F): F => {
        const y = add(Y, mul(mul(face.skew, 0.25), sub(X, mouth.x0)));
        return sub(ell(X, y, mouth.x0, sub(MOUTH_TOP, mouth.tall), mouth.wide, mouth.tall), 1);
      };
      const head = dome({
        name: "head", frame, scale: k,
        radii: { across: RADII.across, up: RADII.up, down: add(RADII.down, mul(face.jaw, HEAD.jawDrop)), out: RADII.out },
        power: HEAD.power, detail: { across: 80, around: 72, crowd: 0.55 },
        relief: (X, Y) => {
          const ax = abs(X);
          // A dish under each eye, a shelf across the crown that the brows stand on, the muzzle, the cheeks, the mouth.
          const sockets = EYES.reduce((acc: F, e) => add(acc, mul(bump(ell(X, Y, -e.side * e.at[0], e.at[1], e.radius * 1.3, e.radius * 1.3)), -0.18)), lift<"f32">(0));
          const shelf = mul(mul(bump(div(abs(sub(Y, 1.45)), 0.55)), sub(1, smoothstep(1.5, 2.3, ax))), 0.2);
          const muzzle = mul(bump(ell(X, Y, 0, muzzleY, 1.3, 0.62)), 0.42);
          const cheeks = mul(bump(ell(ax, Y, 1.75, cheekY, 0.8, 0.62)), add(0.1, mul(face.cheek, 0.3)));
          const cavity = mul(smoothstep(0.06, -0.15, mouthEdge(X, Y)), add(0.12, mul(face.jaw, 0.5)));
          return sub(add(add(add(sockets, shelf), muzzle), cheeks), cavity);
        },
        paint: (X, Y, front) => {
          const ax = abs(X);
          const BRICK = vec3(...I.brick), DARK = vec3(...I.brickDark), BLACK = vec3(...I.black);
          // Mottled like the shell round the edge and the back; the face itself is kept clean for its features.
          const blots = mul(mottle(add(mul(X, 0.23), 0.37), add(mul(Y, 0.11), 0.21)), max(smoothstep(0.75, 1.0, ell(X, Y, 0, 0, 2.3, 2.0)), sub(1, front)));
          // Each eye in a dark socket, so its white has a dark surround on the brick head.
          const socket = EYES.reduce((acc: F, e) => max(acc, inked(sub(ell(X, Y, -e.side * e.at[0], e.at[1], e.radius * 1.22, e.radius * 1.22), 1))), lift<"f32">(0));
          // Creases: two furrows between the brows that come with a scowl, a fold over each cheek that thickens as it bunches.
          const furrow = mul(mul(inkLine(sub(ax, add(0.1, mul(sub(Y, 0.9), 0.12))), 0.03), mul(smoothstep(0.9, 1.0, Y), sub(1, smoothstep(1.45, 1.6, Y)))), smoothstep(0.2, 0.6, face.slant));
          const fold = mul(mul(inkLine(sub(ell(ax, Y, 1.75, cheekY, 0.84, 0.66), 1), add(0.04, mul(face.cheek, 0.05))), crisp(Y, add(cheekY, 0.1))), sub(1, crisp(ax, 2.45)));
          const nostril = inked(sub(ell(ax, Y, 0.17, add(muzzleY, 0.5), 0.085, 0.05), 1));
          // The mouth: dark maroon inside its edge, a tongue on its floor, a lip line round it.
          const edge = mouthEdge(X, Y), inMouth = inked(edge);
          const tongue = inked(sub(ell(X, Y, mouth.x0, sub(MOUTH_TOP, mul(mouth.tall, 1.5)), mul(mouth.wide, 0.62), mul(mouth.tall, 0.62)), 1));
          let c = mix(mix(BRICK, DARK, blots), DARK, socket);
          c = mix(c, BLACK, mul(max(max(furrow, fold), nostril), front));
          c = mix(c, mix(vec3(...I.maw), vec3(...I.tongue), tongue), inMouth);
          return mix(c, BLACK, mul(inkLine(edge, 0.09), front));
        },
      });
      const { skin, world, turned } = head;

      // ---- the eyes, each under its brow ----
      // Every eye faces the same way: the face's normal turned a little to the crab's right, where its audience is.
      const front = tabV("front", unit(add(out, mul(body.z, FACE_RIGHT))));
      const side = tabV("side", unit(cross(front, upFace))), up = cross(side, front);
      const axes: EyeAxes = { front, side, up };
      const audience = rig.audience;
      const disc = vec3(rig.inputs.crushCentre.x, 0, rig.inputs.crushCentre.y);
      // The second boat where the ring has pushed it: the rig's place for it and the attack's own readout of the shove.
      const shoved = crush.pushed(rig.boatTwoAt);
      const boatTwo = tabV("boat2", vec3(add(rig.boatTwoAt.x, shoved.x), 0.8, add(rig.boatTwoAt.y, shoved.y)));

      const eye = (e: EyeSpec, i: number) => {
        const c = e.lag === 0 ? face : posed(e.tag, e.lag, ["upper", "lower", "brow", "slant", "cock", "pupil", "pop", "ship", "disc", "boat", "shake"]);
        const q = eyeFrom(GPU, c, e), R = e.radius * k;
        // In the head: its middle under the head's surface (the relief aside: the socket is a dish round it). Raised:
        // `stalk` radii along the stalk's way. It starts out of its socket with `pop`, and trembles when the mood says.
        const seat: V3 = [-e.side * e.at[0], e.at[1], shellOut(RADII, HEAD.power, e.at[0], e.at[1]) - SINK * e.radius];
        const raised: V3 = [seat[0] + STALK_WAY[0] * o.stalk * e.radius, seat[1] + STALK_WAY[1] * o.stalk * e.radius, seat[2] + STALK_WAY[2] * o.stalk * e.radius];
        const tremble = add(mul(side, mul(sin(mul(time, TAU * 9 + i)), c.shake)), mul(up, mul(sin(add(mul(time, TAU * 11), 2 * i)), mul(c.shake, 0.5))));
        const centre = tabV(`${e.tag}_at`, add(add(world(raised), mul(front, mul(q.out, R))), mul(tremble, k)));
        // The look: from the audience to the ship, the disc or the second boat as the mood says.
        const look = unit(sub(mix(mix(mix(audience, shipNow, c.ship), disc, c.disc), boatTwo, c.boat), centre));
        const g = gazeOf(look, axes, GAZE_REACH), gaze = { x: tabF(`${e.tag}_gx`, g.x), y: tabF(`${e.tag}_gy`, g.y) };
        const upper = tabF(`${e.tag}_upperAngle`, q.upper), lower = tabF(`${e.tag}_lowerAngle`, q.lower);
        const hinge = lidHinge(axes, tabF(`${e.tag}_slantAngle`, q.slant));

        const ball = eyeball({
          name: `eye${e.tag}`, centre, axes, radius: R, gaze, iris: IRIS, pupil: c.pupil,
          inks: { white: I.cream, iris: I.moss, pupil: I.black, back: I.brickDark },
        });
        // Coral lids with a heavy black lash line (the dandy's: a lid in the body's brick was lost on the body).
        const lidInk = (edge: F): P3 => mix(vec3(...I.coral), vec3(...I.black), sub(1, crisp(edge, 0.2)));
        const lids = [
          lid({ name: `cheek${e.tag}`, centre, front, hinge, radius: R * LID_OVER[0], angle: lower, from: -1, paint: lidInk }),
          lid({ name: `lid${e.tag}`, centre, front, hinge, radius: R * LID_OVER[1], angle: upper, from: 1, paint: lidInk }),
        ];
        // The brow rides the eye's sphere just outside the upper lid. Its thick end is by the nose: toward the crab's
        // left for the right eye, so the span is mirrored by the eye's side. It never holds still (its own seed).
        const idle = alive(time, 0.04, 31 + i);
        const over = q.brow.map((a, j) => tabF(`${e.tag}_brow${j}`, add(a, idle))) as unknown as readonly [F, F, F];
        const brow = hoodBrow({
          name: `brow${e.tag}`, centre, axes, radius: R * LID_OVER[1] + BROW.girth[0] * BROW.depth * k + 0.02 * k,
          span: [BROW.span[0] * e.side, BROW.span[1] * e.side], over, girth: [BROW.girth[0] * k, BROW.girth[1] * k], depth: BROW.depth,
          // Dark brick, darker than the head and far darker than the eye: the shape that reads from far away.
          paint: () => vec3(...I.brickDark),
        });
        // Raised, the eye stands on a short thick stalk from its socket.
        const stalk: readonly Drawable[] = o.stalk === 0 ? [] : [strand({
          name: `stalk${e.tag}`, spine: (m) => mix(world([seat[0], seat[1], seat[2] - 0.4 * e.radius]), centre, m), stations: 4,
          girth: R * 0.62, tips: ["open", "open"], up: front, detail: { along: 8, around: 14 },
          paint: (m) => mix(vec3(...I.brick), vec3(...I.black), sub(1, crisp(abs(sub(m, 0.5)), 0.44))),
        })];
        // The drawn points a viewer compares (and `expressionsRead` measures): the same expressions the parts are made of.
        const on = (dir: P3): P3 => add(centre, mul(dir, R));
        const marks = {
          [`browIn${e.tag}`]: { from: centre, to: brow.ends[0] },
          [`browOut${e.tag}`]: { from: centre, to: brow.ends[2] },
          [`upper${e.tag}`]: { from: centre, to: on(add(mul(hinge.up, cos(upper)), mul(front, sin(upper)))) },
          [`lower${e.tag}`]: { from: centre, to: on(add(mul(hinge.up, mul(cos(lower), -1)), mul(front, sin(lower)))) },
          [`pupil${e.tag}`]: { from: centre, to: on(add(add(mul(side, gaze.x), mul(up, gaze.y)), mul(front, 0.85))) },
        };
        return { ball, centre, marks, width: { from: on(mul(side, -1)), to: on(side) }, things: [...stalk, ball, ...lids, brow.strand] };
      };
      const [right, left] = EYES.map(eye) as [ReturnType<typeof eye>, ReturnType<typeof eye>];

      // ---- the mouth: two mandible plates over the head's own maroon mouth ----
      const chew = mul(max(sin(mul(time, 2.1)), 0), 0.07);
      const gape = clamp(add(face.jaw, chew), 0, 1);
      const mandible = (s: 1 | -1) => {
        const p = mouth.plates[s < 0 ? 0 : 1];
        // The hinge sits on the muzzle's skin; the tip hangs clear of the mouth's hollow, so it is placed off the head's
        // plain surface, further off as the plates part into tusks. Clenched, the plates grind against each other.
        const grind = mul(mul(sin(mul(time, TAU * 7 + s)), face.grit), 0.03);
        const hinge = tabV(`plate${s < 0 ? "L" : "R"}_hinge`, world(skin(add(p.hinge[0], grind), p.hinge[1], 0.1)));
        const tip = tabV(`plate${s < 0 ? "L" : "R"}_tip`, world(add(skin(add(p.tip[0], grind), p.tip[1], 0), vec3(0, 0, add(p.proud, mul(face.jaw, 0.5))))));
        return {
          hinge, tip,
          plate: tusk({
            name: `mandible${s < 0 ? "L" : "R"}`, hinge, tip, flat: 0.4, face: out, bow: mul(gape, 0.12 * k),
            // A blunt plate at rest, a pointed tusk agape.
            girth: (m) => mul(mix(0.36, mix(0.3, 0.17, gape), m), k),
            // Cream, with a black line where it leaves the gum.
            paint: (m) => mix(vec3(...I.cream), vec3(...I.black), sub(1, crisp(m, 0.07))),
          }),
        };
      };
      // The viewer's left is the crab's right: `plateR` is the plate on the great claw's side.
      const plateR = mandible(-1), plateL = mandible(1);
      // Read only by the checks, so not tabulated: a per-frame table nothing draws from is not in the artefact.
      const mouthTop = world(skin(mouth.x0, MOUTH_TOP + 0.1, 0.1));

      // ---- the moustache, on the muzzle ----
      const moustache = (s: 1 | -1) => handlebar({
        name: `moustache${s < 0 ? "L" : "R"}`, side: s, frame: { x: out, y: upFace, z: body.z },
        root: world(skin(-s * 0.2, sub(muzzleY, 0.12), 0.12)), length: 1.75 * k, girth: 0.24 * k, droop: 0.5, ink: I.black,
        // Lopsided with the rest of the face (the great claw's side rides higher: a smirk), never quite still.
        lift: add(add(add(face.whisk, mul(face.cock, 0.12 * s)), alive(time, 0.05, 61 + s)), mul(sin(mul(time, TAU * 9 + s)), mul(face.shake, 1.5))),
      });

      // ---- the antennae: loose parts ----
      // Each is a whip of fixed length from the crown: it leaves at `lean` radians back from straight up and bends back
      // by `bend` over its length (pricked up: nearly straight; laid back: it droops behind). Along it (m) it reads the
      // body's motion late: it trails the walk's sway, flicks when the Grab lets go, whips forward after the slam.
      const antenna = (s: 1 | -1, long: number, lag: number, seed: number) => {
        const root = world(skin(-s * 0.55, 1.85, -0.08));
        const perk = clamp(face.perk, -1.2, 1.2);
        const sinceThrow = sub(grabEnv.tau, n.grabSeconds.hold);
        const spine = (m: F): P3 => {
          const late = mul(m, lag);
          const whip = add(swing(sub(crushAfter, mul(late, 0.5)), -0.9, 1.3, 0.2), swing(sub(sinceThrow, mul(late, 0.5)), 0.45, 1.5, 0.25));
          const lean = add(add(add(-0.1, mul(perk, -0.3)), mul(alive(sub(time, late), 0.07, seed), 1)), mul(whip, m));
          const bend = add(1.25, mul(perk, -0.6));
          // Position along a curve of constant bend: L / bend times (cos and sin differences), back and up.
          const a = add(lean, mul(bend, m));
          const back = mul(div(sub(cos(lean), cos(a)), bend), long), rise = mul(div(sub(sin(a), sin(lean)), bend), long);
          // Sideways: splayed out, trailing where the body's sway was `late` ago, trembling with the mood.
          const trail = mul(mul(sub(sin(mul(sub(time, late), w)), sin(mul(time, w))), n.sway * 2.2), m);
          const out_ = add(add(add(mul(s, add(mul(m, 0.12 * long), mul(mul(m, m), 0.12 * long))), trail), mul(alive(sub(time, late), 0.3, seed + 1), mul(m, m))), mul(mul(sin(mul(time, TAU * 8 + s)), face.shake), mul(m, 3)));
          return add(root, mul(add(add(mul(body.x, mul(back, -1)), mul(body.y, rise)), mul(body.z, out_)), k));
        };
        return strand({
          name: `antenna${s < 0 ? "L" : "R"}`, spine, stations: 14, girth: (m) => mul(mix(0.22, 0.05, m), k), tips: ["open", { point: 0.1 }], up: body.z,
          paint: (m) => mix(vec3(...I.brick), vec3(...I.brickDark), crisp(sin(mul(m, 38)), 0.55)), detail: { along: 28, around: 8 }, bulge: 1.2,
        });
      };

      const roar = sub(crush.first, 0.3);
      return {
        things: [
          head.thing, ...right.things, ...left.things, plateR.plate, plateL.plate, moustache(1), moustache(-1),
          antenna(1, 5.4, 0.55, 71), antenna(-1, 4.7, 0.7, 81),
        ],
        checks: [
          // Each eye is big enough to read from the game camera (the dandy's are held to 50 and 38 px).
          minScreenSize(right.ball, "game", 50), minScreenSize(left.ball, "game", 42),
          // Every named expression shows in a loop, and any two differ on screen by a quarter of the right eye's width.
          expressionsRead(theScore, { ...right.marks, ...left.marks, jawR: { from: mouthTop, to: plateR.tip }, jawL: { from: mouthTop, to: plateL.tip } },
            { camera: "game", period: n.crushPeriod, apart: tolerance.share(0.25), of: right.width }),
          // The roar is wide: at the end of Claw Crush's wind-up the mandibles' hinges stand at least 40 px apart.
          spansOnScreen("the roar's mouth", { from: plateR.hinge, to: plateL.hinge }, "game", 40, { at: roar }),
          // The claws keep off the face: from the game camera neither eye nor the mouth is behind a claw for more than
          // half a second at a stretch, anywhere in the loop.
          staysInView({ eyeR: right.centre, eyeL: left.centre, mouth: mouthTop }, claws.things, { camera: "game", period: n.crushPeriod, hidden: tolerance.units(0.5) }),
        ],
      };
    },
  };
}

/** The face as built for the bruiser: eyes in the head. */
export const brow = browFace({ stalk: 0 });
/** The same face with its eyes on short thick stalks, for comparison (docs/art_direction/crab_round4/stalk_hybrid.webp). */
export const browStalk = browFace({ stalk: 1.1 });

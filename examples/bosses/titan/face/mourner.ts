// The mourner: the spider crab's face (docs/art_direction/DIRECTION.md, "Round 4: the fiddler's and the spider crab's
// faces"). Temperament: patient, melancholy, eerie and slow. It has stood in this water a long time and is sorry about
// what it is going to do.
//
// What it is, and what every feature is for:
// - two cream eyes that hang. Each stalk leaves a socket on the bare front of the thorny ball, goes out and a little
//   up, and droops in a crook, and the eye hangs from its end like one more of the shrine's lanterns
//   (docs/art_direction/crab_round4/others/stilt_turnaround.webp). That droop is its identity;
// - they swing, slowly, and nothing chooses how: each is a pendulum (src/geom/pendulum.ts) whose period follows from
//   its own length and the world's gravity (about 4.0 and 4.2 s), swung by the body's sway as it walks (the walk's
//   period is 4.2 s, so they are near resonance: a wide swing, most of a second late) and jolted by every action: the
//   snatch, the throw, the slam. The left stalk is longer, so the two drift in and out of step;
// - heavy lids: the upper lid lies at the eye's middle line and droops toward the outside (the sad slant), over a small
//   pupil that looks down at the water. A lid is straw-brown, between the cream and the sea behind it, with a black
//   lash line, so a shut eye is a closed bell and not a dark ball;
// - everything is late and slow. Each eye reads the score a fifth and nearly half a second behind the fight; moods
//   come on over a second and leave over two; a blink takes most of a second; the wince comes after the blow;
// - on the ball itself: two brows over the sockets that lift at the middle (grief) or drop (wrath), a small mouth that
//   turns down, or up a very little; the two rostral horns of a spider crab.
//
// The face is a score (src/geom/expression.ts). Where it looks is part of each expression: at rest the water ahead of
// it; the ship is `rig.shipNow`; the slam's place `rig.crushCentre`; the other boat `rig.boatTwoAt` and how far the slam's
// wave has pushed it; the sockets face `rig.audience`. Every other place is in the crab's own axes, so the face sits and
// looks rightly on a crab that is placed and turned (examples/bosses/crab_lineup.ts). Its triumph also plays through a
// taunt (`rig.dance`), where there is one.
//
// Inherited: the eyeball, sliding pupil and lune lids (the islander's, by way of lib/stalk_eyes.ts); the brows, mouth
// and horns of face/patient.ts; a score over the fight's clocks. Mine: the eye as a pendulum with nothing keyed (its
// swing is the driven oscillator's own answer to the rig's sway and attack clocks), the droop as a pose a stalk
// bends by, stiffness as a channel (wrath holds the eyes out on stiff arms; grief lets them hang).

import {
  abs, add, added, alive, cast, clamp, cross, div, during, expressionsRead, fract, spiralTube, lift, max, minScreenSize, mix, mul, place, rigid, score, show, sin, smoothstep,
  staysInView, strand, sub, through, time, tolerance, unit, vec3,
  type Expression, type F, type P3, type Posed, type Score,
} from "../../../../src/index.ts";
import { bent } from "../../../../src/geom/bend.ts";
import { jolt, pendulum, sway } from "../../../../src/geom/pendulum.ts";
import { tremor } from "../../../../src/geom/restless.ts";
import { lookOf, stalkEye } from "../../lib/stalk_eyes.ts";
import { cut, perFrame, type V3 } from "../ink.ts";
import type { Rig } from "../rig.ts";
import type { FaceOption } from "../slots.ts";

/** How far below its audience (`rig.audience`: the game camera, when the crab is at home) the sockets face when nothing
 * turns them: the sine of about 10 degrees, as the islander's. (Planned 25 degrees lower, so the heavy lid showed
 * first; the theory put the pupil on the eye's rim.) */
export const BELOW = 0.17;
/** How far the socket turns toward what it looks at, and how far the pupil slides (face/dandy.ts). It looks down at the
 * water, nearly square to its socket, so the turn and the slide are short: at 0.25 and 0.5 the pupil sat on the rim
 * from the game camera. */
export const TURN = 0.15, SLIDE = 0.3;
/** The water it watches at rest: ahead of it and down (crab coordinates; the body rides `ride` above the sea). */
export const WATER = [14, -7, 2] as const;

// ---- the channels, and the cast ----

/**
 * What the face is drawn from. Angles are radians.
 * - upper, lower: how far each lid has come over the eye: 0 out of the way, 1 at its middle line; shut when they sum to 2.
 * - slant: the lid line's tip, positive down toward the middle (wrath), negative down at the outside (grief).
 * - pupil: the pupil's radius as a share of the eye's.
 * - flinch: how far it has flinched from a blow on its right. Not the same on both sides (`EyeSpec.flinch`).
 * - reach: the stalks' length, times their own. droop: how far the stalk's end has turned down from the way it left
 *   the socket (2.0 hangs plumb). lift: the whole stalk raised at the socket. splay: apart. aside: both to its right.
 * - stiff: 0 the eyes hang loose and swing; 1 they are held and do not.
 * - smile: the mouth's corners, up (1) or down (-1). brow: the brows' inner ends, up (1, grief) or down (-1, wrath).
 * - ship, disc, boat: how far its look goes from the water to the ship, to the slam's place, or to the second boat
 *   (which the slam's wave carries off).
 * - shake: a slow shudder.
 */
export type Channel = "upper" | "lower" | "slant" | "pupil" | "flinch" | "reach" | "droop" | "lift" | "splay" | "aside" | "stiff" | "smile" | "brow" | "ship" | "disc" | "boat" | "shake";

export const CAST = cast<Channel, "want" | "strain" | "triumph" | "fury" | "wince">(
  // At rest it mourns: lids half down and drooping outward, small pupils on the water, the eyes hanging plumb.
  { upper: 1.0, lower: 0.25, slant: -0.4, pupil: 0.28, flinch: 0, reach: 1, droop: 2.0, lift: 0, splay: 0, aside: 0, stiff: 0, smile: -0.3, brow: 0.6, ship: 0, disc: 0, boat: 0, shake: 0 },
  {
    // It wants the ship, and is sorry: the eyes drawn out toward it on lifted stalks, the lids raised, the brows high.
    want: { upper: 0.6, lower: 0.15, slant: -0.25, pupil: 0.36, reach: 1.12, droop: 1.55, lift: 0.15, aside: -0.4, splay: -0.1, smile: -0.1, brow: 1, ship: 1 },
    // The squeeze: lids shut tight and knotted toward the middle, the stalks drawn in short and curled under, shuddering.
    strain: { upper: 1.08, lower: 1.0, slant: 0.35, pupil: 0.25, reach: 0.72, droop: 2.5, lift: -0.1, splay: 0.2, stiff: 0.6, smile: -0.8, brow: -0.5, ship: 1, shake: 1 },
    // Let go: it raises its eyes to watch the ship fly, with the smallest of smiles; the cheeks rise, the grief stays in
    // the lids (lids at 0.75 each were a wide stare, not a smile; at 0.9 each, shut). The only time its pupils leave the water for the sky.
    triumph: { upper: 0.8, lower: 0.85, slant: -0.5, pupil: 0.32, reach: 1.05, droop: 1.6, lift: 0.25, splay: 0.2, smile: 0.9, brow: 0.9, ship: 1 },
    // Before the slam: the stalks rise and stiffen and hold the eyes out at the disc; lids hard down to the middle.
    fury: { upper: 0.95, lower: 0.3, slant: 0.8, pupil: 0.16, reach: 1.1, droop: 1.0, lift: 0.3, splay: 0.25, aside: 0.2, stiff: 0.85, smile: -1, brow: -1, disc: 1, shake: 0.25 },
    // The blow, a moment after it: one eye shut, the other left half open on the damage; the stalks let go again.
    wince: { flinch: 1, upper: 0.9, lower: 0.5, slant: -0.2, pupil: 0.22, reach: 0.85, droop: 2.3, splay: 0.1, stiff: 0.2, smile: -0.6, brow: 0.3, disc: 1 },
  },
);
export type Mood = keyof typeof CAST.named;

// ---- the two eyes ----

export type EyeSpec = {
  readonly tag: "L" | "R"; readonly side: 1 | -1;
  /** The socket on the ball's front (x from the carapace's front, y as a share of its height, z), the way the stalk
   * leaves it (crab axes: forward, up, to its own side), the stalk's length and its radius at root and tip; the eye's radius. */
  readonly socket: V3; readonly leaves: V3; readonly length: number; readonly girth: readonly [number, number]; readonly radius: number;
  /** What `flinch` adds to this eye's upper and lower lids. The shut eye's lids meet at its middle line: met lower
   * down, the lash line was under the ball and a shut eye was a plain ball from above (face/dandy.ts found the same). */
  readonly flinch: readonly [number, number];
  /** Seconds late it reads the score; seconds into each third of the loop it blinks. */
  readonly lag: number; readonly blinkAt: number;
};
/** How far below the stalk's end the eye's middle hangs, in its own radii. */
export const HANG = 0.85;
// Not twins: the left stalk is longer, so its eye hangs lower and swings slower; it is later in everything. They leave
// the sockets nearly straight ahead: splayed 20 degrees apart the eyes hung 3.5 apart, one of them among the legs and out
// of the face camera's frame.
export const EYES: readonly EyeSpec[] = [
  { tag: "R", side: 1, socket: [-0.38, 0.2, 0.7], leaves: [0.88, 0.42, 0.12], length: 2.9, girth: [0.14, 0.09], radius: 0.62, flinch: [0.12, 0.5], lag: 0.2, blinkAt: 1.4 },
  { tag: "L", side: -1, socket: [-0.42, 0.17, -0.7], leaves: [0.86, 0.4, 0.16], length: 3.35, girth: [0.14, 0.09], radius: 0.58, flinch: [-0.15, -0.1], lag: 0.45, blinkAt: 3.1 },
];
/** The pendulum an eye is: its arm is the drooping half of the stalk and the hang below it; lightly damped. */
export const armOf = (e: EyeSpec): number => 0.5 * e.length + HANG * e.radius;
export const DAMPING = 0.22;
/** The jolts each action gives the sockets, units / s: [across (toward its right), fore]. Signs are the socket's change
 * of velocity; the eyes are left behind and swing the other way first. */
export const JOLTS = { snatch: [0.7, 0], release: [-0.9, 0.6], slam: [0, -1.8] } as const;
/** How far the eyes hang forward of the body at the bottom of a taunt's bow, and across at the end of its sway, radians. */
const BOW = { fore: 0.45, across: 0.35 };
/** A lid's least angles, radians: the upper is never out of sight. */
const LID_MIN = { upper: 0.3, lower: 0.15 };

type Arith<T> = { readonly add: (a: T | number, b: T | number) => T; readonly mul: (a: T | number, b: T | number) => T; readonly clamp: (x: T, lo: number, hi: number) => T };
const JS: Arith<number> = { add: (a, b) => a + b, mul: (a, b) => a * b, clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi) };
const GPU: Arith<F> = { add: (a, b) => add(a, b), mul: (a, b) => mul(a, b), clamp: (x, lo, hi) => clamp(x, lo, hi) };

/** One eye's drawn quantities from the channels: the lids' angles, the slant, the stalk's length, its lean (toward its
 * right, and down) and its droop. One formula for the picture and for the theory (tools/faces_fs_theory.ts). */
function eyeFrom<T>(o: Arith<T>, c: Readonly<Record<Channel, T>>, e: EyeSpec) {
  return {
    upper: o.clamp(o.mul(o.add(c.upper, o.mul(c.flinch, e.flinch[0])), Math.PI / 2), LID_MIN.upper, Math.PI),
    lower: o.clamp(o.mul(o.add(c.lower, o.mul(c.flinch, e.flinch[1])), Math.PI / 2), LID_MIN.lower, Math.PI),
    slant: o.mul(c.slant, e.side),
    length: o.mul(c.reach, e.length),
    lean: [o.add(c.aside, o.mul(c.splay, e.side)), o.mul(c.lift, -1)] as const,
    droop: o.clamp(c.droop, 0.5, 2.7),
  };
}
/** The same in plain numbers: what tools/faces_fs_theory.ts predicts from. */
export const poseOf = (c: Expression<Channel>, e: EyeSpec) => eyeFrom(JS, c, e);

// ---- the score: the cast laid over the fight, late ----

/** Seconds after the thrown ship lands for the look to leave it (the grab's `settle` beat). */
const LOOK_AWAY = 2.5;

export function scoreOf(rig: Rig): Score<Channel, Mood> {
  const { crush, grab, dance } = rig;
  return score(CAST, (t) => {
    const ctau = crush.envelope(t).tau;
    const gb = grab.beats(t, LOOK_AWAY), gtau = grab.envelope(t).tau;
    // Nothing snaps. It notices the ship most of a second into the warning and takes a second and a half to want it.
    const attending = mul(during(add(gtau, grab.warn), { from: 0.6, rise: 1.5 }), sub(1, smoothstep(0.2, 1, gb.settle)));
    // The strain comes on over the first fifth of the hold and does not bite with each squeeze: it endures.
    const straining = mul(smoothstep(0, 0.22, gb.hold), sub(1, smoothstep(0, 0.6, gb.release)));
    const consoled = mul(smoothstep(0.3, 1, gb.release), sub(1, smoothstep(0.1, 1, gb.settle)));
    // Wrath gathers through the whole warning and wind-up, and breaks a moment after the blow.
    const wrathful = mul(during(add(ctau, crush.warn), { from: 0.1, rise: 1.0 }), sub(1, smoothstep(0.1, 0.4, ctau)));
    const wincing = during(ctau, { from: 0.12, rise: 0.3, to: 1.3, fall: 1.6 });
    // Its open eye follows the second boat as the wave carries it off, for a long time.
    const watching = during(ctau, { from: 0.8, rise: 1.0, to: 5.0, fall: 2.0 });
    // The taunt (rig.dance.on is 0 for a crab that has none): the same small solace all through it.
    return [
      show("want", attending), show("strain", straining), show("triumph", max(consoled, dance.on)), show("fury", wrathful), show("wince", wincing),
      added({ boat: 1 }, watching),
    ];
  });
}

// ---- the face ----

export const mourner: FaceOption = {
  about: "a mourner: two heavy-lidded eyes hung from drooping stalks like lanterns, swinging slowly; sad brows, a small mouth, two rostral horns",
  // The face camera stands 2.5 lower for it: its eyes hang below the body, under that frame's bottom edge.
  numbers: { faceRise: -2.5 },
  draw: (rig, _carapace, claws) => {
    const { n, body, local, shipNow, crushAfter, grabEnv, dance } = rig;
    const I = n.ink;
    const theScore = scoreOf(rig);
    const tabF = (name: string, e: F): F => perFrame(`mourner_${name}`, e);
    // The face's mount: the front of the body (crab x = carapace.to), so the face follows the carapace's numbers.
    const F0 = n.carapace.to, H = n.carapace.height;
    const at = (x: number, y: number, z: number): V3 => [F0 + x, y * H, z];
    const inBody = (v: V3): P3 => add(add(mul(body.x, v[0]), mul(body.y, v[1])), mul(body.z, v[2]));
    const water = local(vec3(...WATER));
    const disc = vec3(rig.crushCentre.x, 0, rig.crushCentre.y);
    // The second boat, where the slam's wave has carried it (rig.ts: its stand-in rides `crush.pushed`).
    const carried = rig.crush.pushed(rig.boatTwoAt);
    const otherBoat = perFrame("mourner_otherBoat", vec3(add(rig.boatTwoAt.x, carried.x), 0.6, add(rig.boatTwoAt.y, carried.y)));
    const sinceThrow = sub(grabEnv.tau, n.grabSeconds.hold);

    const eye = (e: EyeSpec, i: number) => {
      const c: Posed<Channel> = theScore.at(sub(time, e.lag)), q = eyeFrom(GPU, c, e);
      const base = local(at(...e.socket));
      // The stalk's frame at the socket: the way it leaves, the level direction to the crab's right, and down.
      const along = unit(inBody([e.leaves[0], e.leaves[1], e.leaves[2] * e.side]));
      const across = unit(cross(along, body.y)), down = cross(along, across);
      // The eye as a pendulum: swung by the walk's sway (rig.ts: the body moves n.sway sin(2 pi t / period) to its
      // right) and jolted by the snatch, the throw and the slam. `stiff` holds it.
      const arm = pendulum({ length: armOf(e), gravity: n.gravity, damping: DAMPING });
      const loose = tabF(`${e.tag}_loose`, sub(1, c.stiff));
      // In a taunt it bows and sways slowly (rig.ts: the body drops by `temper.rise` on each move): slower than the eyes'
      // own swing, so they hang plumb while the body tips, which against the body is a swing forward with the bow and
      // across with the sway. (The accents' instants are not the rig's to give, so this is not a jolt.)
      const swingAcross = add(arm.answer(time, [sway(n.sway, n.period), jolt(grabEnv.tau, JOLTS.snatch[0]), jolt(sinceThrow, JOLTS.release[0])]), mul(dance.swing, BOW.across));
      const swingFore = add(arm.answer(time, [jolt(sinceThrow, JOLTS.release[1]), jolt(crushAfter, JOLTS.slam[1])]), mul(dance.wave, BOW.fore));
      // A slow shudder when the mood says so, and a breath that never stops; each eye its own.
      const shudder = mul(mul(tremor(time, 2.7, 5 + i), 0.08), c.shake);
      const droop = tabF(`${e.tag}_droop`, add(q.droop, alive(time, 0.05, 71 + i, 0.09, n.crushPeriod)));
      // The stalk's end has turned `droop` from the way it left, so a turn across by psi asks droop / sin(droop) of it
      // (the exponential map shortens a sideways step by sin(size) / size).
      const acrossGain = div(droop, max(sin(droop), 0.35));
      const posed = { root: base, along, a: across, b: down, sharp: 2 } as const;
      const stalk = bent({
        ...posed, length: tabF(`${e.tag}_length`, q.length),
        lean: [tabF(`${e.tag}_leanA`, add(q.lean[0], alive(time, 0.03, 81 + i, 0.07, n.crushPeriod))), tabF(`${e.tag}_leanB`, q.lean[1])],
        crook: [
          tabF(`${e.tag}_crookA`, mul(add(mul(swingAcross, loose), shudder), acrossGain)),
          // A swing forward is less droop.
          tabF(`${e.tag}_crookB`, sub(droop, mul(swingFore, loose))),
        ],
      });
      // A slow blink once in each third of the loop, the two eyes out of step; none while it watches something.
      const every = n.crushPeriod / 3;
      const sinceBlink = abs(sub(mul(fract(div(time, every)), every), e.blinkAt));
      const blink = mul(sub(1, smoothstep(0.15, 0.6, sinceBlink)), sub(1, max(c.ship, c.disc)));
      const shut = Math.PI / 2 + 0.08;
      const lookAt = (target: P3) => (middle: P3) => lookOf({ from: middle, audience: rig.audience, below: BELOW, target, up: body.y, turn: TURN, slide: SLIDE });
      const target = mix(mix(mix(water, shipNow, c.ship), disc, c.disc), otherBoat, c.boat);
      return stalkEye({
        tag: e.tag, prefix: "mourner",
        stalk: {
          bent: stalk, girth: e.girth, bulge: 1.3,
          // Bamboo, as its legs: straw with a black node every sixth, a dark collar where it leaves the socket.
          paint: (m) => mix(mix(vec3(...I.straw), vec3(...I.black), sub(1, cut(abs(sub(fract(mul(m, 6)), 0.5)), 0.07))), vec3(...I.thornDark), sub(1, cut(m, 0.12))),
        },
        radius: e.radius, swell: lift<"f32">(1), hang: HANG, up: body.y, look: lookAt(target), pupil: c.pupil,
        ink: { white: I.cream, pupil: I.black, back: I.thornDark, glint: 0.2, ring: 0.05 },
        lids: {
          upper: mix(q.upper, shut, blink), lower: mix(q.lower, shut, blink), slant: q.slant,
          // Straw-brown with a heavy black edge: between the cream and the sea it hangs against, and lighter than the
          // body (in the legs' dark straw alone, two shut eyes tucked under the ball were two more lumps of it).
          ink: (edge) => mix(mix(vec3(...I.strawDark), vec3(...I.straw), 0.55), vec3(...I.black), sub(1, cut(edge, 0.22))),
        },
        // The marks are the expression's own pose: no swing, no shudder, no breath, no blink.
        posed: { bent: bent({ ...posed, length: q.length, lean: q.lean, crook: [0, q.droop] }), look: lookAt(target), upper: q.upper, lower: q.lower },
      });
    };
    const [right, left] = EYES.map(eye) as [ReturnType<typeof eye>, ReturnType<typeof eye>];

    // The brows and the mouth read the score later still.
    const face = theScore.at(sub(time, 0.3));
    const browUp = tabF("brow", face.brow), smile = tabF("smile", face.smile);
    // On the ball's front, a little proud of it. x is from the surface of the ellipsoid the carapace is (thorny.ts).
    const C = n.carapace, mid = (C.from + C.to) / 2, half = (C.to - C.from) / 2;
    const onFront = (y: number, z: number, proud: number): number => mid + half * Math.sqrt(Math.max(1 - (y / C.height) ** 2 - (z / C.width) ** 2, 0)) + proud;
    const front = (y: number, z: number, dy: F | number, proud = 0.04): P3 => vec3(onFront(y, z, proud), add(y, dy), z);
    // Brows over the sockets: the inner ends rise for grief and drop for wrath; the outer ends go the other way a little.
    const brow = (s: 1 | -1) => place(strand({
      name: `brow${s < 0 ? "L" : "R"}`, stations: 6,
      spine: (m) => through(m, [front(0.92, s * 1.25, mul(browUp, -0.08)), front(1.08, s * 0.95, mul(browUp, 0.02)), front(1.12, s * 0.45, mul(browUp, 0.2))]),
      girth: (m) => mul(0.12, sub(1.25, mul(m, 0.5))), tips: ["round", "round"], paint: () => vec3(...I.black), detail: { along: 12, around: 8 },
    }), rigid(body));
    // A small mouth, low on the front: its corners turn down, or up a very little. Straw, not black: a black line was
    // lost in the ball's dark hatching.
    const mouth = place(strand({
      name: "mouth", stations: 6,
      spine: (m) => through(m, [front(-0.62, -0.55, mul(smile, 0.14)), front(-0.5, 0, mul(smile, -0.07)), front(-0.62, 0.55, mul(smile, 0.14))]),
      girth: 0.1, tips: ["round", "round"], paint: () => vec3(...I.straw), detail: { along: 12, around: 8 },
    }), rigid(body));
    // Two rostral horns from between the sockets, forward and up, diverging a little: a spider crab's beak (face/patient.ts).
    const rostrum = (s: 1 | -1) => place(spiralTube({
      name: `rostrum${s < 0 ? "L" : "R"}`, length: 1.9, curl: 0.35, taper: 0.12, girth: 0.13, out: [0.75, 0.62, s * 0.18], toward: [0, 1, 0],
      paint: (m) => mix(vec3(...I.thornDark), vec3(...I.straw), cut(m, 0.45)), detail: { along: 12, around: 8 },
    }), rigid({ o: local(at(-0.12, 0.3, s * 0.16)), x: body.x, y: body.y, z: body.z }));

    return {
      things: [...right.things, ...left.things, brow(1), brow(-1), mouth, rostrum(1), rostrum(-1)],
      checks: [
        // The eyes hang inside the game camera's frame (the shrine does not), so the size a player sees is measured there.
        minScreenSize(right.ball, "game", 42), minScreenSize(left.ball, "game", 37),
        // And from the camera that holds the whole crab, where they are smaller.
        minScreenSize(right.ball, "far", 36),
        expressionsRead(theScore, { ...right.marks, ...left.marks }, { camera: "game", period: n.crushPeriod, apart: tolerance.share(0.25), of: right.width }),
        // Neither eye is behind a claw from the game camera for longer than half a second at a stretch.
        staysInView({ eyeR: right.middle, eyeL: left.middle }, claws.things, { camera: "game", period: n.crushPeriod, hidden: tolerance.units(0.5) }),
      ],
    };
  },
};

// The war mask: the samurai crab's face (docs/art_direction/DIRECTION.md, "Round 4: the samurai's face").
//
// Temperament: a stern, proud warrior. Its expressions are kabuki: few, large, held. Where the other crabs flow, this
// one snaps into a pose in four frames, holds it dead still, and lets it go. Two of its poses are mie proper: the
// glare before the slam, with the nirami (both pupils crossed to the nose), and the chin-up triumph after the throw.
//
// What it is, and what every part is for:
// - a red face on a sphere patch in front of the helmet, tilted up at the high cameras: one closed-form surface with a
//   relief (sockets, nose, cheeks, muzzle) and flat inks. The mouth is on it: thick lips set in a downturned bow, a row
//   of cream teeth, a black gape when the jaw drops (everything under the mouth's line moves down), upper fangs;
// - two eyes, big and nearly flat (a flattened ball each, black-rimmed), with small black pupils and no iris. Flat, so
//   that a pupil in the middle of the white looks at whoever is looking, from any camera, and a pupil slid to the nose
//   is seen to be crossed; the lids are painted on the ball in the face's red with a black lash line;
// - two brow plates of black lacquer standing proud of the face: they tip into a deep V over the eyes, lift apart, or
//   cock one up. They are the largest dark shapes on the red, so they carry the mood furthest;
// - two cream tusks on the lower jaw that drop with it;
// - the whole face nods and turns on its sphere (chin up in triumph, down in the glare): the largest thing that moves.
//
// The face is a score (src/geom/expression.ts) of poses struck on the fight's own clocks (src/geom/struck.ts): it
// wants the ship from the Grab's warning (the eyes slide to `rig.shipNow`, one brow cocks), strains through the hold,
// is triumphant from the let-go, furious through Claw Crush's wind-up, winces at the slam. Every pose is a `struck`
// weight; what flows (a blink, the strain's tremble) is laid before the poses that cover it, so a held pose is the
// cast's own numbers and nothing else (`holdsStill` checks it).
//
// Inherited: the sphere patch mapped from the square to a disc, its rim, the lacquer guards and brim, the jaw that
// drops everything under the mouth's line (this file's first version); expressions as a cast and a score, the marks a
// check compares (face/dandy.ts). New here: the flat eye that looks at every camera, the brow plates as parts, the
// nod and turn of the whole face as channels, tusks, and every expression as a struck pose.

import {
  abs, add, added, cast, clamp, cos, cross, div, dot, draw, expressionsRead, fract, holdsStill, length, lift, max, min, minScreenSize, mix,
  mul, only, score, show, sin, smoothstep, spacing, spansOnScreen, sqrt, staysInView, strand, struck, sub, surface, through, time, tolerance, unit, vec2, vec3,
  type Expression, type F, type P3, type Posed, type Score, type Struck,
} from "../../../../src/index.ts";
import { cut, perFrame, TAU } from "../ink.ts";
import type { Rig } from "../rig.ts";
import type { FaceOption } from "../slots.ts";

// ---- the face's own geometry: numbers, in units along the face from its middle (a across to the crab's right, b up) ----

/** The mask's sphere: its radius, how far it stands in front of the carapace's front end, its tilt up toward the high
 * cameras (radians), its centre's height. */
export const R = 4.2, PROUD = 0.75, TILT = 0.4, CY = 0.1;
/** Half-angles the mask spans: across (wider at the cheeks than the chin) and up/down. */
const ACROSS = 0.8, CHIN = 0.65, UP = 0.42, DOWN = 0.55;
/** An eye: where its middle is (a for the right eye; the left is mirrored), its radius, its half-depth (it is a
 * flattened ball) and how far its middle stands off the sphere. */
export const EYE = { a: 1.1, b: 0.15, r: 0.8, depth: 0.24, out: -0.02 } as const;
/** A brow plate at rest: its inner end, middle and outer end (a, b), how far it stands off the sphere, its half-height
 * at the inner and outer ends, and what the channels do to it (units of b per unit of channel). */
export const BROW = {
  line: [[0.22, 0.5], [1.25, 1.0], [2.4, 0.86]] as const, out: 0.3, girth: [0.42, 0.3] as const,
  vee: [-0.42, 0.05, 0.35] as const, cock: [0.34, -0.14] as const,
} as const;
/** The mouth: its line's height, its half-width, how far the jaw drops, the lips' thickness, how far the lips part to
 * bare the teeth, the corners' drop per unit of `grim`, and what `skew` does (sideways, and to the corner it pulls). */
export const MOUTH = { b: -1.0, half: 1.9, drop: 0.62, lip: 0.22, part: [0, 0.25] as const, grim: 1.0, skew: [0.45, 0.45] as const } as const;
/** How far a pupil slides, as a share of the eye's radius: crossed to the nose, and toward what it looks at. */
const CROSS = 0.45, SLIDE = 0.5;
/** Half-height (units of b) of the band between the teeth rows that stretches into the gape when the jaw drops. */
const GAP = 0.1;

// ---- the channels, and the cast ----

/**
 * What the face is drawn from.
 * - brow: both plates lifted, units; vee: how far they tip into a V (inner ends down, outer up), 1 the full glare;
 *   cock: 1 the right plate (the camera's side) up and the left a little down, -1 the other way.
 * - lidU, lidL: how far each lid has come over the eye: 0 out of the way, 1 at its middle line; wink: how far the
 *   right eye shuts by itself.
 * - pupil: the pupil's radius as a share of the eye's; cross: 1 both pupils at the nose (the nirami); ship: how far the
 *   look has gone from the audience to the ship.
 * - jaw: 0 shut to 1 dropped; bare: how far the lips part over the teeth; grim: how far the corners turn down; skew:
 *   1 the mouth pulled to the crab's right.
 * - nod: radians the whole mask tips up (chin up). The face turns inside the helmet (its features slide across the
 *   sphere while the rim, the brim and the cheek guards stay): turn is radians to the crab's right, and play is the
 *   share of the way round to its audience (`rig.audience`) it turns besides, wherever that is.
 */
export type Channel = "brow" | "vee" | "cock" | "lidU" | "lidL" | "wink" | "pupil" | "cross" | "ship" | "jaw" | "bare" | "grim" | "skew" | "nod" | "turn" | "play";

export const CAST = cast<Channel, "wanting" | "straining" | "triumphant" | "furious" | "wincing">(
  // Stern: brows low in a shallow V, lids a third down, the pupils square on you, the teeth just showing in a grimace.
  { brow: 0, vee: 0, cock: 0, lidU: 0.5, lidL: 0.2, wink: 0, pupil: 0.3, cross: 0, ship: 0, jaw: 0, bare: 0.35, grim: 0.5, skew: 0, nod: 0, turn: 0, play: 0.2 },
  {
    // It wants the ship: the face turns a little to it, the eyes slide all the way, the near brow cocks, the jaw loosens.
    wanting: { cock: 1.3, vee: -0.2, lidU: 0.08, lidL: 0, pupil: 0.32, ship: 1, jaw: 0.25, bare: 0.7, grim: 0.2, nod: -0.03, turn: -0.06, play: 0 },
    // The squeeze: eyes screwed to slits under brows crushed down, every tooth bared, chin tucked.
    straining: { brow: -0.28, vee: 0.3, lidU: 0.85, lidL: 0.8, pupil: 0.22, jaw: 0.06, bare: 1, grim: 0.85, nod: -0.09, play: 0.06 },
    // Let go (a mie): the face snaps round to the audience, chin up, brows high and still angled, eyes wide, the lips
    // sealed in a proud bow, the lids level: it looks down at you. (Brows flung apart over pin pupils in round whites read
    // as fright, not pride.)
    triumphant: { brow: 0.45, vee: 0.15, cock: 0.2, lidU: 0.3, lidL: 0.35, pupil: 0.28, bare: 0, grim: 0.9, nod: 0.16, play: 0.5 },
    // Before the slam (a mie, with the nirami): brows in a deep V, eyes wide and crossed, the jaw dropped in a roar.
    furious: { brow: -0.05, vee: 0.9, lidU: 0.05, lidL: 0, pupil: 0.22, cross: 1, jaw: 1, bare: 1, grim: 0.7, nod: -0.07, play: 0.5 },
    // The impact: the near eye shut and its brow jammed down, the mouth dragged to that side, the head jolted back.
    wincing: { brow: -0.1, vee: 0.25, cock: -1.3, lidU: 0.55, lidL: 0.5, wink: 1, pupil: 0.24, jaw: 0.1, bare: 0.9, grim: 0.3, skew: 1, nod: 0.07, play: 0 },
  },
);
export type Mood = keyof typeof CAST.named;

type Arith<T> = {
  readonly add: (a: T | number, b: T | number) => T; readonly sub: (a: T | number, b: T | number) => T; readonly mul: (a: T | number, b: T | number) => T;
  readonly clamp: (x: T, lo: number, hi: number) => T;
};
const JS: Arith<number> = { add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi) };
const GPU: Arith<F> = { add: (a, b) => add(a, b), sub: (a, b) => sub(a, b), mul: (a, b) => mul(a, b), clamp: (x, lo, hi) => clamp(x, lo, hi) };

/** The mouth's line at s (-1 the left corner, 1 the right): its height, and how far the lips stand apart there. One
 * formula for the paint, the relief, the marks and the theory. */
function mouthAt<T>(o: Arith<T>, c: Readonly<Record<Channel, T>>, s: T, taper: T) {
  const pulled = o.mul(o.mul(c.skew, MOUTH.skew[1]), o.clamp(s, 0, 1));
  return {
    line: o.add(o.sub(MOUTH.b, o.mul(o.mul(c.grim, MOUTH.grim), o.mul(s, s))), pulled),
    open: o.mul(o.mul(o.add(MOUTH.part[0], o.mul(c.bare, MOUTH.part[1])), taper), o.add(1, o.mul(o.mul(c.skew, 0.8), s))),
  };
}

/** What is drawn, from the channels: one formula for the picture and for the theory (tools/mask_theory.ts): `T` is a
 * number there and an expression here. `side` 1 is the crab's right eye and brow, -1 its left. */
export function featuresOf<T>(o: Arith<T>, c: Readonly<Record<Channel, T>>) {
  const one = (side: 1 | -1) => {
    const lift_ = o.add(c.brow, o.mul(c.cock, side > 0 ? BROW.cock[0] : BROW.cock[1]));
    const shut = side > 0 ? c.wink : o.mul(c.wink, 0.25);
    const cU = o.clamp(o.add(c.lidU, shut), 0, 1), cL = o.clamp(o.add(c.lidL, shut), 0, 1);
    return {
      /** The plate's inner end, middle and outer end, (a, b). */
      brow: BROW.line.map(([a, b], i) => [o.mul(o.sub(a, o.mul(c.vee, i === 0 ? 0.1 : 0)), side), o.add(o.add(b, lift_), o.mul(c.vee, BROW.vee[i]!))] as const),
      /** The lids' edges at the eye's middle, as shares of its radius up from its centre; and their tip toward the nose. */
      upper: o.sub(1, cU), lower: o.sub(cL, 1), slant: o.mul(o.add(0.3, o.mul(c.vee, 0.3)), side),
      /** The pupil's middle before it looks at anything, shares of the eye's radius (across to the crab's right, up). */
      // Crossed, they go to the nose and down: the brows' V covers the upper inner quarter of each eye, where pupils
      // crossed level were hidden.
      pupil: [o.mul(o.mul(c.cross, CROSS), -side), o.sub(0.1, o.mul(c.cross, 0.5))] as const,
    };
  };
  return {
    pitch: o.add(TILT, c.nod), turn: c.turn, play: c.play, right: one(1), left: one(-1), pupil: c.pupil, ship: c.ship,
    mouth: { centre: o.mul(c.skew, MOUTH.skew[0]), drop: o.mul(o.clamp(c.jaw, 0, 1.2), MOUTH.drop), at: (s: T, taper: T) => mouthAt(o, c, s, taper) },
  };
}
/** The same in plain numbers: what tools/mask_theory.ts predicts from. */
export const featuresIn = (c: Expression<Channel>) => featuresOf(JS, c);

// ---- the score: every expression a pose struck on the fight's clocks ----

/** Seconds from a cue to its pose: four frames at 30 a second. A flinch is faster. */
export const SNAP = 0.13, FLINCH = 0.08;
/** Seconds before the slam that the glare is struck: when the rising crusher has cleared the face from the game camera. */
export const GLARE = 1.0;
/** The longest a claw may stand between the game camera and an eye or the mouth, seconds. */
const CLAW_ACROSS = 0.3;

export function scoreOf(rig: Rig): { readonly score: Score<Channel, Mood>; readonly poses: Readonly<Record<Mood, Struck>> } {
  const { n, crush, grab } = rig;
  const hold = n.grabSeconds.hold;
  const posesAt = (t: F): Record<Mood, Struck> => {
    // Each attack's own clock: seconds from its arming (the grip closing, the slam landing).
    const g = grab.envelope(t).tau, c = crush.envelope(t).tau;
    return {
      // From a fifth of a second after the Grab's warning shows, until the claw has it.
      wanting: struck(g, { from: -n.grabWarn + 0.2, snap: SNAP, hold: n.grabWarn - 0.2 - SNAP - 0.1, release: 0.3 }),
      // As the grip lands, through the carry and the whip.
      straining: struck(g, { from: -0.1, snap: 0.1, hold: hold + 0.2, release: 0.3 }),
      // The mie at the let-go: held while the ship is in the air, then let go slowly.
      triumphant: struck(g, { from: hold, snap: SNAP, hold: 1.8, release: 0.6 }),
      // The mie at the top of Claw Crush's wind-up, held until the claw lands. Not from the warning: on its way up the
      // crusher crosses the face from the game camera until about a second before the slam, and a mie struck behind
      // it was half over before it was seen. So the claw rises first, then the face strikes: one thing at a time.
      furious: struck(c, { from: -GLARE, snap: SNAP, hold: GLARE - SNAP - 0.03, release: 0.2 }),
      // The slam.
      wincing: struck(c, { from: -0.03, snap: FLINCH, hold: 0.55, release: 0.7 }),
    };
  };
  const theScore = score(CAST, (t) => {
    const p = posesAt(t);
    // What flows, laid first so a held pose covers it. A blink three times a cycle, two frames shut.
    const every = n.crushPeriod / 3;
    const blink = sub(1, smoothstep(0.05, 0.08, abs(sub(mul(fract(div(t, every)), every), 1.7))));
    // The strain trembles, harder with each squeeze (0 to 1 at its tightest).
    const squeeze = clamp(div(sub(1, grab.crush(t)), n.grabSqueeze), 0, 1);
    const tremble = mul(mul(p.straining.still, mix(0.35, 1, squeeze)), sub(1, max(p.triumphant.weight, 0)));
    return [
      added({ lidU: 0.7, lidL: 0.9 }, blink),
      show("wanting", p.wanting.weight), show("straining", p.straining.weight),
      added({ brow: mul(sin(mul(t, TAU * 11)), 0.05), nod: mul(sin(mul(t, TAU * 9)), 0.012), jaw: mul(sin(mul(t, TAU * 13)), 0.04) }, tremble),
      show("triumphant", p.triumphant.weight), show("furious", p.furious.weight), show("wincing", p.wincing.weight),
      // The taunt (rig.dance; nothing for a crab that has none): on each of its accents the body strikes a pose and
      // holds it, and the face is its mie: the triumph, with the eyes crossed. The weight is the dance's own move (not
      // a function of this score's clock: the face reads its score on the scene's clock only), so the face lands on
      // the frame the gauntlet does and holds exactly as long.
      show("triumphant", rig.dance.wave), only("furious", ["cross"], rig.dance.wave),
    ];
  });
  return { score: theScore, poses: posesAt(time) };
}

// ---- paint helpers ----

/** A smooth bump: 1 at distance 0, 0 from distance 1. */
const bump = (d: F): F => sub(1, smoothstep(0, 1, d));
/** An ink line of half-width w along the zero set of d. */
const line = (d: F, w: number | F): F => sub(1, cut(abs(d), w));
/** 1 where d < 0, with a crisp edge. */
const inside = (d: F): F => sub(1, cut(d, 0));
/** Elliptic distance from (cx, cy) with radii (rx, ry): 1 on the ellipse. */
const ell = (x: F, y: F, cx: number, cy: number, rx: number, ry: number): F => length(vec2(mul(sub(x, cx), 1 / rx), mul(sub(y, cy), 1 / ry)));

export const mask: FaceOption = {
  about: "a kabuki war mask: lacquer brow plates, flat black-rimmed eyes that cross, a fanged mouth; poses struck and held",
  draw: (rig, _carapace, claws) => {
    const { n, body, local, shipNow } = rig;
    const I = n.ink, C = n.carapace;
    const { score: theScore, poses } = scoreOf(rig);
    const tabF = (name: string, e: F): F => perFrame(`titan_mask_${name}`, e);
    const tabV = (name: string, e: P3): P3 => perFrame(`titan_mask_${name}`, e);
    // One clock for the whole face: in a mie every part lands on the same beat (no eye reads the score late).
    const now = theScore.at(time);
    const c = Object.fromEntries(CAST.channels.map((ch) => [ch, tabF(`ch_${ch}`, now[ch])])) as Posed<Channel>;
    const f = featuresOf(GPU, c);

    // ---- the face's frame: its sphere's centre, and its own out, up and right after the tilt, the nod and the turn ----
    const O = local([C.to + PROUD - R, CY, 0]);
    const cp = cos(f.pitch), sp = sin(f.pitch);
    const N = tabV("out", add(mul(body.x, cp), mul(body.y, sp))), U = tabV("up", sub(mul(body.y, cp), mul(body.x, sp))), Z = body.z;
    // How far the features have slid to the crab's right, in units along the face: the turn, and `play` of the way round
    // to the audience, wherever the rig says that is (the game camera for a crab at home, 29 degrees round; a staged
    // crab's is its scene's).
    const toAudience = unit(sub(rig.audience, add(O, mul(N, R))));
    const slid = tabF("slid", mul(add(f.turn, mul(f.play, dot(toAudience, Z))), R));
    /** The unit direction from the sphere's centre to the face at angles (th across, ph up). */
    const dirAt = (th_: F | number, ph_: F | number): P3 => {
      const th = lift<"f32">(th_), ph = lift<"f32">(ph_);
      return add(add(mul(N, mul(cos(ph), cos(th))), mul(U, sin(ph))), mul(Z, mul(cos(ph), sin(th))));
    };
    /** A point `out` off the sphere at (a, b), units along the face. */
    const at = (a: F | number, b: F | number, out: number): P3 => add(O, mul(dirAt(div(lift<"f32">(a), R), div(lift<"f32">(b), R)), R + out));
    const drop = tabF("drop", f.mouth.drop);

    /** Square (p up, q across, both 0..1) to disc (X across, Y up), then to units along the face. */
    const where = (p: F, q: F) => {
      const u = sub(mul(q, 2), 1), v = sub(mul(p, 2), 1);
      const X = mul(u, sqrt(sub(1, mul(mul(v, v), 0.5)))), Y = mul(v, sqrt(sub(1, mul(mul(u, u), 0.5))));
      const th = mul(X, mix(CHIN, ACROSS, smoothstep(-0.9, 0.0, Y))), ph = mul(Y, mix(DOWN, UP, smoothstep(-0.1, 0.1, Y)));
      // (a, b) are the features' own coordinates: they slide with the turn. (X, Y) are the mask's: its rim and lacquer stay.
      return { X, Y, th, ph, a: sub(mul(th, R), slid), b: mul(ph, R) };
    };
    /** The mouth at a point of the face: s along it, its line's height below the point, the lips' gap there. */
    const mouth = (a: F, b: F) => {
      const s = div(sub(a, f.mouth.centre), MOUTH.half), s2 = mul(s, s);
      const taper = max(sub(1, mul(s2, s2)), 0);
      const m = f.mouth.at(s, taper);
      return { s, taper, dy: sub(b, m.line), open: m.open };
    };

    /** The relief: height above the sphere, world units. Geometry: smooth edges only (`cut` is paint's). */
    const relief = (w: ReturnType<typeof where>): F => {
      const { a, b, X, Y } = w, ax = abs(a), rho = length(vec2(X, Y)), m = mouth(a, b);
      const rim = sub(mul(smoothstep(0.84, 0.94, rho), 0.16), mul(smoothstep(0.95, 1.0, rho), 0.4));
      const socket = mul(bump(ell(ax, b, EYE.a, EYE.b, EYE.r * 1.5, EYE.r * 1.45)), 0.3);
      const nose = add(mul(bump(ell(a, b, 0, -0.42, 0.5, 0.62)), 0.36), mul(bump(ell(ax, b, 0.4, -0.66, 0.36, 0.3)), 0.24));
      const cheek = mul(bump(ell(ax, b, 2.25, -0.75, 0.95, 0.8)), 0.3);
      const muzzle = mul(bump(ell(a, b, 0, MOUTH.b, 2.7, 1.05)), 0.24);
      const lips = mul(bump(div(abs(m.dy), add(m.open, MOUTH.lip * 1.4))), mul(m.taper, 0.16));
      const gape = mul(smoothstep(0.04, -0.04, sub(abs(m.dy), m.open)), 0.2);
      const guard = mul(mul(smoothstep(0.8, 0.92, abs(X)), smoothstep(0.25, -0.15, Y)), 0.18);
      return sub(add(add(add(add(add(rim, nose), cheek), muzzle), lips), guard), add(socket, gape));
    };
    const point = (p: F, q: F): P3 => {
      const w = where(p, q), m = mouth(w.a, w.b);
      // The jaw: everything below the mouth's line drops, the band between the teeth rows stretching into the gape.
      // A straight ramp across the band, not a smooth step: the grid draws a ramp exactly, and with a curved one the
      // teeth's edges in the gape followed the grid's rows in a sawtooth.
      const down = mul(mul(drop, clamp(div(sub(GAP, m.dy), 2 * GAP), 0, 1)), sub(1, smoothstep(0.9, 1.3, abs(m.s))));
      return sub(add(O, mul(dirAt(w.th, w.ph), add(R, relief(w)))), mul(U, down));
    };

    const RED = vec3(...I.brick), DARK = vec3(...I.brickDark), BLACK = vec3(...I.black), CREAM = vec3(...I.cream), LAC = vec3(...I.lacquer);
    const paint = (p: F, q: F): P3 => {
      const w = where(p, q), { a, b, X, Y } = w, ax = abs(a), rho = length(vec2(X, Y)), m = mouth(a, b);
      // Under each eye a black surround (the eye's liner), and kumadori: dark strokes swept up and out from the eyes'
      // outer corners and down the cheeks, two furrows over the nose.
      const liner = inside(sub(ell(ax, b, EYE.a, EYE.b, EYE.r * 1.12, EYE.r * 1.12), 1));
      const sweep = mul(line(sub(b, add(0.3, mul(sub(ax, 2.0), 0.75))), 0.07), mul(smoothstep(2.05, 2.2, ax), smoothstep(3.0, 2.7, ax)));
      const cheekLine = mul(line(sub(ell(ax, b, 2.25, -0.85, 1.0, 0.8), 1), 0.05), mul(cut(b, -0.75), smoothstep(2.9, 2.5, ax)));
      const furrow = mul(line(sub(ax, add(0.13, mul(sub(b, 0.5), 0.2))), 0.035), mul(smoothstep(0.75, 0.9, b), smoothstep(1.4, 1.25, b)));
      const kumadori = max(max(sweep, cheekLine), furrow);
      // The nose: its wings' outline and two nostrils; the folds from the wings to the mouth's corners.
      const wings = mul(line(sub(ell(ax, b, 0.4, -0.66, 0.4, 0.32), 1), 0.05), sub(1, cut(b, -0.6)));
      const nostril = inside(sub(ell(ax, b, 0.3, -0.72, 0.15, 0.08), 1));
      const fold = mul(line(sub(ax, add(0.7, mul(sub(-0.6, b), 1.7))), 0.03), mul(smoothstep(-0.55, -0.65, b), smoothstep(MOUTH.b - 0.1, MOUTH.b + 0.15, b)));
      const creases = max(max(wings, nostril), fold);

      // The mouth. Between the lips: teeth, cream with black gaps, and between the two rows a band that is a hairline
      // when the jaw is shut and stretches into the black gape when it drops; in the gape the upper teeth hang from the
      // top and the lower stand at the bottom, the upper fangs longest.
      const lipsApart = inside(sub(abs(m.dy), m.open));
      const band = inside(sub(abs(m.dy), GAP));
      const within = smoothstep(0.99, 0.93, abs(m.s));
      const tooth = line(sub(fract(add(mul(m.s, 5.5), 0.5)), 0.5), 0.045);
      const g = div(m.dy, GAP); // 1 at the gape's top, -1 at its bottom
      const fang = bump(div(abs(sub(abs(m.s), 0.6)), 0.14));
      const share = div(2 * 0.17, add(drop, 2 * GAP * 0.55)); // a tooth's length as a share of the gape; shut, the rows meet
      const upperRow = cut(g, sub(1, mul(share, add(1, mul(fang, 1.8))))), lowerRow = sub(1, cut(g, add(-1, share)));
      const inGape = mix(BLACK, mix(CREAM, BLACK, tooth), max(upperRow, lowerRow));
      const mouthInk = mix(mix(CREAM, BLACK, tooth), inGape, band);
      // Sealed lips are one heavy bowed line; parted, an outline round the teeth.
      const lipEdge = max(line(sub(abs(m.dy), m.open), mix(0.065, 0.03, clamp(mul(c.bare, 4), 0, 1))), mul(line(sub(abs(m.dy), add(m.open, MOUTH.lip)), 0.025), cut(m.taper, 0.02)));
      const chinLine = mul(line(sub(m.dy, -0.62), 0.03), smoothstep(0.75, 0.5, abs(m.s)));

      // Lacquer: the cheek guards below and outside the cheeks, and the brim above; a cream edge line on each.
      const guardD = sub(0.87, add(abs(X), mul(min(Y, 0), -0.15)));
      const guard = mul(inside(guardD), smoothstep(0.35, 0.25, Y));
      const brimD = sub(0.86, add(Y, mul(mul(X, X), -0.25)));
      const lacquer = max(guard, inside(brimD));
      const lacquerEdge = max(mul(line(guardD, 0.012), smoothstep(0.35, 0.25, Y)), line(brimD, 0.012));

      let ink = mix(RED, DARK, kumadori);
      ink = mix(ink, BLACK, max(creases, chinLine));
      ink = mix(ink, BLACK, liner);
      ink = mix(ink, BLACK, mul(lipEdge, within));
      ink = mix(ink, mouthInk, mul(lipsApart, within));
      ink = mix(ink, LAC, lacquer);
      ink = mix(ink, CREAM, lacquerEdge);
      return mix(ink, BLACK, line(sub(rho, 0.955), 0.012));
    };
    const face = draw.surface("mask", surface(point, { u: ["free", "free"], v: "free" }), { paint, grid: { u: spacing.even(96), v: spacing.even(96) }, sides: "one", outline: "border" });

    // ---- the eyes: flattened balls in the sockets, the lids and the pupil painted on them ----
    const eye = (side: 1 | -1) => {
      const tag = side > 0 ? "R" : "L", e = side > 0 ? f.right : f.left;
      const front = tabV(`eye${tag}_front`, dirAt(div(add(slid, side * EYE.a), R), EYE.b / R));
      const centre = tabV(`eye${tag}_at`, add(O, mul(front, R + EYE.out)));
      // The eye's own across (to the crab's right) and up.
      const across = unit(cross(front, U)), up = cross(across, front);
      // Where it looks: at the audience (the middle of the white), slid toward the ship by `ship`, crossed by `cross`.
      const look = unit(sub(shipNow, centre));
      const reach = 1 - 0.14; // the pupil's edge stays this share of the radius inside the rim
      const gx = tabF(`eye${tag}_gx`, clamp(add(e.pupil[0], mul(mul(dot(look, across), SLIDE), f.ship)), sub(f.pupil, reach), sub(reach, f.pupil)));
      const gy = tabF(`eye${tag}_gy`, clamp(add(e.pupil[1], mul(mul(dot(look, up), SLIDE), f.ship)), sub(f.pupil, reach), sub(reach, f.pupil)));
      const upper = tabF(`eye${tag}_upper`, e.upper), lower = tabF(`eye${tag}_lower`, e.lower), slant = tabF(`eye${tag}_slant`, e.slant);
      const ball = strand({
        name: `eye${tag}`, spine: (m) => add(centre, mul(front, mul(sub(m, 0.5), EYE.depth * 2))), stations: 4, girth: EYE.r,
        tips: [{ round: 0.5 }, { round: 0.5 }], up: U, detail: { along: 14, around: 28 },
        paint: (m, v) => {
          // The front cap's own coordinates: x across (to the crab's right), y up, each -1 to 1.
          const z = sub(mul(m, 2), 1), r = sqrt(max(sub(1, mul(z, z)), 0));
          const x = mul(r, cos(mul(v, TAU))), y = mul(r, sin(mul(v, TAU)));
          // The lids' edges: arcs that flatten as they close, tipped down toward the nose by the slant.
          const arch = sub(1, mul(mul(x, x), 0.4)), tip = mul(x, slant);
          const yU = add(mul(upper, arch), tip), yL = add(mul(lower, arch), mul(tip, sub(1, abs(lower))));
          const open = mul(cut(yU, y), cut(y, yL));
          const lash = max(line(sub(y, yU), 0.09), line(sub(y, yL), 0.05));
          const pupil = cut(f.pupil, length(vec2(sub(x, gx), sub(y, gy))));
          const white = mix(CREAM, BLACK, pupil);
          // A lid is the face's own red (a shut eye in a face is a line, not a ball), the upper one in shadow.
          const lid = mix(RED, DARK, cut(y, yU));
          const front_ = mix(mix(lid, white, open), BLACK, max(lash, cut(r, 0.88)));
          // Black behind: the rim's own thickness, so from the side the eye is a dark-edged disc.
          return mix(BLACK, front_, cut(m, 0.5));
        },
      });
      const on = (x: F | number, y: F | number): P3 => add(centre, mul(add(mul(across, x), mul(up, y)), EYE.r));
      return {
        ball, centre, width: { from: on(-1, 0), to: on(1, 0) },
        marks: {
          [`pupil${tag}`]: { from: centre, to: on(gx, gy) },
          [`upper${tag}`]: { from: centre, to: on(0, upper) },
          [`lower${tag}`]: { from: centre, to: on(0, lower) },
        },
      };
    };
    const right = eye(1), left = eye(-1);

    // ---- the brow plates: lacquer bars standing proud of the face, from by the nose out to the temple ----
    const brow = (side: 1 | -1) => {
      const tag = side > 0 ? "R" : "L", e = side > 0 ? f.right : f.left;
      const [inner, mid, outer] = e.brow.map(([a, b], i) => tabV(`brow${tag}_${i}`, at(add(a, slid), b, BROW.out))) as [P3, P3, P3];
      const plate = strand({
        name: `brow${tag}`, spine: (m) => through(m, [inner, mid, outer]), stations: 8, girth: (m) => mix(BROW.girth[0], BROW.girth[1], m),
        section: { aspect: 0.75, squareness: 3 }, tips: [{ round: 0.1 }, { point: 0.28 }], up: N, detail: { along: 22, around: 12 },
        // Black lacquer with red edges above and below (the helmet's own trim): on the red face, a dark bar.
        paint: (_m, v) => mix(LAC, RED, cut(abs(cos(mul(v, TAU))), 0.8)),
      });
      const eyeAt = side > 0 ? right.centre : left.centre;
      return { plate, ends: { from: inner, to: outer }, marks: { [`browIn${tag}`]: { from: eyeAt, to: inner }, [`browOut${tag}`]: { from: eyeAt, to: outer } } };
    };
    const browR = brow(1), browL = brow(-1);

    // ---- the tusks: two cream fangs on the lower jaw, at the mouth's corners; they drop with it ----
    const tusk = (side: 1 | -1) => {
      const tag = side > 0 ? "R" : "L";
      // It stands on the lower lip three quarters of the way to the corner, wherever the mouth's line is there.
      const lineThere = f.mouth.at(lift<"f32">(side * 0.76), lift<"f32">(0.67)).line;
      const foot = tabV(`tusk${tag}_foot`, sub(at(add(add(f.mouth.centre, slid), side * 1.42), sub(lineThere, 0.3), 0.3), mul(U, drop)));
      const tipAt = tabV(`tusk${tag}_tip`, sub(at(add(add(f.mouth.centre, slid), side * 1.6), add(lineThere, 0.52), 0.62), mul(U, drop)));
      return strand({
        name: `tusk${tag}`, spine: (m) => mix(foot, tipAt, m), stations: 4, girth: (m) => mix(0.2, 0.12, m), tips: [{ round: 0.1 }, { point: 0.5 }],
        up: N, detail: { along: 8, around: 8 }, paint: () => CREAM,
      });
    };

    // The mouth's marks: from the upper lip's middle to the lower lip's (the gape), and to each corner.
    const zero = lift<"f32">(0), one = lift<"f32">(1);
    const mid = f.mouth.at(zero, one), cornerR = f.mouth.at(one, zero), cornerL = f.mouth.at(lift<"f32">(-1), zero);
    // Plain expressions, not per-frame tables: only the checks read them, and a table nothing draws from is not laid out.
    const lipTop = at(add(f.mouth.centre, slid), add(mid.line, mid.open), 0.3);
    const lipBottom = sub(at(add(f.mouth.centre, slid), sub(mid.line, mid.open), 0.3), mul(U, drop));
    const cornerAt = (s: 1 | -1, m: typeof mid) => at(add(add(f.mouth.centre, slid), s * MOUTH.half), m.line, 0.2);
    const gape = { from: lipTop, to: lipBottom };
    const marks = {
      ...right.marks, ...left.marks, ...browR.marks, ...browL.marks,
      gape, cornerR: { from: lipTop, to: cornerAt(1, cornerR) }, cornerL: { from: lipTop, to: cornerAt(-1, cornerL) },
      // The whole face's nod and turn: from its sphere's centre to the bridge of its nose.
      face: { from: O, to: at(slid, 0, 0) },
    };

    return {
      things: [face, right.ball, left.ball, browR.plate, browL.plate, tusk(1), tusk(-1)],
      checks: [
        // Each eye is large enough to carry a pupil that is seen to cross (a ball this size measures 54 px; the drawn
        // disc is turned 45 degrees from the game camera and is about 40 px across).
        minScreenSize(right.ball, "game", 48), minScreenSize(left.ball, "game", 48),
        // A brow plate is a visible bar: at least 55 px from end to end.
        spansOnScreen("the right brow plate", browR.ends, "game", 55, { at: 0 }),
        // The roar is a visible shape: lip to lip at least 16 px, measured in the glare's hold.
        spansOnScreen("the roar's gape", gape, "game", 16, { at: n.crushFirst - 0.5 }),
        // Every named expression shows in a cycle, and any two differ on screen by a quarter of the right eye's width.
        expressionsRead(theScore, marks, { camera: "game", period: n.crushPeriod, apart: tolerance.share(0.25), of: right.width }),
        // The poses that are held are held dead still: through each hold every channel is the cast's own number (to a
        // thousandth of its spread across the cast: f32). The strain trembles by design and is not in the list.
        // The claws keep off the face: from the game camera neither eye nor the mouth is behind a claw for more than
        // CLAW_ACROSS seconds at a stretch (the crusher crosses on its way up; the glare is struck once it has passed).
        staysInView({ eyeR: right.centre, eyeL: left.centre, mouth: lipTop }, claws.things, { camera: "game", period: n.crushPeriod, hidden: tolerance.units(CLAW_ACROSS) }),
        holdsStill(theScore, { wanting: poses.wanting, triumphant: poses.triumphant, furious: poses.furious, wincing: poses.wincing }, { period: n.crushPeriod, within: tolerance.share(1e-3) }),
      ],
    };
  },
};

// The fiddler's claws: one great claw as long as the body, held up like a banner, and a tiny cutter on a long arm.
//
// The great claw (right) is one strand from the wrist to the tip of the fixed finger (the pollex is the hand's own
// lower edge, not a separate finger: a fiddler's propodus runs on into it), and one moving finger (the dactyl) hinged
// on its upper edge that curls down onto it. The hand is flat: its broad faces stand facing out and forward at rest,
// so the banner shows its face to the cameras, and it lands face down, a slap that covers the disc.
//
// Claw Crush in three poses, each a direction for the hand (it turns about the wrist, so the tip travels on arcs):
// - display (rest): raised, leaning a little back, waved slowly twice a loop and drawn up higher on the wave;
// - cocked (the wind-up, on the attack's posture p): thrown back over its shoulder, the hand open wide;
// - landed (the strike, on the attack's progress q): laid along the lane, pitched just down, shut, stretched long in
//   flight (back to its length at contact) and squashed on contact (`impact`), which the body's thud answers.
//
// DERIVATION (out/variants/fiddler_work/theory.ts; scored in the commit that lands this):
// - Size: g = `crusher`; the hand is 3.6 g long and 0.8 g at its widest. At g = 2.4 it is 8.6 long, the body's
//   length plus a third; from the game camera (1280 x 800) about 325 px long raised, 320 px landed, and its tip
//   travels about 810 px from cocked to landed (the base crusher's palm tip: about 420 px).
// - The disc: `landsInside` measures the whole hand (the pollex is in the strand), squashed by `IMPACT` at contact.
//   Laid flat and centred, at most 2% outside needs a radius of about 4.3 at g = 2.4 (4.8 unsquashed); the base disc,
//   3.4, holds g = 1.8 at most. `crushLead` is the footprint's centroid from the wrist, computed below from the same
//   profile the strand draws, so the hand lands centred whatever g.
// - The cutter is the base pincer (claws/base.ts, `cutterOf`): its grip is proven. It cannot be short: measured with
//   `loft check`, the grip's middle at the closing instant drifts off as the fingers shorten against the fixed beam
//   (cutter 0.8: 0.058 off, 0.7: 0.095, 0.6: 0.224, 0.5: 0.302; the limit is 0.119). Longer arms made it worse (0.7 with
//   arms x1.2: 0.192), so the arm's span, my first explanation, is not it. What helps is a slimmer claw: its hinges sit
//   closer, so shorter fingers straddle the beam (0.75 at clawFat 0.6: 0.059 off; 0.7 at 0.55: 0.103; 0.65 at 0.5 fails
//   in the hold). So the small claw is small by being slender: `clawFat` here reaches only the cutter (the great claw
//   has its own dimensions).

import {
  abs, add, alive, animate, cos, cross, div, spiralTube, impact, keys, lift, chain, max, mix, mul, normalize, part, place, pow, rigid, sin, smoothstep, strand, sub, time,
  unit, vec3, type F, type Frame, type P3,
} from "../../../../src/index.ts";
import { cut, perFrame, TAU } from "../ink.ts";
import type { Numbers } from "../numbers.ts";
import type { ClawsOffer, ClawsOption } from "../slots.ts";
import { cutterGripper, cutterOf } from "./base.ts";

/** The hand's length and widest half-width per unit of `crusher`. */
const LEN = 3.6, FAT = 0.95;
/** Half-width along the hand (times FAT g): a fat oval palm, then the pollex narrowing to its point. */
const GIRTH: readonly (readonly [number, number])[] = [[0, 0.55], [0.12, 0.85], [0.3, 1.0], [0.45, 0.95], [0.56, 0.7], [0.66, 0.42], [0.85, 0.28], [1, 0.1]];
/** Where the spine sits across the hand (times FAT g, toward the dactyl's side): the pollex is the hand's lower edge,
 * hooking back up at its tip. */
const SIDE: readonly (readonly [number, number])[] = [[0, 0], [0.5, 0], [0.62, -0.4], [0.85, -0.42], [1, -0.2]];
/** The squash at contact: the hand 10% shorter along, wider across (volume kept). */
const IMPACT = 0.1;
/** Where the dactyl hinges along the hand, its length (share of the hand's) and its hinge's offset (share of FAT g). */
const HINGE = 0.55, DACTYL = 0.5, HINGE_OUT = 0.45;
/** The dactyl's gape (radians) wide open for a click: the wind-up's 1.05 and a little more. Shut is 0, on the pollex. */
const DACTYL_WIDE = 1.1;

const keyAt = (k: readonly (readonly [number, number])[], m: number): number => {
  for (let i = 1; i < k.length; i++) if (m <= k[i]![0]) { const [a, va] = k[i - 1]!, [b, vb] = k[i]!; return va + ((m - a) / (b - a)) * (vb - va); }
  return k[k.length - 1]![1];
};

/** The hand's size this build: length, widest half-width, and the arm's two segments. */
const handOf = (n: Numbers) => ({ len: LEN * n.crusher, fat: FAT * n.crusher, arm: [1.12 * n.crusher, 1.05 * n.crusher] as const });

/** The centroid of the landed hand's footprint along the lane, from the wrist: discs of the drawn girth on the drawn spine,
 * at the contact squash. Plain numbers, before the rig exists. */
function footprintLead(n: Numbers): number {
  const h = handOf(n), s = 1 - IMPACT, L = h.len * s, R = h.fat / Math.sqrt(s), step = 0.04;
  const joints = Array.from({ length: 48 }, (_, i) => { const m = i / 47; return { x: m * L, z: keyAt(SIDE, m) * R, r: keyAt(GIRTH, m) * R }; });
  let sum = 0, count = 0;
  for (let x = -R; x < L + R; x += step) for (let z = -R; z < R; z += step) {
    if (joints.some((j) => Math.hypot(x - j.x, z - j.z) <= j.r)) { sum += x; count++; }
  }
  return sum / count;
}

function offer(n: Numbers): ClawsOffer {
  return { crushLead: footprintLead(n), cutter: cutterGripper(n) };
}

/**
 * How the great claw is carried at rest, the one thing a fiddler may change and keep everything proven about it (the
 * strike, the disc, the cutter's grip): where its wrist rests, which way the hand stands, and when it waves.
 */
export type Banner = {
  readonly about: string;
  /** The wrist at rest, crab coordinates: ahead of the carapace's front end, above the body's origin, and out beyond the
   * shoulder (which is 0.55 of the carapace's half-width out). */
  readonly wrist: { readonly ahead: number; readonly up: number; readonly out: number };
  /** The way the hand stands at rest, crab coordinates (made unit). */
  readonly along: readonly [number, number, number];
  /** The display wave: seconds from one wave to the next (each lasts half of that), and when the first begins. */
  readonly wave: { readonly every: (n: Numbers) => number; readonly from: number };
};

/** A fiddler that carries its great claw as `banner` says. */
export const fiddlerWith = (banner: Banner): ClawsOption => ({
  about: banner.about,
  // The disc is the game's hit shape: a bigger hand needs a bigger disc (the DERIVATION). A gameplay change, stated.
  // The lunge's rise is cut from 7.8 to 0.4: the hand itself stands 8.6 above the wrist when cocked (theory.ts: the tip at
  // y ~30 px of 800 in the game camera; at 7.8 it left the frame).
  numbers: { crusher: 2.4, crushRadius: 4.4, cutter: 0.75, clawFat: 0.6, crushRise: 0.4 },
  offer,
  draw: (rig) => {
    const { n, body, local, shoulder, crush, crushAfter, grabOn } = rig;
    const I = n.ink, h = handOf(n);
    const env = crush.envelope(time);
    const tabS = (name: string, e: F): F => perFrame(`fiddler_s_${name}`, e);
    const tabV = (name: string, e: P3): P3 => perFrame(`fiddler_v_${name}`, e);
    const inBody = (x: F | number, y: F | number, z: F | number): P3 => add(add(mul(body.x, x), mul(body.y, y)), mul(body.z, z));
    const up = vec3(0, 1, 0);

    // ---- display: the banner waved twice a loop (at about 6.7 s and 14.7 s), never while the cutter works ----
    // In a taunt the banner waves on the dance's accents instead (rig.dance.display: its own display when there is none).
    const turn = TAU / banner.wave.every(n), sinceWave = sub(time, banner.wave.from);
    const wave = tabS("wave", rig.dance.display(mul(mul(max(sin(mul(sinceWave, turn)), 0), max(sin(mul(sinceWave, turn)), 0)), sub(1, grabOn))));
    const C = n.carapace;
    const wristHome = vec3(C.to + banner.wrist.ahead, banner.wrist.up, C.width * 0.55 + banner.wrist.out);
    const drift = vec3(alive(time, 0.25, 41, 0.17), alive(time, 0.3, 42, 0.21), alive(time, 0.2, 43, 0.19));
    // In a routine the wrist goes to the score's aim from the shoulder in arm spans (rig.dance.raised; the wrist itself
    // without one), the hand turned by the same weight as by its own wave (`display`).
    const span = h.arm[0] + h.arm[1];
    const restWrist = (m: F): P3 => mix(local(rig.dance.raised(1, add(add(wristHome, mul(vec3(0, 1.1, 0.8), wave)), drift), span)), local(shoulder(1)), m);

    // The wrist is the m = 0 end of the spine Claw Crush poses (as the base crusher's): the lunge throws it back and up in
    // the wind-up and lands it `crushLead` short of the disc's centre.
    let great: P3 | undefined, gapeOut: F | undefined;
    const crusher = animate(restWrist, [crush], (spine) => {
      const w = tabV("wrist", spine(lift<"f32">(0)));
      great = w;
      // The lane: from the wrist toward the disc's centre, level. At contact it is the lunge's own lane.
      const toward = tabV("toward", normalize(vec3(sub(rig.crushCentre.x, w.x), 0, sub(rig.crushCentre.y, w.z))));
      const p = env.p, q = env.q;
      // Display: up, leaning back; on the wave (the wrist lifted 1.1) it swings up and out to the side and back, as a
      // fiddler waves. (Swung forward, it lay down across the face and read as a lowered claw.) Face: out and forward.
      const restA = unit(add(inBody(...banner.along), inBody(mul(wave, 0.1), mul(wave, 0.35), mul(wave, 0.75))));
      const restN = inBody(0.7, 0, 0.7);
      // Cocked: thrown back over its shoulder, its face turned up toward the target. Landed: along the lane, face down.
      const backA = unit(sub(mul(up, 0.8), mul(toward, 0.6))), backN = unit(add(mul(up, 0.6), mul(toward, 0.8)));
      const hitA = unit(sub(toward, mul(up, 0.1)));
      const struck = mul(q, p);
      const a = tabV("along", unit(mix(mix(restA, backA, p), hitA, struck)));
      const nRaw = mix(mix(restN, backN, p), up, struck);
      const o = tabV("open", unit(cross(nRaw, a)));
      const nrm = tabV("face", cross(a, o));

      // Stretched in flight (most at mid-strike, back to 1 at contact), squashed at contact, springing back.
      const flight = mul(mul(sin(mul(max(q, 0), Math.PI)), 0.16), mul(p, sub(1, smoothstep(1, 1.1, q))));
      const lenK = tabS("len", mul(add(1, flight), impact(crushAfter, IMPACT, 2.4, 0.3)));
      const widthK = tabS("width", pow(max(lenK, 1e-3), -0.5));
      const g = keys(GIRTH.map(([m, v]) => [m, v] as const)), sideK = keys(SIDE.map(([m, v]) => [m, v] as const));
      const L = mul(lenK, h.len), R = mul(widthK, h.fat);

      const arm = chain({ root: local(shoulder(1)), target: w, lengths: h.arm, bend: add(body.z, mul(body.y, 0.6)) });
      const armStrand = strand({
        name: "crusherArm", spine: arm.spine, stations: 16, girth: (m) => mul(h.fat, sub(0.4, mul(m, 0.12))), tips: ["round", "round"], up: body.y,
        paint: (m, v) => {
          const top = mix(vec3(...I.brick), vec3(...I.cream), cut(sin(mul(v, TAU)), -0.3));
          const ring = sub(1, cut(abs(sub(m, arm.knots[1]!)), 0.02));
          return mix(top, vec3(...I.black), ring);
        },
        detail: { along: 40, around: 14 },
      });

      const hand = strand({
        name: "crusherPalm", spine: (m) => add(add(w, mul(a, mul(L, m))), mul(o, mul(sideK(m).x, R))), stations: 16,
        girth: (m) => mul(g(m).x, R), section: { aspect: 0.5, squareness: 2.2 }, tips: [{ round: 0.12 }, { round: 0.04 }], up: nrm, bulge: 1.2,
        paint: (m, v) => {
          // Accent red to cream fingers along a ragged line; three engraved lines down each face of the palm; a black point.
          const ragged = add(0.6, mul(sin(mul(v, TAU * 3)), 0.03));
          const lines = mul(sub(1, cut(cos(mul(add(mul(v, 6), mul(m, 1.5)), Math.PI)), -0.93)), sub(1, cut(m, 0.5)));
          const body_ = mix(mix(vec3(...I.accent), vec3(...I.cream), cut(m, ragged)), vec3(...I.black), lines);
          return mix(mix(body_, vec3(...I.black), cut(m, 0.96)), vec3(...I.black), sub(1, cut(m, 0.025)));
        },
        detail: { along: 56, around: 28 },
      });

      // The dactyl: hinged on the hand's upper edge at HINGE, curling down onto the pollex. It gapes a little at rest (more
      // on the wave), wide in the wind-up, and is shut at contact; it opens again as the claw goes home.
      // In a routine the dactyl clicks: opened wide before each click and shut on the pollex on it (rig.dance.clicked).
      const gape = tabS("gape", rig.dance.clicked(mul(mix(add(0.12, mul(wave, 0.45)), 1.05, p), sub(1, mul(p, smoothstep(0.55, 0.95, q)))), 0, DACTYL_WIDE));
      gapeOut = gape;
      const hingeAt = add(add(w, mul(a, mul(L, HINGE))), mul(o, mul(R, HINGE_OUT)));
      const ca = cos(gape), sa = sin(gape);
      const hinged: Frame = { o: hingeAt, x: add(mul(a, ca), mul(o, sa)), y: sub(mul(o, ca), mul(a, sa)), z: nrm };
      const dactyl = place(spiralTube({
        name: "crusherDactyl", length: mul(L, DACTYL), curl: 0.75, taper: 0.22, girth: mul(R, 0.36), out: [1, 0, 0], toward: [0, -1, 0],
        paint: (m) => mix(mix(vec3(...I.accent), vec3(...I.cream), cut(m, 0.2)), vec3(...I.black), cut(m, 0.93)),
        detail: { along: 28, around: 14 },
      }), rigid(hinged));
      return { things: [armStrand, hand, dactyl], parts: { crusherPalm: part("crusherPalm", hand, { tip: 1 }) } };
    });

    // The tiny cutter: the base pincer, painted as the body, its palm with one cream band.
    const cutter = cutterOf(rig, {
      about: "the fiddler's cutter",
      palm: (J, m, v) => mix(mix(vec3(...J.brick), vec3(...J.cream), cut(mul(sin(mul(v, TAU)), -1), 0.3)), vec3(...J.black), sub(1, cut(m, 0.04))),
    });
    const strike = crusher.strikes.crush;
    if (strike === undefined) throw new Error("claws/fiddler: the great claw is not bound to Claw Crush");
    if (great === undefined || gapeOut === undefined) throw new Error("claws/fiddler: the great claw's wrist was not posed");
    return { things: [...crusher.things, ...cutter.things], crush: strike, cutterFingers: cutter.fingers, great: { wrist: great, span, open: div(gapeOut, DACTYL_WIDE) } };
  },
});

/** The fiddler as first built: the banner beside the face, leaning a little back, waved every 8 s. (That is twice in
 * the 16 s loop it was made for; the loop is 22 s since the throw, so its wave no longer meets itself at the loop's seam.) */
export const fiddler: ClawsOption = fiddlerWith({
  about: "a fiddler: one great claw as long as the body, waved as a banner and slapped flat; a tiny cutter",
  wrist: { ahead: 0.6, up: 1.2, out: 2.7 }, along: [-0.3, 0.92, 0.15], wave: { every: () => 8, from: 4.7 },
});

/**
 * The same claw carried clear of a face on the head (face/brow.ts; docs/art_direction/DIRECTION.md, Round 4). From the
 * game camera the banner beside the face stood 15 px from the right eye at rest and over it while the crab turned to
 * the Grab (`staysInView`: the eye's middle behind the palm for 1.4 s). Here the wrist rests behind the carapace's front
 * end and 1.1 further out, and the hand leans a little out to the side, away from the head. It waves twice a loop whatever the
 * loop's length (so the wave meets itself at the seam): from 5.6 s, over the thrown ship's flight, and again while it poses.
 */
export const fiddlerAside: ClawsOption = fiddlerWith({
  about: "the fiddler's great claw carried out to the side, clear of a face on the head",
  wrist: { ahead: -0.2, up: 1.2, out: 3.8 }, along: [-0.3, 0.92, 0.3], wave: { every: (n) => n.crushPeriod / 2, from: 5.6 },
});


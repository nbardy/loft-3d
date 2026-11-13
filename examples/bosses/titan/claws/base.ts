// The claws: the crusher (right) posed by Claw Crush, the cutter (left) posed by the Grab. Each is an arm reaching its
// wrist by inverse kinematics, a palm continuing the forearm, and two curled horn fingers hinged near the palm's tip
// that open sideways in the palm's flat plane (a V from above). `clawsOf(look)` makes an option from a look, so another
// claw that keeps this mechanism is a look and some numbers (claws/fiddler.ts).

import {
  abs, add, alive, animate, cos, div, fingerAngle, spiralTube, lift, chain, max, mix, mul, part, place, rigid, rotateAbout, sin, smoothstep, strand, sub, swing,
  time, unit, vec3, type Drawable, type F, type Frame, type Measured, type P3,
} from "../../../../src/index.ts";
import { cut, mottle, perFrame } from "../ink.ts";
import type { Numbers } from "../numbers.ts";
import type { Rig } from "../rig.ts";
import type { ClawsOffer, ClawsOption, Gripper } from "../slots.ts";

type Ink = Numbers["ink"];
/** What a claw option may change of the drawing without touching the mechanism: the palm's paint over its (m, v). */
export type ClawLook = {
  readonly about: string; readonly numbers?: ClawsOption["numbers"]; readonly palm: (I: Ink, m: F, v: F) => P3;
  // Optional, added for the mask direction (2026-11-11); each absent field builds exactly the base claw's expression.
  /** The arm's paint over its (m, v), given the elbow's m. */
  readonly arm?: (I: Ink, m: F, v: F, elbow: F) => P3;
  /** A factor on the arm's girth over its m (armour lames). */
  readonly armProfile?: (m: F) => F;
  /** The fingers' paint over their m (0 at the hinge, 1 at the tip). */
  readonly finger?: (I: Ink, m: F) => P3;
  /** The rest pose: where a wrist rests (crab coordinates) and how far the palms fold in toward the face (base 0.55). */
  readonly rest?: { readonly wrist: (n: Numbers, side: 1 | -1, size: number) => readonly [number, number, number]; readonly fold: number };
};

/** Size of a claw: palm length, palm half-width, arm segment lengths. */
const clawDims = (n: Numbers, size: number) => ({ len: n.clawPalm * size, fat: n.clawFat * size, arm: n.armLengths.map((l) => l * (0.55 + 0.45 * size)) as unknown as readonly [number, number] });

/**
 * The cutter as a gripper (DERIVATION; the grab check measures it at the closing instant):
 * - the grip's middle lies `closedDepth` beyond the wrist along the palm: the fingers hinge 0.88 of the palm (2.9) out,
 *   and each finger touches the hull at its contact station, m = 0.85 of the horn (the tip runs on 0.37 past it), whose
 *   chord in the horn's own frame is 2.315 long at -0.366 rad and whose radius is 0.138. The stations' axes stand the
 *   grip's gap plus two radii apart (the gap is between surfaces), and the hull's middle is between them. Closed on the
 *   beam (1.19) that is 2.552 + 2.315 cos(asin((1.19 + 0.276 - 0.407) / 4.63)) = 4.81.
 *   (Until 2026-11-11 the tips' axes were put a beam apart with the hull 0.35 inside them: the library's gripReaches
 *   measured the surfaces there 1.02 apart, the fingers 0.085 into the hull on each side.)
 * - the two hinges' distance apart: each sits 0.35 of the palm's half-width out from its axis (palm.frame(0.88, v, 0.35)),
 *   and at m = 0.88 the palm's rounded tip (round 0.3) has narrowed the section by sqrt(1 - (0.18 / 0.3)^2) = 0.8. Without
 *   that factor (until 2026-11-11) this was 0.509 against 0.407 drawn, and the grip closed 0.1 tighter than asked.
 */
function pincer(n: Numbers) {
  const len = n.clawPalm * n.cutter, fat = n.clawFat * n.cutter;
  /** The finger's contact station (m = 0.85 of the horn): its chord from the hinge, the chord's angle, and its radius. */
  // The contact radius is the horn's girth (0.44 fat) tapered to m = 0.85: 0.138 at the base's clawFat (1.1). Written per
  // unit of clawFat so a slimmer claw (the fiddler's cutter) is offered its own; for the base it is 0.138 exactly.
  const chord = (2.315 / 2.755) * len * 0.95, phi = -0.366, contactR = 0.138 * n.cutter * (n.clawFat / 1.1);
  const hinges = 2 * 0.35 * fat * (0.55 + 0.3 * Math.sin(0.88 * Math.PI)) * Math.sqrt(1 - ((0.88 - 0.7) / 0.3) ** 2);
  return { len, chord, phi, contactR, hinges };
}

/** The cutter as a gripper (the DERIVATION above): what the rig places the ship by. */
export function cutterGripper(n: Numbers): Gripper {
  const p = pincer(n);
  return {
    closedDepth: (width) => 0.88 * p.len + p.chord * Math.cos(Math.asin((width + 2 * p.contactR - p.hinges) / (2 * p.chord))),
    /** The gap whose finger angle is the claw's own rest (0.3): the fingers cross at rest, so it is below zero. */
    restGap: p.hinges + 2 * p.chord * Math.sin(0.3 + p.phi) - 2 * p.contactR,
  };
}

/**
 * A claw's grip when something drives it: `on` how far (0 leaves the claw to its own gape and fold), `angle` the angle
 * both fingers stand at, `along` the palm's direction.
 */
type Grip = { readonly on: F; readonly angle: F; readonly along: P3; /** The palm's up while gripping: the held thing's own up, so the fingers stay either side of it as the hand turns it. */ readonly up: P3 };
/** No grip: the claw keeps its own gape and fold. A function, so nothing is built at import. */
const free = (): Grip => ({ on: lift<"f32">(0), angle: lift<"f32">(0), along: vec3(1, 0, 0), up: vec3(0, 1, 0) });

/** The pincer's offer to the rig: the crusher lands half its palm short of the disc's centre; the cutter grips by `cutterGripper`. */
function offer(n: Numbers): ClawsOffer {
  return { crushLead: clawDims(n, n.crusher).len * 0.5, cutter: cutterGripper(n) };
}

/**
 * One pincer claw of this mechanism: an arm by inverse kinematics from the shoulder on `side` to `wrist`, the palm
 * continuing the forearm (folded in by `fold`), two curled horn fingers opening by `gape` or standing at `grip`'s angle.
 */
function pincerClaw(rig: Rig, look: ClawLook, name: string, side: 1 | -1, size: number, wrist: P3, gape: F, fold: F, grip: Grip = free()) {
  const { n, body, local, shoulder } = rig;
  const I = n.ink;
  const d = clawDims(n, size);
  const arm = chain({ root: local(shoulder(side)), target: wrist, lengths: d.arm, bend: add(mul(body.z, side), mul(body.y, 0.5)) });
  const [, elbow, w] = arm.joints;
  // The palm continues the forearm, folded in toward the face at rest as a crab carries it.
  const free = unit(add(unit(sub(w, elbow)), mul(body.z, mul(fold, -side * (look.rest?.fold ?? 0.55)))));
  const along = unit(mix(free, grip.along, grip.on));
  const armStrand = strand({
    name: `${name}Arm`, spine: arm.spine, stations: 16, tips: ["round", "round"], up: body.y,
    girth: look.armProfile === undefined ? (m) => mul(d.fat, sub(0.42, mul(m, 0.1))) : (m) => mul(mul(d.fat, sub(0.42, mul(m, 0.1))), look.armProfile!(m)),
    paint: look.arm !== undefined ? (m, v) => look.arm!(I, m, v, arm.knots[1]!) : (m, v) => {
      const top = mix(vec3(...I.brick), vec3(...I.brickDark), mottle(mul(m, 0.6), v));
      const ring = sub(1, cut(abs(sub(m, arm.knots[1]!)), 0.022));
      return mix(mix(vec3(...I.cream), top, cut(sin(mul(v, Math.PI * 2)), -0.25)), vec3(...I.black), ring);
    },
    detail: { along: 40, around: 14 },
  });
  const palm = strand({
    name: `${name}Palm`, spine: (m) => add(w, mul(along, mul(d.len, m))), stations: 6, girth: (m) => mul(d.fat, add(0.55, mul(sin(mul(m, Math.PI)), 0.3))),
    // Free, the palm lies flat on the body's up; gripping, on the held thing's (rig.gripUp): through the throw's stroke
    // the hand turns the ship about a tilted axis, and a palm left level had a finger 0.46 into the rolled hull.
    section: { aspect: 0.62 }, tips: [{ round: 0.3 }, { round: 0.3 }], up: unit(mix(body.y, grip.up, grip.on)),
    paint: (m, v) => look.palm(I, m, v),
    detail: { along: 24, around: 20 },
  });
  // The pincer opens sideways, in the palm's flat plane, so it reads as a V from above.
  const finger = (fname: string, v: number, opens: number) => {
    const f = palm.frame(vec3(0.88, v, 0.35));
    // Free, the dactyl opens by the gape and the fixed finger by a third of it; gripping, both stand at the grip's angle
    // (symmetric, so the grip's middle is on the palm's axis).
    const a = mix(mul(gape, opens), grip.angle, grip.on);
    const hinged: Frame = { o: f.o, x: rotateAbout(f.x, f.z, a), y: rotateAbout(f.y, f.z, a), z: f.z };
    return place(spiralTube({
      name: fname, length: d.len * 0.95, curl: 0.8, taper: 0.16, girth: mul(d.fat, 0.44), out: [1, -0.15, 0], toward: [0, -1, 0],
      paint: look.finger !== undefined ? (m) => look.finger!(I, m) : (m) => mix(mix(vec3(...I.brick), vec3(...I.cream), cut(m, 0.56)), vec3(...I.black), cut(m, 0.965)),
    }), rigid(hinged));
  };
  const fingers = [finger(`${name}Fixed`, side > 0 ? 0.5 : 0, 0.35), finger(`${name}Dactyl`, side > 0 ? 0 : 0.5, 1)] as const;
  return { things: [armStrand, palm, ...fingers], palm, fingers };
}

/** A claw's arm, shoulder to wrist at full stretch: the two segments (`clawDims`). */
const spanOf = (n: Numbers, size: number): number => clawDims(n, size).arm[0] + clawDims(n, size).arm[1];

const wristRest = (look: ClawLook, n: Numbers, side: 1 | -1, size: number): readonly [number, number, number] =>
  look.rest !== undefined ? look.rest.wrist(n, side, size) : [n.carapace.to + 1.0 * size, 0.4, side * (n.carapace.width * 0.55 + 0.6 * size)];

/**
 * The cutter (left) posed by the Grab: the attack's grip turned into this pincer's pose. Exported so another claws
 * option keeps this proven grip (and its offer, `cutterGripper`) and changes only the crusher (claws/fiddler.ts).
 */
export function cutterOf(rig: Rig, look: ClawLook): { readonly things: readonly Drawable[]; readonly fingers: readonly [Measured, Measured] } {
  const { n, crush, grab, grabOn, grabEnv, keel, gripRest, body, local } = rig;
  const env = crush.envelope(time);
  const p = pincer(n);
  const keelV = keel;
  const take = grab.grip(gripRest);
  // Both fingers' contact stations, of chord `p.chord`, hinged `p.hinges` apart, stand the gap plus their two radii
  // apart: the library's fingerAngle is for straight fingers, so the curl's chord angle (phi) is taken off. (pincerAngle,
  // one hinge and one fixed finger, does not fit this claw: its two horns hinge 0.41 apart and close symmetrically,
  // keeping the grip's middle on the palm's axis.)
  const tabV = (name: string, e: P3) => perFrame(`titan_grab_${name}`, e);
  const tabS = (name: string, e: F) => perFrame(`titan_s_${name}`, e);
  const gripGap = tabS("gap", take.gap), gripPalm = tabV("palm", take.palm);
  const chordAngle = fingerAngle(add(gripGap, 2 * p.contactR), p.chord, p.hinges);
  const gripAngle = sub(chordAngle, p.phi);
  const gripDepth = add(0.88 * p.len, mul(cos(chordAngle), p.chord));
  const grabWrist = sub(gripPalm, mul(keelV, gripDepth));
  /** The cutter idles on its own seeds, held quieter while the crusher works. */
  const quiet = sub(1, mul(env.p, 0.8));
  // In a taunt the small claw answers the great one's wave (rig.dance.raised; the wrist as it is without a taunt).
  const cutterIdle = local(rig.dance.raised(-1, add(vec3(...wristRest(look, n, -1, n.cutter)), mul(vec3(alive(time, 0.45, 21, 0.19), alive(time, 0.4, 22, 0.27), alive(time, 0.25, 23, 0.21)), quiet)), spanOf(n, n.cutter)));
  /** Once home (the attack's span is over), the arm swings once. */
  const homeSwing = swing(sub(grabEnv.tau, grab.span.after), 0.4, 1.1, 0.3);
  // The grab's closed forms are long (arcs, selects, two finger angles); written inline they were re-evaluated by every
  // station of the arm, palm and fingers, and the crab's GPU-table test went from 11 s to over 60 s (2026-11-11). They
  // are evaluated once per frame into small tables, as the body frame is.
  const cutterWrist = tabV("wrist", add(mix(cutterIdle, grabWrist, grabOn), mul(body.y, homeSwing)));
  const cutterGape = add(0.3, mul(mul(max(alive(time, 1, 24, 0.3), 0), 0.35), quiet));
  const cutter = pincerClaw(rig, look, "cutter", -1, n.cutter, cutterWrist, cutterGape, lift<"f32">(1), { on: grabOn, angle: tabS("angle", gripAngle), up: rig.gripUp, along: keelV });
  return { things: cutter.things, fingers: cutter.fingers };
}

/** The crusher's gape (radians): at rest (its fingers meet), and wide (the wind-up's). */
const CRUSH_SHUT = 0.28, CRUSH_WIDE = 0.28 + 0.85;

export function clawsOf(look: ClawLook): ClawsOption {
  return {
    about: look.about, ...(look.numbers === undefined ? {} : { numbers: look.numbers }), offer,
    draw: (rig) => {
      const { n, local, shoulder, crush, grabOn } = rig;
      const env = crush.envelope(time);

      // The crusher gapes wide in the wind-up and shuts on the hit; the cutter works slowly at rest.
      // In a routine the great claw clicks: opened to the wind-up's gape before each click and shut to its own rest (which
      // is closed: its fingers already meet) on it (rig.dance.clicked; the gape itself outside a routine).
      const crushGape = rig.dance.clicked(add(0.28, mul(mul(env.p, sub(1, smoothstep(0.55, 1, env.q))), 0.85)), CRUSH_SHUT, CRUSH_WIDE);
      // The crusher at rest is never still (a moving hold, its own seeds); while the cutter works, it keeps quieter.
      const crusherIdle = vec3(alive(time, 0.3, 31, 0.17), alive(time, 0.25, 32, 0.23), alive(time, 0.25, 33, 0.2));
      // The crusher's wrist is the m = 0 end of a spine from the wrist at rest back to the shoulder, posed by the crush; the
      // palm is the part that lands (its m = 1 end leads). In the attack the palm unfolds to drive straight on along its forearm.
      const crusherDrift = perFrame("titan_crusher_drift", mul(crusherIdle, sub(1, mul(grabOn, 0.8))));
      // In a taunt the great claw waves: its rest wrist is lifted up and out on each move (rig.dance.raised).
      let wrist: P3 | undefined;
      const crusher = animate((m) => mix(local(rig.dance.raised(1, add(vec3(...wristRest(look, n, 1, n.crusher)), crusherDrift), spanOf(n, n.crusher))), local(shoulder(1)), m), [crush], (spine) => {
        wrist = spine(lift<"f32">(0));
        const c = pincerClaw(rig, look, "crusher", 1, n.crusher, wrist, crushGape, sub(1, env.p));
        return { things: c.things, parts: { crusherPalm: part("crusherPalm", c.palm, { tip: 1 }) } };
      });

      // ---- the Grab, on the cutter ----
      const cutter = cutterOf(rig, look);

      const strike = crusher.strikes.crush;
      if (strike === undefined) throw new Error("claws: the crusher is not bound to Claw Crush (animate returned no strike \"crush\")");
      if (wrist === undefined) throw new Error("claws: the crusher's wrist was not posed");
      return { things: [...crusher.things, ...cutter.things], crush: strike, cutterFingers: cutter.fingers, great: { wrist, span: spanOf(n, n.crusher), open: div(sub(crushGape, CRUSH_SHUT), CRUSH_WIDE - CRUSH_SHUT) } };
    },
  };
}

export const base = clawsOf({
  about: "crusher 1.4 times the cutter, mottled brick palms",
  palm: (I, m, v) => mix(mix(vec3(...I.brick), vec3(...I.brickDark), mottle(mul(m, 0.8), mul(v, 1.3))), vec3(...I.cream), cut(mul(sin(mul(v, Math.PI * 2)), -1), -0.475)),
});

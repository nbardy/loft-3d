// The serpent strikes: a bite along a capsule at a ship ahead, then a tail sweep through an arc at a second ship
// astern. Each attack is defined once, from what a game's simulation would supply (a hit shape, an arming time, a
// warning duration, all host inputs), and everything else is derived from it: the posed body through time, the
// telegraph on the water, the smear of the striking part, the wake, and the checks exported below.
//
// The "simulation" here is a stand-in: it aims each hit shape at its ship's position input, so moving a ship moves
// the shape and the strike follows. Run `loft check examples/strike.ts` for the checks.

import {
  add, atan2, div, input, length, lift, mod, mul, normalize, scene, sea, smoothstep, sub, time, toon, vec2,
  type Expr,
} from "../src/index.ts";
import { ship, type ShipSpec } from "./recipes/ship.ts";
import { sloopSpec } from "./fleet.ts";
import { animate, attack, hit, part, smear, telegraph, wake, type Target } from "../src/spacetime/index.ts";
import { budget, landsInside, minScreenSize, staysClear, stopsAt } from "../src/check.ts";
import { restGape, restSpine, S, serpent } from "./serpent.ts";

const water = sea({
  swell: [
    { direction: [1, 0.3], length: 14, height: 0.35, speed: 1.1 },
    { direction: [-0.3, 1], length: 6.5, height: 0.12, speed: 0.8, phase: 1.3 },
  ],
});

// ---- the ships: small cutters (examples/recipes/ship.ts) afloat on the swell, broadside to the serpent ---------------------

const WIND = [0.8, 0.6] as const;
/** A cutter about 5.6 long: the fleet's sloop, smaller. Its half-beam is where the bite's lane stops short. */
const cutter = (name: string, team: readonly [number, number, number]): ShipSpec => ({
  ...sloopSpec, name, length: 5.6, beam: 1.9, depth: 0.75, freeboard: 0.55, mastHeight: 5.5, bowsprit: 1.8,
  colours: { ...sloopSpec.colours, team },
});
const HALF_BEAM = 0.95;
function afloatShip(spec: ShipSpec, at: Expr<"vec2">, heading: Expr<"vec2">) {
  const s = ship(spec);
  const chart = s.afloatChart(water, { at, heading: atan2(heading.y, heading.x), wind: WIND });
  // The target is the hull itself (its signed distance), so contact at arming reads as contact, not as the half-unit
  // gap to the capsules of a stand-in.
  return { things: s.placed(chart, WIND), target: s.target(chart) };
}

/** The ships' positions: what the game moves. */
const bow = input("ship.at", "vec2", [14.5, 1.5]);
const stern = input("ship2.at", "vec2", [-3.3, -5.8]);

// ---- the bite: a lunge along a capsule from the serpent's neck to the ship's near side ----------------------------

/** Where the simulation's lane starts: in front of the serpent's neck on the water. */
const ANCHOR: readonly [number, number] = [7.4, 0];
const biteDir = normalize(sub(bow, lift<"vec2">(ANCHOR)));
const bowHeading = vec2(mul(biteDir.y, -1), biteDir.x);
const bowShip = afloatShip(cutter("ship", [0.85, 0.15, 0.12]), bow, bowHeading);
const biteTarget: Target = bowShip.target;
const bite = attack({
  name: "bite",
  arm: input("bite.arm", "f32", [2.4]),
  warn: input("bite.warn", "f32", [1.6]),
  target: biteTarget,
  part: "head",
  motion: {
    kind: "lunge",
    hit: hit.capsule({ a: add(lift<"vec2">(ANCHOR), mul(biteDir, 1.2)), b: sub(bow, mul(biteDir, HALF_BEAM - 0.42)), radius: input("bite.radius", "f32", [0.95]) }),
    reach: 0.3, lead: 1.95, height: 0.8, coil: 1.6, rise: 1.1, approach: 0.3, neck: 1.6,
  },
});

// ---- the lash: the tail sweeps through an arc round a point behind the body, toward the second ship --------------

const PIVOT: readonly [number, number] = [-3, 0];
const SWEEP_FROM = Math.PI - 0.25;
const toStern = sub(stern, lift<"vec2">(PIVOT));
// The ship's bearing from the pivot, unwrapped past the sweep's start, less the angle its near half-beam subtends.
const sternBearing = add(SWEEP_FROM, mod(sub(atan2(toStern.y, toStern.x), SWEEP_FROM), Math.PI * 2));
const sternHeading = normalize(toStern);
const sternShip = afloatShip(cutter("ship2", [0.13, 0.45, 0.85]), stern, sternHeading);
const lashTarget: Target = sternShip.target;
const lash = attack({
  name: "lash",
  arm: input("lash.arm", "f32", [5.6]),
  warn: input("lash.warn", "f32", [1.4]),
  target: lashTarget,
  part: "tail",
  motion: {
    kind: "sweep",
    hit: hit.arc({ centre: PIVOT, inner: 1.2, outer: 7.4, from: SWEEP_FROM, to: sub(sternBearing, div(HALF_BEAM - 0.08, length(toStern))) }),
    root: 0.72, height: 0.25, inset: 0.45,
  },
  timing: { windup: 0.7, strike: 0.32, travel: 3 },
});

// ---- the serpent, posed by both attacks ---------------------------------------------------------------------------

const biteOpen = (() => {
  const e = bite.envelope(time);
  // The jaw opens wide through the wind-up and snaps shut on landing.
  return mul(mul(e.p, sub(1, smoothstep(-0.03, 0.08, e.tau))), S.jawGape * 3.2);
})();

const creature = animate(restSpine, [bite, lash], (spine) => {
  const s = serpent({ spine, gape: add(restGape, biteOpen) });
  return {
    things: s.things,
    parts: { head: part("head", s.head, { tip: 1 }), tail: part("tail", s.body, { from: 0.8, to: 1, tip: 1 }), eye: part("eye", s.eyes[1], { tip: 0.5 }), body: part("body", s.body, { tip: 0 }) },
  };
});
const parts = creature.parts;

export const strikes = creature.strikes;

export default scene({
  ground: water,
  things: [
    ...creature.things, ...bowShip.things, ...sternShip.things,
    telegraph(bite), telegraph(lash),
    wake(parts.body.body, { over: 1.6, samples: 10 }),
    smear(strikes.bite, { over: 0.12, samples: 4 }),
    smear(strikes.lash, { over: 0.1, samples: 4 }),
  ],
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    three: { kind: "perspective", eye: [13, 16, 18], target: [3.5, 0, -0.5], fovY: 0.62 },
    side: { kind: "perspective", eye: [3, 4.5, 33], target: [3, 1.2, 0], fovY: 0.62 },
    top: { kind: "orthographic", eye: [3, 40, 0.001], target: [3, 0, 0], height: 24 },
    bite: { kind: "perspective", eye: [16, 10, 13], target: [11, 1, 0.5], fovY: 0.6 },
  },
});

export const checks = [
  landsInside(strikes.bite),
  stopsAt(strikes.bite, biteTarget, { contact: 0.1 }),
  staysClear(parts.body, biteTarget, { until: bite.arm, label: "bite: body clear of the ship until arming" }),
  staysClear(parts.head, biteTarget, { until: bite.arm, margin: 0.02, label: "bite: head clear of the ship until arming" }),
  landsInside(strikes.lash),
  stopsAt(strikes.lash, lashTarget, { contact: 0.1 }),
  staysClear(parts.body, lashTarget, { until: lash.arm, label: "lash: body clear of ship2 until arming" }),
  minScreenSize(parts.eye, "three", 4, { at: bite.arm }),
  budget({ triangles: 400_000 }),
];

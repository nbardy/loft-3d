// The Strike (toon). One gameplay beat read from the game's high camera, on an 8-second loop: the serpent swims
// beside a brig; at 2 s the danger marker opens on the water between them and its teeth grow as the serpent coils
// back (the wind-up); at 4 s it lunges, the head smeared along its path, and lands on the marker where the brig lies
// broadside; then it recovers while its wake spreads behind it. The attack is defined once (a capsule on the water, an
// arming time, a warning) and the pose, marker, smear, wake and the checks below are all derived from it.
// `pnpm loft check examples/scenes/the_strike.ts` runs the checks.
import {
  add, atan2, budget, input, landsInside, lift, minScreenSize, mul, normalize, scene, sea, smoothstep,
  staysClear, stopsAt, strand, sub, through, time, toon, vec2, vec3,
} from "../../src/index.ts";
import { ship } from "../recipes/ship.ts";
import { animate, attack, hit, part, smear, telegraph, wake, type Target } from "../../src/spacetime/index.ts";
import { restGape, restSpine, S, serpent } from "../serpent.ts";
import { brig, PLAYER } from "./lib/fleet.ts";

// ---- named numbers ------------------------------------------------------------------------------------------------
const ARM = 4.0;                  // seconds: the bite lands half way through the loop
const WARN = 2.0;                 // seconds of warning before it
const SHIP_AT: readonly [number, number] = [14.2, 1.6];
const SHIP_LENGTH = 5.6;
/** Where the lane starts: on the water in front of the serpent's neck (examples/serpent.ts puts the head near x = 8). */
const ANCHOR: readonly [number, number] = [7.4, 0];
const BITE_RADIUS = 1.0;
/** How far inside the beam line the lane ends: the head lands on the bulwark, not short of it (checked by stopsAt). */
const LAND_INSET = 0.25;
const WIND: readonly [number, number] = [0.3, 1];

const water = sea({
  swell: [
    { direction: [1, 0.3], length: 14, height: 0.3, speed: 1.1 },
    { direction: [-0.3, 1], length: 6.5, height: 0.1, speed: 0.8, phase: 1.3 },
  ],
  foam: 0.35,
});

// ---- the brig, broadside to the serpent, and the body the attack aims at -------------------------------------------
const shipAt = input("ship.at", "vec2", [...SHIP_AT]);
const biteDir = normalize(sub(shipAt, lift<"vec2">(ANCHOR)));
const along = vec2(mul(biteDir.y, -1), biteDir.x);
const spec = brig("quarry", SHIP_LENGTH, PLAYER);
const HALF_BEAM = spec.beam / 2;
const quarry = ship(spec).afloat(water, { at: shipAt, heading: atan2(along.y, along.x), wind: WIND });
/**
 * The library's ships are surfaces in a rigid chart, not bodies, and an attack's target must be a body (its skeleton
 * capsules are what the checks measure). So the hull is stood in for by a strand along the same waterline, its
 * capsules the beam wide, as examples/strike.ts's stand-in hull was. It has to be drawn: a body only read by a check
 * is first used after the artefact is laid out, and the compiler refuses it ("table body_quarryHull was first used
 * after the artefact was laid out"). So it is drawn inside the real hull, low and a little narrower, where it is never
 * seen.
 */
const hullProxy = strand({
  name: "quarryHull",
  spine: (m) => through(m, [0, 0.5, 1].map((s) => {
    const xz = add(shipAt, mul(along, (s - 0.5) * SHIP_LENGTH * 0.85));
    return vec3(xz.x, add(water.height(xz), -0.15), xz.y);
  })),
  stations: 6, girth: (m) => mul(sub(1, mul(mul(sub(m, 0.5), sub(m, 0.5)), 2.2)), HALF_BEAM * 0.92), section: { aspect: 0.5 },
  tips: [{ round: 0.06 }, { point: 0.2 }], paint: [0.5, 0.3, 0.2],
});
const target: Target = { kind: "body", body: hullProxy };

// ---- the bite --------------------------------------------------------------------------------------------------------
const bite = attack({
  name: "bite",
  arm: input("bite.arm", "f32", [ARM]),
  warn: input("bite.warn", "f32", [WARN]),
  target,
  part: "head",
  motion: {
    kind: "lunge",
    hit: hit.capsule({ a: add(lift<"vec2">(ANCHOR), mul(biteDir, 1.2)), b: sub(shipAt, mul(biteDir, HALF_BEAM - LAND_INSET)), radius: input("bite.radius", "f32", [BITE_RADIUS]) }),
    reach: 0.3, lead: 1.95, height: 0.8, coil: 1.7, rise: 1.2, approach: 0.3, neck: 1.6,
  },
});
/** The jaw opens wide through the wind-up and snaps shut on landing. */
const biteOpen = (() => {
  const e = bite.envelope(time);
  return mul(mul(e.p, sub(1, smoothstep(-0.03, 0.08, e.tau))), S.jawGape * 3.2);
})();

// ---- the serpent, posed by the bite ---------------------------------------------------------------------------------
const creature = animate(restSpine, [bite], (spine) => {
  const s = serpent({ spine, gape: add(restGape, biteOpen) });
  return {
    things: s.things,
    parts: { head: part("head", s.head, { tip: 1 }), eye: part("eye", s.eyes[1], { tip: 0.5 }), body: part("body", s.body, { tip: 0 }) },
  };
});
const parts = creature.parts;
const strikes = creature.strikes;

// ---- the scene ----------------------------------------------------------------------------------------------------
export default scene({
  ground: water,
  things: [
    ...creature.things, ...quarry, hullProxy,
    telegraph(bite),
    wake(parts.body.body, { over: 1.8, samples: 10 }),
    smear(strikes.bite, { over: 0.14, samples: 5 }),
  ],
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    game: { kind: "perspective", eye: [19, 23, 20], target: [7.5, 0, 0], fovY: 0.6 },
    hero: { kind: "perspective", eye: [20, 6, 14], target: [10, 1.5, 0.5], fovY: 0.62 },
    close: { kind: "perspective", eye: [14, 5.5, 8], target: [9.5, 2.0, 0.5], fovY: 0.5 },
  },
});

export const checks = [
  landsInside(strikes.bite),
  stopsAt(strikes.bite, target),
  staysClear(parts.body, target, { until: bite.arm, label: "bite: body clear of the brig until arming" }),
  staysClear(parts.head, target, { until: bite.arm, margin: 0.02, label: "bite: head clear of the brig until arming" }),
  minScreenSize(parts.eye, "game", 4, { at: bite.arm }),
  budget({ triangles: 500_000 }),
];

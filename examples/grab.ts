// Grabs, by the size of the thing grabbed (src/geom/grab.ts). Three claws take boats of three sizes: each opens to
// its own boat's width before it arrives, closes on it, lifts it, squeezes it twice and sets it down. A tentacle does
// the same to a fourth boat with a coil: the coil's radius is the same `gap`, and its number of turns follows from the
// tentacle's length, so it takes up another half turn each time it tightens. The largest claw takes a whole ship (hull,
// mast, sails, rigging): the ship is placed with the grab's squeezed size across its beam.
import {
  add, draw, fingerAngle, floor, grab, lt, mix, mod, mul, pick, posed, scene, sea, select, shifted, sin, size, strand, sub, through, time, toon, turn, vec3, wrap, cos,
  type Expr, type Grab,
} from "../src/index.ts";
import { ship } from "./recipes/ship.ts";
import { sloop } from "./scenes/lib/fleet.ts";

type F = Expr<"f32">;
const PERIOD = 7, BEATS = { reach: 1.1, close: 0.18, hold: 2.6, release: 1.2 };
/** Each grab's own clock: the same loop, started a little later down the row. */
const since = (k: number): F => sub(mod(sub(time, k * 0.35), PERIOD), 0.8);

// ---- three claws ---------------------------------------------------------------------------------------------------
const water = sea({ swell: [{ direction: [1, 0.3], length: 11, height: 0.08, speed: 0.7 }] });
const prize = ship(sloop("prize", 4.4));
// The third thing is the ship: its half beam is the radius the claw opens and closes to.
const BOATS = [{ r: 0.35, x: -6 }, { r: 0.7, x: -2.6 }, { r: prize.hull.lines.beam / 2, x: 1.6 }] as const;
const FINGER = 2.6;
const afloat = (r: number, x: number): [number, number, number] => [x, 0.3 * r, 0];
const claws: Grab[] = BOATS.map((b, k) =>
  grab(since(k), { rest: [b.x, 4.2, 0], from: afloat(b.r, b.x), radius: b.r, carryLift: 2.4, squeeze: 0.45, pulses: 2, restGap: 0.5 }, BEATS));
/** The wrist a claw's two fingers hinge at: above the palm by the fingers' height at this gap. */
const wrist = (g: Grab) => add(g.palm, vec3(0, mul(cos(fingerAngle(g.gap, FINGER)), FINGER), 0));

const finger = strand({
  name: "finger", spine: (m) => vec3(0, mul(m, -1), 0), stations: 4,
  girth: (m) => mix(0.07, 0.025, m), tips: ["round", "point"], paint: [0.78, 0.22, 0.14], detail: { along: 10, around: 10 },
});
const fingers = draw.posed("fingers", posed(6, (i) => {
  const k = floor(mul(i, 0.5)), side = sub(mul(mod(i, 2), 2), 1);
  return {
    at: pick(k, claws.map(wrist)),
    turn: turn.about([0, 0, 1], mul(side, pick(k, claws.map((g) => fingerAngle(g.gap, FINGER))))),
    size: size.even(FINGER),
  };
}), finger);
const arms = claws.map((g, k) => strand({
  name: `arm${k}`, spine: (m) => mix(vec3(BOATS[k]!.x, 11, -3), wrist(g), m), stations: 4, girth: 0.16, paint: [0.6, 0.16, 0.1], detail: { along: 8, around: 10 },
}));

// ---- the tentacle ----------------------------------------------------------------------------------------------------
const PREY = { r: 0.8, x: 6.5 }, BODY = 0.2, ROOT = vec3(9.5, -1.5, -2.5);
const home = afloat(PREY.r, PREY.x);
// It waits curled, off the boat's bow, and slides over it along the boat's own axis.
const coilGrab = grab(since(3), { rest: [home[0], home[1] + 0.4, 4.5], from: home, radius: PREY.r, carryLift: 2.4, squeeze: 0.45, pulses: 2 }, BEATS);
const coil = wrap({ centre: coilGrab.palm, axis: [0, 0, 1], toward: [1, -0.4, 0], radius: add(mul(coilGrab.gap, 0.5), BODY), length: 10, pitch: 0.55 });
const LEAD = 0.3;
const tentacle = strand({
  name: "tentacle", stations: 64, bulge: 1.3,
  // The lead runs from the root to the coil's first point, heading in along the coil's own curve continued backwards.
  spine: (m) => select(lt(m, LEAD),
    through(mul(m, 1 / LEAD), [ROOT, add(ROOT, vec3(-0.5, 2.5, 1.5)), coil.spine(mul(-0.12, 1) as F), coil.spine(mul(0, 1) as F)]),
    coil.spine(mul(sub(m, LEAD), 1 / (1 - LEAD)))),
  girth: (m) => mix(0.34, BODY * 0.55, m), tips: ["round", "point"],
  paint: (m, v) => mix(vec3(0.45, 0.2, 0.5), vec3(0.95, 0.8, 0.75), mul(0.5, add(1, sin(mul(v, Math.PI * 2))))),
  detail: { along: 220, around: 16 },
});

// ---- the boats ---------------------------------------------------------------------------------------------------------
const hull = strand({
  name: "hull", spine: (m) => vec3(0, 0, mul(sub(m, 0.5), 3.4)), stations: 12,
  girth: (m) => mul(sin(mul(m, Math.PI)), mix(1.0, 0.8, m)), section: { aspect: 0.55, squareness: 2.6 }, tips: ["point", "point"],
  paint: (m, v) => mix(vec3(0.5, 0.31, 0.16), vec3(0.93, 0.87, 0.72), select(lt(mod(add(v, 0.5), 1), 0.5), 0, 1)),
  detail: { along: 28, around: 18 },
});
const GRABS = [claws[0]!, claws[1]!, coilGrab], SIZES = [BOATS[0].r, BOATS[1].r, PREY.r];
// The ship floats bow toward +z, so the claw (closing along x) takes it across the beam, the ship's own z.
const SHIP = BOATS[2], shipGrab = claws[2]!;
const prizeHeld = prize.placed(
  shifted(prize.afloatChart(water, { at: [SHIP.x, 0], heading: Math.PI / 2, wind: [1, 0.3] }), sub(shipGrab.thing, afloat(SHIP.r, SHIP.x))),
  [1, 0.3], shipGrab.squeezed(1, "z"));
const boats = draw.posed("boats", posed(3, (i) => ({
  at: pick(i, GRABS.map((g) => g.thing)),
  turn: turn.none,
  size: size.axes(pick(i, GRABS.map((g, k) => g.squeezed(SIZES[k]!).k))),
})), hull);

export default scene({
  ground: water,
  things: [...arms, fingers, tentacle, boats, ...prizeHeld],
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.4, 0.8, 0.5],
  cameras: {
    three: { kind: "perspective", eye: [1.5, 7, 17], target: [1, 1.6, 0], fovY: 0.62 },
    side: { kind: "perspective", eye: [0.5, 2.5, 19], target: [0.5, 2, 0], fovY: 0.6 },
    top: { kind: "perspective", eye: [0.5, 20, 0.5], target: [0.5, 0, 0], fovY: 0.6 },
    front: { kind: "perspective", eye: [20, 3, 0], target: [0, 2, 0], fovY: 0.6 },
  },
});

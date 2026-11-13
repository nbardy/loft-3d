// A maelstrom: a whirlpool deforming the sea, two ships and a scatter of debris riding it, and the serpent of
// examples/serpent.ts coiled into it. Nothing here animates anything: the ships float (`afloat`) in the whirlpool's
// coordinates, so the water carries them round and tilts them on the funnel wall; the debris is points placed in the
// same chart; the serpent's spine is given in whirlpool coordinates (the serpent as authored, set along a radius), so
// the whirlpool's steady spiral winds its skeleton into a coil while its cross-sections keep their shape.
import {
  add, compose, cos, draw, floor, mod, mul, place, points, rigid, scene, sea, sin, strand, through, toon, vec3, whirlpool,
  Strand, SurfaceDrawable, type Chart, type Drawable, type F,
} from "../src/index.ts";
import { ship } from "./recipes/ship.ts";
import serpent, { bodySpec } from "./serpent.ts";
import { brigSpec } from "./brig.ts";
import { sloopSpec } from "./fleet.ts";

const R = 24;
const pool = whirlpool({ at: [0, 0], radius: R, spin: 0.2, depth: 6, drift: 0.45, throat: 0.3, arms: 3 });
const water = sea({
  swell: [
    { direction: [1, 0.3], length: 20, height: 0.45, speed: 2 },
    { direction: [-0.3, 1], length: 8, height: 0.15, speed: 1.2, phase: 1.3 },
  ],
  deform: [pool],
  reach: 300,
});
const vortex = pool.in(water);
const WIND = [0.6, 0.8] as const;

/** A heading along the flow (counter-clockwise round the centre) at whirlpool point (x, z). */
const along = (x: number, z: number): number => Math.atan2(z, x) + Math.PI / 2;
const at = (r: number, a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)];

const brigAt = at(15.5, 0.6), sloopAt = at(10.5, 2.75);
const ships = [
  ...ship({ ...brigSpec, name: "brigM" }).afloat(vortex, { at: brigAt, heading: along(...brigAt) - 0.25, wind: WIND }),
  ...ship({ ...sloopSpec, name: "sloopM" }).afloat(vortex, { at: sloopAt, heading: along(...sloopAt) - 0.2, wind: WIND }),
];

// ---- debris: barrels and planks on a loose ring, floating half awash ------------------------------------------------
const barrel = strand({
  name: "barrel", spine: (m) => through(m, [[-0.45, 0, 0], [0.45, 0, 0]]), stations: 4,
  girth: (m) => add(0.32, mul(sin(mul(m, Math.PI)), 0.07)), tips: [{ round: 0.12 }, { round: 0.12 }],
  paint: (m) => vec3(0.5, 0.3, 0.14).mul(add(0.75, mul(floor(mod(mul(m, 6), 2)), 0.25))), detail: { along: 12, around: 12 },
});
const plank = strand({
  name: "plank", spine: (m) => through(m, [[-1.1, 0, 0], [1.1, 0, 0]]), stations: 4, girth: 0.18,
  section: { aspect: 0.25, squareness: 5 }, tips: "open", paint: [0.62, 0.46, 0.28], detail: { along: 4, around: 12 },
});
/** n things scattered round radius r0..r1, each half awash, turned by a hash of its index. */
const scatter = (n: number, r0: number, r1: number, seed: number, awash: number) => points(n, (i: F) => {
  const a = add(mul(i, 2.39996), seed), r = add(r0, mul(mod(mul(i, 0.618034), 1), r1 - r0));
  return { at: vec3(mul(r, cos(a)), awash, mul(r, sin(a))), scale: add(0.8, mul(mod(mul(i, 0.37), 1), 0.5)) };
});
const debris = [
  draw.points("barrels", place(scatter(11, 6, 19, 0.3, -0.12), vortex), barrel),
  draw.points("planks", place(scatter(9, 7, 20, 1.9, 0.02), vortex), plank),
];

// ---- the serpent, coiled ----------------------------------------------------------------------------------------
// The serpent as authored (head toward +x, around the origin), laid across the whirlpool 30 degrees off the flow,
// tail inward: that is its spine in whirlpool coordinates, and the whirlpool winds it into a coil. Laid along a radius it
// was wound 2.8 to 3 times its length (6 times locally) and read as a thin ribbon; across the flow a line keeps its
// radius, so the tilt sets how tightly it coils (1.4 times its length here, scratch measurement 2026-11-11). Its girth
// stays as authored: the crests, spikes and head ride the authored body's skin, so a thicker coiled body buries them.
const RADIAL = 2.2, OFF_FLOW = 0.5;
const heading = RADIAL + Math.PI / 2 - OFF_FLOW;
const shift: Chart = rigid({
  o: vec3(13.5 * Math.cos(RADIAL), 0, 13.5 * Math.sin(RADIAL)),
  x: vec3(Math.cos(heading), 0, Math.sin(heading)), y: vec3(0, 1, 0), z: vec3(-Math.sin(heading), 0, Math.cos(heading)),
});
const coil = compose(vortex, shift);
// The body again from its spec, with more stations: in the coil it is several times longer than as authored.
const body = place(strand({ ...bodySpec, name: "serpentCoil", stations: 150, detail: { along: 640, around: 28 } }), coil);
/** Carry one of the serpent's parts into the coil (a thin dispatcher over the kinds the serpent is made of). */
function coiled(thing: Drawable): Drawable {
  if (thing instanceof Strand) return thing.placedAs(coil, `body_${thing.name}_coil`);
  if (thing instanceof SurfaceDrawable) return thing.through(coil);
  throw new Error(`maelstrom: cannot coil "${thing.name}"`);
}
// The serpent scene's own things after its sky, sea and shadows; its body is replaced by the coiled one above.
const parts = serpent.things.slice(3).filter((t) => t.name !== "serpent").map(coiled);

export default scene({
  ground: water,
  things: [...ships, ...debris, body, ...parts],
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    front: { kind: "perspective", eye: [44, 16, 10], target: [0, -1, 0], fovY: 0.7 },
    side: { kind: "perspective", eye: [0, 18, 48], target: [0, -1.5, 0], fovY: 0.7 },
    top: { kind: "perspective", eye: [0, 62, 0.01], target: [0, 0, 0], fovY: 0.75 },
    three: { kind: "perspective", eye: [-30, 31, 36], target: [0, -2.5, 2], fovY: 0.7 },
    wall: { kind: "perspective", eye: [-4, 5, 26], target: [-3, -1, 6], fovY: 0.6 },
    throat: { kind: "perspective", eye: [10, 12, 14], target: [0, -3.5, 0], fovY: 0.7 },
  },
});

// One brig under sail on a swell, close enough to see the rigging. Everything about the ship is in its named numbers
// (examples/recipes/ship.ts); it floats with `afloat`, so it rides the swell with no animation code, and its yards, sails and
// pennant answer the wind in its own frame.
import { scene, sea, toon } from "../src/index.ts";
import { ship } from "./recipes/ship.ts";

export const brigSpec = {
  name: "brig",
  // hull
  length: 11, beam: 3.3, depth: 1.25, freeboard: 1.05, sheer: [0.35, 0.55], castle: [0.25, 0],
  entry: 2.1, run: 2.6, fullness: 2.7, tumblehome: 0.1, transom: 0.55, rake: 0.5,
  // rig
  masts: 2, mastHeight: 11, mastRake: 0.06, tiers: 3, yard: 2.1, spanker: 1, jibs: 2, bowsprit: 3.6,
  // sailing
  billow: 0.15, flutter: 0.05, heel: 0.12,
  ports: 7,
  colours: {
    hull: [0.2, 0.13, 0.1], bottom: [0.72, 0.42, 0.22], wale: [0.06, 0.05, 0.05], trim: [0.92, 0.7, 0.16], deck: [0.78, 0.62, 0.42],
    spar: [0.42, 0.28, 0.16], cloth: [0.97, 0.93, 0.82], rope: [0.16, 0.11, 0.08], team: [0.82, 0.12, 0.14],
  },
} as const;

const WIND = [0.8, 0.6] as const;
const water = sea({
  swell: [
    { direction: [1, 0.25], length: 22, height: 0.7, speed: 2.2 },
    { direction: [0.3, 1], length: 9, height: 0.22, speed: 1.3, phase: 1.1 },
  ],
});
const brig = ship(brigSpec);

export default scene({
  ground: water,
  things: brig.afloat(water, { at: [0, 0], heading: 0.15, wind: WIND }),
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.5, 0.7, 0.45],
  cameras: {
    front: { kind: "perspective", eye: [22, 5, 4], target: [0, 4.5, 0], fovY: 0.62 },
    side: { kind: "perspective", eye: [-2, 5, 26], target: [0, 5, 0], fovY: 0.62 },
    top: { kind: "perspective", eye: [-8, 26, 12], target: [0, 3, 0], fovY: 0.62 },
    three: { kind: "perspective", eye: [-17, 7, 17], target: [0.5, 5, 0], fovY: 0.62 },
    rigging: { kind: "perspective", eye: [7, 9, 8], target: [-1, 8, 0], fovY: 0.6 },
    stern: { kind: "perspective", eye: [-19, 2.2, -7], target: [-4, 1.2, 0], fovY: 0.45 },
  },
});

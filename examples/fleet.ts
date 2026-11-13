// Three ships made by changing numbers, sailing in formation on one swell: a cutter-rigged sloop, the brig of
// examples/brig.ts, and a heavy galleon. Nothing but the specs differs; every part is assembled by `ship`.
import { scene, sea, toon } from "../src/index.ts";
import { ship, type ShipSpec } from "./recipes/ship.ts";
import { brigSpec } from "./brig.ts";

export const sloopSpec: ShipSpec = {
  name: "sloop",
  length: 7, beam: 2.2, depth: 0.95, freeboard: 0.6, sheer: [0.18, 0.32], entry: 1.7, run: 2.2, fullness: 2.1,
  deadrise: 0.35, tumblehome: 0.02, transom: 0.45, rake: 0.7,
  masts: 1, mastHeight: 9.5, mastRake: 0.04, tiers: 0, jibs: 2, bowsprit: 3,
  billow: 0.12, flutter: 0.045, heel: 0.2, ports: 0,
  colours: {
    hull: [0.12, 0.33, 0.42], bottom: [0.85, 0.85, 0.8], wale: [0.95, 0.92, 0.84], trim: [0.95, 0.92, 0.84], deck: [0.84, 0.7, 0.5],
    spar: [0.62, 0.45, 0.25], cloth: [0.98, 0.95, 0.86], rope: [0.2, 0.15, 0.1], team: [0.13, 0.45, 0.85],
  },
};

export const galleonSpec: ShipSpec = {
  name: "galleon",
  length: 17, beam: 5.2, depth: 1.9, freeboard: 1.7, sheer: [0.9, 1.1], castle: [1.6, 0.9], entry: 2.6, run: 3.2,
  fullness: 3.2, deadrise: 0.12, tumblehome: 0.2, transom: 0.7, rake: 0.42, widest: 0.5,
  masts: 3, mastHeight: 15, mastRake: 0.04, tiers: 2, yard: 1.9, spanker: 1, jibs: 1, bowsprit: 5,
  billow: 0.18, flutter: 0.06, heel: 0.07, ports: 9,
  colours: {
    hull: [0.36, 0.17, 0.1], bottom: [0.55, 0.45, 0.32], wale: [0.1, 0.07, 0.05], trim: [0.95, 0.78, 0.2], deck: [0.74, 0.56, 0.36],
    spar: [0.36, 0.23, 0.13], cloth: [0.95, 0.9, 0.76], rope: [0.15, 0.1, 0.07], team: [0.95, 0.72, 0.1],
  },
};

const WIND = [0.85, 0.5] as const;
const water = sea({
  swell: [
    { direction: [1, 0.2], length: 26, height: 0.8, speed: 2.4 },
    { direction: [0.4, 1], length: 10, height: 0.25, speed: 1.4, phase: 0.6 },
  ],
});

// In echelon, each a little ahead of the next and further out, all on the same heading.
const heading = 0.2;
const things = [
  ...ship(galleonSpec).afloat(water, { at: [-6, -12], heading, wind: WIND }),
  ...ship(brigSpec).afloat(water, { at: [6, 4], heading, wind: WIND }),
  ...ship(sloopSpec).afloat(water, { at: [16, 17], heading, wind: WIND }),
];

export default scene({
  ground: water,
  things,
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.5, 0.7, 0.45],
  cameras: {
    front: { kind: "perspective", eye: [52, 9, 18], target: [4, 5, 2], fovY: 0.62 },
    side: { kind: "perspective", eye: [-6, 9, 62], target: [4, 5, 2], fovY: 0.62 },
    top: { kind: "perspective", eye: [-30, 55, 30], target: [4, 2, 2], fovY: 0.62 },
    three: { kind: "perspective", eye: [-34, 14, 48], target: [4, 5, 2], fovY: 0.62 },
  },
});

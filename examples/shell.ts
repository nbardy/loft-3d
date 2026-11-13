// A seashell written directly as a function of (u, v): a circle swept along a logarithmic spiral (Raup's coiling), its
// normal taken from the map itself. Its paint is one tile drawn in one cell of a fold: shell coordinates already grow
// exponentially with the turn, so a sheared repeat in (turn, round) is a log-spiral tiling of the surface, and every
// tile is the same motif at its own scale.
import {
  abs, add, cos, exp, f, lift, mix, mul, scene, sea, sin, spacing, surface, draw, tile, toon, vec2, vec3, type F,
} from "../src/index.ts";
import { fold2, compose, type Fold } from "../src/lib/fold.ts";
import { coverage, hash2, hsv, rotate2, sdBox } from "../src/lib/index.ts";

const TURNS = 3.2, GROWTH = 0.16, APERTURE = 0.62, OFFSET = 1.1, RISE = 0.9;
const TAU = Math.PI * 2;

const shell = surface((u: F, v: F) => {
  const th = mul(u, TAU * TURNS), ph = mul(v, TAU);
  // Scale 1 at the mouth (u = 1), shrinking by e^(-GROWTH) per radian toward the apex.
  const s = exp(mul(sub1(u), -GROWTH * TAU * TURNS));
  const ring = mul(add(OFFSET, mul(cos(ph), APERTURE)), s);
  // Coiled in the xy plane, standing on the water, the spire rising along z.
  return mul(vec3(mul(ring, cos(th)), mul(ring, sin(th)), add(mul(mul(sin(ph), APERTURE), s), mul(sub1(u), RISE))), 1.5).add(vec3(0, 2.15, 0));
}, { u: ["pole", "free"], v: "periodic" });
function sub1(u: F): F { return mul(add(u, -1), -1); }

// 7 cells round the tube, 9 per turn along it, sheared one cell round per cell along: spiral rows that close at the
// seam (the shear and the counts are integers). One rounded tile per cell, its hue from the cell's identity.
const CELLS_ROUND = 7, CELLS_TURN = 9;
const shear: Fold<"vec2"> = (pp) => {
  const p = lift<"vec2">(pp);
  return { x: vec2(mul(p.x, CELLS_TURN * TURNS), add(mul(p.y, CELLS_ROUND), mul(p.x, CELLS_TURN * TURNS))), id: vec2(0, 0), stretch: f(1), toWorld: (d) => d };
};
const paint = tile(compose(shear, fold2.repeat([1, 1])), (cell) => {
  const d = sdBox(rotate2(cell.x, 0.35), vec2(0.3, 0.3)).add(-0.09);
  const hue = add(mul(hash2(cell.id), 0.12), 0.03);
  const fill = hsv(hue, 0.55, 0.98), ink = vec3(0.16, 0.07, 0.1), base = vec3(0.98, 0.9, 0.78);
  return mix(mix(base, fill, coverage(d, 0.05)), ink, coverage(abs(d).add(-0.025), 0.04));
});

export default scene({
  ground: sea({ swell: [{ direction: [1, 0.2], length: 9, height: 0.12, speed: 0.8 }] }),
  things: [draw.surface("shell", shell, { paint, grid: { u: spacing.even(220), v: spacing.even(40) }, sides: "two", outline: "none" })],
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.4, 0.8, 0.45],
  cameras: {
    three: { kind: "perspective", eye: [7, 6, 10], target: [0, 2.4, 0], fovY: 0.6 },
    side: { kind: "perspective", eye: [0, 3, 13], target: [0, 2.4, 0], fovY: 0.6 },
    top: { kind: "perspective", eye: [-3, 9, -9], target: [0, 2.2, 0], fovY: 0.6 },
    front: { kind: "perspective", eye: [12, 2.5, 1], target: [0, 2.4, 0], fovY: 0.6 },
  },
});

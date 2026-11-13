// Scenes for the bake tests: a straight cylinder with analytic geometry, a curved tapered body, and the serpent.
import { add, cos, sheetOn, draw, mul, scene, sea, sin, spacing, strand, surface, through, toon, vec3, wave, type F, type Scene } from "../src/index.ts";

const base = { ground: sea({ swell: [{ direction: [1, 0], length: 10, height: 0.2, speed: 1 }] }), style: toon(), sun: [0.3, 0.8, 0.2] as [number, number, number] };

/** Straight, constant radius, open ends: a cylinder of radius 0.5 and length 4 on the line y = 1, z = 0. */
export const CYLINDER = { radius: 0.5, length: 4, axisY: 1 };
export const cylinder = strand({
  name: "tube", spine: (m) => vec3(mul(m, CYLINDER.length), CYLINDER.axisY, 0), stations: 8, girth: CYLINDER.radius, tips: "open", paint: [0.2, 0.5, 0.8],
});
export const cylinderScene: Scene = scene({ ...base, things: [cylinder] });

/** Curved, tapered, closed with a round and a point tip, with a fin standing on it. */
export const bent = strand({
  name: "bent",
  spine: (m) => add(through(m, [[-3, 0.5, 0], [-1, 1.4, 0.8], [1, 0.9, -0.6], [3, 1.8, 0.2]]), wave(m, { axis: [0, 0, 1], waves: 1, rate: 0.5, amplitude: 0.3 })),
  stations: 16, girth: (m) => mul(add(0.2, mul(m, 0.3)), 1), section: { aspect: 0.8, squareness: 2.5 }, tips: [{ round: 0.1 }, { point: 0.2 }],
  paint: (m, v) => vec3(m, v, 0.5),
});
export const bentFin = sheetOn({ on: bent, name: "bent_crest", from: 0.2, to: 0.8, height: 0.6, paint: [0.9, 0.3, 0.3] });
export const bentScene: Scene = scene({ ...base, things: [bent, bentFin] });

/** A torus written directly as a map of (u, v), periodic both ways: no strand, no table, its normal from the map. */
export const torusScene: Scene = scene({ ...base, things: [draw.surface("torus", surface((u: F, v: F) => {
  // v runs round the tube clockwise seen along +u, so d/du x d/dv points out of the tube.
  const a = mul(u, Math.PI * 2), b = mul(v, -Math.PI * 2), ring = add(2, mul(cos(b), 0.6));
  return vec3(mul(ring, cos(a)), add(mul(sin(b), 0.6), 1), mul(ring, sin(a)));
}, { u: "periodic", v: "periodic" }), { paint: () => vec3(0.5, 0.5, 0.5), grid: { u: spacing.even(16), v: spacing.even(8) }, sides: "one", outline: "none" })] });

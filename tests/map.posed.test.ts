// A copy scaled along each axis (`size.axes`, added 2026-11-11 for the ghost fleet's spars, rags and splashes, which
// stretched their frames by hand and fixed the normals by hand: examples/bosses/tithe/kit.ts). The drawn normal is the
// surface's own normal turned by the cofactor of the scale; the bug this catches is turning it by the scale itself (or
// not at all), which leans every normal toward the long axis and lights a stretched ball as if it were round. Measured
// against the posed map's own normal by finite differences, on a ball stretched 3 : 0.4 : 1.5 and turned.
import { expect, test } from "bun:test";
import { compileJs, cos, dot, lift, mul, sin, variable, vec3 } from "../src/expr.ts";
import { posed, size, turn } from "../src/map/chart.ts";
import { framedPose, mapNormal, surface } from "../src/map/surface.ts";

test("normals of a copy scaled along each axis match its map's own normals", () => {
  // A unit ball, u from pole to pole; the front faces out.
  const ball = surface((u, v) => {
    const a = mul(u, Math.PI), b = mul(v, -2 * Math.PI);
    return vec3(mul(sin(a), cos(b)), cos(a), mul(sin(a), sin(b)));
  }, { u: ["pole", "pole"], v: "periodic" });
  const copies = posed(2, (i) => ({ at: [1, 2, 3], turn: turn.about(lift<"vec3">([0.6, 0, 0.8]), mul(i, 0.7).add(0.3)), size: size.axes([3, 0.4, 1.5]) }));
  const U = variable("u", "f32"), V = variable("v", "f32");
  for (const k of [0, 1]) {
    const s = framedPose(ball, copies.at(lift<"f32">(k)));
    const run = compileJs([s.normal(U, V), mapNormal(s.point)(U, V), dot(s.normal(U, V), mapNormal(s.point)(U, V))]);
    let worst = 1;
    for (let i = 1; i < 12; i++) for (let j = 0; j < 16; j++) {
      const [, , d] = run({ vars: { u: i / 12, v: j / 16 }, inputs: {}, params: {} }) as [number[], number[], number];
      worst = Math.min(worst, d);
    }
    // Finite differences of the map at a step of 1e-3 are accurate to about 1e-6 here; the wrong transform is off by
    // tens of degrees on this ball (cos well under 0.9).
    expect(worst).toBeGreaterThan(1 - 1e-4);
  }
});

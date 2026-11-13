// Tables as functions (src/map/table.ts): a tabulated function interpolates its source, and where it is filled decides
// what it follows.
import { expect, test } from "bun:test";
import { draw, mul, param, scene, sea, sin, spacing, surface, tabulate, toon, variable, vec3, type F } from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { stateAt } from "./compile.harness.ts";

const amp = param("tab.amp", 1);
const source = (x: F): F => mul(sin(mul(x, Math.PI * 2)), amp);
const N = 64;
const byFrame = tabulate("tabFrame", source, N, "frame");
const once = tabulate("tabStatic", source, N, "static");
const strip = draw.surface("strip", surface((u, v) => vec3(u, byFrame(u).add(once(u)), v), { u: ["free", "free"], v: "free" }), {
  paint: () => vec3(1, 1, 1), grid: { u: spacing.even(8), v: spacing.even(1) }, sides: "two", outline: "none",
});

// Catches: an interpolant reading the wrong neighbour or weight (an off-by-one in the cell, the fraction taken from the
// wrong end), a table not filled, a frame table that ignores a param change, or a static one that follows it.
test("a tabulated function interpolates its source within the linear-interpolation bound", () => {
  const c = compileScene(scene({ ground: sea({ swell: [] }), things: [strip], style: toon(), sun: [0, 1, 0] }));
  const x = variable("x", "f32");
  const run = c.cpu([byFrame(x), once(x), source(x)]);
  // |f - interpolant| <= h^2 / 8 max|f''|, with f'' = (2 pi)^2 amp and h = 1 / (N - 1).
  const bound = (amp: number) => ((1 / (N - 1)) ** 2 / 8) * (2 * Math.PI) ** 2 * amp;
  for (const a of [1, 2.5]) {
    const frame = c.frame(stateAt(c.artefact, 0, { params: { "tab.amp": a } }));
    let worstFrame = 0, worstStatic = 0;
    for (let k = 0; k <= 1000; k++) {
      const [f, s, want] = run(frame, { x: k / 1000 }) as number[];
      worstFrame = Math.max(worstFrame, Math.abs(f - want));
      // Static: filled once at compile time with the param at its default, 1.
      worstStatic = Math.max(worstStatic, Math.abs(s - want / a));
    }
    expect(worstFrame).toBeLessThan(bound(a) * 1.01);
    // Not exact: it is the interpolant, not the source evaluated again.
    expect(worstFrame).toBeGreaterThan(bound(a) * 0.5);
    expect(worstStatic).toBeLessThan(bound(1) * 1.01);
  }
});

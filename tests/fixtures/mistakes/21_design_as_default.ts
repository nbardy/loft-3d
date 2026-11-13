// mistake: a design exported as the default export (Loft looks for `export const design`)
// expect: load
import { design as makeDesign, draw, scene, vec3 } from "../../../src/index.ts";
import { ball, cameras, grid, style, water } from "./_parts.ts";

export default makeDesign({
  name: "ballDesign",
  numbers: { r: 0.9, g: 0.4, b: 0.2 },
  slots: { colour: { base: { about: "orange" }, blue: { about: "blue", numbers: { r: 0.2, b: 0.9 } } } },
  variants: {},
  compare: ["three"],
  build: (_picked, n) => ({
    scene: scene({ ground: water, style, sun: [0.3, 0.8, 0.4], cameras, things: [draw.surface("ball", ball, { paint: () => vec3(n.r, n.g, n.b), grid, sides: "one", outline: "hull" })] }),
    checks: [], strikes: {}, holds: {}, waves: {},
  }),
});

// mistake: an import the library does not export (a misspelt or invented name)
// expect: load
// @ts-expect-error: tsc refuses this import too; the fixture checks what render says
import { draw, scene, spiralTub } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

const tube = spiralTub(1, 0.2);
export default scene({ ground: water, things: [draw.surface("tube", tube, { paint, grid, sides: "one", outline: "hull" }), draw.surface("ball", ball, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

// mistake: a shape slot given undefined (a variable used before it was assigned)
import { draw, scene, type Surface } from "../../../src/index.ts";
import { cameras, grid, paint, style, water } from "./_parts.ts";

let body: Surface | undefined;
export default scene({ ground: water, things: [draw.surface("body", body!, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

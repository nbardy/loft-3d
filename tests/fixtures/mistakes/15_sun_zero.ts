// mistake: the sun given as a zero vector
import { draw, scene } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

export default scene({ ground: water, things: [draw.surface("ball", ball, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0, 0, 0], cameras });

// mistake: an option value that is not one of the choices (sides "both", outline "ink")
import { draw, scene } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

export default scene({ ground: water, things: [draw.surface("ball", ball, { paint, grid, sides: "both", outline: "ink" } as never)], style, sun: [0.3, 0.8, 0.4], cameras });

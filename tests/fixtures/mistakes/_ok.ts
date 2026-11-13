// mistake: none (the control: this one must draw)
import { draw, scene } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

export default scene({ ground: water, things: [draw.surface("ball", ball, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

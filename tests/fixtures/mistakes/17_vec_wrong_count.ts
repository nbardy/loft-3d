// mistake: vec3 built from two numbers
import { draw, scene, vec3 } from "../../../src/index.ts";
import { ball, cameras, grid, style, water } from "./_parts.ts";

export default scene({ ground: water, things: [draw.surface("ball", ball, { paint: () => vec3(0.9, 0.4), grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

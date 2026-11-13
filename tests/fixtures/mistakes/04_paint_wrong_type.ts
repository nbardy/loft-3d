// mistake: paint returns a number, not a colour (vec3)
import { draw, scene, type F } from "../../../src/index.ts";
import { ball, cameras, grid, style, water } from "./_parts.ts";

const grey = ((u: F) => u) as never; // tsc refuses this; a scene run without tsc reaches the constructor
export default scene({ ground: water, things: [draw.surface("ball", ball, { paint: grey, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

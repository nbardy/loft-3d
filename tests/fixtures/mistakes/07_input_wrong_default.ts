// mistake: an input declared with a default of the wrong size
import { add, draw, input, scene, surface, type F } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

const aim = input("aim", "vec3", [0, 1]);
const moved = surface((u: F, v: F) => add(ball.point(u, v), aim), ball.topology);
export default scene({ ground: water, things: [draw.surface("ball", moved, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

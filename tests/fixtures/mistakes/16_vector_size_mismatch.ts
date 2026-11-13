// mistake: adding a 2-vector to a 3-vector
import { add, draw, scene, surface, vec2, type F } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

const moved = surface((u: F, v: F) => add(ball.point(u, v), vec2(0, 1) as never), ball.topology);
export default scene({ ground: water, things: [draw.surface("ball", moved, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

// mistake: a number that is not finite (a division by zero) used in a shape
import { add, draw, scene, surface, vec3, type F } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

const speed = 1 / 0;
const moved = surface((u: F, v: F) => add(ball.point(u, v), vec3(0, speed, 0)), ball.topology);
export default scene({ ground: water, things: [draw.surface("ball", moved, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

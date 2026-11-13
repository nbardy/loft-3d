// mistake: a table with more entries than a GPU binding holds (ten million samples)
import { add, draw, scene, surface, tabulate, vec3, type F } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

const lift = tabulate("lift", (x: F) => x, 10_000_000, "frame");
const moved = surface((u: F, v: F) => add(ball.point(u, v), vec3(0, lift(u), 0)), ball.topology);
export default scene({ ground: water, things: [draw.surface("ball", moved, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

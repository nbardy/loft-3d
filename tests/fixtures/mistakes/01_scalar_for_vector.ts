// mistake: the surface returns a number where a point (vec3) is needed
import { draw, mul, scene, surface, type F } from "../../../src/index.ts";
import { cameras, grid, paint, style, water } from "./_parts.ts";

const flat = surface((u: F, v: F) => mul(u, v) as never, { u: ["free", "free"], v: "free" });
export default scene({ ground: water, things: [draw.surface("sheet", flat, { paint, grid, sides: "one", outline: "none" })], style, sun: [0.3, 0.8, 0.4], cameras });

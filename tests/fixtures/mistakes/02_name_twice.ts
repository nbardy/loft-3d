// mistake: two things with the same name
import { draw, scene } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

const a = draw.surface("ball", ball, { paint, grid, sides: "one", outline: "hull" });
const b = draw.surface("ball", ball, { paint, grid, sides: "one", outline: "none" });
export default scene({ ground: water, things: [a, b], style, sun: [0.3, 0.8, 0.4], cameras });

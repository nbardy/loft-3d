// mistake: the old key sea: where the scene now takes ground: (a sea, plane or nothing)
import { draw, scene } from "../../../src/index.ts";
import { ball, cameras, grid, paint, style, water } from "./_parts.ts";

// @ts-expect-error: the type checker refuses this too; the fixture checks what render says
export default scene({ sea: water, things: [draw.surface("ball", ball, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

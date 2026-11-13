// mistake: a surface sampled with zero cells
import { draw, scene, spacing } from "../../../src/index.ts";
import { ball, cameras, paint, style, water } from "./_parts.ts";

export default scene({ ground: water, things: [draw.surface("ball", ball, { paint, grid: { u: spacing.even(0), v: spacing.even(32) }, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4], cameras });

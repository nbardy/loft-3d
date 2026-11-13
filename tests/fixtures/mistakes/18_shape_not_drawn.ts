// mistake: a shape put in things without draw.surface (a Surface is not a drawable)
import { scene } from "../../../src/index.ts";
import { ball, cameras, style, water } from "./_parts.ts";

export default scene({ ground: water, things: [ball as never], style, sun: [0.3, 0.8, 0.4], cameras });

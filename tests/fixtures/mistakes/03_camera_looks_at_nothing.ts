// mistake: a camera whose eye is its target (it looks at nothing)
import { draw, scene } from "../../../src/index.ts";
import { ball, grid, paint, style, water } from "./_parts.ts";

export default scene({
  ground: water, things: [draw.surface("ball", ball, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4],
  cameras: { three: { kind: "perspective", eye: [0, 1.5, 0], target: [0, 1.5, 0], fovY: 0.6 } },
});

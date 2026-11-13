// mistake: a camera's field of view given in degrees (60), where radians are meant
import { draw, scene } from "../../../src/index.ts";
import { ball, grid, paint, style, water } from "./_parts.ts";

export default scene({
  ground: water, things: [draw.surface("ball", ball, { paint, grid, sides: "one", outline: "hull" })], style, sun: [0.3, 0.8, 0.4],
  cameras: { three: { kind: "perspective", eye: [5, 4, 6], target: [0, 1.5, 0], fovY: 60 } },
});

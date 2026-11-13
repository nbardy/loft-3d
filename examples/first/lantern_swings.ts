// The lantern hung from a post, swinging, its shadow moving on the ground. Motion is an expression of `time`: the
// swing angle is a sine of it, and every point of the rope and the lantern is written from that angle, so the GPU
// poses them each frame with no animation code. The scene comes round every PERIOD seconds.
import { add, cos, mul, plane, scene, sin, strand, sub, through, time, toon, vec3, type F } from "../../src/index.ts";
import { paper, radius, SUN } from "./lantern.ts";

const PERIOD = 2.6, SWING = 0.32;
const HOOK = [0, 3.4, 0] as const, ROPE = 0.45, HEIGHT = 1.8;

/** The swing angle from straight down, radians: a pendulum's small swing, one period every PERIOD seconds. */
const angle = mul(sin(mul(time, (2 * Math.PI) / PERIOD)), SWING);
/** A point `along` units down the rope's line from the hook, at this moment. */
const down = (along: F) => add(vec3(...HOOK), mul(vec3(sin(angle), mul(cos(angle), -1), 0), along));

const post = strand({
  name: "post",
  // Up from the ground and over in a crook to just above the hook.
  spine: (m) => through(m, [[-1.4, 0, 0], [-1.4, 2.6, 0], [-1.3, 3.5, 0], [-0.7, 3.75, 0], [0, 3.48, 0]]),
  girth: 0.06,
  tips: ["open", "round"],
  paint: [0.24, 0.16, 0.1],
});

const rope = strand({
  name: "rope",
  spine: (m) => down(mul(m, ROPE)),
  girth: 0.015,
  tips: "open",
  paint: [0.12, 0.09, 0.07],
});

// The lantern's foot (m = 0) hangs lowest: m = 1 is where the rope ends.
const lantern = strand({
  name: "lantern",
  spine: (m) => down(add(ROPE, mul(sub(1, m), HEIGHT))),
  girth: radius,
  tips: "open",
  paint: (m) => paper(m),
});

export default scene({
  ground: plane,
  things: [post, rope, lantern],
  style: toon(),
  sun: SUN,
  period: PERIOD,
  cameras: {
    three: { kind: "perspective", eye: [4.4, 3.2, 6.0], target: [-0.2, 1.9, 0], fovY: 0.62 },
    side: { kind: "perspective", eye: [0.4, 2.2, 9], target: [-0.3, 1.9, 0], fovY: 0.6 },
  },
});

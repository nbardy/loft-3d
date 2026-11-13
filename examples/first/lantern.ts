// A first scene: a paper lantern standing on the ground. One swept body (a strand: a circle swept along a spine, its
// radius a function of the way along it), a plain ground, a sun and a camera. Draw it with
//   bun src/cli/main.ts render examples/first/lantern.ts --views three,low --out out/lantern.webp
// and in another style with --style woodblock (or biolume, papercraft).
import { abs, add, cos, mix, mul, plane, scene, sin, smoothstep, strand, sub, toon, vec3, type F } from "../../src/index.ts";

const HEIGHT = 1.8, WIDEST = 0.75, RIBS = 14;

/** m runs 0 at the foot to 1 at the top: the radius there. */
export function radius(m: F): F {
  // A round belly (half a sine), pinched a little at every rib of the paper's bamboo frame.
  const belly = add(0.16, mul(sin(mul(m, Math.PI)), WIDEST - 0.16));
  const rib = abs(cos(mul(m, Math.PI * RIBS)));
  return mul(belly, sub(1, mul(sub(1, rib), 0.05)));
}

export const lantern = strand({
  name: "lantern",
  // A straight spine up from the ground (y is up; the ground is y = 0).
  spine: (m) => vec3(0, add(0.04, mul(m, HEIGHT)), 0),
  girth: radius,
  // Open ends: the paper is a tube; the wooden caps are paint.
  tips: "open",
  paint: (m) => paper(m),
});

/** Red paper, a darker line on every rib, and black lacquered caps top and bottom. */
export function paper(m: F): ReturnType<typeof vec3> {
  const red = vec3(0.86, 0.2, 0.12);
  const ribs = mix(red, vec3(0.5, 0.08, 0.06), smoothstep(0.9, 0.98, abs(cos(mul(m, Math.PI * RIBS)))));
  const cap = add(smoothstep(0.08, 0.06, m), smoothstep(0.92, 0.94, m));
  return mix(ribs, vec3(0.08, 0.06, 0.06), cap);
}

export const cameras = {
  three: { kind: "perspective", eye: [4.2, 2.4, 5.2], target: [0, 0.9, 0], fovY: 0.6 },
  low: { kind: "perspective", eye: [5.5, 0.6, 1.5], target: [0, 1.0, 0], fovY: 0.55 },
} as const;

export const SUN = [-0.55, 0.75, 0.35] as const;

export default scene({
  ground: plane,
  things: [lantern],
  style: toon(),
  sun: SUN,
  cameras,
});

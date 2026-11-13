// Shells within shells receding toward a point: one shell, drawn through the recursive scale fold (`repeatScale`), so
// every shell is the same motif at ratio^k, without end toward the centre. Each shell is cut open by a wedge that turns
// a little with every level, so the openings form a spiral stair into the nest and each shell shows the next inside it.
// Sphere-traced per pixel (draw.field); the march ends at the pixel footprint, so the infinite recursion costs no more
// than the shells big enough to see.
import { add, bound, cos, sin, dot, draw, length, max, min, mix, mul, normalize, scene, sea, sub, toon, vec3, type F, type P3 } from "../src/index.ts";
import { fold3, hsv, sdSphere, shell, smax } from "../src/lib/index.ts";

const RATIO = 1.5;
/** The shells' common centre and the outermost shell's radius. */
const CENTRE: [number, number, number] = [0, 1.1, 0];
const OUTER = 2.3;
/** In a shell's own frame: radius 1, wall thickness, and how far the wedge turns per level. */
const THICK = 0.12, TURN = 0.5;

/**
 * The shell of level k in its own coordinates: a sphere's skin with a round window cut in it. The window is a cone
 * about a direction tilted up from the horizon and turned by k, so the windows of successive shells climb in a spiral
 * and each looks onto the next shell in.
 */
function motif(x: P3, k: F): F {
  const turn = add(mul(k, TURN), 0.8);
  const axis = vec3(mul(cos(turn), COS_UP), SIN_UP, mul(sin(turn), COS_UP));
  const skin = shell(sdSphere(x, 1), THICK);
  // Signed distance to the cone of half-angle WINDOW about the axis (negative inside), for points on the axis's side:
  // s cos(a) - c sin(a), with c along the axis and s across it. Cutting it away is max(skin, -cone).
  const c = dot(x, axis), across = length(sub(x, mul(axis, c)));
  return smax(skin, sub(mul(c, Math.sin(WINDOW)), mul(across, Math.cos(WINDOW))), 0.04);
}
const UP = 0.45, COS_UP = Math.cos(UP), SIN_UP = Math.sin(UP), WINDOW = 0.8;

const scaleFold = fold3.repeatScale(RATIO, (1 + RATIO) / (2 * RATIO));

/**
 * Distance to the nest. A point sees its own shell and two neighbours each way: through the windows a shell two levels
 * off can be the nearest. With only one each way the field jumped at the fold's walls and the safety check refused it
 * (measured Lipschitz constant 12.9).
 */
function nest(p: P3): { d: F; k: F } {
  const q = sub(p, vec3(...CENTRE));
  const g = scaleFold(q);
  const k = g.id.x;
  const at = (j: number): F => {
    const s = mul(g.stretch, Math.pow(RATIO, j));
    return mul(motif(mul(g.x, Math.pow(RATIO, -j)), add(k, j)), s);
  };
  const d = [-2, -1, 1, 2].reduce((m, j) => min(m, at(j)), at(0));
  // Shells beyond the outermost are cut away by the bounding sphere.
  return { d: max(d, sub(length(q), OUTER + THICK)), k };
}

const field = (p: P3): F => nest(p).d;

/** Hue by shell; the inside of each shell lighter than its outside, so the nesting reads at a glance. */
const paint = ({ p, normal }: { p: P3; normal: P3 }): P3 => {
  const q = sub(p, vec3(...CENTRE));
  const g = scaleFold(q);
  // The shell this point is on: the folded radius tells whether it is the point's own shell or the next one out.
  const k = g.id.x;
  const outward = dot(normal, normalize(q));
  const hue = add(mul(k, 0.17), 0.55);
  const outside = hsv(hue, 0.8, 0.95), inside = hsv(add(hue, 0.08), 0.35, 1.0);
  return mix(inside, outside, outward.mul(0.5).add(0.5));
};

const drawn = draw.field("nest", field, {
  bounds: bound.sphere(CENTRE, OUTER + THICK + 0.05),
  paint,
  steps: 128,
  outline: "silhouette",
  schedule: "auto",
});

export default scene({
  ground: sea({ swell: [{ direction: [1, 0.2], length: 9, height: 0.16, speed: 0.9 }] }),
  things: [drawn],
  style: toon({ bands: 3, shadow: [0.55, 0.5, 0.85] }),
  sun: [-0.4, 0.8, 0.45],
  cameras: {
    three: { kind: "perspective", eye: [-4.2, 4.4, 7.2], target: [0, 1.0, 0], fovY: 0.62 },
    front: { kind: "perspective", eye: [0.01, 1.6, 8.5], target: [0, 1.0, 0], fovY: 0.62 },
    side: { kind: "perspective", eye: [8.5, 1.6, 0.01], target: [0, 1.0, 0], fovY: 0.62 },
    top: { kind: "perspective", eye: [0.01, 9, 0.01], target: [0, 1, 0], fovY: 0.62 },
    close: { kind: "perspective", eye: [-0.25, 1.9, 2.9], target: [0, 1.15, 0], fovY: 0.62 },
  },
});

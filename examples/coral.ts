// A branching reef grown by a kaleidoscopic fold, sphere-traced per pixel (draw.field), rising through the sea.
//
// One branch is drawn, then space is folded into its children's frame (to the tip, turn, mirror, tilt, shrink) and
// the branch is drawn again: `grow` runs that as a real loop, so the tree has 2^levels tips for `levels` branch
// evaluations. The depth falls with distance (a branch thinner than a pixel is not drawn). Where the reef breaks the
// water the sea's contact foam finds it through the depth the tracer writes.
import { abs, add, lt, min, select, div, draw, f, log, max, mix, mul, scene, sea, step, sub, toon, vec2, vec3, type F, type P3 } from "../src/index.ts";
import { bound } from "../src/draw/trace.ts";
import { fieldPixel } from "../src/draw/field.ts";
import { grow, hash3, hsv, levels, rotate2, sdRoundCone, type Folded } from "../src/lib/index.ts";

/** Trunk length and radius, child-to-parent size ratio, tilt of each child, turn of each level. */
const L = 1.5, R = 0.3, K = 0.76, TILT = 0.5, TURN = 2.4;
const MAX_LEVELS = 10;
/** Where the reef stands: the trunk's foot, on a seabed well below the water. */
const FOOT: [number, number, number] = [0, -3.2, 0];

/** Levels worth drawing at this pixel size: stop once a branch is thinner than half a pixel. */
const depth = levels(2, MAX_LEVELS, add(1, div(log(div(2 * R, max(fieldPixel, 1e-6))), Math.log(1 / K))));

const turnY = (q: P3, a: F): P3 => { const r = rotate2(vec2(q.x, q.z), a); return vec3(r.x, q.y, r.y); };

const coral = grow({
  count: depth,
  // A tapering branch from the level's origin up its y axis.
  motif: (q) => sdRoundCone(q, [0, 0, 0], [0, L, 0], R, R * 0.8),
  step: (q, level): Folded<"vec3"> => {
    // To the tip; turn (so successive forks branch in different planes); mirror across x (two children); tilt the
    // child's axis upright; magnify (the child is K times smaller, so its coordinates are 1 / K times larger).
    const tip = turnY(sub(q, vec3(0, L, 0)), f(TURN));
    const r = rotate2(vec2(abs(tip.x), tip.y), TILT);
    return { x: div(vec3(r.x, r.y, tip.z), K), id: vec3(step(0, tip.x), 0, 0), stretch: f(K), toWorld: (d) => mul(d, K) };
  },
});

/**
 * Three trees round the reef's centre, each turned and sized differently. Not a polar repeat: the crowns reach across
 * the sector walls, so a repeat's field jumps there (the safety check measured a Lipschitz constant of 98 and refused
 * it); with three sectors the neighbours a repeat would need are all three trees anyway.
 */
const TREES: readonly { at: [number, number]; size: number; turn: number }[] = [
  { at: [0, 1.9], size: 1.0, turn: 0 },
  { at: [1.75, -1.0], size: 0.84, turn: 2.1 },
  { at: [-1.6, -0.9], size: 0.72, turn: 4.0 },
];
const trees = (p: P3) => TREES.map((t, k) => {
  const q = turnY(sub(p, vec3(FOOT[0] + t.at[0], FOOT[1], FOOT[2] + t.at[1])), f(t.turn));
  const g = coral(div(q, t.size));
  return { d: mul(g.d, t.size), level: g.level, id: add(g.id, vec3(0, k, 0)) };
}).reduce((a, b) => {
  const nearer = lt(b.d, a.d);
  return { d: min(a.d, b.d), level: select(nearer, b.level, a.level), id: select(nearer, b.id, a.id) };
});
const at = (p: P3): P3 => p;
const field = (p: P3): F => trees(p).d;

const paint = ({ p }: { p: P3 }): P3 => {
  const g = trees(p);
  // Hue climbs from magenta at the root to warm yellow at the tips; each branch nudged by a hash of its path.
  const t = div(g.level, MAX_LEVELS);
  const hue = add(mix(0.93, 1.13, t), mul(sub(hash3(g.id), 0.5), 0.06));
  return hsv(hue, mix(0.85, 0.7, t), mix(0.8, 1.0, t));
};

const reef = draw.field("coral", field, {
  bounds: bound.box([-4.2, -3.6, -4.2], [4.2, 3.4, 4.2]),
  paint,
  steps: 96,
  outline: "silhouette",
  schedule: "auto",
});

export default scene({
  ground: sea({ swell: [{ direction: [1, 0.35], length: 11, height: 0.22, speed: 1.1 }, { direction: [-0.3, 1], length: 5, height: 0.06, speed: 0.7 }], foam: 0.35 }),
  things: [reef],
  style: toon({ bands: 3, shadow: [0.66, 0.5, 0.86] }),
  sun: [-0.5, 0.75, 0.35],
  cameras: {
    three: { kind: "perspective", eye: [9, 5.5, 10], target: [0, 0.4, 0], fovY: 0.62 },
    front: { kind: "perspective", eye: [0, 1.2, 13], target: [0, 0.4, 0], fovY: 0.62 },
    side: { kind: "perspective", eye: [13, 1.2, 0], target: [0, 0.4, 0], fovY: 0.62 },
    top: { kind: "perspective", eye: [0.01, 14, 0.01], target: [0, 0, 0], fovY: 0.62 },
    close: { kind: "perspective", eye: [2.6, 1.6, 3.4], target: [0, 0.6, 0], fovY: 0.62 },
  },
});

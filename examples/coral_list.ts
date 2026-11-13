// The reef of coral.ts, listed instead of asked (docs/tracing_sota.md 5.3).
//
// coral.ts folds space and sphere-traces the folded field: `levels` branch evaluations per step of a march, for every
// pixel of the reef's bound. Here the same fold is run backwards into the list of branches it makes (`tree.branches`),
// and each branch is one instance, intersected exactly where it is on screen (`draw.copies`). One description, the
// chain of generators below, gives both readings; tests/similar.test.ts checks that they agree.
//
// The numbers, cameras, sea and style are coral.ts's, so the two pictures can be compared.
import { add, div, draw, f, mix, mul, scene, sea, sub, toon } from "../src/index.ts";
import { gen, hash3, hsv, list, tree, WORLD, type Branch } from "../src/lib/index.ts";

/** Trunk length and radius, child-to-parent size ratio, tilt of each child, turn of each level. */
const L = 1.5, R = 0.3, K = 0.76, TILT = 0.5, TURN = 2.4;
const MAX_LEVELS = 10;
const FOOT: [number, number, number] = [0, -3.2, 0];

/** A tapering branch up the level's y axis; then to the tip, turn, mirror across x (two children), tilt, shrink. */
export const coral = tree({
  part: { kind: "cone", a: [0, 0, 0], b: [0, L, 0], ra: R, rb: R * 0.8 },
  step: [gen.shift([0, L, 0]), gen.turn("xz", TURN), gen.mirror("x"), gen.turn("xy", TILT), gen.shrink(K)],
});

/** Three trees round the reef's centre, each turned and sized differently. */
export const TREES: readonly { at: [number, number]; size: number; turn: number }[] = [
  { at: [0, 1.9], size: 1.0, turn: 0 },
  { at: [1.75, -1.0], size: 0.84, turn: 2.1 },
  { at: [-1.6, -0.9], size: 0.72, turn: 4.0 },
];
/** A tree's placement, as a chain: the same generators place a point (asked) and a frame (listed). */
export const placement = (t: (typeof TREES)[number]) => [gen.shift([FOOT[0] + t.at[0], FOOT[1], FOOT[2] + t.at[1]]), gen.turn("xz", t.turn), gen.shrink(t.size)];

const branches: Branch[] = TREES.flatMap((t, k) => {
  const root = list(placement(t), WORLD)[0]!.frame;
  return coral.branches(MAX_LEVELS, root).map((b) => ({ ...b, id: [b.id[0], b.id[1] + k, b.id[2]] as const }));
});

const reef = draw.copies("coral", {
  kind: "cone",
  copies: branches,
  // coral.ts's paint, with the branch's level and id given instead of found by a second evaluation of the field.
  paint: ({ level, id }) => {
    const t = div(level, MAX_LEVELS);
    const hue = add(mix(0.93, 1.13, t), mul(sub(hash3(id), 0.5), 0.06));
    return hsv(hue, mix(0.85, 0.7, t), mix(f(0.8), 1.0, t));
  },
  outline: "silhouette",
  // coral.ts stops folding once a branch is thinner than a pixel, and always draws two levels.
  minPixels: 1,
  keepLevels: 2,
  inkBack: 8,
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

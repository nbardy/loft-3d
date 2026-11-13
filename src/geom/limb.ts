// A chain of two or three straight segments reaching from a root toward a target by closed-form inverse kinematics
// (the law of cosines): a leg, an arm, a crane's jib, a desk lamp. See `chain`.

import { abs, add, clamp, div, dot, length, lift, lt, max, mix, mul, select, sqrt, sub, type In } from "../expr.ts";
import type { F, P3 } from "../map/types.ts";

export type ChainSpec = {
  /** Where the limb leaves the body (the hip or shoulder). */
  readonly root: In<"vec3">;
  /** Where the foot (or hand) should be. */
  readonly target: In<"vec3">;
  /** Segment lengths, root first: two (upper, lower) or three (upper, lower, foot). */
  readonly lengths: readonly [In<"f32">, In<"f32">] | readonly [In<"f32">, In<"f32">, In<"f32">];
  /** The side the middle joint bends toward (a knee forward, or up and out). Need not be unit. */
  readonly bend: In<"vec3">;
  /** Three segments only: the direction the last segment points along, toward the target. Default straight down. */
  readonly foot?: In<"vec3">;
};

export type Chain = {
  /** Root, middle joint(s), tip: three points for two segments, four for three. */
  readonly joints: readonly P3[];
  /** Arc fraction of each joint (0 at the root, 1 at the tip). */
  readonly knots: readonly F[];
  /** The polyline through the joints, m in [0, 1] by arc length. */
  spine(m: F): P3;
};

/**
 * The unit vector along v, v / max(|v|, 1e-6): a zero vector stays (nearly) zero instead of becoming NaN. It cannot
 * give a direction for a vector shorter than 1e-6: such a vector comes back shorter than 1, so a caller that needs a
 * true direction there must choose one itself.
 */
export const unit = (v: P3): P3 => div(v, max(length(v), 1e-6));

/**
 * Two segments from `root` toward `target`. The distance is clamped to what the chain can span, so out of reach the
 * chain lies straight along the line to the target (and, too close, folds on that line); in reach the middle joint
 * sits where both lengths are exact, on the `bend` side of the line, and the tip lands on the target.
 */
function twoBone(root: P3, target: P3, a: F, b: F, bend: P3): readonly [P3, P3] {
  const toward = sub(target, root);
  const e = unit(toward);
  const d = clamp(length(toward), max(abs(sub(a, b)), 1e-5), add(a, b));
  const cosA = clamp(div(sub(add(mul(a, a), mul(d, d)), mul(b, b)), mul(mul(a, d), 2)), -1, 1);
  const sinA = sqrt(max(sub(1, mul(cosA, cosA)), 0));
  const n = unit(sub(bend, mul(e, dot(bend, e))));
  const knee = add(root, mul(add(mul(e, cosA), mul(n, sinA)), a));
  // The tip is the knee plus the lower length toward the target: exact in reach, and in a line with the knee out of it.
  return [knee, add(knee, mul(unit(sub(target, knee)), b))];
}

/**
 * A chain of two or three straight segments from `root` reaching toward `target`, posed by closed-form inverse
 * kinematics, so it is an expression of its root and target and needs no solver state.
 *
 * The shape and its law. Two segments: the middle joint sits where both lengths are exact (the law of cosines), on the
 * side of the root-target line that `bend` points to; out of reach the chain lies straight toward the target. Three:
 * the last segment is held along `foot`, and the first two reach its start. `spine(m)` is the polyline through the
 * joints by arc fraction, which is what a `strand` along it sweeps (pinch the girth at a joint to read as one).
 *
 * Parameters: every slot is an expression (root, target, lengths, bend, foot), so a chain follows anything that moves.
 *
 * What it cannot do, because of the law:
 * - more than three segments, or a middle joint that is not decided by the other two (a spine, a tail, a snake).
 * - bend in two planes: one `bend` direction for the whole chain, so no knee that also twists out.
 * - curved segments: each is a straight line (sweep a `strand` along a curve of your own for a curved bone).
 * - joint limits: a knee bends as far as the target asks, backward included if `bend` says so.
 * - reach past its length: the tip stops short on the line to the target.
 *
 * Going past it: the result is the mechanism (`joints`, `knots`, `spine`), and `polyline(m, points, knots)` draws a
 * spine through any joints, so adding a segment, a kink or a finger is a list edit. Relatives:
 * - many segments: FABRIK (reach forward and back along the chain a few times) is closed form for a fixed number of
 *   passes; unroll it and pass the joints to `polyline`.
 * - a chain of chains: one chain's tip as the next one's root (an arm, then a hand, then fingers).
 * - curved bones: `bent` per segment, each starting where the last ended, gives a crooked finger or a tentacle.
 * - a coil round a thing: `wrap` (in `grab.ts`) is a chain's opposite: a body that winds instead of reaches.
 */
export function chain(spec: ChainSpec): Chain {
  const root = lift<"vec3">(spec.root), target = lift<"vec3">(spec.target), bend = lift<"vec3">(spec.bend);
  const ls = spec.lengths.map((x) => lift<"f32">(x));
  const joints: P3[] = ls.length === 2 ? twoLimb(root, target, ls[0], ls[1], bend) : threeLimb(root, target, ls[0], ls[1], ls[2], bend, lift<"vec3">(spec.foot ?? [0, -1, 0]));
  const total = ls.reduce((s, x) => add(s, x));
  const knots: F[] = [lift<"f32">(0)];
  ls.forEach((l, i) => knots.push(i === ls.length - 1 ? lift<"f32">(1) : div(add(mul(knots[i], total), l), total)));
  return { joints, knots, spine: (m) => polyline(m, joints, knots) };
}

function twoLimb(root: P3, target: P3, a: F, b: F, bend: P3): P3[] {
  const [knee, tip] = twoBone(root, target, a, b, bend);
  return [root, knee, tip];
}

/**
 * Three segments: the last one is held along `foot` (so the ankle target is the foot target minus that segment), and
 * the first two reach the ankle. If the ankle is out of reach, the last segment points from wherever the ankle got to
 * toward the target, so the whole chain still reaches toward it with every length kept.
 */
function threeLimb(root: P3, target: P3, a: F, b: F, c: F, bend: P3, foot: P3): P3[] {
  const ankleTarget = sub(target, mul(unit(foot), c));
  const [knee, ankle] = twoBone(root, ankleTarget, a, b, bend);
  return [root, knee, ankle, add(ankle, mul(unit(sub(target, ankle)), c))];
}

/**
 * The point at m (0 to 1, clamped) on the broken line through `points`, point j sitting at m = knots[j]: straight
 * between neighbours, linear in m within each piece. `chain`'s spine is this through its joints; pass any joints (and
 * their arc fractions) to draw your own jointed spine.
 *
 * Parameters: `m`, the points and the knots are all expressions (the points can move); the number of points is fixed.
 *
 * What it cannot do, because it is piecewise linear:
 * - turn smoothly: the heading jumps at every point, so a strand swept along it shows a crease at each joint.
 * - check its knots: they must be as many as the points, start at 0, end at 1 and increase; anything else is not
 *   caught and gives a wrong line, not an error.
 * - keep speed: m runs at a constant rate within a piece, so equal steps in m are equal lengths only if the knots are
 *   the true arc fractions.
 *
 * Relatives, through the same points by a smoother law:
 * - `through`: a Catmull-Rom cubic through the points, with a continuous heading (a curved bone, a tail).
 * - corners rounded by a circular arc of radius r at each inner point: a bent pipe, a jointed limb with fleshy joints.
 */
export function polyline(m: F, points: readonly P3[], knots: readonly F[]): P3 {
  const x = clamp(m, 0, 1);
  const seg = (j: number): P3 => mix(points[j], points[j + 1], clamp(div(sub(x, knots[j]), max(sub(knots[j + 1], knots[j]), 1e-6)), 0, 1));
  let out = seg(points.length - 2);
  for (let j = points.length - 3; j >= 0; j--) out = select(lt(x, knots[j + 1]), seg(j), out);
  return out;
}


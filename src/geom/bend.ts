// A stalk that bends by a pose (docs/animation_principles.md, "Stalks and hanging things").
//
// A stalk posed by where its tip is (a Bezier from root to tip) can only reach: it cannot bow, crook, cross another
// or recoil, and it stretches as it leans. Here the pose is the bending itself. The stalk keeps its length; its
// heading at every point along it is a turn away from the heading at the root, and the turn is the sum of three
// bends, each two angles (radians toward `a` and toward `b`, the two directions across the stalk):
//
//   lean   the whole stalk tips over at its root joint (the same turn everywhere along it);
//   bow    it bends near the root and runs out straight: the turn has reached 3/4 of the bow by half way;
//   crook  it bends near the tip: a shepherd's crook, a neck craning, a head hung. The turn is m^sharp of the crook.
//
// heading(m) = Exp_along(lean + bow (1 - (1 - m)^2) + crook m^sharp)        spine(m) = root + length * integral_0^m heading
//
// `Exp` is the sphere's exponential map (a turn by the angle's size toward the angle's direction), so the heading is a
// unit vector for any bends and the spine is parametrised by arc length: stations are evenly spaced along the stalk
// whatever its pose, and a strand on it neither stretches nor swells. The integral is four-point Gauss-Legendre on
// [0, m]: closed form in m, no state, exact to about 1e-4 of the length for turns up to 3 radians.
//
// Read each bend on its own clock and the stalk whips: `crook` a tenth of a second behind `bow` is a tip that arrives
// late and overshoots (follow through along the stalk), with nothing more than `score.at(sub(time, lag))`.
//
// Inherited: the exponential map; Gauss-Legendre. Mine: a pose as three named turns with fixed shapes along the stalk,
// so an expression can say "bow left, crook right" (a recoil) in two numbers.

import { add, cos, div, lift, max, mul, pow, sin, sqrt, sub, type Expr, type In } from "../expr.ts";

type F = Expr<"f32">;
type P3 = Expr<"vec3">;

/** A bend: radians toward the stalk's `a`, and toward its `b`. */
export type Bend = readonly [In<"f32">, In<"f32">];

export type BentSpec = {
  /** Where the stalk is rooted. */
  readonly root: In<"vec3">;
  /** The stalk's frame at its root, three unit vectors at right angles: `along` it, and the two directions across it. */
  readonly along: In<"vec3">; readonly a: In<"vec3">; readonly b: In<"vec3">;
  readonly length: In<"f32">;
  readonly lean?: Bend; readonly bow?: Bend; readonly crook?: Bend;
  /** How near the tip the crook's bending is gathered: 1 an even arc, 2 (the default) mostly in the upper half, 4 a hook. */
  readonly sharp?: number;
};

export type Bent = {
  /** The stalk's centre line at m in [0, 1], by arc length. */
  readonly spine: (m: In<"f32">) => P3;
  /** Its unit heading there. */
  readonly heading: (m: In<"f32">) => P3;
  /** Where it ends, and which way it points there. */
  readonly tip: P3; readonly tipHeading: P3;
};

/** Raised by `bent` when `sharp` is not a finite number at least 1; it carries only the message, which names the value. */
export class BendError extends Error {}

/** Four-point Gauss-Legendre on [0, 1]: nodes and weights. */
const GAUSS: readonly (readonly [number, number])[] = [[0.0694318442, 0.1739274226], [0.3300094782, 0.3260725774], [0.6699905218, 0.3260725774], [0.9305681558, 0.1739274226]];

const NONE: Bend = [0, 0];

/**
 * A stalk that bends by a pose: an eye stalk, a neck, a stem, an antenna, a tail.
 *
 * The shape and its law. Each bend is two angles (toward `a`, toward `b`). The heading at m in [0, 1] is the root's
 * heading turned by the sphere's exponential map of lean + bow (1 - (1 - m)^2) + crook m^sharp (a turn by that
 * vector's size toward its direction), and the spine is root + length times the integral of the heading from 0 to m,
 * so the stalk keeps its length in every pose and is parametrised by arc length. The lean turns it all from the root,
 * the bow mostly near the root, the crook mostly near the tip.
 *
 * Parameters: root, frame, length and the three bends are expressions (they move; read each on its own clock and the
 * stalk whips); `sharp` is a fixed number.
 *
 * What it cannot do, because of the law:
 * - bend anywhere but by these three shapes: no S with two bows at chosen places, no kink in the middle.
 * - twist about itself (the heading turns; the stalk has no roll of its own).
 * - stretch or squash along its length.
 * - large or sharp turns exactly: the spine is a four-point Gauss-Legendre integral, off by about 4e-4 of the length
 *   at 3 radians of bow or crook, and by about 6e-3 for a 3 radian crook with `sharp` 4.
 * - keep its length on a skewed frame: `along`, `a` and `b` must be unit and at right angles, or the heading is not
 *   unit and the length is not kept (nothing checks this).
 *
 * Going past it: the heading is the law, so a bend shape of your own is a new weight in its `turn` (copy `bent`, about
 * twenty lines): any function w(m) times a bend. `bentTip` predicts a tip on the CPU. Relatives:
 * - a bend gathered at m0: the weight smoothstep(m0 - h, m0 + h, m), a joint with a soft knee anywhere along it.
 * - a wave travelling up the stalk (a swimming tail, a whip): a bend times sin(k m - w t), the turn moving outward.
 * - a clothoid, curvature growing evenly toward the tip: turn growing as m^2, which is `crook` with `sharp` 2.
 * - straight segments between hard joints: `chain`. A fixed curve that tightens as it thins: `spiralLine`.
 */
export function bent(spec: BentSpec): Bent {
  const sharp = spec.sharp ?? 2;
  if (!(sharp >= 1 && Number.isFinite(sharp))) throw new BendError(`bent: sharp must be a finite number >= 1 (1 is an even arc), got ${sharp}`);
  const root = lift<"vec3">(spec.root), along = lift<"vec3">(spec.along), a = lift<"vec3">(spec.a), b = lift<"vec3">(spec.b);
  const lean = spec.lean ?? NONE, bow = spec.bow ?? NONE, crook = spec.crook ?? NONE;
  const heading = (m: In<"f32">): P3 => {
    const s = lift<"f32">(m), one = sub(1, s);
    const wBow = sub(1, mul(one, one)), wCrook = pow(max(s, 0), sharp);
    const turn = (k: 0 | 1): F => add(add(lean[k], mul(bow[k], wBow)), mul(crook[k], wCrook));
    const ta = turn(0), tb = turn(1);
    const size = sqrt(add(add(mul(ta, ta), mul(tb, tb)), 1e-8));
    // sin(size) / size is 1 at no turn; the 1e-8 under the root keeps the quotient finite there.
    return add(mul(along, cos(size)), mul(add(mul(a, ta), mul(b, tb)), div(sin(size), size)));
  };
  const spine = (m: In<"f32">): P3 => {
    const s = lift<"f32">(m);
    const sum = GAUSS.map(([x, w]) => mul(heading(mul(s, x)), w)).reduce((acc, h) => add(acc, h));
    return add(root, mul(sum, mul(s, spec.length)));
  };
  return { spine, heading, tip: spine(1), tipHeading: heading(1) };
}

/**
 * `bent`'s tip and its heading in plain numbers, on the CPU: the same law and the same four-point integral, so it
 * predicts where the drawn tip will be before anything is drawn (for aiming a stalk, or checking a pose reaches). It
 * cannot take expressions (every input is a number), and unlike `bent` it does not check `sharp`.
 */
export function bentTip(o: {
  readonly root: readonly [number, number, number]; readonly along: readonly [number, number, number];
  readonly a: readonly [number, number, number]; readonly b: readonly [number, number, number];
  readonly length: number; readonly lean?: readonly [number, number]; readonly bow?: readonly [number, number]; readonly crook?: readonly [number, number]; readonly sharp?: number;
}): { readonly tip: readonly [number, number, number]; readonly heading: readonly [number, number, number] } {
  const sharp = o.sharp ?? 2, lean = o.lean ?? [0, 0], bow = o.bow ?? [0, 0], crook = o.crook ?? [0, 0];
  const heading = (s: number): [number, number, number] => {
    const wBow = 1 - (1 - s) * (1 - s), wCrook = Math.pow(Math.max(s, 0), sharp);
    const ta = lean[0] + bow[0] * wBow + crook[0] * wCrook, tb = lean[1] + bow[1] * wBow + crook[1] * wCrook;
    const size = Math.sqrt(ta * ta + tb * tb + 1e-8), c = Math.cos(size), k = Math.sin(size) / size;
    return [0, 1, 2].map((i) => o.along[i]! * c + (o.a[i]! * ta + o.b[i]! * tb) * k) as [number, number, number];
  };
  const sum = GAUSS.reduce<[number, number, number]>((acc, [x, w]) => { const h = heading(x); return [acc[0] + h[0] * w, acc[1] + h[1] * w, acc[2] + h[2] * w]; }, [0, 0, 0]);
  return { tip: [o.root[0] + sum[0] * o.length, o.root[1] + sum[1] * o.length, o.root[2] + sum[2] * o.length], heading: heading(1) };
}

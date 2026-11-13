// Iterated folds as real loops (`iterate` in expr.ts), so fold depth may be an expression: a traced field can lower it
// with distance (`fieldPixel` in src/draw/field.ts). fold.ts's `scaleFold` unrolls a fixed count; these are the looped
// forms the tracers use.
//
// Two shapes of recursion:
//  - `kifs`: fold, scale, repeat; then the motif once, at the final point (sponges, nested crystals).
//  - `grow`: at every level draw the motif, then move into the child's frame (trees, coral, ferns). The result is the
//    union over levels, and it also reports which level (and which mirror cell) is nearest, for paint.
//
// Both keep distances true: each level's map is a similarity (isometric folds, rotations, uniform scales), and the
// accumulated stretch is the product of the levels' stretches, so `motif * stretch` stays Lipschitz 1 at every level
// and so does their minimum. A step whose map is not a similarity breaks that; the tracer's compile-time check catches it.
import { add, clamp, div, f, floor, iterate, lift, lt, min, mod, mul, select, sub, vec3, type Expr, type In } from "../expr.ts";
import type { Fold, Folded } from "./fold.ts";

type P3 = Expr<"vec3">;
type F = Expr<"f32">;

const ID_MOD = 65521; // as fold.ts: 37 * 65521 + 65521 stays exact in f32
const combine = (a: P3, b: P3): P3 => mod(add(mul(a, 37), b), ID_MOD);

/**
 * The kaleidoscopic iterated fold with a looped count: `count` times, apply `fold` (an isometry: mirrors, rotations),
 * then scale about `offset`: q = scale q - offset (scale - 1). Stretch scale^-count (times the folds' own). `count` is
 * an expression, truncated to an integer: depth may fall with distance. Same contract as fold.ts's `scaleFold`.
 */
export function kifs(spec: { readonly count: In<"f32">; readonly fold: Fold<"vec3">; readonly scale: number; readonly offset: In<"vec3"> }): Fold<"vec3"> {
  if (!(Number.isFinite(spec.scale) && Math.abs(spec.scale) > 1)) throw new Error(`kifs: |scale| must be finite and > 1, got ${spec.scale}`);
  const o = lift<"vec3">(spec.offset), pull = spec.scale - 1, s = Math.abs(spec.scale);
  return (p): Folded<"vec3"> => {
    const [x, id, stretch] = iterate(spec.count, [lift<"vec3">(p), vec3(0, 0, 0), f(1)] as const, ([q, k, st]) => {
      const g = spec.fold(q);
      return [sub(mul(g.x, spec.scale), mul(o, pull)), combine(k, g.id), div(mul(st, g.stretch), s)] as const;
    });
    return { x, id, stretch, toWorld: (d) => mul(d, stretch) };
  };
}

/** What `grow` reports at a point: the distance, and which level and which cell the nearest part belongs to. */
export type Grown = {
  readonly d: F;
  /** Level of the nearest part: 0 the root motif, 1 its children, ... (an integer as an f32). */
  readonly level: F;
  /** The combined fold ids along the way to the nearest part (integer lanes): which branch it is. */
  readonly id: P3;
};

export type GrowSpec = {
  /** Levels drawn (an expression: truncated to an integer, so detail can fall with distance). */
  readonly count: In<"f32">;
  /** The motif in a level's own coordinates (a distance there). `level` is 0, 1, ... */
  readonly motif: (q: P3, level: F) => F;
  /**
   * From a level's coordinates to its children's: a fold whose map is a similarity (mirror into one child's side,
   * translate to the branch tip, rotate, scale up by the ratio of sizes) with its stretch (`1 / ratio`).
   */
  readonly step: (q: P3, level: F) => Folded<"vec3">;
};

/**
 * Branching recursion: the union of `motif` at every level, each level seen through all the steps before it. With a
 * mirror in `step` every level doubles (or quadruples) its copies at no cost: the tree has b^count tips and costs
 * `count` motif evaluations per query.
 */
export function grow(spec: GrowSpec): (p: In<"vec3">) => Grown {
  return (p) => {
    const init = [lift<"vec3">(p), f(1), f(1e9), f(0), vec3(0, 0, 0), vec3(0, 0, 0)] as const;
    const [, , d, level, , id] = iterate(spec.count, init, ([q, st, best, lvl, k, bestId], i) => {
      const here = mul(spec.motif(q, i), st);
      const nearer = lt(here, best);
      const g = spec.step(q, i);
      return [g.x, mul(st, g.stretch), min(best, here), select(nearer, i, lvl), combine(k, g.id), select(nearer, k, bestId)] as const;
    });
    return { d, level, id };
  };
}

/** A level-of-detail count: `x` (the wanted depth as a real number) clamped to [lo, hi] and truncated. */
export function levels(lo: number, hi: number, x: In<"f32">): F {
  return floor(clamp(x, lo, hi));
}

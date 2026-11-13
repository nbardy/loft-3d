// Folds as values (docs/folding_and_tracing.md sections 1 and 2).
//
// A fold maps a point to { x, id, stretch }: the folded coordinate, the identity of the cell the point came from, and
// the local change of length. Draw one motif at `x` and it appears at every point that folds onto it. To get a distance
// in the original space from a distance measured at `x`, multiply by `stretch` (see `fieldOf` in sdf3.ts).
//
// Conventions that hold for every fold here:
//  - `stretch` is "world length per unit length at x": 1 for isometries, 1 / s^N for N scalings by s, and so on.
//  - `id` has the dimension of the space and holds integer-valued lanes (a cell index, a sector index, a mirror side),
//    zero where a fold has nothing to say. Compose combines two ids as `(37 a + b) mod 65521`, which is exact in f32 and
//    good enough to key per-copy variation (a hash, a colour); it is not injective, so do not use it to count copies.
//  - Seams: points exactly on a seam (a cell wall, a sector wall, the atan2 cut) land on either side, and f32 and f64
//    may disagree about which. Nothing here treats a seam specially.
//  - Whether a fold gives a distance that is correct for a whole row of copies depends on the motif: "stays in its
//    cell" is spelled out in each doc comment. A motif that crosses its cell wall needs the neighbouring cells too
//    (evaluate the motif at the neighbours' folded points and take the minimum).
//
// Two families, `fold2` for the plane and `fold3` for space, share one implementation written over lanes.
import { abs, add, atan2, clamp, cos, div, dot, exp, f, floor, length, lift, log, max, min, mod, mul, neg, normalize, sin, sqrt, step, sub, TAU, vec2, vec3, type Expr, type In } from "../expr.ts";
import { rotate2 } from "./util.ts";

export type Vec = "vec2" | "vec3";
/** What a fold returns for one point. */
export type Folded<V extends Vec> = {
  /** The folded coordinate: where to evaluate the motif. */
  readonly x: Expr<V>;
  /** Which copy the point belongs to: integer-valued lanes (see the file comment). */
  readonly id: Expr<V>;
  /** Multiply a distance evaluated at `x` by this to get a distance in the original space. */
  readonly stretch: Expr<"f32">;
  /**
   * A distance measured at `x`, as a distance in the original space. For every fold except `inversion` this is
   * `d * stretch`. Inversion is the one map where a single length factor is not enough (the factor changes along the
   * way), so it supplies the exact lower bound instead; `fieldOf` always goes through this, never through `stretch`.
   */
  readonly toWorld: (d: Expr<"f32">) => Expr<"f32">;
};
/** A fold: a point to its folded form. */
export type Fold<V extends Vec> = (p: In<V>) => Folded<V>;

type S = Expr<"f32">;

/** The dimension-specific part: split a point into scalar lanes and build one from lanes. */
type Space<V extends Vec> = {
  readonly n: 2 | 3;
  lanes(p: In<V>): S[];
  make(c: readonly In<"f32">[]): Expr<V>;
};
const SPACE2: Space<"vec2"> = { n: 2, lanes: (p) => { const q = lift<"vec2">(p); return [q.x, q.y]; }, make: (c) => vec2(...c) };
const SPACE3: Space<"vec3"> = { n: 3, lanes: (p) => { const q = lift<"vec3">(p); return [q.x, q.y, q.z]; }, make: (c) => vec3(...c) };

const ONE = f(1);

/** A fold result whose distance conversion is the plain `d * stretch`. */
function folded<V extends Vec>(x: Expr<V>, id: Expr<V>, stretch: Expr<"f32">): Folded<V> {
  return { x, id, stretch, toWorld: (d) => mul(d, stretch) };
}
const ID_MOD = 65521; // largest prime below 2^16: 37 * 65521 + 65521 stays below 2^24, exact in f32

/**
 * The single place the unrolled fold iteration lives: apply `step` to `state` `count` times. `count` is a compile-time
 * number, so the emitted code grows with it. When `iterate(count, state, step)` lands in expr.ts, replace the body of
 * this function with a call to it and nothing else changes.
 */
function unrolled<T>(count: number, init: T, step: (state: T) => T): T {
  if (!Number.isInteger(count) || count < 1) throw new Error(`iteration count must be an integer >= 1, got ${count}`);
  let state = init;
  for (let i = 0; i < count; i++) state = step(state);
  return state;
}

/**
 * Apply `f` first, then `g` to f's folded point. Stretches multiply (a length at the final point is scaled by g's, then
 * by f's); ids combine as described in the file comment. Exactness is the weaker of the two: composing exact folds
 * keeps stretch exact, but a motif must then stay inside the cell of every fold in the chain.
 */
export function compose<V extends Vec>(first: Fold<V>, second: Fold<V>): Fold<V> {
  return (p) => {
    const a = first(p), b = second(a.x);
    return { x: b.x, id: mod(add(mul(a.id, 37), b.id), ID_MOD) as unknown as Expr<V>, stretch: mul(a.stretch, b.stretch), toWorld: (d) => a.toWorld(b.toWorld(d)) };
  };
}

/** Planar rotation of the lanes (i, j) into the sector nearest the +i axis out of `count`; also returns the sector index. */
function sectorFold(ci: S, cj: S, count: In<"f32">): { i: S; j: S; k: S } {
  const w = div(TAU, count);
  const k = floor(add(div(atan2(cj, ci), w), 0.5));
  const a = sub(atan2(cj, ci), mul(k, w));
  const r = length(vec2(ci, cj));
  return { i: mul(r, cos(a)), j: mul(r, sin(a)), k };
}

/** The folds that read the same in both dimensions. */
function shared<V extends Vec>(sp: Space<V>) {
  const zero = sp.make(Array(sp.n).fill(f(0)));
  const idOf = (...lead: In<"f32">[]): Expr<V> => sp.make([...lead, ...Array(sp.n - lead.length).fill(f(0))]);
  const axisCheck = (axis: number): void => {
    if (!Number.isInteger(axis) || axis < 0 || axis >= sp.n) throw new Error(`axis must be an integer in [0, ${sp.n}), got ${axis}`);
  };

  /** Identity: x = p, id = 0, stretch 1. Exact. */
  const identity: Fold<V> = (p) => folded(lift<V>(p), zero, ONE);

  /**
   * Mirror across the plane through the origin perpendicular to coordinate `axis` (`abs` of that lane). id's first lane
   * is 0 on the negative side and 1 on the positive side. Stretch exact (1). Idempotent. The map is continuous, so the
   * field is too; the motif may cross the mirror (it then sees its own reflection merged with it, like a union), but
   * for the mirrored copy to be what you want the motif should lie on the positive side.
   */
  const mirror = (axis: number): Fold<V> => {
    axisCheck(axis);
    return (p) => {
      const c = sp.lanes(p);
      return folded(sp.make(c.map((v, i) => (i === axis ? abs(v) : v))), idOf(step(0, c[axis])), ONE);
    };
  };

  /**
   * Mirror across the plane with unit normal `normal` (normalised here) at signed offset `offset` from the origin:
   * `p - 2 min(0, p.n - offset) n`. Points on the positive side are unchanged. id's first lane is 1 on the positive side.
   * Stretch exact (1). Idempotent. Iterating several planes gives kaleidoscopes and polyhedral symmetry.
   */
  const mirrorPlane = (normal: In<V>, offset: In<"f32"> = 0): Fold<V> => {
    const n = normalize(lift<V>(normal));
    return (p) => {
      const q = lift<V>(p);
      const d = sub(dot(q, n), offset);
      return folded(sub(q, mul(mul(2, min(d, 0)), n)) as unknown as Expr<V>, idOf(step(0, d)), ONE);
    };
  };

  /**
   * Infinite repeat with cell size `cell` (per axis), cells centred on the origin: `p - cell * round(p / cell)`. id is
   * the integer cell index. Stretch exact (1). Distances are correct only if the motif stays inside its cell (within
   * half a cell of the origin in every axis, and symmetric where it reaches the wall); otherwise the nearest copy may
   * be a neighbour's and the distance is overestimated. Capping the distance by the distance to the cell wall (not
   * done here) makes it a safe lower bound for any motif inside the cell.
   */
  const repeat = (cell: In<V>): Fold<V> => {
    const c = lift<V>(cell);
    return (p) => {
      const q = lift<V>(p);
      const k = floor(add(div(q, c), 0.5));
      return folded(sub(q, mul(c, k)) as unknown as Expr<V>, k as unknown as Expr<V>, ONE);
    };
  };

  /**
   * Repeat with at most `count` extra copies on each side of the origin per axis (copies at index -count..count);
   * beyond the last copy the points see that copy. id is the clamped cell index. Stretch exact (1). Same cell rule as
   * `repeat`; past the ends the motif of the last copy is seen from far away, which is exact (a single copy).
   */
  const repeatLimited = (cell: In<V>, count: In<V>): Fold<V> => {
    const c = lift<V>(cell), l = lift<V>(count);
    return (p) => {
      const q = lift<V>(p);
      const k = clamp(floor(add(div(q, c), 0.5)), neg(l), l);
      return folded(sub(q, mul(c, k)) as unknown as Expr<V>, k as unknown as Expr<V>, ONE);
    };
  };

  /**
   * The kaleidoscopic iterated fold: `iterations` times, apply `fold` to the point, then scale about `offset`:
   * `q = scale * q - offset * (scale - 1)` (the Mandelbox/KIFS step). Returns the accumulated stretch `scale^-iterations`
   * (exact for the maps taken; the folds must be isometries, as mirrors are). ids combine the per-iteration ids. The
   * result is a continuous map whose Lipschitz constant is `scale^iterations`, so `fieldOf` gives a field with
   * Lipschitz constant at most 1: safe to sphere-trace. It is a lower bound of the distance to the fractal, not the
   * exact distance, and it is only meaningful for `scale` > 1 (a larger value zooms faster). The motif is drawn once
   * at the final point and may be any size: there is no cell.
   */
  const scaleFold = (spec: { iterations: number; fold: Fold<V>; scale: number; offset: In<V> }): Fold<V> => {
    if (!Number.isFinite(spec.scale) || spec.scale === 0) throw new Error(`scaleFold: scale must be finite and nonzero, got ${spec.scale}`);
    const o = lift<V>(spec.offset);
    const pull = f(spec.scale - 1);
    return (p) => {
      const out = unrolled<Folded<V>>(spec.iterations, folded(lift<V>(p), zero, ONE), (state) => {
        const g = spec.fold(state.x);
        return {
          x: sub(mul(g.x, spec.scale), mul(o, pull)) as unknown as Expr<V>,
          id: mod(add(mul(state.id, 37), g.id), ID_MOD) as unknown as Expr<V>,
          stretch: div(mul(state.stretch, g.stretch), Math.abs(spec.scale)),
          toWorld: (d) => state.toWorld(g.toWorld(div(d, Math.abs(spec.scale)))),
        };
      });
      return out;
    };
  };

  /**
   * Recursion toward the origin: shells of ratio `ratio` (> 1) each hold a copy of the shell `[inner, inner * ratio]`,
   * scaled by ratio^k. `x = p / ratio^k`, stretch ratio^k, id's first lane is the shell index k. It is the composite
   * of the log map (`logPolar` / `logSphere`), a repeat in log r, and the inverse map, simplified to a scaling. Stretch
   * exact: a uniform scaling is conformal and k is constant inside a shell. A motif must stay inside the shell
   * `[inner, inner * ratio]`, and the distances at the shell walls agree between neighbours only if the walls sit where
   * the nearest surface changes from one copy to the next (for nested spheres of radius rho * ratio^k, the wall is at
   * the arithmetic mean of neighbouring radii, i.e. choose `inner = rho (1 + ratio) / (2 ratio)`). The default puts the
   * shell symmetric about 1 in log r: `inner = 1 / sqrt(ratio)`.
   */
  const repeatScale = (ratio: number, inner: number = 1 / Math.sqrt(ratio)): Fold<V> => {
    if (!(ratio > 1) || !Number.isFinite(ratio)) throw new Error(`repeatScale: ratio must be finite and > 1, got ${ratio}`);
    if (!(inner > 0) || !Number.isFinite(inner)) throw new Error(`repeatScale: inner must be finite and > 0, got ${inner}`);
    const L = Math.log(ratio), l0 = Math.log(inner);
    return (p) => {
      const q = lift<V>(p);
      // 1e-20 keeps log finite at the origin (the recursion is infinite there; the shell index saturates).
      const lr = log(max(length(q), 1e-20));
      const k = floor(div(sub(lr, l0), L));
      const s = exp(mul(k, L));
      return folded(div(q, s) as unknown as Expr<V>, idOf(k), s);
    };
  };

  /**
   * Inversion in the sphere of radius `radius` about the origin: `p R^2 / |p|^2`. id's first lane is 1 inside the
   * sphere, 0 outside. `stretch` = `|p|^2 / R^2` is the exact local length factor (the map is conformal) but
   * `d * stretch` is only a first-order estimate: it is exact on the motif's surface and, away from it, can exceed the
   * true distance (the factor changes along the way; measured Lipschitz 9 for a sphere). So `toWorld` is NOT
   * `d * stretch` here: it is `|d| rho^2 / (R^2 + |d| rho)` signed like d (rho = |p|), a lower bound of the true
   * distance with Lipschitz constant at most 1 (derivation in the code). It is a bound, not exact, and is much smaller
   * than the true distance far from the surface (it saturates at rho^2 / rho = rho as |d| grows). The origin maps to
   * infinity and is clamped (`|p|^2` floored at 1e-12). Points inside and outside swap, so a motif drawn outside
   * appears inside as well.
   */
  const inversion = (radius: number): Fold<V> => {
    if (!(radius > 0) || !Number.isFinite(radius)) throw new Error(`inversion: radius must be finite and > 0, got ${radius}`);
    const R2 = radius * radius;
    return (p) => {
      const q = lift<V>(p);
      const r2 = max(dot(q, q), 1e-12);
      // The exact lower bound: with rho = |p| and D the distance at x, |D| rho^2 / (R^2 + |D| rho) never exceeds the true
      // distance (inversion scales the chord between two points by R^2 / (|a||b|), and |b| <= |x| + |D|), and its
      // gradient has norm at most 1: the two terms (through D and through rho) sum to (R^2 + |D| rho)^2 / (R^2 + |D| rho)^2.
      const rho = sqrt(r2);
      return {
        x: mul(q, div(R2, r2)) as unknown as Expr<V>, id: idOf(step(r2, R2)), stretch: div(r2, R2),
        toWorld: (d) => div(mul(d, r2), add(R2, mul(abs(d), rho))),
      };
    };
  };

  /** Translate: `x = p - offset`, so a motif drawn at the origin appears at `offset`. Exact (1); id 0. Useful after another fold to ask for a neighbouring cell's copy. */
  const translate = (offset: In<V>): Fold<V> => {
    const o = lift<V>(offset);
    return (p) => folded(sub(lift<V>(p), o) as unknown as Expr<V>, zero, ONE);
  };

  return { identity, translate, mirror, mirrorPlane, repeat, repeatLimited, scaleFold, repeatScale, inversion };
}

const base2 = shared(SPACE2);
const base3 = shared(SPACE3);

/** The folds of the plane. */
export const fold2 = {
  ...base2,

  /**
   * Repeat in `count` equal sectors about the origin, the first centred on the +x axis: the point's position in that
   * sector at the same radius. id's first lane is the sector index in [0, count). Stretch exact (1). A motif must
   * stay inside its sector (the nearest copy changes at the sector wall); on the wall itself the distance is correct
   * only when the motif is mirror-symmetric about the sector's centre line. Seam: the atan2 cut on the negative x axis.
   */
  repeatPolar(count: In<"f32">): Fold<"vec2"> {
    return (p) => {
      const c = SPACE2.lanes(p);
      const s = sectorFold(c[0], c[1], count);
      return folded(vec2(s.i, s.j), vec2(mod(s.k, count), 0), ONE);
    };
  },

  /**
   * Log-polar coordinates: `x = (log r, angle)`, angle in [-pi, pi]. A scaling about the origin becomes a translation
   * in the first lane, so a plain repeat there gives recursion toward the origin (`repeatScale` is that, folded back).
   * Stretch `r` is the exact local factor (the map is conformal) for the metric of the `(log r, angle)` plane; it is a
   * first-order factor, not a bound on far distances (see `inversion`). Seam: the atan2 cut jumps the second lane by
   * 2 pi. Not defined at the origin (r clamped at 1e-20). id is 0.
   */
  logPolar(): Fold<"vec2"> {
    return (p) => {
      const c = SPACE2.lanes(p);
      const r = max(length(vec2(c[0], c[1])), 1e-20);
      return folded(vec2(log(r), atan2(c[1], c[0])), vec2(0, 0), r);
    };
  },

  /**
   * Logarithmic spiral tiling: log-polar coordinates sheared by the angle (the demo in out/fold_demo.ts). `cells` cells
   * go around, `arms` spiral arms (both integers, so the tiling closes across the atan2 cut). `x` is the position in
   * the cell, each lane in [-0.5, 0.5] (unit cells); id is the integer cell (around, outward). The map is not
   * conformal (the shear), so the stretch `2 pi r / (cells * sigma)` is a conservative BOUND: sigma = (m + sqrt(m^2 + 4)) / 2
   * with m = arms / cells is the largest stretching of the shear. Stretch also grows with r, so far from the surface
   * the product is only first-order. A motif must stay inside its unit cell and be symmetric at the cell walls.
   */
  spiral(spec: { arms: number; cells: number }): Fold<"vec2"> {
    if (!Number.isInteger(spec.arms) || !Number.isInteger(spec.cells) || spec.cells < 1) throw new Error(`spiral: arms and cells must be integers, cells >= 1 (got ${spec.arms}, ${spec.cells})`);
    const m = spec.arms / spec.cells;
    const sigma = (m + Math.sqrt(m * m + 4)) / 2;
    return (p) => {
      const c = SPACE2.lanes(p);
      const r = max(length(vec2(c[0], c[1])), 1e-20);
      const s = mul(div(atan2(c[1], c[0]), TAU), spec.cells);
      const t = add(mul(div(log(r), TAU), spec.cells), mul(s, m));
      const cell = vec2(s, t);
      const k = floor(add(cell, 0.5));
      return folded(sub(cell, k) as unknown as Expr<"vec2">, k as unknown as Expr<"vec2">, mul(r, TAU / (spec.cells * sigma)));
    };
  },
};

const lane = (axis: number): { ax: number; i: number; j: number } => {
  if (!Number.isInteger(axis) || axis < 0 || axis > 2) throw new Error(`axis must be 0, 1 or 2, got ${axis}`);
  return { ax: axis, i: (axis + 1) % 3, j: (axis + 2) % 3 }; // (i, j, axis) is a right-handed cycle
};

/** The folds of space. Rotations about an axis use `axis` 0 (x), 1 (y) or 2 (z, the default). */
export const fold3 = {
  ...base3,

  /**
   * Repeat in `count` equal sectors about coordinate `axis` (default z), the first centred on the positive direction of
   * the next axis in the cycle (x for z). id's lane `axis` is the sector index in [0, count). Stretch exact (1). Same
   * sector rule as `fold2.repeatPolar`; the axis itself is a degenerate point (all sectors meet).
   */
  repeatPolar(count: In<"f32">, axis = 2): Fold<"vec3"> {
    const { ax, i, j } = lane(axis);
    return (p) => {
      const c = SPACE3.lanes(p);
      const s = sectorFold(c[i], c[j], count);
      const out: S[] = [], id: S[] = [];
      out[i] = s.i; out[j] = s.j; out[ax] = c[ax];
      id[i] = f(0); id[j] = f(0); id[ax] = mod(s.k, count);
      return folded(vec3(...out), vec3(...id), ONE);
    };
  },

  /**
   * Helical repetition about `axis` (default z): the group generated by rotating `2 pi / count` about the axis while
   * translating `pitch / count` along it. After `count` steps the point has turned once and risen by `pitch`, so a
   * `count`-start helix of period `pitch`. Points related by that screw motion fold to the same `x`. id's lane `axis` is
   * the index of the pitch period; lane (axis + 1) mod 3 holds the sector index in [0, count). Stretch
   * exact (1) (rotation and translation). A motif must stay inside its sector and its period `pitch`.
   * Neighbouring copies sit `pitch / count` higher or lower, so the plain field is discontinuous at the sector walls
   * (by up to that rise, measured Lipschitz > 1000 for a capsule): take the minimum over the adjacent sectors with
   * `helix` and `nearest` for distances that are safe to march. `count` >= 2 for a helix; `count` = 1 is a plain repeat along the axis.
   */
  screw(pitch: number, count: number, axis = 2): Fold<"vec3"> {
    if (!(pitch > 0) || !Number.isFinite(pitch)) throw new Error(`screw: pitch must be finite and > 0, got ${pitch}`);
    if (!Number.isInteger(count) || count < 1) throw new Error(`screw: count must be an integer >= 1, got ${count}`);
    const { ax, i, j } = lane(axis);
    return (p) => {
      const c = SPACE3.lanes(p);
      const s = sectorFold(c[i], c[j], count);
      // Undo the rotation by k sectors and the rise by k * pitch / count. The atan2 cut moves k by count, i.e. z by one
      // pitch, which the repeat along the axis absorbs: the fold is the same on both sides of the cut.
      const z = sub(c[ax], mul(s.k, pitch / count));
      const turn = floor(add(div(z, pitch), 0.5));
      const out: S[] = [], id: S[] = [];
      out[i] = s.i; out[j] = s.j; out[ax] = sub(z, mul(turn, pitch));
      id[i] = mod(s.k, count); id[j] = f(0); id[ax] = turn;
      return folded(vec3(...out), vec3(...id), ONE);
    };
  },

  /**
   * The copy of a `screw` motif in a neighbouring sector: `x` is `p` rotated by `-angle` about `axis`, lowered by
   * `rise`, then wrapped into one period (`period` = the screw's pitch) along the axis, so the motif appears turned by
   * `angle`, raised by `rise`, and repeated every `period`. Exact (1); id 0. Use `compose(screw(pitch, count),
   * helix(2 pi / count, pitch / count, pitch))` for the next sector and the same with both signs negated for the
   * previous one, and take the minimum with the original (`nearest` in sdf3.ts): the result is correct where a motif
   * reaches across a sector wall. The wrap matters: a neighbour that rose by `rise` may be nearer a turn up or down.
   */
  helix(angle: number, rise: number, period: number, axis = 2): Fold<"vec3"> {
    if (!(period > 0) || !Number.isFinite(period)) throw new Error(`helix: period must be finite and > 0, got ${period}`);
    const { ax, i, j } = lane(axis);
    return (p) => {
      const c = SPACE3.lanes(p);
      const q = rotate2(vec2(c[i], c[j]), -angle);
      const z = sub(c[ax], rise);
      const out: S[] = [];
      out[i] = q.x; out[j] = q.y; out[ax] = sub(z, mul(floor(add(div(z, period), 0.5)), period));
      return folded(vec3(...out), vec3(0, 0, 0), ONE);
    };
  },

  /**
   * Spherical-log coordinates: `x = (log r, polar angle from +z, azimuth)`. Stretch `r` is a BOUND: the first two
   * lanes are exact local factors, but the azimuth lane overstates lengths away from the equator by 1 / sin(polar), so
   * world lengths are at most `r` times coordinate lengths. Not defined at the origin (r clamped at 1e-20) and the
   * azimuth is degenerate on the z axis. For recursion toward a point use `repeatScale`, which does not need the angles. id is 0.
   */
  logSphere(): Fold<"vec3"> {
    return (p) => {
      const c = SPACE3.lanes(p);
      const r = max(length(vec3(c[0], c[1], c[2])), 1e-20);
      return folded(vec3(log(r), atan2(length(vec2(c[0], c[1])), c[2]), atan2(c[1], c[0])), vec3(0, 0, 0), r);
    };
  },

  /**
   * Twist about z: rotate the xy plane by `rate * z` radians (so one full turn per `2 pi / rate` of z). Not
   * length-preserving. The stretch is a BOUND, not exact: it is the constant `1 / sigma` with
   * `sigma = (s + sqrt(s^2 + 4)) / 2`, `s = |rate| * radius`, the largest singular value of the map's Jacobian for
   * points within `radius` of the z axis. A field `sdf(x) * stretch` is then Lipschitz-1 inside that cylinder; outside
   * it the bound does not hold. It is conservative (about `s` times too small along most directions), so sphere
   * tracing is slower but does not leave holes. id is 0.
   */
  twist(rate: number, radius: number): Fold<"vec3"> {
    if (!Number.isFinite(rate) || !(radius > 0) || !Number.isFinite(radius)) throw new Error(`twist: rate must be finite and radius finite and > 0 (got ${rate}, ${radius})`);
    const s = Math.abs(rate) * radius;
    const inv = 2 / (s + Math.sqrt(s * s + 4));
    return (p) => {
      const c = SPACE3.lanes(p);
      const q = rotate2(vec2(c[0], c[1]), mul(rate, c[2]));
      return folded(vec3(q.x, q.y, c[2]), vec3(0, 0, 0), f(inv));
    };
  },

  /**
   * Bend about the y axis direction: rotate the xy plane by `rate * x` radians (a strip along x curls into an arc of
   * curvature `rate`). Not length-preserving. The stretch is a BOUND, not exact: the constant `1 / (1 + |rate| * radius)`
   * where `radius` bounds sqrt(x^2 + y^2); the Jacobian's norm is at most `1 + |rate| r`. A field `sdf(x) * stretch` is then
   * Lipschitz-1 inside that cylinder only. Conservative: it shortens steps everywhere by the worst case. id is 0.
   */
  bend(rate: number, radius: number): Fold<"vec3"> {
    if (!Number.isFinite(rate) || !(radius > 0) || !Number.isFinite(radius)) throw new Error(`bend: rate must be finite and radius finite and > 0 (got ${rate}, ${radius})`);
    const inv = 1 / (1 + Math.abs(rate) * radius);
    return (p) => {
      const c = SPACE3.lanes(p);
      const q = rotate2(vec2(c[0], c[1]), mul(rate, c[0]));
      return folded(vec3(q.x, q.y, c[2]), vec3(0, 0, 0), f(inv));
    };
  },
};

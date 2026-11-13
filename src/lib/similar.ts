// Similarity folds with two readings (docs/tracing_sota.md 5.3).
//
// A fold made of shifts, turns, mirrors and uniform scales can be asked or listed:
//   ask   a point to its folded point: compose in front of a field, one evaluation whatever the number of copies
//   list  a frame to the frames of its copies: one instance per copy, each drawn by an exact intersection
// Both are derived from one description, a chain of generators, so they cannot disagree. `tree` is the branching
// recursion built on it (as `grow` in grow.ts, which takes a free-form step and so can only be asked).
//
// The two describe the same solid where every copy stays on its own side of its mirror planes. A copy that crosses a
// plane is cut there when asked and whole when listed.
import { abs, add, div, f, iterate, lift, lt, min, mod, mul, select, step, sub, vec2, vec3, type Expr, type In } from "../expr.ts";
import type { Folded } from "./fold.ts";
import { sdCapsule3, sdRoundCone, sdSphere } from "./sdf3.ts";
import { rotate2 } from "./util.ts";

type P3 = Expr<"vec3">;
type F = Expr<"f32">;
export type V3 = readonly [number, number, number];
export type Axis = "x" | "y" | "z";
export type Plane = "xy" | "xz" | "yz";

/** One generator. Each is a similarity of space, or the two-to-one fold of a mirror. */
export type Gen =
  /** q - by: the origin moves to `by`. */
  | { readonly kind: "shift"; readonly by: V3 }
  /** The plane's two coordinates rotated counter-clockwise by `angle` (as `rotate2`). */
  | { readonly kind: "turn"; readonly plane: Plane; readonly angle: number }
  /** |coordinate|: the two sides of the plane through the origin become one. Two copies. */
  | { readonly kind: "mirror"; readonly axis: Axis }
  /** q / ratio: what follows is `ratio` times smaller. */
  | { readonly kind: "shrink"; readonly ratio: number };

const finite = (what: string, v: readonly number[]): void => {
  for (const x of v) if (!Number.isFinite(x)) throw new Error(`gen.${what}: every number must be finite, got [${v.join(", ")}]`);
};
/** Constructors that check their numbers once. */
export const gen = {
  shift(by: V3): Gen { finite("shift", by); return { kind: "shift", by }; },
  turn(plane: Plane, angle: number): Gen { finite("turn", [angle]); return { kind: "turn", plane, angle }; },
  mirror(axis: Axis): Gen { return { kind: "mirror", axis }; },
  shrink(ratio: number): Gen {
    if (!(ratio > 0 && Number.isFinite(ratio))) throw new Error(`gen.shrink: ratio must be positive and finite, got ${ratio}`);
    return { kind: "shrink", ratio };
  },
};

const LANE: Readonly<Record<Axis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };

/** A chain may mirror each axis once: a copy's id has one lane per axis, and it holds the side of that axis's mirror. */
function checked(chain: readonly Gen[]): readonly Gen[] {
  for (const axis of ["x", "y", "z"] as const) {
    const n = chain.filter((g) => g.kind === "mirror" && g.axis === axis).length;
    if (n > 1) throw new Error(`similarity chain: ${n} mirrors on ${axis}; a chain may mirror each axis once`);
  }
  return chain;
}
const PLANE: Readonly<Record<Plane, readonly [0 | 1 | 2, 0 | 1 | 2]>> = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };

// ---- ask ------------------------------------------------------------------------------------------------------------

type Asked = { readonly q: readonly [F, F, F]; readonly id: readonly [F, F, F]; readonly stretch: number };

/** One generator applied to a point. A mirror records which side the point was on (1 for the positive side). */
function askGen(g: Gen, s: Asked): Asked {
  switch (g.kind) {
    case "shift": return { ...s, q: [sub(s.q[0], g.by[0]), sub(s.q[1], g.by[1]), sub(s.q[2], g.by[2])] };
    case "turn": {
      const [i, j] = PLANE[g.plane], r = rotate2(vec2(s.q[i], s.q[j]), g.angle), q = [...s.q] as [F, F, F];
      q[i] = r.x; q[j] = r.y;
      return { ...s, q };
    }
    case "mirror": {
      const k = LANE[g.axis], q = [...s.q] as [F, F, F], id = [...s.id] as [F, F, F];
      id[k] = step(0, s.q[k]); q[k] = abs(s.q[k]);
      return { ...s, q, id };
    }
    case "shrink": return { ...s, q: [div(s.q[0], g.ratio), div(s.q[1], g.ratio), div(s.q[2], g.ratio)], stretch: s.stretch * g.ratio };
  }
}

/** The chain as a fold: the point in the copy's coordinates, which copy, and the stretch that restores distances. */
export function ask(chain: readonly Gen[]): (p: In<"vec3">) => Folded<"vec3"> {
  checked(chain);
  return (p) => {
    const q = lift<"vec3">(p);
    const end = chain.reduce<Asked>((s, g) => askGen(g, s), { q: [q.x, q.y, q.z], id: [f(0), f(0), f(0)], stretch: 1 });
    return { x: vec3(...end.q), id: vec3(...end.id), stretch: f(end.stretch), toWorld: (d) => mul(d, end.stretch) };
  };
}

// ---- list -----------------------------------------------------------------------------------------------------------

/** A copy's coordinates in the world: world = o + m q, with m's columns `scale` long. */
export type Frame = { readonly o: V3; readonly m: readonly [V3, V3, V3]; readonly scale: number };
/** The identity `Frame`: origin at zero, unit axes, scale 1, so a part in it is already in world coordinates. */
export const WORLD: Frame = { o: [0, 0, 0], m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], scale: 1 };

/** A point of a frame, in the world. */
export function toWorld(fr: Frame, q: V3): V3 {
  return [0, 1, 2].map((k) => fr.o[k]! + fr.m[0][k]! * q[0] + fr.m[1][k]! * q[1] + fr.m[2][k]! * q[2]) as unknown as V3;
}

/** An affine map of copy coordinates to its parent's: columns of the linear part, and the image of the origin. */
type Affine = { readonly m: readonly [V3, V3, V3]; readonly o: V3; readonly scale: number; readonly id: V3 };
const IDENTITY: Affine = { m: WORLD.m, o: [0, 0, 0], scale: 1, id: [0, 0, 0] };
const mapColumns = (a: Affine, fn: (v: V3) => V3): Affine => ({ ...a, m: [fn(a.m[0]), fn(a.m[1]), fn(a.m[2])], o: fn(a.o) });

/**
 * One generator undone: the maps that take what follows it back through it. `after` maps copy coordinates to the
 * generator's output; the result maps them to its input. A mirror gives two (the positive side, id 1, and the negative).
 */
function listGen(g: Gen, after: Affine): Affine[] {
  switch (g.kind) {
    case "shift": return [{ ...after, o: [after.o[0] + g.by[0], after.o[1] + g.by[1], after.o[2] + g.by[2]] }];
    case "turn": {
      const [i, j] = PLANE[g.plane], c = Math.cos(g.angle), s = Math.sin(g.angle);
      // rotate2 by angle sends (x, y) to (c x - s y, s x + c y); its inverse is the rotation by -angle.
      return [mapColumns(after, (v) => { const w = [...v] as [number, number, number]; w[i] = c * v[i]! + s * v[j]!; w[j] = -s * v[i]! + c * v[j]!; return w; })];
    }
    case "mirror": {
      const k = LANE[g.axis];
      return [1, 0].map((side) => {
        const flipped = side === 1 ? after : mapColumns(after, (v) => { const w = [...v] as [number, number, number]; w[k] = -v[k]!; return w; });
        const id = [...after.id] as [number, number, number]; id[k] = side;
        return { ...flipped, id };
      });
    }
    case "shrink": return [{ ...mapColumns(after, (v) => [v[0] * g.ratio, v[1] * g.ratio, v[2] * g.ratio]), scale: after.scale * g.ratio }];
  }
}

/** One copy of a chain: its frame in the world and the id `ask` reports inside it. */
export type Copy = { readonly frame: Frame; readonly id: V3 };

/** The chain listed: the frames of every copy it makes of what follows it, seen from `parent`. */
export function list(chain: readonly Gen[], parent: Frame): Copy[] {
  // Undo the chain from its last generator to its first.
  const maps = checked(chain).reduceRight<Affine[]>((maps, g) => maps.flatMap((a) => listGen(g, a)), [IDENTITY]);
  return maps.map((a) => {
    const col = (v: V3): V3 => [0, 1, 2].map((k) => parent.m[0][k]! * v[0] + parent.m[1][k]! * v[1] + parent.m[2][k]! * v[2]) as unknown as V3;
    return { frame: { o: toWorld(parent, a.o), m: [col(a.m[0]), col(a.m[1]), col(a.m[2])], scale: parent.scale * a.scale }, id: a.id };
  });
}

// ---- parts: a shape with a distance (to ask) and a closed ray formula (to list) --------------------------------------

/** A simple solid in a copy's own coordinates. Each kind has an exact distance and an exact ray intersection. */
export type Part =
  | { readonly kind: "sphere"; readonly centre: V3; readonly radius: number }
  | { readonly kind: "capsule"; readonly a: V3; readonly b: V3; readonly radius: number }
  /** The hull of a sphere of radius `ra` at `a` and one of radius `rb` at `b`. */
  | { readonly kind: "cone"; readonly a: V3; readonly b: V3; readonly ra: number; readonly rb: number };

/** The part's distance at a point of its own coordinates. */
export function partDistance(part: Part, q: P3): F {
  switch (part.kind) {
    case "sphere": return sdSphere(sub(q, [...part.centre]), part.radius);
    case "capsule": return sdCapsule3(q, [...part.a], [...part.b], part.radius);
    case "cone": return sdRoundCone(q, [...part.a], [...part.b], part.ra, part.rb);
  }
}

/** A part placed in the world: two ends with their radii (equal ends for a sphere, equal radii for a capsule). */
export type Placed = { readonly a: V3; readonly ra: number; readonly b: V3; readonly rb: number };

/**
 * The part `part` placed in the world by frame `fr`: its end points moved by the frame and its radii scaled by the
 * frame's scale.
 */
export function placePart(part: Part, fr: Frame): Placed {
  switch (part.kind) {
    case "sphere": { const c = toWorld(fr, part.centre), r = part.radius * fr.scale; return { a: c, ra: r, b: c, rb: r }; }
    case "capsule": { const r = part.radius * fr.scale; return { a: toWorld(fr, part.a), ra: r, b: toWorld(fr, part.b), rb: r }; }
    case "cone": return { a: toWorld(fr, part.a), ra: part.ra * fr.scale, b: toWorld(fr, part.b), rb: part.rb * fr.scale };
  }
}

// ---- tree: branching recursion, asked or listed ----------------------------------------------------------------------

const ID_MOD = 65521; // as fold.ts and grow.ts: 37 * 65521 + 65521 stays exact in f32
const combineExpr = (a: P3, b: P3): P3 => mod(add(mul(a, 37), b), ID_MOD);
const combine = (a: V3, b: V3): V3 => [(a[0] * 37 + b[0]) % ID_MOD, (a[1] * 37 + b[1]) % ID_MOD, (a[2] * 37 + b[2]) % ID_MOD];

export type TreeSpec = {
  /** The part drawn at every level, in the level's own coordinates. */
  readonly part: Part;
  /** From a level's coordinates to its children's. */
  readonly step: readonly Gen[];
};

/** What a tree reports at a point: as `Grown` in grow.ts. */
export type Asked3 = { readonly d: F; readonly level: F; readonly id: P3 };
/** One listed branch: where it is, how deep, and the id `at` reports on it. */
export type Branch = Placed & { readonly level: number; readonly id: V3 };

export type Tree = {
  /** Ask: the union of the part over `count` levels (an expression, truncated: detail may fall with distance). */
  readonly at: (p: In<"vec3">, count: In<"f32">) => Asked3;
  /** List: every branch of the first `levels` levels, seen from `root`. */
  readonly branches: (levels: number, root: Frame) => Branch[];
};

/**
 * A branching recursion of one `Part`: the part at every level, with each level's coordinates reached from its
 * parent's by the generators in `spec.step`. Gives two readings of one description: `at(p, count)` asks a point for
 * the distance, level and id of the union (an expression, for `draw.field`), and `branches(levels, root)` lists every
 * branch down to a level as placed parts (for `draw.copies`).
 */
export function tree(spec: TreeSpec): Tree {
  const fold = ask(spec.step);
  return {
    at: (p, count) => {
      const init = [lift<"vec3">(p), f(1), f(1e9), f(0), vec3(0, 0, 0), vec3(0, 0, 0)] as const;
      const [, , d, level, , id] = iterate(count, init, ([q, st, best, lvl, k, bestId], i) => {
        const here = mul(partDistance(spec.part, q), st);
        const nearer = lt(here, best);
        const g = fold(q);
        return [g.x, mul(st, g.stretch), min(best, here), select(nearer, i, lvl), combineExpr(k, g.id), select(nearer, k, bestId)] as const;
      });
      return { d, level, id };
    },
    branches: (levels, root) => {
      if (!(Number.isInteger(levels) && levels >= 1)) throw new Error(`tree.branches: levels must be a positive integer, got ${levels}`);
      const out: Branch[] = [];
      let front: Copy[] = [{ frame: root, id: [0, 0, 0] }];
      for (let level = 0; level < levels; level++) {
        for (const c of front) out.push({ ...placePart(spec.part, c.frame), level, id: c.id });
        front = front.flatMap((c) => list(spec.step, c.frame).map((child) => ({ frame: child.frame, id: combine(c.id, child.id) })));
      }
      return out;
    },
  };
}

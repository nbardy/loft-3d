// The signatures (DESIGN.md 7.1): a shape is a function, and its signature says how it can be drawn. All of them are
// closures over `Expr`, so they are pure, may read `time` and inputs, and compile to both backends.

import type { Expr } from "../expr.ts";
import type { Curve as CurveOf } from "../curve.ts";
import type { Fold } from "../lib/fold.ts";

export type F = Expr<"f32">;
export type P3 = Expr<"vec3">;

/** A point and a right-handed orthonormal frame there. */
export type Frame = { readonly o: P3; readonly x: P3; readonly y: P3; readonly z: P3 };

/** A frame and a uniform scale: where one instance of something goes. */
export type Placed = { readonly frame: Frame; readonly scale: F };

/** index -> frame. Drawn by instancing a drawable (`draw.points`). `i` is 0 .. count - 1, as an f32. */
export interface Points {
  readonly count: number;
  at(i: F): Placed;
}

/**
 * How a copy is scaled: evenly, or by its own length along each axis of its frame (a spar's length and girth, a rag's
 * width, drop and belly). Along each axis the size is positive; a negative one would mirror the copy and turn it inside
 * out.
 */
export type Size = { readonly kind: "even"; readonly k: F } | { readonly kind: "axes"; readonly k: P3 };

/** Where one copy goes: a frame (turned as the copy is) and a size. */
export type Posed = { readonly frame: Frame; readonly size: Size };

/**
 * index -> posed copy: `Points` whose copies may also be scaled along each axis. Drawn by `draw.posed`. `i` is
 * 0 .. count - 1, as an f32. `Points` are poses with an even size (`posesOf`).
 */
export interface Poses {
  readonly count: number;
  at(i: F): Posed;
}

/** (u) -> point, u in [0, 1]. Drawn as a stroke (`draw.curve`). The same type as a keyed or closed-form curve. */
export type Curve = CurveOf<"vec3">;

/**
 * What an edge of a surface's (u, v) square is. `free`: a boundary. `pole`: the whole edge is one point (a closing tip).
 * `cap`: a boundary closed by a flat disc when the surface is made solid (an open end of a tube). `periodic` (a pair):
 * the edge is glued to the opposite one (round a tube, along a torus).
 */
export type End = "free" | "pole" | "cap";
export type Topology = {
  readonly u: "periodic" | readonly [End, End];
  readonly v: "periodic" | "free";
};

/**
 * Capsules along a chain: what casts a shadow, collides, leaves a footprint. `joint(k)` for k = 0 .. joints - 1 is the
 * centre and radius of joint k, as expressions (they may read per-frame tables). A surface with nothing to cast has
 * an empty chain (`joints` 0), which is what absence means here.
 */
export interface Skeleton {
  readonly joints: number;
  joint(k: number): { readonly p: P3; readonly r: F };
}
/** The `Skeleton` with no joints: what a drawable that casts no shadow reports. It has no `joint(k)` to ask for. */
export const NO_SKELETON: Skeleton = { joints: 0, joint: (k) => { throw new Error(`NO_SKELETON has no joint ${k}`); } };

/**
 * (u, v) -> point, with u and v in [0, 1]. Drawn as a grid evaluated in the vertex stage (`draw.surface`). `normal` is
 * the unit normal on the side `d(point)/du x d(point)/dv` points to (the front, and the outside of a closed solid);
 * `surface()` derives it from the map by finite differences, a sweep has an analytic one.
 */
export interface Surface {
  point(u: F, v: F): P3;
  normal(u: F, v: F): P3;
  /**
   * Where (u, v) sits in the surface's own rest space: a function of (u, v) alone, not of time or of where the surface
   * has been moved, at about world scale. Patterns that should stick to a thing (a style's facets, line wobble,
   * hatching) are written over it, so they ride the surface instead of sliding through it as it moves. A body's is
   * its skin straightened along its rest arc length; a copy's is its own (not its placement's); an analytic surface's
   * is its point at time 0.
   */
  anchor(u: F, v: F): P3;
  readonly topology: Topology;
  readonly skeleton: Skeleton;
}

/**
 * (u, v, w) -> point, with a frame: a coordinate system. `frame(c)` is the point at local coordinates c and the
 * chart's axes there. `at(t)` is the same chart with `time` read as t (a slice); a chart built on per-frame tables
 * builds the slice's own tables, which is why this is a method and not a substitution.
 */
export interface Chart {
  frame(c: P3): Frame;
  at(t: F): Chart;
  /**
   * `at(t)` for a reader that reads the slice only at local coordinates `c` (a part placed there). A chart built on
   * per-frame tables may post only what reading at c needs (a body: the stations up to c's m); others are `at(t)`.
   */
  atNear(t: F, c: P3): Chart;
}

/** point -> signed distance. Drawn by a tracer inside a bound (`draw.field`). */
export type Field = (p: P3) => F;
/** point -> density. Drawn by integration along the view ray (`draw.density`). */
export type Density = (p: P3) => F;
/**
 * What paint knows of where it is besides the surface's own coordinates (u, v): the world point, the unit normal in the
 * world (toward the side drawn: flipped on the back of a two-sided sheet), and which copy this is (its index, 0 .. count
 * - 1, as an f32; 0 for a surface drawn once). For copies, the normal is the copy's own after its placement turned and
 * scaled it, so a pattern can face the light or the viewer; the index lets each copy differ (a curl in a different place
 * on every cloud lobe).
 */
export type PaintAt = { readonly world: P3; readonly normal: P3; readonly copy: F };

/** Surface coordinates -> base colour (display-referred rgb), lit by the scene's style in the fragment stage. */
export type Paint = (u: F, v: F, at: PaintAt) => P3;

/**
 * A domain map: the mapped coordinate, the cell it came from and the local change of length (`src/lib/fold.ts`, whose
 * folds are warps). Composed in front of a shape by `warp`.
 */
export type Warp<V extends "vec2" | "vec3"> = Fold<V>;

/** Something `place` can put in a coordinate system. Placement acts on what the thing is built from (DESIGN.md 7.2). */
export interface Placeable<T> {
  placed(chart: Chart): T;
}

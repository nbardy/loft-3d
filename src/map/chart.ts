// Charts and placement (DESIGN.md 7.2, "compose behind"). A chart maps local coordinates to a point and a frame.
// Placement acts on what a thing is built from (a body's spine, an instance's frame), not on every vertex of its skin:
// mapping every skin vertex through a chart that bends or twists shears a body into slivers.

import { abs, add, cos, cross, dot, fetch, lift, listOf, max, mul, sin, sub, vec3, vec4, type In, type TableSource } from "../expr.ts";
import { scopedName } from "../expr.ts";
import type { Chart, F, Frame, P3, Placeable, Placed, Points, Posed, Poses, Size } from "./types.ts";

const X = lift<"vec3">([1, 0, 0]), Y = lift<"vec3">([0, 1, 0]), Z = lift<"vec3">([0, 0, 1]);

/** A direction given in frame g's axes, in world terms. */
export const rotate = (g: Frame, d: P3): P3 => add(add(mul(g.x, d.x), mul(g.y, d.y)), mul(g.z, d.z));

/** A frame given in a chart's local coordinates (origin and axes), carried to the chart's world. */
export function carry(chart: Chart, f: Frame): Frame {
  const g = chart.frame(f.o);
  return { o: g.o, x: rotate(g, f.x), y: rotate(g, f.y), z: rotate(g, f.z) };
}

/** The identity: local coordinates are world coordinates. */
export const world: Chart = { frame: (c) => ({ o: c, x: X, y: Y, z: Z }), at: () => world, atNear: () => world };

/**
 * The frame of `host` at the fixed local point `c`, as a rigid chart: local (x, y, z) goes to
 * `o + x X + y Y + z Z` in that frame. This is how a part rides a body (`place(horn, on(head, [0.14, v, 1]))`).
 */
export function on(host: Chart, c: In<"vec3">): Chart {
  const ce = lift<"vec3">(c);
  const g = host.frame(ce);
  return { frame: (l) => ({ o: add(g.o, rotate(g, l)), x: g.x, y: g.y, z: g.z }), at: (t) => on(host.atNear(t, ce), ce), atNear: (t) => on(host.atNear(t, ce), ce) };
}

/** `inner`'s coordinates, then `outer`'s: frames of inner carried through outer. */
export function compose(outer: Chart, inner: Chart): Chart {
  return { frame: (c) => carry(outer, inner.frame(c)), at: (t) => compose(outer.at(t), inner.at(t)), atNear: (t, c) => compose(outer.at(t), inner.atNear(t, c)) };
}

/**
 * `chart` with its local coordinates scaled by `k` along their axes before they are placed, so everything built in it
 * is squeezed or stretched as one (a thing squeezed in a grip). Positions scale; directions keep the chart's. A body placed in it
 * has its spine scaled and keeps its own girth. `at(t)` moves the chart to time t and keeps this frame's `k`.
 */
export function sized(chart: Chart, k: In<"vec3">): Chart {
  const ke = lift<"vec3">(k);
  return { frame: (c) => chart.frame(mul(c, ke)), at: (t) => sized(chart.at(t), ke), atNear: (t, c) => sized(chart.atNear(t, mul(c, ke)), ke) };
}

/** `chart` moved by the world vector `by` (a thing lifted off the surface it rides on). */
export function shifted(chart: Chart, by: In<"vec3">): Chart {
  const b = lift<"vec3">(by);
  const move = (g: Frame): Frame => ({ o: add(g.o, b), x: g.x, y: g.y, z: g.z });
  return { frame: (c) => move(chart.frame(c)), at: (t) => shifted(chart.at(t), b), atNear: (t, c) => shifted(chart.atNear(t, c), b) };
}

/** A size as lengths along x, y and z. One handler per kind. */
export function sizeLengths(z: Size): P3 {
  switch (z.kind) {
    case "even": return vec3(z.k, z.k, z.k);
    case "axes": return z.k;
  }
}

/** Put a shape in a coordinate system. */
export function place<T>(shape: Placeable<T>, chart: Chart): T {
  return shape.placed(chart);
}

export type PointSpec = { readonly at: In<"vec3">; readonly scale: In<"f32"> };

/** Points with local frames at `at(i)` (axes of the coordinate system they are placed in) and scales. */
class PointSet implements Points, Placeable<PointSet> {
  constructor(readonly count: number, private readonly chart: Chart, private readonly spec: (i: F) => PointSpec) {}
  at(i: F): Placed {
    const s = this.spec(i);
    return { frame: carry(this.chart, { o: lift<"vec3">(s.at), x: X, y: Y, z: Z }), scale: lift<"f32">(s.scale) };
  }
  placed(chart: Chart): PointSet { return new PointSet(this.count, compose(chart, this.chart), this.spec); }
}

/**
 * `count` points at local coordinates `at(i)` with scale `scale(i)`. Placed on a body (`place(points(...), body)`),
 * the coordinates are body coordinates (m, v, rho) and each frame is the body's frame there.
 */
export function points(count: number, spec: (i: F) => PointSpec): PointSet {
  if (!(Number.isInteger(count) && count >= 1)) throw new Error(`points: count must be a positive integer, got ${count}`);
  return new PointSet(count, world, spec);
}

// ---- posed copies: turned and scaled along each axis ---------------------------------------------------------------

/**
 * How a copy is turned in the coordinates it is placed in: not at all, by an angle about a unit axis (a bell swinging
 * on its hook), or to given axes (unit and perpendicular: `x` and `y`, with z = x cross y; a spar along its direction).
 */
export type Turn =
  | { readonly kind: "none" }
  | { readonly kind: "about"; readonly axis: P3; readonly angle: F }
  | { readonly kind: "axes"; readonly x: P3; readonly y: P3 };

/**
 * How a posed copy is turned (`PoseSpec.turn`): `turn.none`, `turn.about(axis, angle)` for an angle in radians about a
 * unit axis, or `turn.axes(x, y)` for unit, perpendicular x and y axes (z is their cross product).
 */
export const turn = {
  none: { kind: "none" } as Turn,
  about: (axis: In<"vec3">, angle: In<"f32">): Turn => ({ kind: "about", axis: lift<"vec3">(axis), angle: lift<"f32">(angle) }),
  axes: (x: In<"vec3">, y: In<"vec3">): Turn => ({ kind: "axes", x: lift<"vec3">(x), y: lift<"vec3">(y) }),
};

/** How a posed copy is scaled (`PoseSpec.size`): `size.even(k)` by one factor, or `size.axes([kx, ky, kz])` per axis. */
export const size = {
  even: (k: In<"f32">): Size => ({ kind: "even", k: lift<"f32">(k) }),
  /** Lengths along the copy's x, y and z (each positive). */
  axes: (k: In<"vec3">): Size => ({ kind: "axes", k: lift<"vec3">(k) }),
};

/** Where one posed copy goes, in the coordinates of the set it belongs to: a point, a turn and a size. */
export type PoseSpec = { readonly at: In<"vec3">; readonly turn: Turn; readonly size: Size };

/** v turned about the unit axis by angle (Rodrigues). */
const about = (v: P3, axis: P3, angle: F): P3 => {
  const c = cos(angle), s = sin(angle);
  return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, mul(sub(1, c), dot(axis, v))));
};

/** The local axes a turn gives. One handler per kind. */
export function turned(t: Turn): { readonly x: P3; readonly y: P3; readonly z: P3 } {
  switch (t.kind) {
    case "none": return { x: X, y: Y, z: Z };
    case "about": return { x: about(X, t.axis, t.angle), y: about(Y, t.axis, t.angle), z: about(Z, t.axis, t.angle) };
    case "axes": return { x: t.x, y: t.y, z: cross(t.x, t.y) };
  }
}

/** Posed copies at `spec(i)`, in the coordinates of the chart they are placed in (the world until placed). */
class PoseSet implements Poses, Placeable<PoseSet> {
  constructor(readonly count: number, private readonly chart: Chart, private readonly spec: (i: F) => PoseSpec) {}
  at(i: F): Posed {
    const s = this.spec(i);
    const a = turned(s.turn);
    return { frame: carry(this.chart, { o: lift<"vec3">(s.at), x: a.x, y: a.y, z: a.z }), size: s.size };
  }
  placed(chart: Chart): PoseSet { return new PoseSet(this.count, compose(chart, this.chart), this.spec); }
}

/**
 * `count` copies, each where `spec(i)` puts it, turned and sized: `points` with a turn and a size along each axis. The
 * spec is an expression of the index and may read time (each bell its own swing); it is evaluated where the copy is
 * drawn, per vertex. For copies whose poses are many separate expressions, list them (`posedList`).
 */
export function posed(count: number, spec: (i: F) => PoseSpec): PoseSet {
  if (!(Number.isInteger(count) && count >= 1)) throw new Error(`posed: count must be a positive integer, got ${count}`);
  return new PoseSet(count, world, spec);
}

/**
 * Copies whose poses are separate expressions (each spar of a fleet between its own two points, each puff on its own
 * clock), listed: every pose is evaluated once per frame by a pose stage into one table (`poses_<name>`), and the vertex
 * stage fetches its copy's. Cheaper than a closed form in the index when the poses share nothing, and the only way to
 * write them when they do not. In the world's coordinates (not placeable). Every copy's size is of one kind.
 */
export function posedList(given: string, specs: readonly PoseSpec[]): Poses {
  const name = scopedName(given);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`posedList "${name}": names must be identifiers (they name a table)`);
  if (specs.length < 1) throw new Error(`posedList "${name}": no copies`);
  const kind = specs[0]!.size.kind;
  specs.forEach((sp, k) => { if (sp.size.kind !== kind) throw new Error(`posedList "${name}": copy ${k}'s size is ${sp.size.kind} and copy 0's is ${kind}; give every copy one kind`); });
  const lengths = (z: Size): P3 => { switch (z.kind) { case "even": return vec3(z.k, z.k, z.k); case "axes": return z.k; } };
  const entries = specs.map((sp) => { const a = turned(sp.turn); return [lift<"vec3">(sp.at), a.x, a.y, a.z, lengths(sp.size)].map((v) => vec4(v, 0)); });
  const table: TableSource = { name: `poses_${name}`, lanes: 5, entries: specs.length, role: "data", program: listOf(entries) };
  const sizeAt = (i: F): Size => {
    const k = fetch(table, i, 4);
    switch (kind) {
      case "even": return { kind, k: k.x };
      case "axes": return { kind, k: k.xyz };
    }
  };
  return {
    count: specs.length,
    at: (i) => ({ frame: { o: fetch(table, i, 0).xyz, x: fetch(table, i, 1).xyz, y: fetch(table, i, 2).xyz, z: fetch(table, i, 3).xyz }, size: sizeAt(i) }),
  };
}

/** Points as poses: each copy's even scale. */
export function posesOf(points: Points): Poses {
  return { count: points.count, at: (i) => { const p = points.at(i); return { frame: p.frame, size: { kind: "even", k: p.scale } }; } };
}

/** The one length that bounds a copy's size (for its level of detail and its shadow's radius): the largest axis. */
export function sizeBound(s: Size): F {
  switch (s.kind) {
    case "even": return s.k;
    case "axes": return max(max(abs(s.k.x), abs(s.k.y)), abs(s.k.z));
  }
}

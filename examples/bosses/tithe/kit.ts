// The ghost fleet's kit: parts drawn once for the whole fleet.
//
// A ship from `examples/recipes/ship.ts` is about 45 draws (DESIGN.md 12.5) and its GPU cost follows the draw count, so four
// ships that way are about 180 draws. Here every kind of part is ONE posed draw for every ship that has it: each copy's
// pose (where it goes, its turn and its size along each axis) is an expression of each ship's frame on the swell and of
// the attack's clock, listed by `posedList` (src/map/chart.ts), which fills one table per frame on the CPU; the vertex
// stage fetches its copy's pose. A unit part (a tube, a rag, a ball) is stretched into place by its size, and the
// library turns its normal by the cofactor of the stretch.

import {
  abs, add, cos, evaluate, floor, fract, lift, lt, max, mix, mul, pow, select, sin, size, smoothstep, sub, turn,
  time, TAU, vec2, vec3, afloatFrame, lathe, mapNormal, NO_SKELETON,
  type Expr, type F, type Frame, type In, type P3, type PoseSpec, type Poses, type Surface, type Topology, type Waters,
} from "../../../src/index.ts";
import { type Hull } from "../../recipes/hull.ts";
import { atRest } from "../../../src/map/surface.ts";

export type V3 = readonly [number, number, number];

// ---- poses -------------------------------------------------------------------------------------------------------

/** Copies `from .. from + count - 1` of a set of poses. */
export function slice(p: Poses, from: number, count: number): Poses {
  return { count, at: (i) => p.at(add(i, from)) };
}

/** The frame of copy k of a set of poses, as expressions (fetched from its table on either side). */
export const frameOf = (p: Poses, k: number): Frame => p.at(lift<"f32">(k)).frame;

/** A unit part's surface: its points; posed copies stretch it, and cast no shadow. */
export function unitPart(point: (u: F, v: F) => P3, topology: Topology): Surface {
  return { point, normal: mapNormal(point), anchor: atRest(point), topology, skeleton: NO_SKELETON };
}

// ---- unit parts --------------------------------------------------------------------------------------------------

/** A tube of radius 1 from y = 0 to y = 1, tapering by `taper` toward the top, closed at both ends. */
export function tubePoint(taper: number): (u: F, v: F) => P3 {
  const shape = lathe((u) => vec2(mul(mul(sub(1, mul(u, taper)), smoothstep(0, 0.03, u)), smoothstep(1, 0.97, u)), u), ["pole", "pole"]);
  return (u, v) => shape.point(u, v);
}

/** A ball of radius 1 at the origin. */
export function ballPoint(): (u: F, v: F) => P3 {
  const shape = lathe((u) => vec2(sin(mul(u, Math.PI)), mul(cos(mul(u, Math.PI)), -1)), ["pole", "pole"]);
  return (u, v) => shape.point(u, v);
}

/** A number in [0, 1) from a number (a cell index). */
export const hash1 = (x: In<"f32">): F => fract(mul(sin(mul(lift<"f32">(x), 127.1)), 43758.5453));

/**
 * A rag hung from a yard: u across (x from -1/2 to 1/2), v down from the yard (y = 0) to its torn foot, belly along
 * +z (about 1 at the middle). It hangs in `strips` strips of hashed lengths, slit almost to the yard between them, each
 * strip's foot torn to a point; each strip swings on its own phase, and a small wave runs across the cloth.
 */
export function ragPoint(o: { readonly strips: number; readonly seed: number; readonly swing: number }): (u: F, v: F) => P3 {
  const N = o.strips;
  return (u, v) => {
    const k = floor(mul(u, N)), f = fract(mul(u, N));
    const h = hash1(add(k, o.seed)), h2 = hash1(add(mul(k, 3.7), o.seed + 11));
    // Each strip: its length, its foot torn to a point, and a slit to near the yard either side.
    const foot = sub(mix(0.42, 1, h), mul(abs(sub(mul(f, 2), 1)), mix(0.06, 0.3, h2)));
    const slit = mul(smoothstep(0, 0.14, f), smoothstep(1, 0.86, f));
    const len = mix(0.1, foot, slit);
    const y = mul(mul(v, len), -1);
    const belly = mul(mul(max(sin(mul(u, Math.PI)), 0), sin(mul(mul(v, len), Math.PI * 0.85))), 1);
    const swing = mul(sin(add(mul(time, 1.3 + 0.4 * o.swing), mul(k, 1.9))), mul(pow15(v), 0.35));
    const ripple = mul(sin(add(mul(sub(mul(u, 2.2), mul(time, 1.4)), TAU), mul(v, 3))), mul(v, 0.12));
    const sway = mul(sin(add(mul(time, 0.9), mul(k, 2.7))), mul(mul(v, v), 0.025));
    return vec3(add(sub(u, 0.5), sway), y, add(belly, add(swing, ripple)));
  };
}
const pow15 = (v: F): F => pow(max(v, 1e-6), 1.5);

// ---- a ship's frame, riding low and wrong -------------------------------------------------------------------------

export type Riding = {
  /** Where (x, z) and the bow's heading, radians from +x toward +z. */
  readonly at: readonly [number, number];
  readonly heading: number;
  readonly length: number;
  readonly beam: number;
  /** How far below its lines the hull sits (world units): the waterline climbs the topsides. */
  readonly sink: number;
  /** Standing list, radians (positive heels to starboard), and how far it rolls about that, uneasily. */
  readonly list: number;
  readonly roll: number;
  /** Standing trim, radians (positive bow down). */
  readonly trim: number;
  /** Phase of the uneasy roll (so the ships do not roll together). */
  readonly phase: number;
  /** Extra sink as an expression (a recoil). */
  readonly jolt?: F;
  /** Extra roll as an expression, radians (a shudder). */
  readonly shudder?: F;
};

/**
 * A ghost ship's frame: afloat on the swell (`afloatFrame`), then held at a list and trim it should not have and sunk
 * below its lines. The uneasy roll is two incommensurate slow sines, so it never settles into a rhythm.
 */
export function ridingFrame(water: Waters, r: Riding, wind: readonly [number, number]): Frame {
  const g = afloatFrame(water, { at: r.at, heading: r.heading, length: r.length * 0.8, beam: r.beam, wind: { direction: wind, heel: 0.04 } });
  const uneasy = add(sin(add(mul(time, 0.41), r.phase)), mul(sin(add(mul(time, 0.97), r.phase * 2.3)), 0.45));
  const phi = add(add(r.list, mul(uneasy, r.roll)), r.shudder ?? 0);
  const theta = add(r.trim, mul(sin(add(mul(time, 0.33), r.phase * 1.7)), r.roll * 0.4));
  const y1 = add(mul(g.y, cos(phi)), mul(g.z, sin(phi))), z1 = sub(mul(g.z, cos(phi)), mul(g.y, sin(phi)));
  const x2 = sub(mul(g.x, cos(theta)), mul(y1, sin(theta))), y2 = add(mul(y1, cos(theta)), mul(g.x, sin(theta)));
  const sink = r.jolt === undefined ? lift<"f32">(r.sink) : add(r.jolt, r.sink);
  return { o: sub(g.o, vec3(0, sink, 0)), x: x2, y: y2, z: z1 };
}

/** A ship's frame as a pose (it is orthonormal: turned to its axes, size 1). */
export const framePose = (g: Frame): PoseSpec => ({ at: g.o, turn: turn.axes(g.x, g.y), size: size.even(1) });

/** A point given in a frame's coordinates, in the world. */
export const toWorld = (g: Frame, p: In<"vec3">): P3 => {
  const q = lift<"vec3">(p);
  return add(g.o, add(add(mul(g.x, q.x), mul(g.y, q.y)), mul(g.z, q.z)));
};
/** A direction given in a frame's coordinates, in the world. */
export const dirWorld = (g: Frame, d: In<"vec3">): P3 => {
  const q = lift<"vec3">(d);
  return add(add(mul(g.x, q.x), mul(g.y, q.y)), mul(g.z, q.z));
};

// ---- spars: straight tubes between two points of a ship ------------------------------------------------------------

const v3 = {
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k],
  len: (a: V3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
};
export { v3 };

/** A spar from a to b (ship coordinates) of radius r at its foot, in ship frame g: a pose of the unit tube. */
export function sparPose(g: Frame, a: V3, b: V3, r: number): PoseSpec {
  const d = v3.sub(b, a), len = v3.len(d);
  if (!(len > 1e-6)) throw new Error("spar: its ends coincide");
  const ey = v3.norm(d);
  const ref: V3 = Math.abs(ey[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ex = v3.norm(v3.cross(ey, ref));
  return { at: toWorld(g, a), turn: turn.axes(dirWorld(g, ex), dirWorld(g, ey)), size: size.axes([r, len, r]) };
}

/** The hull's lines as numbers (positions of masts and chainplates are decided when the ship is). */
export function linesOf(h: Hull) {
  const n = (e: Expr<"f32">): number => evaluate(e) as number;
  const L = h.lines;
  return {
    x: (u: number) => n(h.x(lift<"f32">(u))),
    half: (u: number) => n(h.half(lift<"f32">(u))),
    sheer: (u: number) => n(h.sheerAt(lift<"f32">(u))),
    deck: (u: number) => n(h.sheerAt(lift<"f32">(u))) - L.bulwark * L.freeboard,
    /** The skin at (u, v), as numbers. */
    skin: (u: number, v: number): V3 => evaluate(h.skin.point(lift<"f32">(u), lift<"f32">(v))) as unknown as V3,
  };
}

/** The bulwarks' inner faces as one two-sided loop: up the starboard rail from the stern, round the bow, down the port. */
export function bulwarkLoop(h: Hull): Surface {
  const L = h.lines;
  // Both sides meet at the stem (u = 1, where the half-breadth is 0), so the loop is continuous there; at the stern it
  // spans the top of the transom, which is the inside of the taffrail.
  const rail = (s: F): P3 => {
    const starboard = lt(s, 0.5);
    return h.skin.point(select(starboard, mul(s, 2), sub(2, mul(s, 2))), select(starboard, 1, 0));
  };
  const edge = (s: F): P3 => { const p = rail(s); return vec3(p.x, sub(p.y, L.bulwark * L.freeboard), mul(p.z, 0.93)); };
  const point = (u: F, v: F): P3 => mix(rail(u), edge(u), v);
  return { point, normal: mapNormal(point), anchor: atRest(point), topology: { u: ["free", "free"], v: "free" }, skeleton: { joints: 0, joint: () => { throw new Error("no joints"); } } };
}

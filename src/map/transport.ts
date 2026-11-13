// Frames transported along a spine, once per frame: the part of a sweep that cannot be computed locally (DESIGN.md
// 7.3). It is a scan (docs/gpu_native.md): one pass along the stations carrying the frame, written in expressions, so
// the pose stage fills it on the GPU and tools read the same program on the CPU. Its input is the body's samples table
// (one map entry per station: the spine placed and local, the rest spine, twist and section), src/map/sweep.ts.
//
// Layout, 3 vec4 per station:
//   p = (position xyz, arc fraction of the stations posted)       q = frame quaternion (x, y, z, w)       r = (half-width, half-height, stretch, rest arc length)
// The frame quaternion maps local x to the tangent (toward increasing m), local y to the dorsal direction and local z
// to the side (= tangent x dorsal). Stations are uniform in the spine parameter m.
//
// Interpolation between stations (`stationSample` in sweep.ts): positions by uniform Catmull-Rom over the stations (so
// the drawn spine is C1 and passes through every station), frames by normalised lerp of quaternions, stretch linearly.
// Tangents at stations are central differences, which is exactly the Catmull-Rom derivative at a knot, so frames and
// the drawn curve agree.

import {
  add, and, atan2, clamp, cos, cross, div, dot, exp, f, fetch, gt, iterate, length, lift, lt, max, mul, neg, normalize, select, sin, sqrt, sub,
  vec4, type Expr, type In, type TableProgram, type TableSource,
} from "../expr.ts";
import type { F, P3 } from "./types.ts";

export const STATION_VEC4S = 3;

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  axpy: (s: number, a: V3, b: V3): V3 => [b[0] + s * a[0], b[1] + s * a[1], b[2] + s * a[2]],
  dot: (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
  unit: (a: V3): V3 => { const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); return [a[0] / l, a[1] / l, a[2] / l]; },
  /** Rotate v about the unit axis (Rodrigues). */
  rotate: (v: V3, axis: V3, angle: number): V3 => {
    const s = Math.sin(angle), c = Math.cos(angle), d = v3.dot(axis, v) * (1 - c), x = v3.cross(axis, v);
    return [v[0] * c + x[0] * s + axis[0] * d, v[1] * c + x[1] * s + axis[1] * d, v[2] * c + x[2] * s + axis[2] * d];
  },
};

/** Quaternion (x, y, z, w) of the rotation whose matrix has columns a, b, c (orthonormal, right-handed). */
export function quatFromColumns(a: V3, b: V3, c: V3): Q4 {
  const tr = a[0] + b[1] + c[2];
  if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); return [(b[2] - c[1]) / s, (c[0] - a[2]) / s, (a[1] - b[0]) / s, s / 4]; }
  if (a[0] > b[1] && a[0] > c[2]) { const s = 2 * Math.sqrt(1 + a[0] - b[1] - c[2]); return [s / 4, (b[0] + a[1]) / s, (c[0] + a[2]) / s, (b[2] - c[1]) / s]; }
  if (b[1] > c[2]) { const s = 2 * Math.sqrt(1 + b[1] - a[0] - c[2]); return [(b[0] + a[1]) / s, s / 4, (c[1] + b[2]) / s, (c[0] - a[2]) / s]; }
  const s = 2 * Math.sqrt(1 + c[2] - a[0] - b[1]);
  return [(c[0] + a[2]) / s, (c[1] + b[2]) / s, s / 4, (a[1] - b[0]) / s];
}

/** Rotate v by the unit quaternion q (same formula as WGSL `qrot`). */
export function qrot(q: Q4 | readonly number[], v: V3): V3 {
  const u: V3 = [q[0], q[1], q[2]];
  const t = v3.add(v3.cross(u, v), v3.scale(v, q[3]));
  return v3.add(v, v3.scale(v3.cross(u, t), 2));
}

/** The samples a station scan reads, one entry per posted station (a map, src/map/sweep.ts). */
export const SAMPLE_VEC4S = 3;
/** Lanes of a samples entry: (world position, twist), (local position, half-width), (rest local position, aspect). */
export const SAMPLE = { world: 0, local: 1, rest: 2 } as const;

/** What the station scan of one body needs besides its samples. */
export type StationScan = {
  /** The posted stations' samples, `steps` entries (SAMPLE lanes). */
  readonly samples: TableSource;
  /** The station table's first posted entry and how many are posted. */
  readonly first: number;
  readonly steps: number;
  /** World direction the frame starts from at the first posted station (projected off the tangent there). */
  readonly up: P3;
  /** World direction levelling pulls toward (the body's `up`, through its chart). */
  readonly level: { readonly up: P3; readonly rate: number };
  /** Rest arc length before the first posted station (0 for a whole spine). */
  readonly restStart: F;
  /** The least stretch volume preservation honours (Section.leastStretch). */
  readonly leastStretch: number;
};

const Z = lift<"vec3">([0, 0, 1]);
const proj = (v: P3, t: P3): P3 => sub(v, mul(t, dot(v, t)));
/** Reflect v across the plane with normal n (|n|^2 = c, c > 0): v - (2 / c) (n . v) n. */
const reflect = (v: P3, n: P3, c: F): P3 => sub(v, mul(n, mul(div(2, c), dot(n, v))));

/** Quaternion (x, y, z, w) of the rotation whose matrix has columns a, b, c (orthonormal, right-handed): the branch
 * on the largest diagonal term, every branch evaluated and one selected (each is finite where it is selected). */
export function quatOf(a: P3, b: P3, c: P3): Expr<"vec4"> {
  const tr = add(add(a.x, b.y), c.z);
  const s1 = mul(sqrt(max(add(tr, 1), 0)), 2);
  const q1 = vec4(div(sub(b.z, c.y), s1), div(sub(c.x, a.z), s1), div(sub(a.y, b.x), s1), mul(s1, 0.25));
  const s2 = mul(sqrt(max(sub(sub(add(a.x, 1), b.y), c.z), 0)), 2);
  const q2 = vec4(mul(s2, 0.25), div(add(b.x, a.y), s2), div(add(c.x, a.z), s2), div(sub(b.z, c.y), s2));
  const s3 = mul(sqrt(max(sub(sub(add(b.y, 1), a.x), c.z), 0)), 2);
  const q3 = vec4(div(add(b.x, a.y), s3), mul(s3, 0.25), div(add(c.y, b.z), s3), div(sub(c.x, a.z), s3));
  const s4 = mul(sqrt(max(sub(sub(add(c.z, 1), a.x), b.y), 0)), 2);
  const q4 = vec4(div(add(c.x, a.z), s4), div(add(c.y, b.z), s4), mul(s4, 0.25), div(sub(a.y, b.x), s4));
  return select(gt(tr, 0), q1, select(and(gt(a.x, b.y), gt(a.x, c.z)), q2, select(gt(b.y, c.z), q3, q4)));
}

/**
 * The station table's program: rotation-minimising frames by double reflection (Wang, Juettler, Zheng and Liu 2008)
 * seeded from `up`, with `strand_kit::Spine::new`'s levelling, then twist; arc fractions; and radii with volume
 * preservation (radii scale by 1 / sqrt(stretch), stretch measured on the local spine against its rest).
 *
 * Tangents are central differences over the posted stations (one-sided at their ends), which is exactly the
 * Catmull-Rom derivative at a knot, so frames and the drawn curve agree. State: the untwisted dorsal direction, the
 * previous quaternion (neighbours kept in one hemisphere so the vertex stage's nlerp takes the short way), the previous
 * tangent, the arc and rest arc so far, and the total arc (computed once, in the scan's start).
 */
/** Entry k (clamped into the table) of a samples table, lane `lane`. */
const sampleAt = (S: TableSource, k: In<"f32">, lane: number): Expr<"vec4"> => fetch(S, clamp(lift<"f32">(k), 0, S.entries - 1), lane);

/** Central difference of a samples lane's xyz at entry k, one-sided at the ends: the Catmull-Rom knot derivative. */
function knot(S: TableSource, lane: number, k: F): P3 {
  const n = S.entries;
  const v = (j: In<"f32">): P3 => sampleAt(S, j, lane).xyz;
  const mid = mul(sub(v(add(k, 1)), v(sub(k, 1))), 0.5);
  return select(lt(k, 0.5), sub(v(1), v(0)), select(gt(k, n - 1.5), sub(v(n - 1), v(n - 2)), mid));
}

/**
 * Entry k's half-width and half-height after volume preservation (radii scale by 1 / sqrt(stretch), stretch measured on
 * the local spine against its rest), and the stretch. Shared by the station scan and the skeleton-only slice, so the
 * two agree exactly.
 */
export function stationRadii(S: TableSource, k: F, leastStretch: number): { readonly a: F; readonly b: F; readonly stretch: F } {
  const stretch = div(length(knot(S, SAMPLE.local, k)), max(length(knot(S, SAMPLE.rest, k)), 1e-9));
  const keep = div(1, sqrt(max(stretch, leastStretch)));
  const hw = sampleAt(S, k, SAMPLE.local).w, aspect = sampleAt(S, k, SAMPLE.rest).w;
  return { a: mul(hw, keep), b: mul(mul(hw, aspect), keep), stretch };
}

export function stationScan(s: StationScan): TableProgram {
  const n = s.steps, S = s.samples;
  if (S.entries !== n) throw new Error(`station scan: samples table "${S.name}" has ${S.entries} entries for ${n} stations`);
  const at = (k: F, lane: number): Expr<"vec4"> => sampleAt(S, k, lane);
  const P = (k: F): P3 => at(k, SAMPLE.world).xyz;
  const tan0 = normalize(knot(S, SAMPLE.world, f(0)));
  // A tangent parallel to `up` leaves no seed direction: a fixed perpendicular instead (a decision, not an error).
  const seed = proj(s.up, tan0);
  const dorsal0 = select(gt(length(seed), 1e-4), normalize(seed), normalize(cross(tan0, Z)));
  const [total] = iterate(n - 1, [f(0)] as const, ([a], j) => [add(a, length(sub(P(add(j, 1)), P(j))))] as const);
  const init = [dorsal0, lift<"vec4">([0, 0, 0, 1]), tan0, f(0), lift<"f32">(s.restStart), max(total, 1e-9)] as const;
  return {
    kind: "scan", first: s.first, steps: n, init,
    step: (state, i) => {
      const [dorsal, prevQ, prevTan, arc, restArc, totalArc] = state as unknown as [P3, Expr<"vec4">, P3, F, F, F];
      const t = normalize(knot(S, SAMPLE.world, i));
      const first = lt(i, 0.5);
      const chord = sub(P(i), P(sub(i, 1)));
      const c1 = dot(chord, chord);
      // Double reflection: across the chord's bisecting plane, then across the plane taking the reflected tangent onto
      // the new tangent. A zero-length chord (a collapsed spine) leaves the frame as it was.
      const rL = reflect(dorsal, chord, c1), tL = reflect(prevTan, chord, c1);
      const v2 = sub(t, tL), c2 = dot(v2, v2);
      const carried = select(gt(c1, 1e-12), select(gt(c2, 1e-12), reflect(rL, v2, c2), rL), dorsal);
      let d: P3 = normalize(proj(carried, t));
      if (s.level.rate > 0) {
        // Levelling (strand_kit): the weight falls to 0 as the dorsal vector nears a quarter turn from "up in the
        // normal plane", so a neck leaning back past vertical keeps its own back instead of flipping.
        const target = proj(s.level.up, t), horizontal = length(target);
        const tg = div(target, max(horizontal, 1e-3));
        const agree = max(dot(d, tg), 0);
        const angle = atan2(dot(cross(d, tg), t), dot(d, tg));
        const gain = sub(1, exp(mul(mul(mul(mul(sqrt(c1), horizontal), horizontal), mul(agree, agree)), -s.level.rate)));
        d = select(gt(horizontal, 1e-3), rotateAbout(d, t, mul(angle, gain)), d);
      }
      const dorsalNow = select(first, dorsal, d);
      // Twist is applied to a copy: it must not feed back into the propagation.
      const sample0 = at(i, SAMPLE.world);
      const dt = rotateAbout(dorsalNow, t, sample0.w);
      const side = normalize(cross(t, dt));
      const q0 = quatOf(t, dt, side);
      const q = select(lt(dot(q0, prevQ), 0), neg(q0), q0);
      const r = stationRadii(S, i, s.leastStretch);
      const arcNow = select(first, arc, add(arc, sqrt(c1)));
      const restStep = length(sub(at(i, SAMPLE.rest).xyz, at(sub(i, 1), SAMPLE.rest).xyz));
      const restNow = select(first, restArc, add(restArc, restStep));
      return {
        next: [dorsalNow, q, t, arcNow, restNow, totalArc],
        lanes: [vec4(P(i), div(arcNow, totalArc)), q, vec4(r.a, r.b, r.stretch, restNow)],
      };
    },
  };
}

/** Rotate v about the unit axis by angle (Rodrigues), as an expression. */
export function rotateAbout(v: In<"vec3">, axis: In<"vec3">, angle: In<"f32">): P3 {
  const ve = lift<"vec3">(v), a = lift<"vec3">(axis);
  const c = cos(angle), sn = sin(angle);
  return add(add(mul(ve, c), mul(cross(a, ve), sn)), mul(a, mul(sub(1, c), dot(a, ve))));
}

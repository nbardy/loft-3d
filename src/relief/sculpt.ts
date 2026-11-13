// A sculpt layer: a height function of (u, v) backed by a table (DESIGN.md 7.3, the 2D counterpart of `tabulate`).
// It is the object a sculpting tool's displacement bake fills: a grid of heights over the surface's (u, v) square,
// static, read by the shaders with `fetch`. It composes with stamps (it is a `Height`) and serves `displace`,
// `draw.relief` and the baker alike.
//
// Grid: `nu x nv` samples. A closed direction has its samples at k / n (k = 0 .. n - 1) and wraps (sample n is sample
// 0); an open one has them at k / (n - 1), with the ends clamped. Lookup is bicubic Hermite through the samples, with
// Catmull-Rom slopes stored beside each sample (one vec4 per sample: value, d/di, d/dj, d2/didj, per index step), so the
// interpolant passes through every sample, is C1 (relief normals do not facet at the cell walls, as bilinear would),
// and costs four fetches.

import { add, fetch, floor, fract, max, min, mul, sub, type Expr, type FilledTable, type TableFill } from "../expr.ts";
import type { F } from "../map/types.ts";
import type { Height, Wrap } from "./height.ts";

/** How one direction of the grid is laid out. */
type Axis = { readonly n: number; readonly closed: boolean };

const AXES: Readonly<Record<Wrap, readonly [boolean, boolean]>> = { none: [false, false], u: [true, false], v: [false, true], uv: [true, true] };

/** Sample index k of an axis, wrapped (closed) or clamped (open). */
const wrapIndex = (a: Axis, k: number): number => (a.closed ? ((k % a.n) + a.n) % a.n : Math.min(a.n - 1, Math.max(0, k)));
/** Where sample k sits in [0, 1]. */
const coordOf = (a: Axis, k: number): number => (a.closed ? k / a.n : k / (a.n - 1));

/** The table: one vec4 per sample, entry i + nu * j. */
export class SculptTable implements FilledTable {
  readonly lanes = 1;
  readonly role = "static";
  readonly entries: number;
  private readonly data: Float32Array;

  constructor(readonly name: string, samples: ArrayLike<number>, readonly u: Axis, readonly v: Axis) {
    if (samples.length !== u.n * v.n) throw new Error(`sculptLayer "${name}": ${samples.length} samples for a ${u.n} x ${v.n} grid`);
    for (let k = 0; k < samples.length; k++) if (!Number.isFinite(samples[k])) throw new Error(`sculptLayer "${name}": sample ${k} is ${samples[k]}`);
    this.entries = u.n * v.n;
    const at = (i: number, j: number) => samples[wrapIndex(u, i) + u.n * wrapIndex(v, j)];
    // One-sided at an open end (the clamped neighbour is the sample itself, so the central difference halves): a
    // Catmull-Rom slope with a clamped phantom, which keeps the end value exact.
    const di = (i: number, j: number) => (at(i + 1, j) - at(i - 1, j)) * 0.5;
    const dj = (i: number, j: number) => (at(i, j + 1) - at(i, j - 1)) * 0.5;
    const dij = (i: number, j: number) => (at(i + 1, j + 1) - at(i + 1, j - 1) - at(i - 1, j + 1) + at(i - 1, j - 1)) * 0.25;
    this.data = new Float32Array(this.entries * 4);
    for (let j = 0; j < v.n; j++) for (let i = 0; i < u.n; i++) {
      const o = (i + u.n * j) * 4;
      this.data[o] = at(i, j); this.data[o + 1] = di(i, j); this.data[o + 2] = dj(i, j); this.data[o + 3] = dij(i, j);
    }
  }

  prepare(): TableFill {
    const data = this.data;
    return (_frame, out) => out.set(data);
  }
}

/** Cubic Hermite basis: value weights (h00, h01) and slope weights (h10, h11) at t in [0, 1]. */
function hermite(t: F): { v0: F; v1: F; s0: F; s1: F } {
  const t2 = mul(t, t), t3 = mul(t2, t);
  return {
    v0: add(sub(mul(t3, 2), mul(t2, 3)), 1),
    v1: sub(mul(t2, 3), mul(t3, 2)),
    s0: add(sub(t3, mul(t2, 2)), t),
    s1: sub(t3, t2),
  };
}

/** The cell an axis coordinate falls in: the two sample indices either side (wrapped or clamped) and the fraction. */
function cellOf(a: Axis, x: F): { k0: F; k1: F; t: F } {
  if (a.closed) {
    const s = mul(fract(x), a.n);
    const k0 = floor(s);
    // k0 + 1 wraps to 0 at the last cell: (k0 + 1) mod n without a mod, since k0 <= n - 1.
    const k1 = mul(fract(mul(add(k0, 1), 1 / a.n)), a.n);
    // Rounded: fract(k / n) * n is an integer up to rounding, and fetch truncates.
    return { k0, k1: floor(add(k1, 0.5)), t: sub(s, k0) };
  }
  const s = mul(max(min(x, 1), 0), a.n - 1);
  const k0 = min(floor(s), a.n - 2);
  return { k0, k1: add(k0, 1), t: sub(s, k0) };
}

/**
 * A sculpt layer: `samples` (row-major, sample (i, j) at index i + nu * j, i along u, j along v) as a height function
 * of (u, v), closed in the directions `wrap` names. The heights are world units.
 */
export function sculptLayer(name: string, samples: ArrayLike<number>, size: readonly [number, number], o: { readonly wrap: Wrap }): Height {
  const [nu, nv] = size;
  const [cu, cv] = AXES[o.wrap];
  for (const [axis, n, closed] of [["u", nu, cu], ["v", nv, cv]] as const) {
    if (!(Number.isInteger(n) && n >= (closed ? 3 : 2))) throw new Error(`sculptLayer "${name}": n${axis} must be an integer >= ${closed ? 3 : 2}, got ${n}`);
  }
  const table = new SculptTable(name, samples, { n: nu, closed: cu }, { n: nv, closed: cv });
  return (u, v) => {
    const a = cellOf(table.u, u), b = cellOf(table.v, v);
    const ha = hermite(a.t), hb = hermite(b.t);
    const at = (i: F, j: F): Expr<"vec4"> => fetch(table, add(i, mul(j, nu)), 0);
    const corner = (c: Expr<"vec4">, wa: F, sa: F, wb: F, sb: F): F =>
      add(add(mul(c.x, mul(wa, wb)), mul(c.y, mul(sa, wb))), add(mul(c.z, mul(wa, sb)), mul(c.w, mul(sa, sb))));
    return add(
      add(corner(at(a.k0, b.k0), ha.v0, ha.s0, hb.v0, hb.s0), corner(at(a.k1, b.k0), ha.v1, ha.s1, hb.v0, hb.s0)),
      add(corner(at(a.k0, b.k1), ha.v0, ha.s0, hb.v1, hb.s1), corner(at(a.k1, b.k1), ha.v1, ha.s1, hb.v1, hb.s1)),
    );
  };
}

/** Samples of a function of (u, v) on the grid `sculptLayer` reads with the same size and wrap (a procedural bake). */
export function sampleGrid(fn: (u: number, v: number) => number, size: readonly [number, number], o: { readonly wrap: Wrap }): Float32Array {
  const [nu, nv] = size;
  const [cu, cv] = AXES[o.wrap];
  const U: Axis = { n: nu, closed: cu }, V: Axis = { n: nv, closed: cv };
  const out = new Float32Array(nu * nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) out[i + nu * j] = fn(coordOf(U, i), coordOf(V, j));
  return out;
}


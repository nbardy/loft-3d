// A distance brick: the three-variable counterpart of `tabulate` (DESIGN.md 7.3, "a table is a function too"). A static
// distance field is sampled once, when the scene is compiled, into a static table, and a tracer marches the table (a
// handful of loads per step) instead of the field's formula, using the formula only near the surface.
//
// Layout: two levels. The bound's box (plus one fine cell all round) is cut into coarse cells of BRICK x BRICK x BRICK
// fine cells (fine cell size `cell`). A coarse cell that has no point within `band` of the surface stores one number,
// `m`, a lower bound of the distance over the whole cell (proved from one sample at its centre: |d(centre)| minus half
// its diagonal). Every other coarse cell owns a brick: (BRICK + 1)^3 samples at the fine grid's points, shared faces
// stored twice so a lookup never leaves its brick.
//
// The lookup is a guaranteed lower bound, not an interpolation. Trilinear interpolation of a distance can exceed it by
// up to half a cell diagonal (across a thin branch it does), which would step through the surface. Instead the lookup is
// the best of the eight corner cones, max_c (d_c - |p - c|): each is a lower bound of a 1-Lipschitz field, so the max is,
// and it is never worse than the trilinear value minus its error bound (sum_c w_c |p - c| <= h sqrt(3) / 2). So:
//   - outside the solid (d >= 0) the lookup is <= d: marching by it cannot overshoot;
//   - where |d| < band its corners are exact samples and it is >= d - cell sqrt(3) (the nearest corner's cone);
//   - in a coarse cell without a brick it is >= band.
// Inside the solid it is negative. Tests: tests/map.brick.test.ts.
//
// Baking samples sparsely, by the same Lipschitz argument: a cube of fine cells is refined only if the sample at its
// centre cannot prove that it holds no point within `band` of the surface (|d(c)| >= half diagonal + band); the samples
// of a cube that is not refined are filled with that proof's bound (max_c ... outside, the matching upper bound inside:
// conservative toward zero, so the sign is right and the lookup stays a lower bound). Exact samples are then only those
// of fine cells within about band + cell of the surface.
//
// Only a static field can be tabled (`varianceOf`): one that reads time, an input, a param (a slider edit is a buffer
// write, never a recompile), a curve row or a per-frame table changes after the bake; one that calls a GPU-only
// function cannot be sampled on the CPU.

import { compileJs, leaves, type Expr, type TableFill, type TableSource, type V } from "../expr.ts";

type V3 = readonly [number, number, number];

/** Fine cells per brick side. */
export const BRICK = 8;
/** Samples per brick side. */
const SIDE = BRICK + 1;
/** Floats per brick: SIDE^3 samples, padded to whole vec4s so every brick starts on one. */
const BRICK_FLOATS = Math.ceil((SIDE * SIDE * SIDE) / 4) * 4;
const SQRT3 = Math.sqrt(3);

/** What a field's value depends on besides the point: whether it may be sampled once. */
export type Variance =
  | { readonly kind: "static" }
  /** It reads something that changes after compilation (named, for error messages). */
  | { readonly kind: "changing"; readonly reads: readonly string[] }
  /** It calls a GPU-only function: the CPU cannot sample it. */
  | { readonly kind: "unevaluable"; readonly fn: string };

/** Classify an expression by its leaves (nothing is asked of the author). Free variables are the caller's business. */
export function varianceOf(e: Expr): Variance {
  const l = leaves([e]);
  const gpuOnly = l.libs.find((fn) => fn.js === "gpu-only");
  if (gpuOnly) return { kind: "unevaluable", fn: gpuOnly.name };
  const reads = [
    ...l.inputs.map((s) => `input "${s.name}"`),
    ...l.params.map((s) => `param "${s.name}"`),
    ...l.rows.map((r) => `curve "${r.label}"`),
    ...l.tables.filter((t) => t.role !== "static").map((t) => `table "${t.name}"`),
  ];
  return reads.length === 0 ? { kind: "static" } : { kind: "changing", reads };
}

export type BrickSpec = {
  /**
   * A number stored per coarse cell beside its bound (read in WGSL by `<fn>_tag(p)`), from the cell's centre and half
   * diagonal: a field's union mask (src/draw/field.ts), or 0.
   */
  readonly tag: (centre: V3, halfDiagonal: number) => number;
  /** The box to cover (the solid must lie inside it). */
  readonly box: { readonly min: V3; readonly max: V3 };
  /** Fine cell size, world units. */
  readonly cell: number;
  /** Width of the shell round the surface sampled exactly, world units (at least a cell). */
  readonly band: number;
};

/** What baking cost and holds. */
export type BrickStats = { readonly evaluations: number; readonly bricks: number; readonly coarse: number; readonly bytes: number; readonly ms: number };

/** A coarse cell that owns a brick: its integer coordinates and its slot in the pool. */
export type BrickCell = { readonly at: V3; readonly slot: number };

export type Brick = {
  readonly name: string;
  /** The static table (role "static"): coarse cells (one vec4 each: slot or -1, m), then the brick pool. */
  readonly table: TableSource;
  /** World position of fine grid point (0, 0, 0). */
  readonly origin: V3;
  readonly cell: number;
  readonly band: number;
  /** Coarse cells per axis. */
  readonly dims: V3;
  readonly cells: readonly BrickCell[];
  /** How far below the field the lookup may be where |d| < band: the cell's diagonal. */
  readonly error: number;
  readonly stats: BrickStats;
  /** The lookup (the WGSL's twin, in f64 over the stored f32 samples). */
  lower(p: V3): number;
  /** The stored sample at fine grid point (i, j, k); the point must belong to a brick (throws otherwise). */
  sample(i: number, j: number, k: number): number;
  /** A brick's own samples, (BRICK + 1)^3, x fastest (a view into the table). */
  samples(slot: number): Float32Array;
  /**
   * WGSL: `fn <fn>(p: vec3<f32>) -> f32`, the lookup, and `fn <fn>_tag(p: vec3<f32>) -> f32`, the tag of p's coarse
   * cell, both reading the table through its accessor `t_<name>`.
   */
  wgsl(fn: string): string;
};

/**
 * Bake `d` (an expression of the free vec3 variable named `pvar`, already static: see `varianceOf`) into a brick named
 * `name` (it names the table). `d` must be 1-Lipschitz (scale it by a field's safety factor first).
 */
export function bakeBrick(name: string, d: Expr<"f32">, pvar: string, spec: BrickSpec): Brick {
  const t0 = performance.now();
  const { cell: h, band } = spec;
  if (!(h > 0 && Number.isFinite(h))) throw new Error(`brick "${name}": cell must be positive, got ${h}`);
  if (!(band >= h)) throw new Error(`brick "${name}": band (${band}) must be at least a cell (${h})`);
  const run = compileJs([d]);
  const vars: Record<string, V> = { [pvar]: [0, 0, 0] };
  const env = { vars, inputs: {}, params: {} };
  let evaluations = 0;
  const field = (x: number, y: number, z: number): number => {
    evaluations++;
    vars[pvar] = [x, y, z];
    const v = run(env)[0] as number;
    if (!Number.isFinite(v)) throw new Error(`brick "${name}": the field is ${v} at (${x}, ${y}, ${z})`);
    return v;
  };

  const origin: V3 = [spec.box.min[0] - h, spec.box.min[1] - h, spec.box.min[2] - h];
  const span = (a: number) => spec.box.max[a]! + h - origin[a]!;
  const dims: V3 = [0, 1, 2].map((a) => Math.max(1, Math.ceil(span(a) / (BRICK * h)))) as unknown as V3;
  const [nx, ny, nz] = dims;
  const NI = nx * BRICK + 1, NJ = ny * BRICK + 1;
  const key = (i: number, j: number, k: number) => i + NI * (j + NJ * k);
  const at = (i: number, j: number, k: number): V3 => [origin[0] + i * h, origin[1] + j * h, origin[2] + k * h];

  // Exact samples at fine grid points, shared by neighbouring bricks.
  const exact = new Map<number, number>();
  const sampleAt = (i: number, j: number, k: number): number => {
    const kk = key(i, j, k);
    const seen = exact.get(kk);
    if (seen !== undefined) return seen;
    const p = at(i, j, k);
    const v = field(p[0], p[1], p[2]);
    exact.set(kk, v);
    return v;
  };

  const coarseCount = nx * ny * nz;
  const slotOf = new Int32Array(coarseCount).fill(-1);
  const lowerOf = new Float64Array(coarseCount);
  const cells: BrickCell[] = [];
  /** Per brick: bound-filled values (NaN where not filled) before exact samples overwrite them. */
  const bounds: Float64Array[] = [];
  const halfDiag = (s: number) => (s * h * SQRT3) / 2;

  // A cube of s fine cells from local corner (a, b, c) of the brick at coarse (ci, cj, ck). s = BRICK is the coarse cell.
  const refine = (bnd: Float64Array, ci: number, cj: number, ck: number, a: number, b: number, c: number, s: number): void => {
    const gi = ci * BRICK + a, gj = cj * BRICK + b, gk = ck * BRICK + c;
    if (s === 1) {
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) sampleAt(gi + dx, gj + dy, gk + dz);
      return;
    }
    const m = s / 2;
    const dc = sampleAt(gi + m, gj + m, gk + m);
    if (Math.abs(dc) >= halfDiag(s) + band) {
      // No point of this cube is within `band` of the surface: fill its samples from the centre's cone.
      for (let z = 0; z <= s; z++) for (let y = 0; y <= s; y++) for (let x = 0; x <= s; x++) {
        const r = Math.hypot((x - m) * h, (y - m) * h, (z - m) * h);
        const v = dc > 0 ? dc - r : dc + r;
        const o = (a + x) + SIDE * ((b + y) + SIDE * (c + z));
        const old = bnd[o]!;
        bnd[o] = Number.isNaN(old) ? v : dc > 0 ? Math.max(old, v) : Math.min(old, v);
      }
      return;
    }
    for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) refine(bnd, ci, cj, ck, a + x * m, b + y * m, c + z * m, m);
  };

  for (let ck = 0; ck < nz; ck++) for (let cj = 0; cj < ny; cj++) for (let ci = 0; ci < nx; ci++) {
    const idx = ci + nx * (cj + ny * ck);
    const half = BRICK / 2;
    const dc = sampleAt(ci * BRICK + half, cj * BRICK + half, ck * BRICK + half);
    const hd = halfDiag(BRICK);
    if (Math.abs(dc) >= hd + band) {
      lowerOf[idx] = dc > 0 ? dc - hd : dc + hd;
      continue;
    }
    const slot = cells.length;
    slotOf[idx] = slot;
    cells.push({ at: [ci, cj, ck], slot });
    const bnd = new Float64Array(SIDE * SIDE * SIDE).fill(Number.NaN);
    bounds.push(bnd);
    refine(bnd, ci, cj, ck, 0, 0, 0, BRICK);
  }

  // The table: coarse cells (vec4: slot or -1, lower bound, tag, 0), then the pool.
  const cellFloats = coarseCount * 4;
  const data = new Float32Array(cellFloats + cells.length * BRICK_FLOATS);
  for (let c = 0; c < coarseCount; c++) { data[c * 4] = slotOf[c]!; data[c * 4 + 1] = slotOf[c]! >= 0 ? 0 : lowerOf[c]!; }
  for (let ck = 0; ck < nz; ck++) for (let cj = 0; cj < ny; cj++) for (let ci = 0; ci < nx; ci++) {
    const half = BRICK / 2;
    data[(ci + nx * (cj + ny * ck)) * 4 + 2] = spec.tag(at(ci * BRICK + half, cj * BRICK + half, ck * BRICK + half), halfDiag(BRICK));
  }
  for (const { at: [ci, cj, ck], slot } of cells) {
    const bnd = bounds[slot]!;
    const base = cellFloats + slot * BRICK_FLOATS;
    for (let z = 0; z < SIDE; z++) for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
      const o = x + SIDE * (y + SIDE * z);
      const e = exact.get(key(ci * BRICK + x, cj * BRICK + y, ck * BRICK + z));
      const v = e ?? bnd[o]!;
      if (Number.isNaN(v)) throw new Error(`internal: brick "${name}" sample (${x}, ${y}, ${z}) of cell (${ci}, ${cj}, ${ck}) was neither sampled nor bounded`);
      data[base + o] = v;
    }
  }

  const table: TableSource = {
    name, lanes: 1, entries: data.length / 4, role: "static",
    prepare: (): TableFill => (_frame, out) => out.set(data),
  };

  const cellIndex = (p: V3): { idx: number; g: V3 } => {
    const g = [0, 1, 2].map((a) => (p[a]! - origin[a]!) / (BRICK * h)) as unknown as V3;
    const c = g.map((x, a) => Math.min(dims[a]! - 1, Math.max(0, Math.floor(x))));
    return { idx: c[0]! + nx * (c[1]! + ny * c[2]!), g: g.map((x, a) => x - c[a]!) as unknown as V3 };
  };
  const lower = (p: V3): number => {
    const { idx, g } = cellIndex(p);
    const slot = data[idx * 4]!;
    if (slot < 0) return data[idx * 4 + 1]!;
    const base = cellFloats + slot * BRICK_FLOATS;
    const f = g.map((x) => x * BRICK);
    const i = f.map((x) => Math.min(BRICK - 1, Math.max(0, Math.floor(x))));
    let best = -Infinity;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const v = data[base + (i[0]! + dx) + SIDE * ((i[1]! + dy) + SIDE * (i[2]! + dz))]!;
      const r = Math.hypot((i[0]! + dx - f[0]!) * h, (i[1]! + dy - f[1]!) * h, (i[2]! + dz - f[2]!) * h);
      best = Math.max(best, v - r);
    }
    return best;
  };
  // A fine point on a coarse cell's face, edge or corner is stored by every brick that holds it (with equal values);
  // any one with a brick will do.
  const sample = (i: number, j: number, k: number): number => {
    const options = (g: number, n: number): number[] => {
      const c = Math.min(n - 1, Math.floor(g / BRICK));
      return g % BRICK === 0 && c > 0 && g / BRICK === c ? [c, c - 1] : [c];
    };
    for (const ck of options(k, nz)) for (const cj of options(j, ny)) for (const ci of options(i, nx)) {
      const slot = slotOf[ci + nx * (cj + ny * ck)]!;
      if (slot >= 0) return data[cellFloats + slot * BRICK_FLOATS + (i - ci * BRICK) + SIDE * ((j - cj * BRICK) + SIDE * (k - ck * BRICK))]!;
    }
    throw new Error(`brick "${name}": fine point (${i}, ${j}, ${k}) is in no coarse cell with a brick`);
  };

  const num = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x));
  const wgsl = (fn: string): string => /* wgsl */ `
fn ${fn}_load(k: u32) -> f32 { return t_${name}(k >> 2u)[k & 3u]; }
/// p in coarse cells.
fn ${fn}_coarse(p: vec3<f32>) -> vec3<f32> { return (p - vec3<f32>(${origin.map(num).join(", ")})) * ${num(1 / (BRICK * h))}; }
fn ${fn}_tag(p: vec3<f32>) -> f32 {
  let c = clamp(vec3<i32>(floor(${fn}_coarse(p))), vec3<i32>(0), vec3<i32>(${nx - 1}, ${ny - 1}, ${nz - 1}));
  return t_${name}(u32(c.x + ${nx} * (c.y + ${ny} * c.z))).z;
}
/// Lower bound of the field at p from the brick "${name}" (src/map/brick.ts): one load in an empty coarse cell, else
/// the best of the eight corner cones of p's fine cell.
fn ${fn}(p: vec3<f32>) -> f32 {
  let g = ${fn}_coarse(p);
  let c = clamp(vec3<i32>(floor(g)), vec3<i32>(0), vec3<i32>(${nx - 1}, ${ny - 1}, ${nz - 1}));
  let cv = t_${name}(u32(c.x + ${nx} * (c.y + ${ny} * c.z)));
  if (cv.x < 0.0) { return cv.y; }
  let base = ${cellFloats}u + u32(cv.x) * ${BRICK_FLOATS}u;
  let f = (g - vec3<f32>(c)) * ${num(BRICK)};
  let i = clamp(vec3<i32>(floor(f)), vec3<i32>(0), vec3<i32>(${BRICK - 1}));
  let fr = (f - vec3<f32>(i)) * ${num(h)};
  let k0 = base + u32(i.x + ${SIDE} * (i.y + ${SIDE} * i.z));
  var best = -1e30;
  for (var n = 0u; n < 8u; n++) {
    let o = vec3<u32>(n & 1u, (n >> 1u) & 1u, n >> 2u);
    let v = ${fn}_load(k0 + o.x + ${SIDE}u * (o.y + ${SIDE}u * o.z));
    best = max(best, v - length(vec3<f32>(o) * ${num(h)} - fr));
  }
  return best;
}`;

  const stats: BrickStats = { evaluations, bricks: cells.length, coarse: coarseCount, bytes: data.byteLength, ms: performance.now() - t0 };
  const samples = (slot: number): Float32Array => data.subarray(cellFloats + slot * BRICK_FLOATS, cellFloats + slot * BRICK_FLOATS + SIDE * SIDE * SIDE);
  return { name, table, origin, cell: h, band, dims, cells, error: h * SQRT3, stats, lower, sample, samples, wgsl };
}

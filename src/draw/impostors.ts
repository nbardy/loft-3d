// impostors: many copies of a sphere, capsule or rounded cone, one per cell of a lattice, intersected analytically per
// pixel (docs/folding_and_tracing.md section 3.2). The ray is folded instead of the point: the fragment stage walks the
// cells the view ray crosses (a 3D DDA) and intersects each cell's shape in closed form, so the cost is the number of
// cells crossed, not the number of copies. Each cell's shape is an expression of the cell (its integer index, its
// centre and three hashes of it), so copies vary per cell at no cost. Depth, coverage, ink and lighting are as for
// draw.field (trace.ts).
//
// Contract: a cell's shape lies inside its cell. Then the first hit along the walk is the nearest once it is nearer
// than the cell's exit, and the walk stops there. A shape reaching into a neighbouring cell is cut where the ray
// leaves its cell late; that is the author's to avoid (a radius of zero is allowed and draws nothing: a missing copy).

import { nameId } from "./surface.ts";
import { lit } from "../compile/scene_wgsl.ts";
import { add, mul, variable, vec4, type Expr } from "../expr.ts";
import { emitShaderFn } from "../compile/bind.ts";
import { drawSpec, type Bakeable, type CompileContext, type Drawable, type Emitted, type V3 } from "../compile/context.ts";
import { hash33 } from "../lib/noise.ts";
import type { F, P3, Skeleton } from "../map/types.ts";
import type { Bounds } from "./index.ts";
import { bound, outlineWgsl, PROXY_VERTICES, traceWgsl, type TraceOutline } from "./trace.ts";

/** One lattice cell: integer index (as f32 lanes), world centre, and three independent hashes of it in [0, 1). */
export type Cell = { readonly id: Expr<"vec3">; readonly centre: P3; readonly hash: Expr<"vec3"> };

/** A cell's shape, positions relative to the cell's centre. */
export type ImpostorShape =
  | { readonly kind: "sphere"; readonly centre: P3; readonly radius: F }
  | { readonly kind: "capsule"; readonly a: P3; readonly b: P3; readonly radius: F }
  /** The hull of a sphere of radius `ra` at `a` and one of radius `rb` at `b` (|ra - rb| < |b - a|). */
  | { readonly kind: "cone"; readonly a: P3; readonly b: P3; readonly ra: F; readonly rb: F };

/** What `paint` sees at a hit. `local` is the hit relative to the cell's centre. */
export type ImpostorHit = { readonly p: P3; readonly normal: P3; readonly local: P3; readonly cell: Cell };

export type ImpostorOptions = {
  /** Cell size per axis; cells are centred on integer multiples of it (as `fold3.repeat`). */
  readonly cell: V3;
  readonly shape: (cell: Cell) => ImpostorShape;
  /** The cells drawn: those whose centres lie in this box. */
  readonly bounds: Bounds;
  readonly paint: (hit: ImpostorHit) => P3;
  /** Most cells walked per pixel. */
  readonly cells: number;
  readonly outline: TraceOutline;
};

const ID = variable("cell_id", "vec3"), P = variable("p", "vec3"), N = variable("n", "vec3");

/** The cell of an index expression, as every expression of this module sees it. */
function cellOf(id: Expr<"vec3">, size: V3): Cell {
  return { id, centre: mul(id, [...size]), hash: hash33(id) };
}

/** The shape as two vec4s (a, b) in world coordinates, and the WGSL that intersects and measures that kind. */
function shapeOf(s: ImpostorShape, c: Cell): { readonly roots: readonly [Expr<"vec4">, Expr<"vec4">]; readonly wgsl: string } {
  const at = (q: P3): P3 => add(c.centre, q);
  switch (s.kind) {
    case "sphere": return { roots: [vec4(at(s.centre), s.radius), vec4(at(s.centre), s.radius)], wgsl: SPHERE };
    case "capsule": return { roots: [vec4(at(s.a), s.radius), vec4(at(s.b), s.radius)], wgsl: CAPSULE };
    case "cone": return { roots: [vec4(at(s.a), s.ra), vec4(at(s.b), s.rb)], wgsl: CONE };
  }
}

// Each kind: `imp_hit(o, d, a, b) -> vec4` (t and unit normal; t < 0 for a miss) and `imp_sd(p, a, b) -> f32` (the
// exact distance, for edges and ink); a.xyz, b.xyz are the ends (equal for a sphere), a.w, b.w the radii.
// The closed forms are Inigo Quilez's (iquilezles.org, "intersectors"), transcribed.
const SPHERE = /* wgsl */ `
fn imp_hit(o: vec3<f32>, d: vec3<f32>, a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let oc = o - a.xyz;
  let bb = dot(oc, d);
  let h = bb * bb - dot(oc, oc) + a.w * a.w;
  if (h < 0.0 || a.w <= 0.0) { return vec4<f32>(-1.0); }
  let t = -bb - sqrt(h);
  return vec4<f32>(t, (oc + d * t) / a.w);
}
fn imp_sd(p: vec3<f32>, a: vec4<f32>, b: vec4<f32>) -> f32 { return length(p - a.xyz) - a.w; }`;

const CAPSULE = /* wgsl */ `
fn imp_hit(o: vec3<f32>, d: vec3<f32>, a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let r = a.w;
  if (r <= 0.0) { return vec4<f32>(-1.0); }
  let ba = b.xyz - a.xyz;
  let oa = o - a.xyz;
  let baba = dot(ba, ba);
  let bard = dot(ba, d);
  let baoa = dot(ba, oa);
  let qa = baba - bard * bard;
  let qb = baba * dot(d, oa) - baoa * bard;
  let qc = baba * dot(oa, oa) - baoa * baoa - r * r * baba;
  let h = qb * qb - qa * qc;
  if (h < 0.0) { return vec4<f32>(-1.0); }
  var t = (-qb - sqrt(h)) / qa;
  let y = baoa + t * bard;
  if (!(y > 0.0 && y < baba)) {
    // An end cap: the sphere at the nearer end.
    let oc = select(o - b.xyz, oa, y <= 0.0);
    let cb = dot(d, oc);
    let hc = cb * cb - dot(oc, oc) + r * r;
    if (hc <= 0.0) { return vec4<f32>(-1.0); }
    t = -cb - sqrt(hc);
  }
  let pa = o + d * t - a.xyz;
  let k = clamp(dot(pa, ba) / baba, 0.0, 1.0);
  return vec4<f32>(t, (pa - ba * k) / r);
}
fn imp_sd(p: vec3<f32>, a: vec4<f32>, b: vec4<f32>) -> f32 {
  let pa = p - a.xyz;
  let ba = b.xyz - a.xyz;
  let k = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * k) - a.w;
}`;

const CONE = /* wgsl */ `
fn imp_hit(o: vec3<f32>, d: vec3<f32>, a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let ra = a.w;
  let rb = b.w;
  if (max(ra, rb) <= 0.0) { return vec4<f32>(-1.0); }
  let ba = b.xyz - a.xyz;
  let oa = o - a.xyz;
  let ob = o - b.xyz;
  let rr = ra - rb;
  let m0 = dot(ba, ba);
  let m1 = dot(ba, oa);
  let m2 = dot(ba, d);
  let m3 = dot(d, oa);
  let m5 = dot(oa, oa);
  let m6 = dot(ob, d);
  let m7 = dot(ob, ob);
  let d2 = m0 - rr * rr;
  let k2 = d2 - m2 * m2;
  let k1 = d2 * m3 - m1 * m2 + m2 * rr * ra;
  let k0 = d2 * m5 - m1 * m1 + m1 * rr * ra * 2.0 - m0 * ra * ra;
  let h = k1 * k1 - k0 * k2;
  if (h < 0.0) { return vec4<f32>(-1.0); }
  let t = (-sqrt(h) - k1) / k2;
  let y = m1 - ra * rr + t * m2;
  if (y > 0.0 && y < d2) { return vec4<f32>(t, normalize(d2 * (oa + t * d) - ba * y)); }
  // The end spheres.
  let h1 = m3 * m3 - m5 + ra * ra;
  let h2 = m6 * m6 - m7 + rb * rb;
  if (max(h1, h2) < 0.0) { return vec4<f32>(-1.0); }
  var r = vec4<f32>(1e20, 0.0, 0.0, 0.0);
  if (h1 > 0.0 && ra > 0.0) { let t1 = -m3 - sqrt(h1); r = vec4<f32>(t1, (oa + d * t1) / ra); }
  if (h2 > 0.0 && rb > 0.0) { let t2 = -m6 - sqrt(h2); if (t2 < r.x) { r = vec4<f32>(t2, (ob + d * t2) / rb); } }
  return select(r, vec4<f32>(-1.0), r.x >= 1e19);
}
fn imp_sd(p: vec3<f32>, a: vec4<f32>, b: vec4<f32>) -> f32 {
  // The rounded cone's exact distance (as sdRoundCone in src/lib/sdf3.ts).
  let ba = b.xyz - a.xyz;
  let l2 = dot(ba, ba);
  let rr = a.w - b.w;
  let a2 = l2 - rr * rr;
  let il2 = 1.0 / l2;
  let pa = p - a.xyz;
  let y = dot(pa, ba);
  let z = y - l2;
  let v = pa * l2 - ba * y;
  let x2 = dot(v, v);
  let y2 = y * y * l2;
  let z2 = z * z * l2;
  let k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) { return sqrt(x2 + z2) * il2 - b.w; }
  if (sign(y) * a2 * y2 < k) { return sqrt(x2 + y2) * il2 - a.w; }
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - a.w;
}`;

/** The intersector and distance of each kind, for drawables that intersect one listed shape per draw (copies.ts). */
export function shapeWgsl(kind: ImpostorShape["kind"]): string {
  switch (kind) {
    case "sphere": return SPHERE;
    case "capsule": return CAPSULE;
    case "cone": return CONE;
  }
}

/** WGSL `imp_closest(o, d, a, b)`: the point of the ray o + t d nearest the segment a-b (as t), for a miss's closest approach. */
export const CLOSEST_WGSL = /* wgsl */ `
fn imp_closest(o: vec3<f32>, d: vec3<f32>, a: vec3<f32>, b: vec3<f32>) -> f32 {
  let ba = b - a;
  let w = o - a;
  let bb = dot(ba, ba);
  let db = dot(d, ba);
  let den = bb - db * db;
  // s on the segment, t on the ray (d is unit). A sphere (bb = 0) or a parallel ray uses the segment's start.
  let s = select(clamp((dot(w, ba) - db * dot(w, d)) / den, 0.0, 1.0), 0.0, den < 1e-9 * max(bb, 1e-20) || bb < 1e-20);
  return max(dot(a + ba * s - o, d), 0.0);
}`;

const num = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));
const v3 = (v: readonly number[]): string => `vec3<f32>(${v.map(num).join(", ")})`;

/**
 * The `Drawable` that `impostors` returns: one sphere, capsule or rounded cone per cell of a lattice, ray-cast per
 * pixel. A scene author gets it from `impostors`, not by constructing it.
 */
export class Impostors implements Drawable {
  readonly skeletons: readonly Skeleton[] = [];
  readonly surfaces: readonly Bakeable[] = [];
  /** First and last cell index per axis. */
  private readonly lo: V3;
  private readonly hi: V3;

  constructor(readonly name: string, readonly o: ImpostorOptions) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`impostors "${name}": names must be identifiers (they name shaders)`);
    if (!o.cell.every((c) => c > 0 && Number.isFinite(c))) throw new Error(`impostors "${name}": cell sizes must be positive, got [${o.cell.join(", ")}]`);
    if (!(Number.isInteger(o.cells) && o.cells >= 1)) throw new Error(`impostors "${name}": cells must be a positive integer, got ${o.cells}`);
    this.lo = o.cell.map((c, i) => Math.ceil(o.bounds.min[i] / c - 1e-9)) as unknown as V3;
    this.hi = o.cell.map((c, i) => Math.floor(o.bounds.max[i] / c + 1e-9)) as unknown as V3;
    if (!this.lo.every((l, i) => l <= this.hi[i])) throw new Error(`impostors "${name}": no cell centre lies in the bounds`);
  }

  /** Number of copies drawn (cells in the bounds). */
  get count(): number { return this.lo.reduce((n, l, i) => n * (this.hi[i] - l + 1), 1); }

  draws(ctx: CompileContext): Emitted {
    const c = this.o.cell;
    const cell = cellOf(ID, c);
    const shape = shapeOf(this.o.shape(cell), cell);
    const shapeFn = emitShaderFn(ctx.slots, { name: "imp_shape", args: [["cell_id", "vec3"]], out: "array<vec4<f32>, 2>", roots: shape.roots, ret: (v) => `array<vec4<f32>, 2>(${v.join(", ")})` });
    const paint = emitShaderFn(ctx.slots, {
      name: "imp_paint", args: [["p", "vec3"], ["n", "vec3"], ["cell_id", "vec3"]], out: "vec3<f32>",
      roots: [this.o.paint({ p: P, normal: N, local: add(P, mul(cell.centre, -1)), cell })], ret: (v) => v[0],
    });
    const box = bound.box(this.lo.map((l, i) => (l - 0.5) * c[i]) as unknown as V3, this.hi.map((h, i) => (h + 0.5) * c[i]) as unknown as V3);
    const key = `impostors.${this.name}`;
    const code = [traceWgsl(box, "true"), outlineWgsl(this.o.outline), `const IMP_ID: f32 = ${lit(nameId(this.name))};`, shape.wgsl, shapeFn.code, paint.code, walkWgsl(c, this.lo, this.hi)].join("\n");
    return {
      shaders: { [key]: { code, libs: [...new Set([...shapeFn.libs, ...paint.libs])] } },
      draws: [drawSpec({ label: this.name, shader: key, vertices: PROXY_VERTICES, cull: "front", constants: { CELLS: this.o.cells } })],
    };
  }
}

function walkWgsl(c: V3, lo: V3, hi: V3): string {
  return /* wgsl */ `
override CELLS: u32 = 64u;
const CELL: vec3<f32> = ${v3(c)};
const KLO: vec3<f32> = ${v3(lo)};
const KHI: vec3<f32> = ${v3(hi)};
${CLOSEST_WGSL}
@diagnostic(off, derivative_uniformity)
@fragment fn fs(in: TraceIn) -> TraceOut {
  let d = view_dir(in.world);
  let o = trace_origin(in.world, d);
  let span = bound_span(o, d);
  let t0 = max(span.x, 0.0);
  let t1 = span.y;
  if (t0 > t1) { discard; }
  let fp0 = pixel_world(o + d * t0);
  let fpk = (pixel_world(o + d * max(t1, t0 + 1e-3)) - fp0) / max(t1 - t0, 1e-3);
  // The walk, in lattice coordinates g = p / CELL + 0.5, where cell k spans [k, k + 1).
  let st = select(vec3<f32>(-1.0), vec3<f32>(1.0), d >= vec3<f32>(0.0));
  let ad = max(abs(d), vec3<f32>(1e-20));
  var k = floor((o + d * t0) / CELL + 0.5);
  let delta = CELL / ad;
  var next = ((k + 0.5 * st) * CELL - o) * st / ad;
  var best = vec4<f32>(1e30, 0.0, 0.0, 0.0);
  var bestK = k;
  var nearPx = 1e30;
  var nearT = t0;
  var nearK = k;
  var inked = false;
  for (var i = 0u; i < CELLS; i++) {
    if (all(k >= KLO) && all(k <= KHI)) {
      let sh = imp_shape(k);
      let h = imp_hit(o, d, sh[0], sh[1]);
      if (h.x > 0.0 && h.x < best.x) { best = h; bestK = k; }
      // An absent copy (radius zero) has no edge and no ink.
      if (h.x <= 0.0 && max(sh[0].w, sh[1].w) > 0.0) {
        let tc = imp_closest(o, d, sh[0].xyz, sh[1].xyz);
        let fp = fp0 + fpk * (tc - t0);
        let gap = imp_sd(o + d * tc, sh[0], sh[1]) / fp;
        if (gap < nearPx) { nearPx = gap; nearT = tc; nearK = k; }
        // Ink: a near miss in a cell before any hit is in front of whatever the ray meets later.
        if (INK_ON && best.x >= 1e30 && gap < ink_px(fp)) { inked = true; break; }
      }
    }
    let exit = min(next.x, min(next.y, next.z));
    if (best.x <= exit || exit > t1) { break; }
    let e = select(vec3<f32>(0.0), vec3<f32>(1.0), next <= vec3<f32>(exit));
    k += st * e;
    next += delta * e;
  }
  let hit = best.x < 1e30 && !inked;
  let ck = select(nearK, bestK, hit);
  let sh = imp_shape(ck);
  let tq = select(nearT, best.x, hit);
  let p = o + d * tq;
  // At a miss, the normal of the nearest point of the shape (its distance's gradient direction).
  let nm = normalize(p - (sh[0].xyz + (sh[1].xyz - sh[0].xyz) * clamp(dot(p - sh[0].xyz, sh[1].xyz - sh[0].xyz) / max(dot(sh[1].xyz - sh[0].xyz, sh[1].xyz - sh[0].xyz), 1e-20), 0.0, 1.0)));
  let n = select(nm, best.yzw, hit);
  let base = imp_paint(p, n, ck);
  let fp = fp0 + fpk * (tq - t0);
  let edge = select(0.0, ink_px(fp), INK_ON);
  let cover = select(clamp(1.0 + edge - nearPx, 0.0, 1.0), 1.0, hit || inked);
  let id = fract(IMP_ID + dot(ck, vec3<f32>(0.6180340, 0.4142136, 0.7320508)));
  let colour = select(trace_shade(base, n, p, d, id), trace_ink(base, n, p, d, id), INK_ON && !hit);
  let mask = trace_mask(cover, in.clip.xy);
  if (mask == 0u) { discard; }
  return TraceOut(vec4<f32>(colour, trace_mark(base, n, p, d, id)), trace_depth(p), mask);
}`;
}

/** Many copies of a simple shape, one per lattice cell, ray-cast per pixel by walking the cells the ray crosses. */
export function impostors(name: string, o: ImpostorOptions): Impostors {
  return new Impostors(name, o);
}

// The wake: foam on the water where a body crossed the surface in the recent past (DESIGN.md 8), from the body taken
// at earlier times (`body.skeletonAt(time - k dt)`), never from state kept between frames.
//
// The pose stages evaluate the skeleton of each past slice and the sea's height at that slice's time. Where a joint's
// sphere cuts the water, its waterline is a disc of radius sqrt(r^2 - h^2); consecutive joints make a tapered capsule,
// widened as it ages. Each capsule is drawn as its own small patch of the sea surface (as shadows are), so the wake
// costs the area it covers. A capsule draws only where the body had not been more recently (the younger slice's
// capsules do not cover the pixel) and, along a chain, only where it is the deepest of its neighbours, so each pixel is
// foamed by the youngest slice that left it: a trail that fades with age, with no foam stacked on foam.

import {
  add, and, clamp, div, fetch, floor, gt, lift, listOf, lt, mapOf, max, mul, or, select, sqrt, sub, time, vec2, vec4, type Expr, type MapRun, type TableSource,
} from "../expr.ts";
import type { F } from "../map/types.ts";
import { drawSpec, type CompileContext, type Drawable, type Emitted } from "../compile/context.ts";
import { seaOf } from "../draw/ground.ts";
import type { Body } from "../map/sweep.ts";
import type { Skeleton } from "../map/types.ts";

/** vec4s per capsule: (end a xz, end b xz), (radius a, radius b, age, valid), (linked to previous, linked to next, 0, 0). */
const ENTRY = 3;
/** The wake keeps every STRIDE-th station of the body. */
const STRIDE = 3;
/** Quads per side of a capsule's patch. */
const PATCH = 3;

export type WakeSpec = {
  /** Seconds of the recent past the wake remembers. */
  readonly over: number;
  /** Past slices sampled across `over`. */
  readonly samples?: number;
  /** World units per second the foam spreads as it ages. */
  readonly spread?: number;
  /** Foam colour (display sRGB). */
  readonly colour?: readonly [number, number, number];
};

class Wake implements Drawable {
  readonly skeletons = [];
  readonly surfaces = [];
  constructor(readonly name: string, readonly body: Body, readonly spec: Required<WakeSpec>) {}

  draws(ctx: CompileContext): Emitted {
    const s = this.spec, dt = s.over / s.samples, sea = seaOf(ctx.ground, `wake "${this.name}"`);
    // Past slices are skeletons only (positions and radii, no frames), at every STRIDE-th station: all a waterline
    // needs, at a third of the cost (DESIGN.md 9). Row 0 reads the live body at the same stations.
    const n = this.body.transport.stations, joints = Math.ceil((n - 1) / STRIDE) + 1, segs = joints - 1;
    const kept = Array.from({ length: joints }, (_, j) => Math.round((j * (n - 1)) / (joints - 1)));
    const live: Skeleton = { joints, joint: (j) => this.body.skeleton.joint(kept[j]!) };
    const slices = Array.from({ length: s.samples + 1 }, (_, k) => (k === 0 ? live : this.body.skeletonAt(sub(time, k * dt), kept)));
    const source = wakeTable(this.name, slices, joints, dt, s.spread, (xz, t) => sea.height(xz, t));
    const t = ctx.table(source).wgsl;
    const [fr, fg, fb] = s.colour;
    const code = /* wgsl */ `
const PATCH: u32 = ${PATCH}u;
const SEGS: u32 = ${segs}u;
const OVER: f32 = ${s.over};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) @interpolate(flat) id: u32,
};
/// Signed distance from p to capsule e (tapered): negative inside.
fn wake_d(e: u32, p: vec2<f32>) -> f32 {
  let a = ${t}(${ENTRY}u * e);
  let b = ${t}(${ENTRY}u * e + 1u);
  let pa = p - a.xy;
  let ba = a.zw - a.xy;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h) - mix(b.x, b.y, h);
}
fn wake_valid(e: u32) -> bool { return ${t}(${ENTRY}u * e + 1u).w > 0.5; }
fn wake_hash(c: vec2<f32>) -> f32 { return fract(sin(dot(c, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn wake_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wake_hash(i), wake_hash(i + vec2<f32>(1.0, 0.0)), u.x), mix(wake_hash(i + vec2<f32>(0.0, 1.0)), wake_hash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
/// Whether a younger slice's capsule at segment j (or its neighbours) covers p: the body was there more recently.
fn wake_younger_covers(row: u32, j: u32, p: vec2<f32>) -> bool {
  let e = (row - 1u) * SEGS + j;
  var hit = wake_valid(e) && wake_d(e, p) < 0.0;
  if (j > 0u) { hit = hit || (wake_valid(e - 1u) && wake_d(e - 1u, p) < 0.0); }
  if (j + 1u < SEGS) { hit = hit || (wake_valid(e + 1u) && wake_d(e + 1u, p) < 0.0); }
  return hit;
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  // Row 0 (the body now) is never drawn: the sea's contact foam covers it. It is read as the youngest row.
  let e = ii + SEGS;
  out.id = e;
  if (!wake_valid(e)) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.world = vec3<f32>(0.0);
    return out;
  }
  let a = ${t}(${ENTRY}u * e);
  let b = ${t}(${ENTRY}u * e + 1u);
  let ij = vec2<u32>((vi / 6u) / PATCH, (vi / 6u) % PATCH) + quad_corner(vi % 6u);
  let uv = vec2<f32>(ij) / f32(PATCH);
  let ab = a.zw - a.xy;
  let len = length(ab);
  let along = select(vec2<f32>(1.0, 0.0), ab / len, len > 1e-6);
  let across = vec2<f32>(-along.y, along.x);
  let pad = max(b.x, b.y) + 0.1;
  let xz = a.xy + along * mix(-pad, len + pad, uv.x) + across * mix(-pad, pad, uv.y);
  out.world = vec3<f32>(xz.x, sea_height(xz), xz.y);
  out.clip = frame.view_proj * vec4<f32>(out.world, 1.0);
  return out;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let e = in.id;
  let row = e / SEGS;
  let j = e % SEGS;
  let p = in.world.xz;
  let px = sea_footprint(in.world);
  let d = wake_d(e, p);
  let c = ${t}(${ENTRY}u * e + 2u);
  if (d > px || wake_younger_covers(row, j, p) || (c.x > 0.5 && wake_d(e - 1u, p) < d) || (c.y > 0.5 && wake_d(e + 1u, p) <= d)) { discard; }
  let age = ${t}(${ENTRY}u * e + 1u).z / OVER;
  // Lacy foam fixed on the water: two octaves of value noise against a threshold that rises as the foam ages, with a
  // brighter line where the waterline was most recently (the capsule's rim).
  let n = 0.65 * wake_noise(p * 2.1) + 0.35 * wake_noise(p * 5.3 + vec2<f32>(3.1, 7.7));
  let threshold = mix(0.3, 0.72, age);
  let lace = smoothstep(threshold - 0.07, threshold + 0.07, n);
  let rim = 1.0 - smoothstep(0.0, 0.35, -d);
  let foam = max(lace, rim * (1.0 - age));
  let edge = 1.0 - smoothstep(-px, px, d);
  let alpha = foam * edge * 0.85 * pow(1.0 - age, 1.4);
  if (alpha <= 0.002) { discard; }
  return vec4<f32>(${fr}, ${fg}, ${fb}, alpha);
}`;
    return {
      shaders: { [this.name]: { code, libs: [] } },
      draws: [drawSpec({ label: this.name, shader: this.name, vertices: 6 * PATCH * PATCH, instances: s.samples * segs, phase: "on-water", cull: "none", depthWrite: false, blend: "alpha" })],
    };
  }
}

/**
 * The wake's capsules, two pose-stage maps. A list of every slice's joints with their waterline (where the joint's
 * sphere cuts the sea at that slice's time: a disc of radius sqrt(r^2 - h^2)); then per slice, segment j from joint j to
 * j + 1, valid where either end cuts the water, widened as it ages, linked to its valid neighbours. An invalid segment's
 * entry is all zero.
 */
function wakeTable(name: string, slices: readonly Skeleton[], joints: number, dt: number, spread: number, seaHeight: (xz: Expr<"vec2">, t: F) => F): TableSource {
  const segs = joints - 1;
  // The joints are a list (each its own expression); the sea under them is one closed form, a map of its own, so no
  // GPU branch per joint evaluates the sea. Entry i is slice floor(i / joints).
  const lines = slices.flatMap((sk) => Array.from({ length: joints }, (_, j) => { const p = sk.joint(j); return [vec4(p.p, p.r)]; }));
  const at: TableSource = { name: `${name}_at`, lanes: 1, entries: lines.length, role: "data", program: listOf(lines) };
  const waterline: TableSource = {
    name: `${name}_joints`, lanes: 1, entries: lines.length, role: "data",
    program: mapOf(lines.length, (i) => {
      const p = fetch(at, i, 0);
      const h = sub(p.y, seaHeight(vec2(p.x, p.z), sub(time, mul(floor(div(i, joints)), dt))));
      return [vec4(p.xyz, sqrt(max(sub(mul(p.w, p.w), mul(h, h)), 0)))];
    }),
  };
  const zero = lift<"vec4">([0, 0, 0, 0]);
  const runs: MapRun[] = slices.map((_, k) => ({
    count: segs,
    lanes: (j) => {
      const J = (i: F): Expr<"vec4"> => fetch(waterline, add(clamp(i, 0, joints - 1), k * joints), 0);
      const valid = (i: F): Expr<"bool"> => or(gt(J(i).w, 1e-3), gt(J(add(i, 1)).w, 1e-3));
      const a = J(j), b = J(add(j, 1));
      // A joint clear of the water contributes no width; the capsule still reaches it so the foam tapers to a point.
      const grow = spread * k * dt;
      const width = (w: F): F => add(w, select(gt(w, 1e-3), grow, 0));
      const here = valid(j);
      const prev = and(gt(j, 0.5), valid(sub(j, 1))), next = and(lt(j, segs - 1.5), valid(add(j, 1)));
      return [
        vec4(a.x, a.z, b.x, b.z), vec4(width(a.w), width(b.w), k * dt, 1), vec4(select(prev, 1, 0), select(next, 1, 0), 0, 0),
      ].map((x) => select(here, x, zero));
    },
  }));
  return { name, lanes: ENTRY, entries: slices.length * segs, role: "data", program: { kind: "map", runs } };
}

/**
 * Foam on the water where the body crossed the surface over the last `over` seconds, fading with age. Read from the
 * body at earlier times, never from state kept between frames.
 *
 * The law. Past slice k (1 to `samples`, dt = over / samples) is the body's skeleton at time - k dt, every third
 * station. Where a joint's sphere (radius r, centre h above the sea at that slice's time) cuts the water its waterline
 * is a disc of radius sqrt(r^2 - h^2); consecutive joints make a tapered capsule, widened by `spread` times its age. A
 * pixel is foamed by the youngest slice that covers it and nowhere a younger one does, so the trail fades with age and
 * foam never stacks: lace from value noise against a threshold that rises with age, and a brighter rim where the
 * waterline was.
 *
 * Parameters: `over`, `samples` (default 10), `spread` (default 0.35 units a second) and `colour` are fixed; the body
 * is any `Body` and moves as it moves.
 *
 * What it cannot do, because of the law:
 * - exist without a sea: it reads the sea's height at past times (a plane or nothing is refused).
 * - move the water: it is foam only, no wave and no displacement.
 * - drift: the foam is fixed where the body crossed, not carried by the swell or a current.
 * - show the body's present waterline: the live slice is left to the sea's contact foam, so a body that holds still
 *   leaves no trail.
 * - follow detail finer than every third station, or remember longer than `over`.
 *
 * Going past it: `body.skeletonAt(t, stations)` is the body's skeleton at any past time, which any drawable of yours
 * can read. Relatives worth trying:
 * - a Kelvin wake: the V of waves behind a moving point, its arms at 19.5 degrees to the path whatever the speed, as
 *   a `SeaDeform` summing crests along the past path.
 * - a dust trail on a plane: the same capsules, cut by the ground at height 0 instead of the sea.
 * - a ring per touchdown: a `ringWave` started at each moment a joint first cuts the water.
 */
export function wake(body: Body, spec: WakeSpec): Drawable {
  const full: Required<WakeSpec> = { over: spec.over, samples: spec.samples ?? 10, spread: spec.spread ?? 0.35, colour: spec.colour ?? [0.95, 0.98, 0.97] };
  if (!(full.over > 0)) throw new Error(`wake: over must be positive, got ${full.over}`);
  if (!(Number.isInteger(full.samples) && full.samples >= 1)) throw new Error(`wake: samples must be a positive integer, got ${full.samples}`);
  if (body.skeleton.joints < 2) throw new Error(`wake: "${body.name}" has no skeleton segments to leave a wake with`);
  return new Wake(`wake_${body.name}`, body, full);
}

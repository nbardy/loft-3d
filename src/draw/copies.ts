// draw.copies: a list of simple solids (spheres, capsules or rounded cones), each intersected exactly per pixel inside
// its own box (docs/tracing_sota.md 5.3). It is the list reading of a fold: where draw.field asks a folded field at
// every step of a march, this draws one instance per copy and solves one closed formula per pixel the copy covers.
//
// Each copy is its oriented box, drawn with front faces culled (as the tracers' proxy, trace.ts), grown by the ink
// width and one pixel for the antialiased edge. The fragment stage intersects the view ray with the copy alone and
// writes its depth, so copies sort against each other and the rest of the scene by the depth test. A union of copies
// drawn this way is the union's surface: the nearest hit over the copies is the hit of their union. Ink is a near
// miss, at the depth of closest approach, so a branch's outline shows over what is behind it and is hidden by what is
// in front, as the traced union's is.
//
// Level of detail is per copy, in the vertex stage: a copy thinner than `minPixels` on screen is not drawn.
//
// Carried copies (`carry`, added 2026-11-11 for examples/bosses/reefback_titan.ts: coral, trees and a ruin on a
// walking crab's shell). The list stays static, given in the carrying frame's coordinates; the frame is a closed-form
// expression evaluated per vertex (a rigid motion: unit axes, so radii are unchanged), and the copies are moved into
// the world before the box is built. `paint` then sees the hit in the frame's coordinates, so patterns ride the
// copies. Not carried, the frame is the identity and the copies are where the list says. The shadow blob is fitted once
// to the list as given, in the frame's coordinates, and its joints are carried by the frame every frame, so it follows
// the crab (it was fitted once in the world and stayed behind, 2026-11-11). Only what stands above the list's own
// y = 0 casts, which is the water's level only for a frame that rides at it.

import { nameId } from "./surface.ts";
import { lit } from "../compile/scene_wgsl.ts";
import { add, lift, variable, type Expr, type TableSource } from "../expr.ts";
import { scopedName } from "../expr.ts";
import { emitShaderFn } from "../compile/bind.ts";
import { drawSpec, type Bakeable, type CompileContext, type Drawable, type Emitted } from "../compile/context.ts";
import type { Branch, Part } from "../lib/similar.ts";
import { rotate } from "../map/chart.ts";
import type { F, Frame, P3, Skeleton } from "../map/types.ts";
import { fitBlob, shadowSkeleton } from "./field_shadow.ts";
import { CLOSEST_WGSL, shapeWgsl } from "./impostors.ts";
import { outlineWgsl, PROXY_VERTICES, tracePlumbingWgsl, type TraceOutline } from "./trace.ts";

/**
 * What `paint` sees at a hit: the point and normal (in the carrying frame's coordinates when carried, else the world's),
 * and which copy it is on (its level and id, as when asked).
 */
export type CopiesHit = { readonly p: P3; readonly normal: P3; readonly level: F; readonly id: Expr<"vec3"> };

export type CopiesOptions = {
  /** The kind every copy is (one closed formula per draw). */
  readonly kind: Part["kind"];
  /** The copies, placed in the world. Static: they are uploaded once. */
  readonly copies: readonly Branch[];
  readonly paint: (hit: CopiesHit) => P3;
  readonly outline: TraceOutline;
  /** A copy whose diameter is under this many pixels is not drawn. */
  readonly minPixels: number;
  /** Levels below this are drawn at any size (so a far tree keeps its trunk). */
  readonly keepLevels: number;
  /** How far behind a near miss its ink is written, in ink widths: a surface closer behind than that shows instead. */
  readonly inkBack: number;
  /**
   * A rigid frame (unit, orthogonal axes) the copies ride: `copies` are given in its coordinates. Absent, they are in
   * the world.
   */
  readonly carry?: Frame;
};

const WORLD_FRAME: Frame = { o: lift<"vec3">([0, 0, 0]), x: lift<"vec3">([1, 0, 0]), y: lift<"vec3">([0, 1, 0]), z: lift<"vec3">([0, 0, 1]) };

/** What the copies ride, classified once from `carry`: the world (as listed), or a moving frame. */
type Ride = { readonly kind: "world" } | { readonly kind: "frame"; readonly frame: Frame };
const rideOf = (carry: Frame | undefined): Ride => (carry === undefined ? { kind: "world" } : { kind: "frame", frame: carry });

/** The shadow's chain, carried as the copies are. */
function rideShadow(s: Skeleton, r: Ride): Skeleton {
  switch (r.kind) {
    case "world": return s;
    case "frame": return { joints: s.joints, joint: (k) => { const j = s.joint(k); return { p: add(r.frame.o, rotate(r.frame, j.p)), r: j.r }; } };
  }
}

const P = variable("p", "vec3"), N = variable("n", "vec3"), ID = variable("copy_id", "vec3"), LEVEL = variable("copy_level", "f32");
const num = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/** The copies as a static table, three vec4s each: (a, ra), (b, rb), (id, level). */
function copiesTable(name: string, copies: readonly Branch[]): TableSource {
  const data = new Float32Array(copies.length * 12);
  copies.forEach((c, i) => data.set([...c.a, c.ra, ...c.b, c.rb, ...c.id, c.level], i * 12));
  return { name, lanes: 3, entries: copies.length, role: "static", prepare: () => (_frame, out) => out.set(data) };
}

/** Points along each copy's axis per copy, for the shadow's fit. */
const SHADOW_SAMPLES = 4;

/**
 * The shadow the copies cast on the water together: one soft blob, as a traced field casts (field_shadow.ts), fitted
 * to points along the copies' axes weighted by the volume each stands for. Only what is above the still water casts,
 * unless nothing is. A blob, not a capsule per copy: thousands of capsules would be posed on the CPU every frame.
 */
function copiesShadow(copies: readonly Branch[]): Skeleton {
  const pts = copies.flatMap((c) => Array.from({ length: SHADOW_SAMPLES }, (_, k) => {
    const s = (k + 0.5) / SHADOW_SAMPLES, r = c.ra + (c.rb - c.ra) * s;
    const p = [c.a[0] + (c.b[0] - c.a[0]) * s, c.a[1] + (c.b[1] - c.a[1]) * s, c.a[2] + (c.b[2] - c.a[2]) * s] as const;
    const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]);
    // A slice of a cone, or the whole ball when the ends coincide.
    return { p, w: len > 0 ? (r * r * len) / SHADOW_SAMPLES : (r * r * r) / SHADOW_SAMPLES, r };
  }));
  const above = pts.filter((q) => q.p[1] > 0);
  const cast = above.length >= 2 ? above : pts;
  return shadowSkeleton({ kind: "sampled", inside: cast.length, chain: fitBlob(cast, 0.5 * Math.max(...cast.map((q) => q.r))) });
}

/**
 * The `Drawable` that `draw.copies` returns: a static list of spheres, capsules or rounded cones, each intersected
 * exactly per pixel. A scene author gets it from `draw.copies`, not by constructing it.
 */
export class Copies implements Drawable {
  readonly skeletons: readonly Skeleton[];
  readonly surfaces: readonly Bakeable[] = [];

  constructor(readonly name: string, readonly o: CopiesOptions) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`draw.copies "${name}": names must be identifiers (they name shaders)`);
    this.name = scopedName(name);
    if (o.copies.length === 0) throw new Error(`draw.copies "${name}": no copies`);
    if (!(o.minPixels >= 0 && Number.isFinite(o.minPixels))) throw new Error(`draw.copies "${name}": minPixels must be finite and not negative, got ${o.minPixels}`);
    if (!(Number.isInteger(o.keepLevels) && o.keepLevels >= 0)) throw new Error(`draw.copies "${name}": keepLevels must be a non-negative integer, got ${o.keepLevels}`);
    for (const c of o.copies) {
      if (![...c.a, ...c.b, c.ra, c.rb].every(Number.isFinite) || Math.max(c.ra, c.rb) <= 0) throw new Error(`draw.copies "${name}": a copy has a non-finite number or no radius`);
    }
    this.skeletons = [rideShadow(copiesShadow(o.copies), rideOf(o.carry))];
  }

  draws(ctx: CompileContext): Emitted {
    const table = ctx.table(copiesTable(`${this.name}_copies`, this.o.copies));
    const paint = emitShaderFn(ctx.slots, {
      name: "copies_paint", args: [["p", "vec3"], ["n", "vec3"], ["copy_id", "vec3"], ["copy_level", "f32"]], out: "vec3<f32>",
      roots: [this.o.paint({ p: P, normal: N, level: LEVEL, id: ID })], ret: (v) => v[0],
    });
    const c = this.o.carry ?? WORLD_FRAME;
    const carry = emitShaderFn(ctx.slots, {
      name: "copies_carry", args: [], out: "array<vec3<f32>, 4>", roots: [c.o, c.x, c.y, c.z],
      ret: (v) => `array<vec3<f32>, 4>(${v.join(", ")})`,
    });
    const key = `copies.${this.name}`;
    const code = [
      tracePlumbingWgsl(), outlineWgsl(this.o.outline), `const COPIES_ID: f32 = ${lit(nameId(this.name))};`,
      shapeWgsl(this.o.kind), CLOSEST_WGSL, paint.code, carry.code, copiesWgsl(table.wgsl, this.o.minPixels, this.o.keepLevels),
    ].join("\n");
    return {
      shaders: { [key]: { code, libs: [...new Set([...paint.libs, ...carry.libs])] } },
      draws: [drawSpec({ label: this.name, shader: key, vertices: PROXY_VERTICES, instances: this.o.copies.length, cull: "front", constants: { INK_BACK: this.o.inkBack } })],
    };
  }
}

function copiesWgsl(tab: string, minPixels: number, keepLevels: number): string {
  return /* wgsl */ `
struct CopyIn {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) @interpolate(flat) a: vec4<f32>,
  @location(2) @interpolate(flat) b: vec4<f32>,
  @location(3) @interpolate(flat) k: vec4<f32>,
  // The carrying frame's origin and axes, for paint in its coordinates.
  @location(4) @interpolate(flat) fo: vec3<f32>,
  @location(5) @interpolate(flat) fx: vec3<f32>,
  @location(6) @interpolate(flat) fy: vec3<f32>,
  @location(7) @interpolate(flat) fz: vec3<f32>,
};
fn copies_to_world(f: array<vec3<f32>, 4>, q: vec3<f32>) -> vec3<f32> { return f[0] + f[1] * q.x + f[2] * q.y + f[3] * q.z; }
fn copies_to_local(in: CopyIn, w: vec3<f32>) -> vec3<f32> { return vec3<f32>(dot(w, in.fx), dot(w, in.fy), dot(w, in.fz)); }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> CopyIn {
  let f = copies_carry();
  let a0 = ${tab}(ii * 3u);
  let b0 = ${tab}(ii * 3u + 1u);
  let a = vec4<f32>(copies_to_world(f, a0.xyz), a0.w);
  let b = vec4<f32>(copies_to_world(f, b0.xyz), b0.w);
  let k = ${tab}(ii * 3u + 2u);
  let mid = (a.xyz + b.xyz) * 0.5;
  let r = max(a.w, b.w);
  let shown = k.w < ${num(keepLevels)} || 2.0 * r >= ${num(minPixels)} * pixel_world(mid);
  // The copy's box: its axis and two directions across it (any, for a sphere).
  let ax = b.xyz - a.xyz;
  let len = length(ax);
  let z = select(vec3<f32>(0.0, 1.0, 0.0), ax / max(len, 1e-20), len > 1e-12);
  let x = normalize(cross(select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(z.y) < 0.9), z));
  let y = cross(z, x);
  // Room for the ink and for the edge's one pixel of antialiasing, at the pixel size of the further end.
  let fp = max(pixel_world(a.xyz), pixel_world(b.xyz));
  let pad = select(0.0, ink_px(fp) * fp, INK_ON) + fp;
  let c = LOFT_CUBE[vi];
  let w = mid + x * (c.x * (r + pad)) + y * (c.y * (r + pad)) + z * (c.z * (len * 0.5 + r + pad));
  return CopyIn(select(HIDDEN_VERTEX, frame.view_proj * vec4<f32>(w, 1.0), shown), w, a, b, k, f[0], f[1], f[2], f[3]);
}
override INK_BACK: f32 = 2.0;
@diagnostic(off, derivative_uniformity)
@fragment fn fs(in: CopyIn) -> TraceOut {
  let d = view_dir(in.world);
  let o = trace_origin(in.world, d);
  let h = imp_hit(o, d, in.a, in.b);
  let hit = h.x > 0.0;
  // A miss is measured where the ray passes nearest the copy: its gap there, in pixels, is the edge's coverage and the ink.
  let tq = select(imp_closest(o, d, in.a.xyz, in.b.xyz), h.x, hit);
  let p = o + d * tq;
  let fp = pixel_world(p);
  let gap = select(imp_sd(p, in.a, in.b) / fp, 0.0, hit);
  let edge = select(0.0, ink_px(fp), INK_ON);
  let cover = select(clamp(1.0 + edge - gap, 0.0, 1.0), 1.0, hit || gap < edge);
  let mask = trace_mask(cover, in.clip.xy);
  if (mask == 0u) { discard; }
  // At a miss, the normal of the copy's nearest point: away from its axis.
  let ba = in.b.xyz - in.a.xyz;
  let nm = normalize(p - (in.a.xyz + ba * clamp(dot(p - in.a.xyz, ba) / max(dot(ba, ba), 1e-20), 0.0, 1.0)));
  let n = select(nm, h.yzw, hit);
  let base = copies_paint(copies_to_local(in, p - in.fo), copies_to_local(in, n), in.k.xyz, in.k.w);
  let colour = select(trace_shade(base, n, p, d, COPIES_ID), trace_ink(base, n, p, d, COPIES_ID), INK_ON && !hit);
  // Ink in two bands. Within the copy's own radius of it (at least 0.75 px) the ink sits at the near miss, in front of
  // whatever is behind: a thin line round every copy. The rest of the style's width is written INK_BACK ink widths
  // further back, so it shows against the far background and gives way to a neighbour close behind. An outline at full
  // width in front of everything buried a dense crown of pixel-wide twigs under ink several times their width.
  let own = mix(in.a.w, in.b.w, clamp(dot(p - in.a.xyz, ba) / max(dot(ba, ba), 1e-20), 0.0, 1.0)) / fp;
  let back = select(edge * fp * INK_BACK, 0.0, hit || gap < clamp(own, 0.75, max(edge, 0.75)));
  return TraceOut(vec4<f32>(colour, trace_mark(base, n, p, d, COPIES_ID)), trace_depth(p + d * back), mask);
}`;
}

/** Listed copies of a simple solid, each intersected exactly per pixel inside its own box. */
export function drawCopies(name: string, o: CopiesOptions): Copies {
  return new Copies(name, o);
}

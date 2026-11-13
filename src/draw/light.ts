// A style's shadow block, printed after the bodies are drawn and before the water (`Style.block`, docs/lighting.md).
//
// The bodies have written the block's tone in the picture's alpha: 1 where it does not print, down to `floor` where it
// prints whole. Three kinds of draw follow, all in the transparent pass's first phase (`on-bodies`), where the opaque
// scene's depth can be read:
//
//  - cast: one box per segment of every thing's skeleton (the capsules the shadows on the water are made of,
//    `casters` in shadows.ts), covering where that capsule's shadow can fall. A fragment finds the opaque point behind
//    its pixel from the scene depth and asks whether the ray from it toward the sun passes through the capsule: a
//    closed form, antialiased by the pixel's own size, so the shadow's edge has no texels and cannot crawl.
//  - overlap: one full-screen draw. A fragment looks round its pixel for opaque surface standing a little in front of
//    the plane of its own (less than `gap`), and bands what lies behind a nearer part.
//  - pull: one full-screen draw that prints the block through the blend alone: picture * alpha + ink * (1 - alpha),
//    and alpha back to 1.
//
// The first two write only alpha, blending with min: shadows over each other are one shadow, as on one block. No draw
// reads the picture, so everything happens per sample of the multisampled target.
//
// What a capsule cannot do: a thing without a skeleton casts nothing; a wide flat form (a carapace) casts as the
// round chain of its skeleton. A ray counts only if it nears the capsule's axis after leaving the surface (`T0`): a
// point on a limb's own lit side moves away from that limb's axis and is never shadowed by it.

import { add, fetch, gt, lift, listOf, lt, select, vec4, type Expr, type MapRun, type TableSource } from "../expr.ts";
import { emitShaderFn } from "../compile/bind.ts";
import { drawSpec, type CompileContext, type Drawable, type DrawSpec, type Emitted, type Shader } from "../compile/context.ts";
import type { BlockCast, BlockOverlap, ShadowBlock } from "../style.ts";
import { sunDir } from "../sun.ts";
import { lit, vec3Lit } from "../compile/scene_wgsl.ts";
import { casters } from "./shadows.ts";

const NAME = "shadow_block";
/** vec4s per capsule. */
const LANES = 3;

/** A full-screen triangle in front of everything (the depth test passes everywhere; nothing here writes depth). */
const FULL_VS = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  return vec4<f32>(vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0, 0.0, 1.0);
}`;

type Part = { readonly shaders: Readonly<Record<string, Shader>>; readonly draws: readonly DrawSpec[] };
const NOTHING: Part = { shaders: {}, draws: [] };

/**
 * The capsules as a table: one entry per segment, chain after chain: (end a, radius a), (end b, radius b), and whether
 * the segments two before, one before, one after and two after it are of its own chain.
 */
function capsules(ctx: CompileContext): { readonly table: TableSource; readonly count: number } {
  const { chains, at } = casters(ctx.things);
  const runs: MapRun[] = [];
  let base = 0, count = 0;
  for (const c of chains) {
    const first = base;
    base += c.length;
    count += c.length - 1;
    const segments = c.length - 1;
    const has = (yes: Expr<"bool">): Expr<"f32"> => select(yes, 1, 0);
    runs.push({
      count: segments,
      lanes: (k) => [
        fetch(at, add(k, first), 0), fetch(at, add(k, first + 1), 0),
        vec4(has(gt(k, 1.5)), has(gt(k, 0.5)), has(lt(k, segments - 1.5)), has(lt(k, segments - 2.5))),
      ],
    });
  }
  const none = lift<"vec4">([0, 0, 0, 0]);
  return { table: { name: `${NAME}_capsules`, lanes: LANES, entries: Math.max(count, 1), role: "data", program: runs.length > 0 ? { kind: "map", runs } : listOf([[none, none, none]]) }, count };
}

function cast(c: BlockCast, b: ShadowBlock, ctx: CompileContext): Part {
  switch (c.kind) {
    case "none": return NOTHING;
    case "capsules": return castCapsules(c, b, ctx);
  }
}

function castCapsules(c: Extract<BlockCast, { kind: "capsules" }>, b: ShadowBlock, ctx: CompileContext): Part {
  const { table, count } = capsules(ctx);
  if (count === 0) return NOTHING;
  const t = ctx.table(table).wgsl;
  const sun = emitShaderFn(ctx.slots, { name: "block_sun", args: [], out: "vec3<f32>", roots: [lift<"vec3">(sunDir(ctx.sunAt))], ret: (o) => o[0]! });
  const code = /* wgsl */ `
${sun.code}
const REACH: f32 = ${lit(c.reach)};
const FLOOR: f32 = ${lit(b.floor)};
const THIN: f32 = ${lit(Math.max(c.thin, 1e-3))};
/// The ray must near the axis at least this far from where it starts: nearer, it is the surface the point is on.
const T0: f32 = 0.05;
/// Corners of a box (bit 2 x, bit 1 y, bit 0 z), twelve triangles, counter-clockwise from outside.
const BOX: array<u32, 36> = array<u32, 36>(0u, 2u, 6u, 0u, 6u, 4u, 1u, 5u, 7u, 1u, 7u, 3u, 0u, 1u, 3u, 0u, 3u, 2u, 4u, 6u, 7u, 4u, 7u, 5u, 0u, 4u, 5u, 0u, 5u, 1u, 2u, 3u, 7u, 2u, 7u, 6u);
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) @interpolate(flat) id: u32,
};
/// Whether p is on capsule i: within its radius and a third, the drawn limb being wider than its skeleton here and there.
fn block_on(p: vec3<f32>, i: u32) -> bool {
  let a = ${t}(${LANES}u * i);
  let b = ${t}(${LANES}u * i + 1u);
  let ab = b.xyz - a.xyz;
  let u = clamp(dot(p - a.xyz, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
  return length(p - a.xyz - ab * u) < mix(a.w, b.w, u) * 1.35 + 0.04;
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  out.id = ii;
  let a = ${t}(${LANES}u * ii);
  let b = ${t}(${LANES}u * ii + 1u);
  let r = max(a.w, b.w);
  if (r < THIN) {
    // A segment too thin to cast: a degenerate triangle outside the clip volume.
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    return out;
  }
  let sun = block_sun();
  let ab = b.xyz - a.xyz;
  // A frame with the sun as its third axis; the first lies along the segment as the sun sees it (any direction across
  // the sun for a segment that points at it).
  let flat = ab - sun * dot(ab, sun);
  let len = length(flat);
  let other = normalize(cross(sun, select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(sun.x) > 0.9)));
  let e1 = select(other, flat / max(len, 1e-9), len > 1e-5);
  let e2 = cross(sun, e1);
  let rise = dot(ab, sun);
  let pad = r + 0.06;
  let corner = BOX[vi];
  let c = vec3<f32>(f32((corner >> 2u) & 1u), f32((corner >> 1u) & 1u), f32(corner & 1u));
  // From the capsule's sunward side back to REACH behind its far side.
  let p = a.xyz + e1 * mix(-pad, len + pad, c.x) + e2 * mix(-pad, pad, c.y) + sun * mix(min(0.0, rise) - pad - REACH, max(0.0, rise) + pad, c.z);
  out.clip = frame.view_proj * vec4<f32>(p, 1.0);
  return out;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let px = in.clip.xy;
  if (scene_depth(px) >= 1.0) { discard; }
  let p = scene_position(px);
  let a = ${t}(${LANES}u * in.id);
  let b = ${t}(${LANES}u * in.id + 1u);
  let sun = block_sun();
  // The nearest approach of the ray p + s sun (s >= 0) to the segment a + u (b - a), u in [0, 1].
  let ab = b.xyz - a.xyz;
  let pa = p - a.xyz;
  let e = max(dot(ab, ab), 1e-10);
  let along = dot(ab, sun);
  let c = dot(pa, sun);
  let g = dot(ab, pa);
  let denom = e - along * along;
  var s = select(0.0, max((along * g - c * e) / max(denom, 1e-12), 0.0), denom > 1e-6 * e);
  let u = clamp((along * s + g) / e, 0.0, 1.0);
  s = max(along * u - c, 0.0);
  let gap = length(pa + sun * s - ab * u);
  let w = pixel_world(p);
  // Under the capsule by a pixel; only a ray that nears the axis after leaving, within reach (the shadow narrows to
  // nothing over the last quarter of the reach, a flat tapered end, not a fade).
  let radius = mix(a.w, b.w, u) * (1.0 - smoothstep(0.75 * REACH, REACH, s));
  let cover = (1.0 - smoothstep(-w, w, gap - radius + w)) * smoothstep(T0 + w, T0 + 3.0 * w, s);
  if (cover <= 0.0) { discard; }
  // A limb does not shadow itself here: a point on this capsule or on its two neighbours either way along the chain is
  // the caster's own skin, and a chain of capsules round a curved limb would print each one's shadow on the next as a
  // ladder. (What a limb's far side owes its near side is the core shadow.) The same test leaves a thing lying on
  // another (a moustache on a head) a shadow that starts a third of its radius out, under its key line.
  let own = ${t}(${LANES}u * in.id + 2u);
  if (block_on(p, in.id) || (own.x > 0.5 && block_on(p, in.id - 2u)) || (own.y > 0.5 && block_on(p, in.id - 1u)) || (own.z > 0.5 && block_on(p, in.id + 1u)) || (own.w > 0.5 && block_on(p, in.id + 2u))) { discard; }
  // Under the water the sea is drawn over it, with the water's own shadows.
  if (p.y < sea_height(p.xz) - 0.02) { discard; }
  return vec4<f32>(0.0, 0.0, 0.0, mix(1.0, FLOOR, cover));
}`;
  return {
    shaders: { [`${NAME}_cast`]: { code, libs: sun.libs } },
    draws: [drawSpec({ label: "block cast", shader: `${NAME}_cast`, vertices: 36, instances: count, phase: "on-bodies", cull: "back", depthWrite: false, blend: "alpha-min", sceneDepth: true })],
  };
}

function overlap(o: BlockOverlap, b: ShadowBlock): Part {
  switch (o.kind) {
    case "none": return NOTHING;
    case "band": return overlapBand(o, b);
  }
}

function overlapBand(o: Extract<BlockOverlap, { kind: "band" }>, b: ShadowBlock): Part {
  const code = /* wgsl */ `
${FULL_VS}
const WIDTH: f32 = ${lit(o.width)};
const GAP: f32 = ${lit(o.gap)};
const DEPTH: f32 = ${lit(1 - (1 - b.floor) * o.amount)};
/// How far in front of the plane a surface must stand to be another part and not this one's own curve.
const SLACK: f32 = 0.07;
fn block_depth(px: vec2<f32>) -> f32 { return dot(scene_position(px) - frame.eye.xyz, frame.forward.xyz); }
/// 1 where the surface at q stands in front of depth z by more than the slack and less than the gap (fading out toward it).
fn block_front(q: vec2<f32>, z: f32) -> f32 {
  let ahead = z - block_depth(q);
  return step(SLACK, ahead) * (1.0 - smoothstep(0.6 * GAP, GAP, ahead));
}
@fragment fn fs(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
  let px = at.xy;
  if (scene_depth(px) >= 1.0) { discard; }
  let p = scene_position(px);
  let ring = WIDTH / pixel_world(p);
  if (ring < 1.0) { discard; }
  let z = dot(p - frame.eye.xyz, frame.forward.xyz);
  // This surface's own slope in depth, per pixel, from the flatter neighbour of each pair (the other may lie across an outline).
  let xa = block_depth(px + vec2<f32>(1.0, 0.0)) - z;
  let xb = z - block_depth(px - vec2<f32>(1.0, 0.0));
  let ya = block_depth(px + vec2<f32>(0.0, 1.0)) - z;
  let yb = z - block_depth(px - vec2<f32>(0.0, 1.0));
  let slope = vec2<f32>(select(xb, xa, abs(xa) < abs(xb)), select(yb, ya, abs(ya) < abs(yb)));
  var near = 0.0;
  for (var k = 0u; k < 12u; k++) {
    let turn = (f32(k) + 0.5) * 0.5235988;
    let d = vec2<f32>(cos(turn), sin(turn));
    // Half a pixel inside and outside the ring: the band's outer edge is a pixel soft, not a stair.
    let far = 0.5 * (block_front(px + d * (ring - 0.5), z + dot(slope, d) * (ring - 0.5)) + block_front(px + d * (ring + 0.5), z + dot(slope, d) * (ring + 0.5)));
    // And half way in, for a part narrower than the ring.
    near = max(near, max(far, block_front(px + d * ring * 0.5, z + dot(slope, d) * ring * 0.5)));
  }
  if (near <= 0.0) { discard; }
  if (p.y < sea_height(p.xz) - 0.02) { discard; }
  return vec4<f32>(0.0, 0.0, 0.0, mix(1.0, DEPTH, near));
}`;
  return {
    shaders: { [`${NAME}_overlap`]: { code, libs: [] } },
    draws: [drawSpec({ label: "block overlap", shader: `${NAME}_overlap`, vertices: 3, phase: "on-bodies", cull: "none", depthWrite: false, blend: "alpha-min", sceneDepth: true })],
  };
}

function pull(b: ShadowBlock): Part {
  const code = /* wgsl */ `
${FULL_VS}
@fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(${vec3Lit(b.ink)}, 1.0); }`;
  return {
    shaders: { [`${NAME}_pull`]: { code, libs: [] } },
    draws: [drawSpec({ label: "block pull", shader: `${NAME}_pull`, vertices: 3, phase: "on-bodies", cull: "none", depthWrite: false, blend: "alpha-pull" })],
  };
}

export const light: Drawable = {
  name: NAME,
  skeletons: [],
  surfaces: [],
  draws(ctx: CompileContext): Emitted {
    const b = ctx.style.block;
    if (b === undefined) throw new Error(`${NAME}: the scene's style prints no shadow block (it is added by scene() for a style that has one)`);
    if (ctx.outline !== "hull") throw new Error(`${NAME}: a shadow block needs hull outlines (screen outlines carry their own code in the picture's alpha)`);
    const parts = [cast(b.cast, b, ctx), overlap(b.overlap, b), pull(b)];
    return { shaders: Object.assign({}, ...parts.map((p) => p.shaders)), draws: parts.flatMap((p) => p.draws) };
  },
};

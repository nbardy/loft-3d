// Cast shadows on the ground (src/draw/ground.ts), from every thing's skeletons: on a sea a layer blended over the
// water, on a plane the plane's own colour at the shadow's coverage, on nothing none.
//
// Two pose-stage maps (docs/gpu_native.md). The first evaluates each skeleton's joints (expressions over the bodies' own
// tables, the same ones the vertex stage reads) and the sea's height under them, and lifts each joint along the sun onto
// the water. The second makes one capsule per segment: valid where the segment is above the water, softer and fainter
// the higher it is (strand_kit::cast_shadow), linked to its valid neighbours in the same chain. Each capsule is drawn as
// its own small instanced patch of the sea surface laid over the water, so a shadow costs the area it covers, not the
// area of the sea. (The sea's fragment stage used to loop over every capsule for every sea pixel: most of a frame at
// 1280x800.) A segment below the water keeps its slot, marked invalid, and draws nothing: the CPU fill used to pack the
// valid ones to the front, which a map cannot do and the draw never needed (it issued every slot either way).
//
// Overlap: shadows combine by max, not by stacking. A patch draws only the pixels where its own capsule is at least
// as dark as its neighbours' in the same chain (ties go to the later one), so the joints of a chain are drawn once.

import {
  add, and, clamp, div, exp, fetch, gt, lift, listOf, lt, mapOf, max, min, mul, saturate, select, sub, vec2, vec4, type Expr, type In, type MapRun, type TableSource,
} from "../expr.ts";
import { drawSpec, type CompileContext, type Drawable, type Emitted } from "../compile/context.ts";
import type { F, Skeleton } from "../map/types.ts";
import { sunParts } from "../sun.ts";
import { levelOf } from "./ground.ts";

/** vec4s per capsule: (end a xz, end b xz), (radius a, radius b, strength, softness), (has previous, has next, valid, 0). */
const ENTRY = 3;
/** Quads per side of a capsule's patch: enough to follow the swell under a capsule a few units long. */
const PATCH = 4;

/** The table's name (its accessor is `t_shadows`). */
export const SHADOWS_TABLE = "shadows";

export const shadows: Drawable = {
  name: "shadows",
  skeletons: [],
  surfaces: [],
  draws(ctx: CompileContext): Emitted {
    switch (ctx.ground.kind) {
      case "sea": return patches(ctx, "sea_shadow(in.world, -view_dir(in.world), distance(in.world, frame.eye.xyz), s)", "alpha");
      // Opaque: where the coverage falls to 0 the colour is the plane's own, so the shadow's edge meets it exactly.
      case "plane": return patches(ctx, "vec4<f32>(ground_colour(in.world, -view_dir(in.world), distance(in.world, frame.eye.xyz), s), 1.0)", "none");
      case "nothing": return { shaders: {}, draws: [] };
    }
  },
};

/** One patch per capsule laid on the ground, coloured by `colour` (WGSL over `in.world` and the coverage `s`). */
function patches(ctx: CompileContext, colour: string, blend: "alpha" | "none"): Emitted {
    // A chain of fewer than two joints has no segment (and a surface with nothing to cast has none at all).
    const { chains, at } = casters(ctx.things);
    const capacity = chains.reduce((n, c) => n + c.length - 1, 0);
    const source = shadowTable(chains, levelOf(ctx.ground), sunParts(ctx.sunAt), at);
    const t = ctx.table(source).wgsl;
    const code = /* wgsl */ `
const PATCH: u32 = ${PATCH}u;
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) @interpolate(flat) id: u32,
};
/// Shadow of capsule i at p: 0..1.
fn capsule_shadow(i: u32, p: vec2<f32>, px: f32) -> f32 {
  let a = ${t}(${ENTRY}u * i);
  let b = ${t}(1u + ${ENTRY}u * i);
  let pa = p - a.xy;
  let ba = a.zw - a.xy;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  let r = mix(b.x, b.y, h);
  let soft = max(b.w, px);
  return b.z * (1.0 - smoothstep(r - soft, r + soft, length(pa - ba * h)));
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  out.id = ii;
  if (${t}(2u + ${ENTRY}u * ii).z < 0.5) {
    // A segment under the water: a degenerate triangle outside the clip volume.
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.world = vec3<f32>(0.0);
    return out;
  }
  let a = ${t}(${ENTRY}u * ii);
  let b = ${t}(1u + ${ENTRY}u * ii);
  let ij = vec2<u32>((vi / 6u) / PATCH, (vi / 6u) % PATCH) + quad_corner(vi % 6u);
  let uv = vec2<f32>(ij) / f32(PATCH);
  let ab = a.zw - a.xy;
  let len = length(ab);
  let along = select(vec2<f32>(1.0, 0.0), ab / len, len > 1e-6);
  let across = vec2<f32>(-along.y, along.x);
  // Out to where the softened edge has faded, plus a margin for the pixel-wide antialiasing far away.
  let pad = max(b.x, b.y) + 2.0 * b.w + 0.1;
  let xz = a.xy + along * mix(-pad, len + pad, uv.x) + across * mix(-pad, pad, uv.y);
  out.world = vec3<f32>(xz.x, sea_height(xz), xz.y);
  out.clip = frame.view_proj * vec4<f32>(out.world, 1.0);
  return out;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let i = in.id;
  let p = in.world.xz;
  let px = sea_footprint(in.world);
  let s = capsule_shadow(i, p, px);
  let c = ${t}(2u + ${ENTRY}u * i);
  if (s <= 0.0 || (c.x > 0.5 && capsule_shadow(i - 1u, p, px) > s) || (c.y > 0.5 && capsule_shadow(i + 1u, p, px) >= s)) { discard; }
  return ${colour};
}`;
    return {
      shaders: { shadows: { code, libs: [] } },
      draws: [drawSpec({ label: "shadows", shader: "shadows", vertices: 6 * PATCH * PATCH, instances: Math.max(capacity, 1), phase: "on-water", cull: "none", depthWrite: false, blend })],
    };
}

/** smoothstep(0, 1, x), written out (as the CPU fill had it). */
const smooth = (x: F): F => { const t = saturate(x); return mul(mul(t, t), sub(3, mul(t, 2))); };

/** A chain of joints that casts: each a point and a radius. */
export type Chain = readonly { readonly p: Expr<"vec3">; readonly r: F }[];

/** Every joint of some chains as a list, chain after chain: one entry (point, radius) each. */
export function jointList(chains: readonly Chain[]): TableSource {
  const listed = chains.flat().map((j) => [vec4(j.p, j.r)]);
  return { name: `${SHADOWS_TABLE}_at`, lanes: 1, entries: Math.max(listed.length, 1), role: "data", program: listOf(listed.length > 0 ? listed : [[lift<"vec4">([0, 0, 0, 0])]]) };
}

const cast = new WeakMap<readonly Drawable[], { readonly chains: readonly Chain[]; readonly at: TableSource }>();
/**
 * What a scene's things cast shadows with: every skeleton of two joints or more as a chain, and the list of their
 * joints. One per scene (keyed by its list of things), so the water's shadows and a style's shadows on the bodies
 * (src/draw/light.ts) read one table.
 */
export function casters(things: readonly Drawable[]): { readonly chains: readonly Chain[]; readonly at: TableSource } {
  const seen = cast.get(things);
  if (seen !== undefined) return seen;
  // A chain of fewer than two joints has no segment (and a surface with nothing to cast has none at all).
  const chains = things.flatMap((t) => t.skeletons).filter((s: Skeleton) => s.joints >= 2).map((c) => Array.from({ length: c.joints }, (_, k) => c.joint(k)));
  const made = { chains, at: jointList(chains) };
  cast.set(things, made);
  return made;
}

/**
 * The shadow capsules of some chains of joints: a list of every joint's foot (lifted along the sun onto the sea: xz,
 * height above the water, radius), then a map of one capsule per segment (ENTRY lanes), chain after chain. `sun` is
 * the unit direction toward the sun by component (numbers, or expressions when a host moves it).
 */
export function shadowTable(chains: readonly Chain[], seaHeight: (xz: Expr<"vec2">) => F, sun: readonly [In<"f32">, In<"f32">, In<"f32">], at: TableSource = jointList(chains)): TableSource {
  // The joints are a list (each its own expression); the sea under them is one closed form, a map of its own, so no
  // GPU branch per joint evaluates the sea.
  const n = at.entries;
  const joints: TableSource = {
    name: `${SHADOWS_TABLE}_joints`, lanes: 1, entries: n, role: "data",
    program: mapOf(n, (i) => {
      const j = fetch(at, i, 0);
      const h = sub(j.y, seaHeight(vec2(j.x, j.z)));
      const rise = div(max(h, 0), sun[1]);
      return [vec4(sub(j.x, mul(rise, sun[0])), sub(j.z, mul(rise, sun[2])), h, j.w)];
    }),
  };
  const runs: MapRun[] = [];
  let base = 0, capacity = 0;
  for (const c of chains) {
    const first = base, count = c.length - 1;
    base += c.length;
    if (count < 1) continue;
    capacity += count;
    runs.push({
      count,
      lanes: (k) => {
        // Joint i of this chain (0 .. count), and whether segment i (0 .. count - 1) casts a shadow.
        const J = (i: F): Expr<"vec4"> => fetch(joints, add(i, first), 0);
        const valid = (i: F): Expr<"bool"> => { const a = J(i), b = J(add(i, 1)); return and(gt(min(a.z, b.z), 0.02), gt(max(a.w, b.w), 1e-3)); };
        const a = J(k), b = J(add(k, 1));
        const h = min(a.z, b.z);
        const strength = mul(mul(smooth(div(sub(h, 0.02), 0.35)), exp(div(h, -9))), 0.85);
        const here = valid(k);
        const prev = and(here, and(gt(k, 0.5), valid(clamp(sub(k, 1), 0, count - 1))));
        const next = and(here, and(lt(k, count - 1.5), valid(clamp(add(k, 1), 0, count - 1))));
        const on = (x: Expr<"vec4">): Expr<"vec4"> => select(here, x, lift<"vec4">([0, 0, 0, 0]));
        return [
          on(vec4(a.xy, b.xy)),
          on(vec4(a.w, b.w, strength, add(mul(h, 0.04), 0.03))),
          vec4(select(prev, 1, 0), select(next, 1, 0), select(here, 1, 0), 0),
        ];
      },
    });
  }
  const none = lift<"vec4">([0, 0, 0, 0]);
  return { name: SHADOWS_TABLE, lanes: ENTRY, entries: Math.max(capacity, 1), role: "data", program: runs.length > 0 ? { kind: "map", runs } : listOf([[none, none, none]]) };
}

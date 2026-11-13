// Pieces every style and part shares: an antialiased edge, colour helpers, the distance in from a silhouette, and WGSL
// for post passes.
//
// A post pass is raw WGSL (it reads the picture so far, which no expression can), prepended by the host with
// PRELUDE_WGSL, POST_WGSL and `sceneWgsl` (DESIGN.md 3). Everything defined here is prefixed `sty_` so it cannot
// collide with a library function that `sceneWgsl` happens to carry.

import { add, div, dot, max, min, mul, smoothstep, sub, vec3, type Expr } from "../expr.ts";
import { fwidth } from "../lib/wgsl.ts";
import type { Rgb, ShadeCtx } from "../style.ts";

/** A colour triple as a vec3 expression, for use inside a style's shading. */
export const rgb = (c: Rgb): Expr<"vec3"> => vec3(c[0], c[1], c[2]);
/** A colour triple as WGSL source text (`vec3<f32>(r, g, b)`), for style code written as raw WGSL. */
export const wgslRgb = (c: Rgb): string => `vec3<f32>(${c.map((x) => x.toFixed(4)).join(", ")})`;

/**
 * 0 below `edge`, 1 above, antialiased over about a pixel of x's change (never narrower than `soft`, never wider
 * than `widest`, in units of x). Fragment stage only (it takes a derivative), so only in uniform control flow.
 */
export function edgeOf(x: Expr<"f32">, edge: number | Expr<"f32">, soft: number, widest = 0.05): Expr<"f32"> {
  // Capped: where x jumps between neighbouring pixels (the contact band does where the search ring starts to find a
  // body) an uncapped width spread that jump into half-covered pixels, a dotted ghost of the silhouette on the water.
  const w = min(max(mul(fwidth(x), 0.75), soft), widest);
  return smoothstep(sub(edge, w), add(edge, w), x);
}

/**
 * How many pixels in from the silhouette a body fragment is, to first order: how far the surface faces the eye
 * (N.V) over how fast that changes across the screen. 0 on the silhouette, growing inward; a band `w` pixels wide along
 * every outline is where this is under `w` (the rim, a line drawn heavier inside the hull, a neon tube's glow).
 *
 * Cannot: see a crease or a fold inside the outline (N.V does not reach 0 there), or measure in the world. It is a
 * fragment's own derivative, so constant across a triangle's quad and rough by a pixel where the mesh is coarse.
 * Going past it: for creases, a post pass on depth and reconstructed normals (`sty_normal` in `POST_COMMON`); for a
 * width in world units divide a world width by `pixelWorld(ctx.world)`, as `weighted` and the rim do.
 */
export function pixelsInside(ctx: ShadeCtx): Expr<"f32"> {
  const facing = dot(ctx.normal, ctx.view);
  return div(facing, max(fwidth(facing), 1e-5));
}

/**
 * WGSL helpers for post passes: a hash of a pixel index, value noise fixed to the screen, the view depth of the opaque
 * scene, and whether a pixel shows the sea in front of whatever opaque thing is behind it.
 */
export const POST_COMMON = /* wgsl */ `
/// A hash of an integer lattice point, uniform in [0, 1] (DESIGN.md: no randomness except hashes of indices).
fn sty_hash(p: vec2<i32>) -> f32 {
  var h = bitcast<u32>(p.x) * 1664525u + bitcast<u32>(p.y) * 1013904223u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return f32(h ^ (h >> 16u)) / 4294967295.0;
}
/// Value noise on the lattice of p, smooth (cubic), in [0, 1].
fn sty_noise(p: vec2<f32>) -> f32 {
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = sty_hash(i);
  let b = sty_hash(i + vec2<i32>(1, 0));
  let c = sty_hash(i + vec2<i32>(0, 1));
  let d = sty_hash(i + vec2<i32>(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/// Distance along the view direction to the opaque surface at px (both camera kinds); large where there is none.
fn sty_view_depth(px: vec2<f32>) -> f32 { return dot(scene_position(px) - frame.eye.xyz, frame.forward.xyz); }
/// Normal of the opaque surface at px, from neighbours s pixels away: of each pair, the one nearer in 3D, so a
/// neighbour across a silhouette does not bend it. Faces the eye.
fn sty_normal(px: vec2<f32>, s: f32) -> vec3<f32> {
  let p = scene_position(px);
  let xa = scene_position(px + vec2<f32>(s, 0.0)) - p;
  let xb = p - scene_position(px - vec2<f32>(s, 0.0));
  let ya = scene_position(px + vec2<f32>(0.0, s)) - p;
  let yb = p - scene_position(px - vec2<f32>(0.0, s));
  let dx = select(xb, xa, dot(xa, xa) < dot(xb, xb));
  let dy = select(yb, ya, dot(ya, ya) < dot(yb, yb));
  // A zero cross product (no surface change across the offsets) has no direction: report the eye's, not a NaN.
  let c = cross(dy, dx);
  let n = select(-frame.forward.xyz, normalize(c), dot(c, c) > 1e-20);
  let toward = select(-frame.forward.xyz, frame.eye.xyz - p, frame.eye.w > 0.5);
  return select(-n, n, dot(n, toward) > 0.0);
}
/// True where an opaque surface is drawn at px (the cleared depth is 1).
fn sty_solid(px: vec2<f32>) -> bool { return scene_depth(px) < 1.0; }
/// The view ray through pixel px: origin and unit direction (both camera kinds).
fn sty_ray(px: vec2<f32>) -> array<vec3<f32>, 2> {
  let ndc = vec2<f32>(px.x * frame.viewport.z * 2.0 - 1.0, 1.0 - px.y * frame.viewport.w * 2.0);
  let n = frame.inv_view_proj * vec4<f32>(ndc, 0.0, 1.0);
  let f = frame.inv_view_proj * vec4<f32>(ndc, 1.0, 1.0);
  let a = n.xyz / n.w;
  return array<vec3<f32>, 2>(a, normalize(f.xyz / f.w - a));
}
/// 1 where the pixel shows the sea (the ray meets the mean sea level before any opaque surface), else 0. The mean
/// level, not the swell: a post pass is per pixel, and the swell's height is small beside what this separates.
fn sty_water(px: vec2<f32>) -> f32 {
  let r = sty_ray(px);
  if (r[1].y > -1e-4) { return 0.0; }
  let t = -r[0].y / r[1].y;
  let hit = dot(r[0] + r[1] * t - frame.eye.xyz, frame.forward.xyz);
  return select(1.0, 0.0, sty_solid(px) && sty_view_depth(px) < hit);
}
/// True where the opaque surface at px is below the sea surface (hidden or tinted by the water drawn over it).
fn sty_submerged(px: vec2<f32>) -> bool {
  let p = scene_position(px);
  return sty_solid(px) && p.y < sea_height(p.xz) - 0.02;
}
`;

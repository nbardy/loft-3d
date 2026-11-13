// draw.density: a medium integrated per pixel in closed form (no marching, no sorting of primitives).
//
// The bound is drawn as its back faces (so it covers the screen whether the camera is outside or inside it) at depth
// 0, with no depth write: every pixel the box covers runs the fragment stage. There the view ray is clipped to the box,
// to the opaque scene behind it (scene depth: a body inside a cloud ends the integral at its skin, so it is veiled
// by exactly the cloud in front of it and the cloud has a soft edge where it meets it) and to the sea.
//
// Per pixel, in two passes over the blobs (each pass tests a cluster's bounding sphere before its blobs):
//   1. closest approaches only (no erfc): the depth range [lo, hi] along the ray where blobs matter, and a coarse
//      estimate of where they become opaque (blobs wholly behind that are skipped by pass 2);
//   2. each blob's optical depth on the segment (closed form), the depth at which the eye sees it (the median of the
//      first-scattering depth), its light there, deposited into BINS depth bins spanning [lo, hi] (split linearly
//      between the two nearest bins, so a blob moving in depth changes the picture continuously).
// Layers and banks are cut into 8 pieces along the ray, each deposited where it is seen: outside the blobs' range into
// FOG fixed bins over the whole ray (merged by depth with the others), among the blobs into the depth bins. The bins are then composited front to back:
// ordering at the resolution of a bin, from a fixed partition, so nothing is sorted and nothing is dropped. (A first
// version kept the 16 strongest pieces per pixel and merged the rest; which pieces were kept changed from one pixel to
// the next, and drew hard-edged discs into the cloud.) Alpha is exact: 1 - exp(-total depth).
//
// Lighting of a piece where the eye sees it (all closed forms): the other blobs' depth toward the sun and the zenith
// (the CPU light pass, interpolated through the blob), plus a third of the blob's own depth from that point (its own
// shadow at full strength drew every lump as a separate sphere). Sun light goes through octaves of extinction (single
// scattering, plus softer lobes standing in for multiple scattering, so shadowed interiors are dark, not black) and a
// forward-scattering phase (silver edges toward the sun); sky light is the style's sky at the zenith. Flash light is
// per blob (CPU, through the medium) plus a small even share.

import { exp, mul, variable } from "../expr.ts";
import { emitShaderFn } from "../compile/bind.ts";
import { drawSpec, type CompileContext, type Drawable, type Emitted, type Shader, type V3 } from "../compile/context.ts";
import { fbm3 } from "../lib/noise.ts";
import type { Skeleton } from "../map/types.ts";
import { accessMedium, BANK_LIB, clusterLoop, EXTENT, GAUSS_LIB, type Box, type Medium, type MediumAccess } from "./medium.ts";

export type Rgb = readonly [number, number, number];

export type DensityOptions = {
  /** Where the medium is integrated: the box drawn, and the clip of every ray. Keep it 3 radii beyond the puffs. */
  readonly bounds: Box;
  /** Sun light colour and strength (multiplies the albedo). */
  readonly sun: Rgb;
  /** Strength of the sky light (the style's sky colour at the zenith). */
  readonly sky: number;
  /** Forward scattering, 0 (even) to 0.9 (a bright rim toward the sun). */
  readonly forward: number;
  /**
   * How strongly the other puffs shadow a puff, 0 to 1 (1 is the plain optical depth). Below 1 stands in for the light
   * that reaches a cloud's surface layers sideways (a stylised cloud reads best with its sunlit side near white).
   */
  readonly shadowing: number;
  /**
   * Detail: each piece's optical depth is multiplied by exp(amount * noise) at the point the eye sees, in the puff's own
   * frame (so the detail rides with it), with cells `scale` world units across. It breaks up the Gaussian edges into
   * wisps and lumps at the cost of one noise lookup per piece. `{ kind: "none" }` for smooth puffs.
   */
  readonly detail: { readonly kind: "none" } | { readonly kind: "noise"; readonly amount: number; readonly scale: number };
  /** Fade toward the style's sky with distance: 1 - exp(-distance * haze). 0 for none. */
  readonly haze: number;
};

/** Depth bins between the nearest and farthest blob along a ray. */
const BINS = 24;
/** Depth bins over the whole ray, for what lies outside the blobs' range (fog in front of and behind a cloud). */
const FOG = 8;
/** Pieces a layer or one side of a bank is cut into along a ray. */
const PIECES = 8;

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));
const v3 = (v: readonly number[]): string => `vec3<f32>(${v.map(f).join(", ")})`;

/**
 * The `Drawable` that `draw.density` returns: a medium (puffs, fog banks) integrated along each view ray and lit by
 * the sun and sky. A scene author gets it from `draw.density`, not by constructing it.
 */
export class DensityDrawable implements Drawable {
  readonly skeletons: readonly Skeleton[] = [];
  readonly surfaces = [];

  constructor(readonly name: string, readonly medium: Medium, readonly o: DensityOptions) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`draw.density "${name}": names must be identifiers (they name shaders)`);
    for (let a = 0; a < 3; a++) if (!(o.bounds.max[a] > o.bounds.min[a])) throw new Error(`draw.density "${name}": bounds are empty on axis ${a}`);
    if (!(o.shadowing >= 0 && o.shadowing <= 1)) throw new Error(`draw.density "${name}": shadowing must be in [0, 1]`);
    if (!(o.forward >= 0 && o.forward < 1)) throw new Error(`draw.density "${name}": forward must be in [0, 1)`);
  }

  draws(ctx: CompileContext): Emitted {
    const acc = accessMedium(this.medium, ctx.sun, (t) => ctx.table(t));
    const key = `density.${this.name}`;
    const detail = detailFn(ctx, this.o.detail);
    const code = [detail.code, densityWgsl(this.medium, acc, this.o, ctx.sun)].join("\n");
    return {
      shaders: { [key]: { code, libs: [...detail.libs, ...(acc.banks.kind === "some" ? [GAUSS_LIB, BANK_LIB] : [GAUSS_LIB])] } },
      draws: [drawSpec({ label: this.name, shader: key, vertices: 36, phase: "transparent", cull: "front", depthWrite: false, blend: "alpha", sceneDepth: true })],
    };
  }
}

const DP = variable("p", "vec3");
/** `fn soft_detail(p: vec3<f32>) -> f32`: the factor a piece's optical depth is multiplied by. */
function detailFn(ctx: CompileContext, d: DensityOptions["detail"]): Shader {
  switch (d.kind) {
    case "none": return { code: "fn soft_detail(p: vec3<f32>) -> f32 { return 1.0; }", libs: [] };
    case "noise": {
      const n = fbm3(mul(DP, 1 / d.scale), { octaves: 1, lacunarity: 2.03, gain: 0.5 });
      // exp(amount * noise), not 1 + amount * noise clamped at 0: on a Gaussian's edge a factor e^x moves the edge by
      // about x / (2 q) radii, so the noise reshapes the silhouette into lumps; the clamped form punched holes through
      // front puffs at large amounts (dark specks of the puffs behind showing through white tops).
      return emitShaderFn(ctx.slots, { name: "soft_detail", args: [["p", "vec3"]], out: "f32", roots: [exp(mul(n, d.amount))], ret: (v) => v[0] });
    }
  }
}

/** The box's six faces: outward normal n and in-face axes u, v with u x v = n (so each face winds counter-clockwise seen from outside). */
const FACES = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
] as const;

/** Box vertex stage shared by the soft volumes: back faces at depth 0, the world point as a varying. */
export function boxVertexWgsl(b: Box): string {
  const c = [0, 1, 2].map((a) => (b.min[a] + b.max[a]) / 2), h = [0, 1, 2].map((a) => (b.max[a] - b.min[a]) / 2);
  return /* wgsl */ `
const BOX_C: vec3<f32> = ${v3(c)};
const BOX_H: vec3<f32> = ${v3(h)};
const BOX_MIN: vec3<f32> = ${v3(b.min)};
const BOX_MAX: vec3<f32> = ${v3(b.max)};
const BOX_N = array<vec3<f32>, 6>(${FACES.map((x) => v3(x[0])).join(", ")});
const BOX_U = array<vec3<f32>, 6>(${FACES.map((x) => v3(x[1])).join(", ")});
const BOX_V = array<vec3<f32>, 6>(${FACES.map((x) => v3(x[2])).join(", ")});
const BOX_S = array<vec2<f32>, 6>(vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0));
struct VOut { @builtin(position) clip: vec4<f32>, @location(0) world: vec3<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let k = vi / 6u;
  let s = BOX_S[vi % 6u];
  let p = BOX_C + BOX_H * (BOX_N[k] + BOX_U[k] * s.x + BOX_V[k] * s.y);
  var out: VOut;
  let clip = frame.view_proj * vec4<f32>(p, 1.0);
  // Depth 0: the volume is integrated per pixel up to the opaque scene, so the box itself must never be depth-rejected
  // (its back faces lie behind the bodies inside it). Clipping still happens at w = 0, in front of the eye.
  out.clip = vec4<f32>(clip.xy, 0.0, clip.w);
  out.world = p;
  return out;
}
/// The ray through this pixel: origin on the eye (or the eye plane, orthographic) and unit direction.
fn soft_ray(world: vec3<f32>) -> array<vec3<f32>, 2> {
  let d = view_dir(world);
  return array<vec3<f32>, 2>(world - d * dot(world - frame.eye.xyz, d), d);
}
/// (near, far) of the ray inside the box.
fn soft_box(o: vec3<f32>, d: vec3<f32>) -> vec2<f32> {
  let dd = select(d, vec3<f32>(1e-12), abs(d) < vec3<f32>(1e-12));
  let ta = (BOX_MIN - o) / dd;
  let tb = (BOX_MAX - o) / dd;
  let lo = min(ta, tb);
  let hi = max(ta, tb);
  return vec2<f32>(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}
/// Distance along the ray to the sea surface (three fixed-point steps on the swell), or far when it looks up.
fn soft_sea(o: vec3<f32>, d: vec3<f32>) -> f32 {
  if (d.y > -1e-4) { return 1e30; }
  var t = -o.y / d.y;
  for (var k = 0u; k < 3u; k++) { let p = o + d * max(t, 0.0); t = (sea_height(p.xz) - o.y) / d.y; }
  return max(t, 0.0);
}
/// Where the ray ends: the opaque scene at this pixel, or the sea.
fn soft_end(px: vec2<f32>, o: vec3<f32>, d: vec3<f32>) -> f32 {
  return min(dot(scene_position(px) - o, d), soft_sea(o, d));
}`;
}

/**
 * A layer's own depth toward the sun. Its density varies with height only, so the tail along any upward direction u is
 * the vertical tail divided by u.y: one erfc per piece instead of two (24 pieces per pixel over a hazy screen). The
 * general form stays for a sun at or below the horizon.
 */
function layerSunTail(sun: V3): string {
  return sun[1] > 0.05 ? `let selfSun = selfUp * ${f(1 / sun[1])};` : "let selfSun = a0.w * loft_gauss_tail(Op, k * SUN_DIR);";
}

function densityWgsl(m: Medium, acc: MediumAccess, o: DensityOptions, sun: V3): string {
  const g = o.forward;
  const NB = m.blobs.length;
  const layers = acc.layers.kind === "none" ? "" : /* wgsl */ `
  for (var i = 0u; i < ${acc.layers.count}u; i++) {
    let a0 = ${acc.layers.wgsl}(i * 2u);
    let a1 = ${acc.layers.wgsl}(i * 2u + 1u);
    let k = vec3<f32>(0.0, a1.w, 0.0);
    soft_extended(vec4<f32>(k * (o - a0.xyz), 0.0), vec4<f32>(k * d, 0.0), t0, t1, a0, k, a1.xyz, o, d);
  }`;
  const banks = acc.banks.kind === "none" ? "" : /* wgsl */ `
  for (var i = 0u; i < ${acc.banks.count}u; i++) {
    let a0 = ${acc.banks.wgsl}(i * 3u);
    let a1 = ${acc.banks.wgsl}(i * 3u + 1u);
    let e = ${acc.banks.wgsl}(i * 3u + 2u);
    let k = vec3<f32>(0.0, a1.w, 0.0);
    let O = k * (o - a0.xyz);
    let D = k * d;
    let s0 = e.x * o.x + e.y * o.z - e.z;
    let s1 = e.x * d.x + e.y * d.z;
    let cut = loft_bank_split(s0, s1);
    soft_extended(vec4<f32>(O, 0.0), vec4<f32>(D, 0.0), max(t0, cut.x), min(t1, cut.y), a0, k, a1.xyz, o, d);
    soft_extended(vec4<f32>(O, e.w * s0), vec4<f32>(D, e.w * s1), max(t0, cut.z), min(t1, cut.w), a0, k, a1.xyz, o, d);
  }`;
  const blobHead = /* wgsl */ `
      let a0 = ${acc.blobs}(i * 5u);
      let a1 = ${acc.blobs}(i * 5u + 1u);
      let O = a1.xyz * (o - a0.xyz);
      let D = a1.xyz * d;
      let al = max(dot(D, D), 1e-20);
      let tm = -dot(O, D) / al;
      let pc = O + D * clamp(tm, t0, t1);
      let qmin = dot(pc, pc);
      if (a0.w <= 0.0 || qmin > 16.0) { continue; }`;
  return /* wgsl */ `${boxVertexWgsl(o.bounds)}
const BINS: u32 = ${BINS}u;
const SUN_DIR: vec3<f32> = ${v3(sun)};
const SUN_LIGHT: vec3<f32> = ${v3(o.sun)};
const SHADOWING: f32 = ${f(o.shadowing)};
const SELF: f32 = 0.35;
// Depth bins, each (tau, tau-weighted light): BINS over the blobs' range [lo, hi], and FOG over the whole segment
// [t0, t1] for what lies outside that range. The fog bins do not move with [lo, hi], so where a blob starts to count
// and the range jumps, a piece of fog changes bin set but not its place in the order. (With one bin in front of the
// blobs and one behind, a long view through haze took the depth-averaged colour of all of it in one pixel and the
// properly ordered colour in the next, and drew the outline of the rain shaft's haze into the fog.)
const FOG: u32 = ${FOG}u;
var<private> soft_bin: array<vec4<f32>, ${BINS}>;
var<private> soft_fog: array<vec4<f32>, ${FOG}>;
var<private> soft_lo: f32;
var<private> soft_hi: f32;
var<private> soft_t0: f32;
var<private> soft_t1: f32;
var<private> soft_sky: vec3<f32>;
var<private> soft_amb: vec3<f32>;

/// Put a piece seen at depth t into the bins, split linearly between the two nearest.
fn soft_deposit(t: f32, tau: f32, light: vec3<f32>) {
  let e = vec4<f32>(tau, tau * light);
  if (t < soft_lo || t > soft_hi) {
    let x = clamp((t - soft_t0) / max(soft_t1 - soft_t0, 1e-6) * f32(FOG) - 0.5, 0.0, f32(FOG - 1u));
    let i0 = u32(floor(x));
    soft_fog[i0] += e * (1.0 - (x - f32(i0)));
    soft_fog[min(i0 + 1u, FOG - 1u)] += e * (x - f32(i0));
    return;
  }
  let x = clamp((t - soft_lo) / max(soft_hi - soft_lo, 1e-6) * f32(BINS) - 0.5, 0.0, f32(BINS - 1u));
  let i0 = u32(floor(x));
  let fr = x - f32(i0);
  soft_bin[i0] += e * (1.0 - fr);
  soft_bin[min(i0 + 1u, BINS - 1u)] += e * fr;
}
/// The light a piece sends toward the eye: sun (through the others and itself), sky, flashes.
fn soft_light(albedo: vec3<f32>, tauSun: f32, tauUp: f32, flash: vec3<f32>, cosv: f32) -> vec3<f32> {
  // Octaves of extinction (Wrenninge's multiple-scattering approximation): each octave half as strong and a third as
  // extinguished, so thick cloud stays luminous a long way in and only the deepest parts go dark.
  let sunVis = (exp(-tauSun) + 0.5 * exp(-0.3 * tauSun) + 0.25 * exp(-0.09 * tauSun)) * (1.0 / 1.75);
  let skyVis = (exp(-0.5 * tauUp) + 0.5 * exp(-0.15 * tauUp)) * (1.0 / 1.5);
  let hg = ${f(1 - g * g)} / pow(${f(1 + g * g)} - ${f(2 * g)} * cosv, 1.5);
  let phase = mix(1.0, hg, 0.5);
  return albedo * (SUN_LIGHT * sunVis * phase + soft_sky * skyVis + flash) + soft_amb;
}
/// The depth at which the eye sees a piece: the median of the first-scattering depth, where the piece's own optical
/// depth reaches -ln((1 + e^-tau) / 2) (its centre when thin, ln 2 into it when dense). Lighting a piece at its
/// centroid instead lit a dense blob's hidden middle and drew every blob as a dark disc with a bright rim.
fn soft_seen(r: vec3<f32>, tau: f32, pa: f32, pb: f32) -> f32 {
  let fs = select(0.5, -log(0.5 * (1.0 + exp(-tau))) / tau, tau > 1e-3);
  return clamp(r.y + r.z * (1.0 / 1.7) * log(fs / (1.0 - fs)), pa, pb);
}
/// The other blobs' depth toward a light at q (in the blob's units), between its values one radius behind and in
/// front, at half the slope of the line through them: the full slope gave every surface blob its own hard terminator.
fn soft_others(q: vec3<f32>, k: vec3<f32>, u: vec3<f32>, lo: f32, hi: f32) -> f32 {
  let ku = k * u;
  let f = clamp(dot(q, ku) / max(length(ku), 1e-9), -1.0, 1.0);
  return mix(lo, hi, 0.5 + 0.25 * f);
}
/// A piece of a layer or bank on [pa, pb], lit by its own depth toward the sun and the sky only.
fn soft_piece(O: vec4<f32>, D: vec4<f32>, pa: f32, pb: f32, a0: vec4<f32>, k: vec3<f32>, albedo: vec3<f32>, o: vec3<f32>, d: vec3<f32>) {
  if (pb <= pa) { return; }
  let r = loft_gauss_ray(O, D, pa, pb);
  let tau = a0.w * r.x;
  if (tau < 1e-5) { return; }
  let t = soft_seen(r, tau, pa, pb);
  let Op = k * (o + d * t - a0.xyz);
  let selfUp = a0.w * loft_gauss_tail(Op, k);
  ${layerSunTail(sun)}
  soft_deposit(t, tau, soft_light(albedo, SHADOWING * selfSun, SHADOWING * selfUp, vec3<f32>(0.0), dot(d, SUN_DIR)));
}
/// A layer or one side of a bank on [ia, ib], in pieces at fixed fractions of it (each deposited where it is seen).
/// Cutting it at the blobs' depth range instead made its light depend on that range, which jumps where a blob starts
/// to count, and drew the outline of the rain shaft's haze into the fog behind it.
fn soft_extended(O: vec4<f32>, D: vec4<f32>, ia: f32, ib: f32, a0: vec4<f32>, k: vec3<f32>, albedo: vec3<f32>, o: vec3<f32>, d: vec3<f32>) {
  if (ib <= ia) { return; }
  for (var j = 0u; j < ${PIECES}u; j++) {
    soft_piece(O, D, mix(ia, ib, f32(j) / ${PIECES}.0), mix(ia, ib, f32(j + 1u) / ${PIECES}.0), a0, k, albedo, o, d);
  }
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let ray = soft_ray(in.world);
  let o = ray[0];
  let d = ray[1];
  let box = soft_box(o, d);
  let t0 = max(box.x, 0.0);
  let t1 = min(box.y, soft_end(in.clip.xy, o, d));
  if (t1 <= t0) { discard; }
  // Pass 1 (closest approaches only, no erfc): where along the ray the blobs are, [lo, hi], and an estimate of each
  // blob's depth (its whole-line integral) in coarse bins over the segment, to find where the blobs become opaque
  // (estimated depth 8, transmission 3e-4). Pass 2 skips the blobs wholly behind that: they cannot be seen, and in a
  // dense cloud they are most of the work.
  soft_lo = 1e30;
  soft_hi = -1e30;
  for (var b = 0u; b < BINS; b++) { soft_bin[b] = vec4<f32>(0.0); }${clusterLoop(m, acc, `${blobHead}
      let s = sqrt(al);
      let est = a0.w * 1.7725 / s * exp(-qmin);
      if (est < 1e-3) { continue; }
      soft_lo = min(soft_lo, max(tm - 2.0 / s, t0));
      soft_hi = max(soft_hi, min(tm + 2.0 / s, t1));
      soft_bin[u32(clamp((tm - t0) / (t1 - t0) * f32(BINS), 0.0, f32(BINS - 1u)))].x += est;`)}
  var cut = t1;
  var acc = 0.0;
  for (var b = 0u; b < BINS; b++) {
    acc += soft_bin[b].x;
    if (acc > 8.0) { cut = mix(t0, t1, f32(b + 1u) / f32(BINS)); break; }
  }
  // No blob matters on this ray (most of a haze-covered screen): pass 2 and the depth bins are skipped, and every
  // piece of fog goes to the fog bins (an empty range [lo, hi] sends every depth there). The bins hold nothing yet:
  // pass 1 deposits only for blobs it counts.
  let blobs = soft_lo <= soft_hi;
  soft_t0 = t0;
  soft_t1 = t1;
  if (blobs) { for (var b = 0u; b < BINS; b++) { soft_bin[b] = vec4<f32>(0.0); } }
  for (var b = 0u; b < FOG; b++) { soft_fog[b] = vec4<f32>(0.0); }
  soft_sky = ${f(o.sky)} * sky(vec3<f32>(0.0, 1.0, 0.0));
  soft_amb = ${acc.blobs}(${NB}u * 5u).xyz;
  let cosv = dot(d, SUN_DIR);
  // Pass 2: every blob's depth, where it is seen, its light there.
  if (blobs) {${clusterLoop(m, acc, `${blobHead}
      let s = sqrt(al);
      // Too faint to see (its whole-line depth below 1e-3), or wholly behind where the cloud is opaque.
      if (a0.w * 1.7725 / s * exp(-qmin) < 1e-3 || tm - 2.0 / s > cut) { continue; }
      let r = loft_gauss_ray(vec4<f32>(O, 0.0), vec4<f32>(D, 0.0), max(t0, tm - ${EXTENT} / s), min(t1, tm + ${EXTENT} / s));
      let detail = soft_detail(o + d * r.y - a0.xyz + vec3<f32>(a1.w * 37.31, a1.w * 11.17, a1.w * 5.71));
      let tau = a0.w * r.x * detail;
      if (tau < 1e-4) { continue; }
      let t = soft_seen(r, tau, t0, t1);
      let k = a1.xyz;
      let Op = k * (o + d * t - a0.xyz);
      let a2 = ${acc.blobs}(i * 5u + 2u);
      let a3 = ${acc.blobs}(i * 5u + 3u);
      let a4 = ${acc.blobs}(i * 5u + 4u);
      let selfSun = a0.w * loft_gauss_tail(Op, k * SUN_DIR);
      let selfUp = a0.w * loft_gauss_tail(Op, vec3<f32>(0.0, k.y, 0.0));
      let sunOthers = soft_others(Op, k, SUN_DIR, a4.x, a4.y);
      let upOthers = soft_others(Op, k, vec3<f32>(0.0, 1.0, 0.0), a4.z, a4.w);
      soft_deposit(t, tau, soft_light(a2.xyz, SHADOWING * (sunOthers + SELF * selfSun), SHADOWING * (upOthers + SELF * selfUp), a3.xyz, cosv));`)}
  }${layers}${banks}
  // Front to back: the two sets of bins merged by depth (each is in order already).
  var trans = 1.0;
  var colour = vec3<f32>(0.0);
  var seen = 0.0;
  var ib = select(BINS, 0u, blobs);
  var jf = 0u;
  for (var n = ib; n < BINS + FOG; n++) {
    let tb = mix(soft_lo, soft_hi, (f32(ib) + 0.5) / f32(BINS));
    let tf = mix(t0, t1, (f32(jf) + 0.5) / f32(FOG));
    let fogNext = jf < FOG && (ib >= BINS || tf < tb);
    var e: vec4<f32>;
    var t: f32;
    if (fogNext) { e = soft_fog[jf]; t = tf; jf += 1u; } else { e = soft_bin[ib]; t = tb; ib += 1u; }
    if (e.x <= 0.0) { continue; }
    let a = trans * (1.0 - exp(-e.x));
    colour += a * e.yzw / e.x;
    seen += a * t;
    trans *= exp(-e.x);
  }
  let alpha = 1.0 - trans;
  if (alpha < 1e-4) { discard; }
  colour /= alpha;
  ${o.haze > 0 ? `colour = mix(colour, sky(d), 1.0 - exp(-(seen / alpha) * ${f(o.haze)}));` : ""}
  return vec4<f32>(colour, alpha);
}`;
}

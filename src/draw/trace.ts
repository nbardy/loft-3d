// What the per-pixel tracers share (docs/folding_and_tracing.md section 3): the bound a tracer marches inside, drawn
// as ordinary triangles, and the fragment-stage plumbing every traced solid needs to sit in the scene like a triangle
// body: the view ray of a pixel, the ray's span inside the bound, depth, the silhouette's antialiasing, and lighting by
// the scene's style.
//
// The proxy is the bound's oriented box drawn with its FRONT faces culled: a back face is visible whenever any part of
// the bound is in view, including when the camera is inside it, and each pixel is shaded once. The ray's span is then
// computed analytically against the bound's own shape (box, sphere or capsule), so a sphere bound wastes only the
// corners of its box, not a march.
//
// Antialiasing. A traced edge lies inside the proxy's triangles, so multisampling sees a fully covered pixel and the
// edge stair-steps. The fragment stage writes `@builtin(sample_mask)` instead: the share of a pixel's 4 samples set is
// the coverage estimated from how close the ray came to the surface, in pixels. That antialiases in the opaque pass
// with no blending and keeps depth exact (every set sample gets the traced depth), so foam and other depth readers see
// a real surface. The bits chosen turn from pixel to pixel so partial coverage does not draw a fixed pattern.

import type { V3 } from "../compile/context.ts";

/** Where a tracer marches: a box, a sphere or a capsule, in world units. Static numbers: the CPU check samples inside it. */
export type TraceBound =
  | { readonly kind: "box"; readonly min: V3; readonly max: V3 }
  | { readonly kind: "sphere"; readonly centre: V3; readonly radius: number }
  | { readonly kind: "capsule"; readonly a: V3; readonly b: V3; readonly radius: number };

const finite = (what: string, v: readonly number[]): void => {
  for (const x of v) if (!Number.isFinite(x)) throw new Error(`bound.${what}: every number must be finite, got [${v.join(", ")}]`);
};

/** Constructors that check their numbers once, so the tracer never sees a degenerate bound. */
export const bound = {
  box(min: V3, max: V3): TraceBound {
    finite("box", [...min, ...max]);
    if (!(max[0] > min[0] && max[1] > min[1] && max[2] > min[2])) throw new Error(`bound.box: max must exceed min on every axis, got [${min.join(", ")}] .. [${max.join(", ")}]`);
    return { kind: "box", min, max };
  },
  sphere(centre: V3, radius: number): TraceBound {
    finite("sphere", [...centre, radius]);
    if (!(radius > 0)) throw new Error(`bound.sphere: radius must be positive, got ${radius}`);
    return { kind: "sphere", centre, radius };
  },
  capsule(a: V3, b: V3, radius: number): TraceBound {
    finite("capsule", [...a, ...b, radius]);
    if (!(radius > 0)) throw new Error(`bound.capsule: radius must be positive, got ${radius}`);
    if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) === 0) throw new Error("bound.capsule: the ends must differ (use bound.sphere)");
    return { kind: "capsule", a, b, radius };
  },
};

/** An oriented box: centre, three right-handed unit axes, half extents along them. */
type Obb = { readonly c: V3; readonly axes: readonly [V3, V3, V3]; readonly half: V3 };

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a: V3): V3 => scale3(a, 1 / Math.hypot(...a));

const AXES: readonly [V3, V3, V3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** The proxy box of each bound. */
function obbOf(b: TraceBound): Obb {
  switch (b.kind) {
    case "box": return { c: scale3(add3(b.min, b.max), 0.5), axes: AXES, half: scale3(sub3(b.max, b.min), 0.5) };
    case "sphere": return { c: b.centre, axes: AXES, half: [b.radius, b.radius, b.radius] };
    case "capsule": {
      const ax = sub3(b.b, b.a), z = unit3(ax);
      // Any unit vector not parallel to the axis gives the other two axes; x = (ref x z) normalised, y = z x x.
      const ref: V3 = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const x = unit3(cross3(ref, z)), y = cross3(z, x);
      return { c: scale3(add3(b.a, b.b), 0.5), axes: [x, y, z], half: [b.radius, b.radius, Math.hypot(...ax) / 2 + b.radius] };
    }
  }
}

/** The axis-aligned box that holds the bound (where the CPU check samples). */
export function aabbOf(b: TraceBound): { readonly min: V3; readonly max: V3 } {
  switch (b.kind) {
    case "box": return { min: b.min, max: b.max };
    case "sphere": return { min: sub3(b.centre, [b.radius, b.radius, b.radius]), max: add3(b.centre, [b.radius, b.radius, b.radius]) };
    case "capsule": {
      const r = b.radius;
      return {
        min: [Math.min(b.a[0], b.b[0]) - r, Math.min(b.a[1], b.b[1]) - r, Math.min(b.a[2], b.b[2]) - r],
        max: [Math.max(b.a[0], b.b[0]) + r, Math.max(b.a[1], b.b[1]) + r, Math.max(b.a[2], b.b[2]) + r],
      };
    }
  }
}

const num = (x: number): string => {
  const s = String(x);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};
const v3 = (v: V3): string => `vec3<f32>(${v.map(num).join(", ")})`;

/**
 * WGSL `fn bound_span(o, d) -> vec2<f32>`: where the ray o + t d (d unit) enters and leaves the bound; x > y for a miss.
 * One body per kind; each is the textbook closed form.
 */
function spanWgsl(b: TraceBound): string {
  switch (b.kind) {
    case "box": return /* wgsl */ `
fn bound_span(o: vec3<f32>, d: vec3<f32>) -> vec2<f32> {
  // Slabs. A zero direction component gives +-inf, which min/max order correctly.
  let inv = 1.0 / d;
  let a = (${v3(b.min)} - o) * inv;
  let c = (${v3(b.max)} - o) * inv;
  let lo = min(a, c);
  let hi = max(a, c);
  return vec2<f32>(max(lo.x, max(lo.y, lo.z)), min(hi.x, min(hi.y, hi.z)));
}`;
    case "sphere": return /* wgsl */ `
fn bound_span(o: vec3<f32>, d: vec3<f32>) -> vec2<f32> {
  let oc = o - ${v3(b.centre)};
  let bb = dot(oc, d);
  let h = bb * bb - (dot(oc, oc) - ${num(b.radius * b.radius)});
  let s = sqrt(max(h, 0.0));
  return select(vec2<f32>(1.0, -1.0), vec2<f32>(-bb - s, -bb + s), h >= 0.0);
}`;
    case "capsule": return /* wgsl */ `
fn loft_span_sphere(o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, r2: f32) -> vec2<f32> {
  let oc = o - c;
  let bb = dot(oc, d);
  let h = bb * bb - (dot(oc, oc) - r2);
  let s = sqrt(max(h, 0.0));
  return select(vec2<f32>(1e30, -1e30), vec2<f32>(-bb - s, -bb + s), h >= 0.0);
}
fn bound_span(o: vec3<f32>, d: vec3<f32>) -> vec2<f32> {
  // The capsule is convex, so the ray's span is one interval: the hull of its spans through the two end spheres and
  // through the cylinder between the end planes.
  let a = ${v3(b.a)};
  let ba = ${v3(sub3(b.b, b.a))};
  let r2 = ${num(b.radius * b.radius)};
  let bal = dot(ba, ba);
  let oa = o - a;
  let bd = dot(ba, d);
  let bo = dot(ba, oa);
  // Infinite cylinder: |(oa + t d) - ba ((bo + t bd) / bal)|^2 = r^2.
  let k2 = bal - bd * bd;
  let k1 = bal * dot(oa, d) - bo * bd;
  let k0 = bal * dot(oa, oa) - bo * bo - r2 * bal;
  let h = k1 * k1 - k2 * k0;
  var cyl = vec2<f32>(1e30, -1e30);
  if (h >= 0.0 && k2 > 1e-12) {
    let s = sqrt(h);
    cyl = vec2<f32>((-k1 - s) / k2, (-k1 + s) / k2);
    // Clip to the slab between the end planes (projection onto the axis in [0, bal]).
    let lo = select((0.0 - bo) / bd, -1e30, abs(bd) < 1e-12);
    let hi = select((bal - bo) / bd, 1e30, abs(bd) < 1e-12);
    let slab = vec2<f32>(min(lo, hi), max(lo, hi));
    let inside = abs(bd) >= 1e-12 || (bo >= 0.0 && bo <= bal);
    cyl = select(vec2<f32>(1e30, -1e30), vec2<f32>(max(cyl.x, slab.x), min(cyl.y, slab.y)), inside);
  }
  let s0 = loft_span_sphere(o, d, a, r2);
  let s1 = loft_span_sphere(o, d, a + ba, r2);
  return vec2<f32>(min(cyl.x, min(s0.x, s1.x)), max(cyl.y, max(s0.y, s1.y)));
}`;
  }
}

/** The 36 corners (12 triangles) of the unit cube [-1, 1]^3, wound counter-clockwise seen from outside. */
function cubeCorners(): V3[] {
  const out: V3[] = [];
  for (let a = 0; a < 3; a++) {
    for (const s of [-1, 1]) {
      const n: V3 = [0, 0, 0]; n[a] = s;
      // u x v = n: counter-clockwise seen from the side n points to.
      const u: V3 = [0, 0, 0]; u[(a + 1) % 3] = 1;
      const v = cross3(n, u);
      const corner = (i: number, j: number): V3 => add3(add3(n, scale3(u, i)), scale3(v, j));
      out.push(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, -1), corner(1, 1), corner(-1, 1));
    }
  }
  return out;
}
const CUBE = cubeCorners();

/** Vertices per proxy draw. */
export const PROXY_VERTICES = CUBE.length;

/**
 * Module-scope WGSL for a traced draw: the bound's span, the proxy vertex stage `vs`, and the fragment helpers
 * (`traceShadeWgsl`). The fragment stage of the caller defines `fs(in: TraceIn) -> TraceOut`. `show` is a WGSL bool
 * expression evaluated per vertex: where it is false the proxy is moved behind the near plane and draws nothing (a
 * field drawn as a mesh from far away and traced up close switches between them per frame this way).
 */
export function traceWgsl(b: TraceBound, show: string): string {
  const o = obbOf(b);
  return /* wgsl */ `${spanWgsl(b)}
struct TraceIn { @builtin(position) clip: vec4<f32>, @location(0) world: vec3<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> TraceIn {
  let c = LOFT_CUBE[vi];
  let w = ${v3(o.c)} + ${v3(o.axes[0])} * (c.x * ${num(o.half[0])}) + ${v3(o.axes[1])} * (c.y * ${num(o.half[1])}) + ${v3(o.axes[2])} * (c.z * ${num(o.half[2])});
  return TraceIn(select(HIDDEN_VERTEX, frame.view_proj * vec4<f32>(w, 1.0), ${show}), w);
}
${tracePlumbingWgsl()}`;
}

/**
 * What every per-pixel tracer needs whatever its proxy: the unit cube's corners (`LOFT_CUBE`, ${CUBE.length} vertices), the
 * fragment output, the view ray's origin, depth, the coverage mask, and the shading helpers. A drawable with its own
 * vertex stage (one box per copy, src/draw/copies.ts) takes this without `traceWgsl`'s single static bound.
 */
export function tracePlumbingWgsl(): string {
  return /* wgsl */ `
const LOFT_CUBE = array<vec3<f32>, ${CUBE.length}>(${CUBE.map(v3).join(", ")});
struct TraceOut { @location(0) colour: vec4<f32>, @builtin(frag_depth) depth: f32, @builtin(sample_mask) mask: u32 };
/// The view ray through a point of the proxy: origin on the eye (perspective) or on the plane through the eye
/// across the view (orthographic), and unit direction. One formula for both cameras.
fn trace_origin(w: vec3<f32>, d: vec3<f32>) -> vec3<f32> {
  return w - d * dot(w - frame.eye.xyz, d);
}
/// Depth buffer value of a world point.
fn trace_depth(p: vec3<f32>) -> f32 {
  let c = frame.view_proj * vec4<f32>(p, 1.0);
  return c.z / c.w;
}
/// Coverage 0..1 as a 4-sample mask: round(4 c) samples, the set turned by a per-pixel hash so that partial
/// coverage reads as grain, not as a fixed pattern.
fn trace_mask(c: f32, px: vec2<f32>) -> u32 {
  let k = u32(clamp(round(c * 4.0), 0.0, 4.0));
  let bits = (1u << k) - 1u;
  let r = u32(fract(52.9829189 * fract(dot(floor(px), vec2<f32>(0.06711056, 0.00583715)))) * 4.0) & 3u;
  return ((bits << r) | (bits >> (4u - r))) & 15u;
}
${traceShadeWgsl()}`;
}

/**
 * The lighting a traced solid gets, shared with a field drawn as a mesh (so the two look the same): the style's
 * shade, mark and ink at a world point, the ink width in pixels, and the clip position that hides a vertex.
 */
export function traceShadeWgsl(): string {
  return /* wgsl */ `
/// A clip position behind the near plane: a triangle with all three corners here is clipped away.
const HIDDEN_VERTEX: vec4<f32> = vec4<f32>(0.0, 0.0, -2.0, 1.0);
/// The style's lit colour of a traced point, as a triangle body's fragment would get it.
/// A traced solid has no surface coordinates: (u, v) is 0 and its anchor is the world point (DESIGN.md 2.6).
fn trace_shade(base: vec3<f32>, n: vec3<f32>, p: vec3<f32>, d: vec3<f32>, id: f32) -> vec3<f32> {
  return shade(base, n, -d, p, sea_height(p.xz) - p.y, vec2<f32>(0.0), p, id);
}
fn trace_mark(base: vec3<f32>, n: vec3<f32>, p: vec3<f32>, d: vec3<f32>, id: f32) -> f32 {
  return mark(base, n, -d, p, sea_height(p.xz) - p.y, vec2<f32>(0.0), p, id);
}
/// Ink width in pixels for a pixel of world size fp: the style's width (as a hull outline has it), at least 1.5 px,
/// and at most 4 px. The cap is for traced solids only: their ink is measured as closest approach, so a branch at
/// the lens would otherwise wear a band tens of pixels wide over everything behind it.
fn ink_px(fp: f32) -> f32 {
  return clamp(outline_world() / fp, 1.5, 4.0);
}
fn trace_ink(base: vec3<f32>, n: vec3<f32>, p: vec3<f32>, d: vec3<f32>, id: f32) -> vec3<f32> {
  return ink(base, n, -d, p, sea_height(p.xz) - p.y, vec2<f32>(0.0), p, id);
}`;
}

/**
 * Ink along a traced solid's silhouettes (the hull outline of a triangle body has no equivalent inside a bound), or
 * none. `silhouette`: rays that pass within the style's ink width of the surface without hitting it are ink.
 */
export type TraceOutline = "silhouette" | "none";

/** WGSL `const INK_ON: bool` for an outline choice. */
export function outlineWgsl(o: TraceOutline): string {
  switch (o) {
    case "silhouette": return "const INK_ON: bool = true;";
    case "none": return "const INK_ON: bool = false;";
  }
}

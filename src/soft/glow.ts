// Glows: light around curves, as a falloff of the distance from each pixel's view ray to the curve. Additive, soft at
// any zoom (the hot core never gets thinner than a pixel; below a pixel it dims instead, keeping its energy), seen
// through a medium when it is inside or behind one (its light is attenuated by the medium's optical depth up to the
// curve, in closed form), and hidden by opaque bodies in front of it.
//
// A glow draws a family of strokes (`Strokes`: curves u -> point indexed by i, with a taper). The strokes are sampled
// once per frame on the CPU into a table (a curve is a function, its samples a table: DESIGN.md 7.3), so the strokes
// may be anything the CPU can evaluate: hashed midpoint displacement for lightning, a spline, a body's spine. Each
// segment is drawn as a quad in the view plane around it, as wide as the falloff reaches; a pixel is shaded by the
// segment nearest its ray among a window of neighbours, and only by that one, so the joints of a polyline are not
// counted twice (the same rule the cast shadows use for their capsules).

import { div, floor, lift, mapOf, mul, sub, variable, vec4, type Expr, type In, type TableSource } from "../expr.ts";
import { emitShaderFn } from "../compile/bind.ts";
import { drawSpec, type CompileContext, type Drawable, type Emitted, type Shader } from "../compile/context.ts";
import type { F, P3, Skeleton } from "../map/types.ts";
import { accessMedium, tauFunction, type Medium } from "./medium.ts";

export type Rgb = readonly [number, number, number];

/** A family of curves: stroke i in [0, count) is u in [0, 1] -> point, with a taper (0 is gone, 1 full width). */
export interface Strokes {
  /** Identifier; names the table the strokes are sampled into. */
  readonly name: string;
  readonly count: number;
  readonly segments: number;
  point(u: F, i: F): P3;
  taper(u: F, i: F): F;
}

/**
 * A family of curves to draw as light: stroke i (0 to count - 1) is u in [0, 1] -> `point(u, i)`, with a `taper(u, i)`
 * (a multiple of the glow's width; 0 is gone). It is the geometry `glows` lights, `bolt` fills with lightning, and any
 * curve family (a spline, a body's spine, rings, sparks) can be.
 *
 * The law: every frame the CPU samples each stroke at u = k / `segments`, k = 0..segments, into a table; the glow draws
 * the polyline through those samples. So `point` and `taper` may be any expression the CPU can evaluate (time, inputs,
 * hashes, another body's frame).
 *
 * Parameters: `name` (an identifier: it names the table), `count` and `segments` fixed whole numbers; `point` and
 * `taper` functions of (u, i) returning expressions.
 *
 * What it cannot do, because it is sampled into a fixed table:
 * - change its number of strokes or segments in time: hide a stroke with a taper or brightness of 0 instead.
 * - follow detail finer than a segment: between samples it is straight, so a sharp kink or a fast wiggle needs more
 *   segments (and cost grows with count x segments, per frame on the CPU and per pixel near each segment).
 * - use expressions the CPU cannot evaluate (GPU-only functions).
 */
export function strokes(name: string, count: number, segments: number, point: (u: F, i: F) => P3, taper: (u: F, i: F) => In<"f32"> = () => 1): Strokes {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`strokes "${name}": names must be identifiers (they name tables)`);
  if (!(Number.isInteger(count) && count >= 1 && Number.isInteger(segments) && segments >= 1)) throw new Error(`strokes "${name}": count and segments must be positive integers`);
  return { name, count, segments, point, taper: (u, i) => lift<"f32">(taper(u, i)) };
}

/** What lies between the eye and a glow: nothing, or a medium whose optical depth dims it. */
export type Veil = { readonly kind: "clear" } | { readonly kind: "medium"; readonly medium: Medium };

export type GlowOptions = {
  /** Half-width of the hot core, world units (times the taper). May follow time. */
  readonly width: In<"f32">;
  /** Radius of the halo as a multiple of the core's half-width. */
  readonly halo: number;
  /** Colour of the halo; the core goes toward `core`. */
  readonly colour: Rgb;
  readonly core: Rgb;
  /** Brightness of stroke i (0 is off). May follow time: a flash envelope. */
  readonly brightness: (i: F) => In<"f32">;
  readonly veil: Veil;
};

/** A star of rays round a point light (a flare): `rays` arms, `length` times the halo radius, `thin` in pixels. */
export type Shape = { readonly kind: "line" } | { readonly kind: "star"; readonly rays: number; readonly length: number; readonly thin: number };

/** Segments either side of a pixel's own segment searched for a nearer one. */
const WINDOW = 6;

const tables = new WeakMap<Strokes, TableSource>();
/** The strokes' samples: entry i (S + 1) + k is (point at u = k / S, taper). */
function strokeTable(s: Strokes): TableSource {
  let t = tables.get(s);
  if (t) return t;
  const S = s.segments;
  // A map over every sample: entry e is stroke i = floor(e / (S + 1)) at u = k / S, k = e - i (S + 1) (exact in f32:
  // the division of a whole number by S + 1 is correctly rounded, so it is exactly i where it divides).
  const sample = (e: F): Expr<"vec4">[] => {
    const i = floor(div(e, S + 1)), u = div(sub(e, mul(i, S + 1)), S);
    return [vec4(s.point(u, i), s.taper(u, i))];
  };
  t = { name: `${s.name}_strokes`, lanes: 1, entries: s.count * (S + 1), role: "data", program: mapOf(s.count * (S + 1), sample) };
  tables.set(s, t);
  return t;
}

const fl = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));
const rgb = (c: Rgb): string => `vec3<f32>(${c.map(fl).join(", ")})`;

/**
 * The `Drawable` that `glow`, `glows` and `flare` return: additive light around curves or a point, softened by
 * distance from each pixel's view ray. A scene author gets it from those functions, not by constructing it.
 */
export class GlowDrawable implements Drawable {
  readonly skeletons: readonly Skeleton[] = [];
  readonly surfaces = [];
  constructor(readonly name: string, readonly strokes: Strokes, readonly o: GlowOptions, readonly shape: Shape) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`glow "${name}": names must be identifiers (they name shaders)`);
    if (!(o.halo >= 1)) throw new Error(`glow "${name}": halo must be at least 1 (a multiple of the core width)`);
  }

  draws(ctx: CompileContext): Emitted {
    const key = `glow.${this.name}`;
    const T = ctx.table(strokeTable(this.strokes)).wgsl;
    const i = variable("i", "f32");
    const env = emitShaderFn(ctx.slots, { name: `glow_${this.name}_env`, args: [["i", "f32"]], out: "vec2<f32>", roots: [lift<"f32">(this.o.brightness(i)), lift<"f32">(this.o.width)], ret: (v) => `vec2<f32>(${v[0]}, ${v[1]})` });
    const veil = veilWgsl(ctx, this.o.veil, `glow_${this.name}_tau`);
    const code = [env.code, veil.code, glowWgsl(this.name, T, this.strokes, this.o, this.shape)].join("\n");
    const shader: Shader = { code, libs: [...env.libs, ...veil.libs] };
    return {
      shaders: { [key]: shader },
      draws: [drawSpec({ label: this.name, shader: key, vertices: 6, instances: this.strokes.count * this.strokes.segments, phase: "transparent", cull: "none", depthWrite: false, blend: "add", sceneDepth: true })],
    };
  }
}

/** `fn glow_veil(o, d, t) -> f32`: the fraction of light that crosses the veil from distance t along the ray. */
function veilWgsl(ctx: CompileContext, v: Veil, fn: string): Shader {
  switch (v.kind) {
    case "clear": return { code: "fn glow_veil(o: vec3<f32>, d: vec3<f32>, t: f32) -> f32 { return 1.0; }", libs: [] };
    case "medium": {
      const f = tauFunction(v.medium, fn, accessMedium(v.medium, ctx.sun, (t) => ctx.table(t)));
      return { code: `${f.code}\nfn glow_veil(o: vec3<f32>, d: vec3<f32>, t: f32) -> f32 { return exp(-${fn}(o, d, 0.0, t)); }`, libs: f.libs };
    }
  }
}

function starWgsl(shape: Shape): string {
  switch (shape.kind) {
    case "line": return "fn glow_star(q: vec2<f32>, h: f32, px: f32) -> f32 { return 0.0; }";
    // q: the pixel's offset from the light in the view plane, world units. Each arm is a thin line fading along its
    // length; arms are drawn by folding the angle into one sector (a polar repeat).
    case "star": return /* wgsl */ `
fn glow_star(q: vec2<f32>, h: f32, px: f32) -> f32 {
  let sector = 6.2831853 / ${fl(shape.rays)};
  let a = atan2(q.y, q.x) + 0.5 * sector;
  let local = a - sector * floor(a / sector) - 0.5 * sector;
  let r = length(q);
  let across = abs(sin(local)) * r;
  let len = ${fl(shape.length)} * h;
  return exp(-across / (${fl(shape.thin)} * px)) * max(1.0 - r / len, 0.0) * max(1.0 - r / len, 0.0);
}`;
  }
}

function glowWgsl(name: string, T: string, s: Strokes, o: GlowOptions, shape: Shape): string {
  const S = s.segments;
  return /* wgsl */ `
const GS: u32 = ${S}u;
const HALO: f32 = ${fl(o.halo)};
const GLOW_COLOUR: vec3<f32> = ${rgb(o.colour)};
const GLOW_CORE: vec3<f32> = ${rgb(o.core)};
${starWgsl(shape)}
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) @interpolate(flat) id: vec2<u32>,
  @location(2) @interpolate(flat) veil: f32,
};
/// Unit right and up of the view plane at p.
fn glow_basis(p: vec3<f32>) -> array<vec3<f32>, 2> {
  let f = view_dir(p);
  let helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(f.y) > 0.99);
  let r = normalize(cross(f, helper));
  return array<vec3<f32>, 2>(r, cross(r, f));
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let stroke = ii / GS;
  let seg = ii % GS;
  let a = ${T}(stroke * (GS + 1u) + seg);
  let b = ${T}(stroke * (GS + 1u) + seg + 1u);
  let env = glow_${name}_env(f32(stroke));
  var out: VOut;
  out.id = vec2<u32>(stroke, seg);
  if (env.x <= 0.0 || max(a.w, b.w) <= 0.0) {
    // Off: a degenerate triangle outside the clip volume.
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.world = vec3<f32>(0.0);
    out.veil = 0.0;
    return out;
  }
  let mid = 0.5 * (a.xyz + b.xyz);
  let basis = glow_basis(mid);
  let f = view_dir(mid);
  // The segment as seen: its projection on the view plane gives the quad's long axis (a square for a point).
  let ab = b.xyz - a.xyz;
  let seen = ab - f * dot(ab, f);
  let len = length(seen);
  let along = select(basis[0], seen / max(len, 1e-9), len > 1e-6);
  let side = normalize(cross(f, along));
  let reach = 3.0 * HALO * env.y * max(a.w, b.w) + 3.0 * pixel_world(mid);
  let corner = vec2<f32>(select(-1.0, 1.0, vi == 1u || vi == 2u || vi == 4u), select(-1.0, 1.0, vi == 2u || vi == 4u || vi == 5u));
  let p = mid + along * corner.x * (0.5 * len + reach) + side * corner.y * reach;
  out.world = p;
  out.clip = frame.view_proj * vec4<f32>(p, 1.0);
  // The veil once per segment, at its middle, not per pixel: a medium's depth is smooth across a quad, and per pixel
  // it was a full pass over the medium's blobs for every pixel of a halo (in examples/storm.ts the lit bolt's halos
  // cost more than the cloud itself).
  let vo = mid - f * dot(mid - frame.eye.xyz, f);
  out.veil = glow_veil(vo, f, dot(mid - vo, f));
  return out;
}
/// Closest approach of the ray o + t d (d unit, t >= 0) to segment a b: (distance, t along the ray, s along the segment).
fn glow_closest(o: vec3<f32>, d: vec3<f32>, a: vec3<f32>, b: vec3<f32>) -> vec3<f32> {
  let v = b - a;
  let w0 = o - a;
  let bb = dot(d, v);
  let cc = dot(v, v);
  let dd = dot(d, w0);
  let ee = dot(v, w0);
  let den = cc - bb * bb;
  let s = clamp(select(0.0, (ee - bb * dd) / den, den > 1e-9 * max(cc, 1e-12)), 0.0, 1.0);
  let t = max(dot(a + v * s - o, d), 0.0);
  return vec3<f32>(distance(o + d * t, a + v * s), t, s);
}
/// What a segment's quad shows at a ray: the strokes' light, the distance along the ray to the nearest point of the
/// stroke, and whether this segment is the nearest of its window (only that one draws).
struct GlowAt { light: vec3<f32>, t: f32, own: bool };
fn glow_eval(o: vec3<f32>, d: vec3<f32>, stroke: u32, seg: u32) -> GlowAt {
  let base = stroke * (GS + 1u);
  let lo = select(0u, seg - ${WINDOW}u, seg > ${WINDOW}u);
  let hi = min(seg + ${WINDOW}u, GS - 1u);
  var best = vec3<f32>(1e30, 0.0, 0.0);
  var bestK = seg;
  var taper = 0.0;
  for (var k = lo; k <= hi; k++) {
    let a = ${T}(base + k);
    let b = ${T}(base + k + 1u);
    let c = glow_closest(o, d, a.xyz, b.xyz);
    // Ties go to the later segment (the joint between two is drawn once).
    if (c.x <= best.x) { best = c; bestK = k; taper = mix(a.w, b.w, c.z); }
  }
  let env = glow_${name}_env(f32(stroke));
  let p = o + d * best.y;
  let px = pixel_world(p);
  let w = env.y * taper;
  // The core: never thinner than about a pixel; thinner than that it dims instead (the same light over more pixels).
  let rc = max(w, 0.7 * px);
  let core = exp(-(best.x / rc) * (best.x / rc)) * (w / rc);
  let h = max(HALO * w, 1.5 * px);
  let hd = best.x / h;
  let halo = (0.65 * exp(-hd * hd) + 0.35 * exp(-3.0 * hd)) * min(1.0, (HALO * w / h) * (HALO * w / h));
  let basis = glow_basis(p);
  let q = p - ${T}(base).xyz;
  let star = glow_star(vec2<f32>(dot(q, basis[0]), dot(q, basis[1])), h, px);
  return GlowAt(env.x * (GLOW_CORE * core + GLOW_COLOUR * (halo + star)), best.y, bestK == seg);
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let d = view_dir(in.world);
  let o = in.world - d * dot(in.world - frame.eye.xyz, d);
  let g = glow_eval(o, d, in.id.x, in.id.y);
  // Behind an opaque body: hidden. In or behind a medium: dimmed by its optical depth up to the curve.
  if (!g.own || dot(scene_position(in.clip.xy) - o, d) < g.t) { discard; }
  return vec4<f32>(g.light * in.veil, 1.0);
}`;
}

/**
 * Light along each of a family of strokes: a hot core and a soft halo round every curve, additive, seen through a
 * medium and hidden by bodies in front. Lightning, a neon tube, a laser, sparks, a glowing vein.
 *
 * The shape and its law. For each pixel, d is the distance from its view ray to the nearest point of the stroke, w the
 * width times the taper there, and px a pixel's world size. The light added is
 *   brightness(i) (core * exp(-(d / rc)^2) (w / rc) + colour * (0.65 exp(-(d / h)^2) + 0.35 exp(-3 d / h))),
 * rc = max(w, 0.7 px), h = max(halo w, 1.5 px): the core never thins below a pixel (it dims instead, keeping its
 * energy), and the whole is multiplied by exp(-optical depth) of the `veil` medium up to the curve.
 *
 * Parameters: `width` and `brightness(i)` take expressions (a flash envelope, a pulse per stroke); `halo`, `colour`,
 * `core` and `veil` are fixed. The curves move as the strokes do.
 *
 * What it cannot do, because the light is added along a distance to a curve:
 * - darken, or hide what is behind it: it only adds light, so a glow over a bright sky barely shows.
 * - light anything: bodies, the ground and the water near it are not lit (a `flash` lights a medium; a `skyFlash`
 *   washes the screen).
 * - glow from a surface or a volume: only from curves (a glowing sheet is many strokes; a glowing cloud is a medium
 *   lit by a flash).
 * - count its own crossings once: two parts of strokes that cross on screen add (brighter where they cross); only the
 *   joints between neighbouring segments are drawn once.
 * - dim smoothly through a medium along one segment: the veil is taken once per segment, at its middle.
 *
 * Going past it: `strokes` is the open slot (any curves the CPU can evaluate). Relatives:
 * - one curve: `glow`; one point with a star of rays: `flare`.
 * - a taper that grows along u: a beam or a cone of light (a searchlight) rather than a line.
 * - another falloff of d, a Lorentzian 1 / (1 + (d / w)^2): a longer, hazier halo, as through mist; written by
 *   copying this drawable's shader, not by an option.
 */
export function glows(name: string, s: Strokes, o: GlowOptions): Drawable {
  return new GlowDrawable(name, s, o, { kind: "line" });
}

/**
 * Light along one curve, u in [0, 1] -> point, sampled into `segments` segments per frame: a neon tube, a glowing
 * thread, a laser. It is `glows` with a single stroke and `intensity` for its brightness, so its law, its limits (it
 * only adds light, lights nothing, glows from curves only) and its relatives are those of `glows`. It cannot taper:
 * the width is the same along the whole curve; for a taper, build `strokes` with one and call `glows`.
 */
export function glow(name: string, curve: (u: F) => P3, o: Omit<GlowOptions, "brightness"> & { readonly intensity: In<"f32">; readonly segments: number }): Drawable {
  return glows(name, strokes(name, 1, o.segments, (u) => curve(u)), { ...o, brightness: () => o.intensity });
}

export type FlareOptions = Omit<GlowOptions, "brightness" | "width"> & {
  /** Radius of the hot centre, world units. */
  readonly size: In<"f32">;
  readonly intensity: In<"f32">;
  /** Rays round it: 0 for none. */
  readonly rays: number;
};

/**
 * A point of light: a hot centre, a halo and (optionally) a star of thin rays, additive, seen through a medium and
 * hidden by bodies in front. A star, a lamp, a spark, a muzzle flash, the sun's glint.
 *
 * The shape and its law: `glows`' law about a single point (d is the distance from the pixel's view ray to `at`), with
 * `size` as the core's half-width; with `rays` > 0, `rays` thin arms are added, each exp(-across / (1.2 px)) times
 * (1 - r / len)^2, len = 2.5 times the halo's radius, laid in the view plane by folding the angle into one sector.
 *
 * Parameters: `at`, `size` and `intensity` take expressions (it can move, swell, flicker); `halo`, `colour`, `core`,
 * `rays` and `veil` are fixed.
 *
 * What it cannot do, because of the law:
 * - turn its star: the arms stand at fixed angles in the view plane (the first along the view's right), and do not
 *   rotate or twinkle on their own.
 * - change its arms' length or thinness (2.5 halo radii, 1.2 pixels), or its number of rays in time.
 * - light anything around it, or darken: it only adds light (see `glows`).
 *
 * Relatives: a glow along a short curve (`glow`) is a streak; many flares are a field of stars, cheaper as one `glows`
 * with `count` single-point strokes; for arms that turn, a `glows` whose strokes are short lines from the point.
 */
export function flare(name: string, at: In<"vec3">, o: FlareOptions): Drawable {
  const s = strokes(name, 1, 1, () => lift<"vec3">(at));
  const shape: Shape = o.rays > 0 ? { kind: "star", rays: o.rays, length: 2.5, thin: 1.2 } : { kind: "line" };
  return new GlowDrawable(name, s, { ...o, width: o.size, brightness: () => o.intensity }, shape);
}


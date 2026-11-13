// Rain: streaks falling through a shaft, and the rings they make where they meet the ground (a sea or a plane).
//
// Instancing with a generator (docs/folding_and_tracing.md section 1): streak i is an index hashed to a place, falling
// on a loop of period `height / speed`; each loop (a cycle) it is hashed to a new place, so the pattern never repeats
// and nothing is stored. One quad per streak, facing the camera, thin and slanted by the wind, faded at both ends and
// toward the shaft's edges; a streak thinner than a pixel keeps a pixel's width and fades instead (no shimmering
// sub-pixel lines). Its lower end stops at the swell (the fragment stage drops what is under the water). A splash is
// the ring the same streak made at the end of its previous cycle, laid on the sea, growing and fading over its life.
// Cost: one quad per streak and per splash, whatever the screen coverage; the fragment work is a few lines.

import { drawSpec, type CompileContext, type Drawable, type Emitted } from "../compile/context.ts";
import { emitShaderFn } from "../compile/bind.ts";
import { lift, type In } from "../expr.ts";
import type { Skeleton } from "../map/types.ts";

export type Rgb = readonly [number, number, number];

export type RainSpec = {
  /** Centre of the shaft at the sea (x, z), its radius (the density of streaks falls off as a Gaussian of this). */
  readonly centre: readonly [number, number];
  readonly radius: number;
  /** Where streaks start falling (the cloud's base), world height. */
  readonly top: number;
  readonly count: number;
  /** Fall speed, world units per second. */
  readonly speed: number;
  /** World units per second the wind carries a drop sideways (x, z). */
  readonly wind: readonly [number, number];
  /** Streak length (motion blur) and half-width, world units. */
  readonly length: number;
  readonly width: number;
  readonly colour: Rgb;
  /** Peak opacity of a streak. */
  readonly opacity: number;
  /** Extra light on the rain (a lightning flash), 0 for none; may follow time. */
  readonly flash: In<"f32">;
  readonly seed: number;
};

export type SplashSpec = {
  /** Rings, from the first streaks of the rain (at most its count). */
  readonly count: number;
  /** Largest radius a ring grows to, and its life in seconds. */
  readonly radius: number;
  readonly life: number;
  readonly colour: Rgb;
  readonly opacity: number;
};

const fl = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/** WGSL shared by streaks and splashes: where streak i is in cycle c, and its clock. */
function rainCommon(r: RainSpec, prefix: string): string {
  const fallTime = r.top / r.speed;
  return /* wgsl */ `
const ${prefix}_SEED: u32 = ${(r.seed >>> 0)}u;
const ${prefix}_PERIOD: f32 = ${fl(fallTime)};
fn ${prefix}_pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn ${prefix}_unit(h: u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }
/// Hashes of (streak, cycle): three numbers in [0, 1).
fn ${prefix}_hash(i: u32, c: i32) -> vec3<f32> {
  let h = ${prefix}_pcg(i ^ ${prefix}_pcg(bitcast<u32>(c) + ${prefix}_SEED));
  let h1 = ${prefix}_pcg(h);
  return vec3<f32>(${prefix}_unit(h), ${prefix}_unit(h1), ${prefix}_unit(${prefix}_pcg(h1)));
}
/// Streak i's phase in its fall: (cycle, fraction of the fall done, 0..1).
fn ${prefix}_clock(i: u32) -> vec2<f32> {
  let offset = ${prefix}_unit(${prefix}_pcg(i + 977u * ${prefix}_SEED));
  let x = frame.time.x / ${prefix}_PERIOD + offset;
  return vec2<f32>(floor(x), x - floor(x));
}
/// Where streak i lands in cycle c (x, z), and its weight (fewer toward the shaft's edge).
fn ${prefix}_land(i: u32, c: f32) -> vec3<f32> {
  let h = ${prefix}_hash(i, i32(c));
  // A Gaussian disc: radius from the inverse of its cumulative distribution, angle uniform.
  let r = ${fl(r.radius)} * sqrt(-log(max(1.0 - h.x * 0.985, 1e-6)));
  let a = h.y * 6.2831853;
  return vec3<f32>(${fl(r.centre[0])} + r * cos(a), ${fl(r.centre[1])} + r * sin(a), h.z);
}`;
}

class RainDrawable implements Drawable {
  readonly skeletons: readonly Skeleton[] = [];
  readonly surfaces = [];
  constructor(readonly name: string, readonly r: RainSpec) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`rain "${name}": names must be identifiers`);
    if (!(Number.isInteger(r.count) && r.count >= 1)) throw new Error(`rain "${name}": count must be a positive integer`);
    if (!(r.speed > 0 && r.top > 0 && r.radius > 0 && r.length > 0 && r.width > 0)) throw new Error(`rain "${name}": speed, top, radius, length and width must be positive`);
  }
  draws(ctx: CompileContext): Emitted {
    const r = this.r;
    const key = `rain.${this.name}`;
    const flash = emitShaderFn(ctx.slots, { name: `rain_${this.name}_flash`, args: [], out: "f32", roots: [lift<"f32">(r.flash)], ret: (v) => v[0] });
    // The fall line: down at `speed`, sideways with the wind; a streak is a piece of it `length` long.
    const dir = [r.wind[0], -r.speed, r.wind[1]], dl = Math.hypot(...dir);
    const code = /* wgsl */ `${flash.code}
${rainCommon(r, "rain")}
const FALL: vec3<f32> = vec3<f32>(${dir.map((x) => fl(x / dl)).join(", ")});
const FALL_LEN: f32 = ${fl((r.top * dl) / r.speed)};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) @interpolate(flat) fade: f32,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let clock = rain_clock(ii);
  let land = rain_land(ii, clock.x);
  // The drop's head: on the fall line ending at the landing point at the sea's mean level.
  let ground = vec3<f32>(land.x, 0.0, land.y);
  let head = ground - FALL * (FALL_LEN * (1.0 - clock.y));
  let tail = head - FALL * ${fl(r.length)};
  let mid = 0.5 * (head + tail);
  let f = view_dir(mid);
  let px = pixel_world(mid);
  let hw = max(${fl(r.width)}, 0.75 * px);
  let side = normalize(cross(FALL, f));
  let corner = vec2<f32>(select(0.0, 1.0, vi == 1u || vi == 2u || vi == 4u), select(-1.0, 1.0, vi == 2u || vi == 4u || vi == 5u));
  let p = mix(tail, head, corner.x) + side * (corner.y * hw);
  var out: VOut;
  out.world = p;
  out.clip = frame.view_proj * vec4<f32>(p, 1.0);
  out.uv = corner;
  // Fewer toward the shaft's edge (the landing weight), fading in below the cloud's base, out of sight under the sea;
  // a streak wider than its true width (far away) is fainter by the same ratio.
  let inShaft = exp(-2.0 * land.z * land.z);
  out.fade = inShaft * smoothstep(0.0, 0.12, clock.y) * (${fl(r.width)} / hw);
  return out;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  if (in.world.y < sea_height(in.world.xz)) { discard; }
  let along = sin(3.14159265 * clamp(in.uv.x, 0.0, 1.0));
  let across = 1.0 - in.uv.y * in.uv.y;
  let a = ${fl(r.opacity)} * in.fade * along * across;
  let c = vec3<f32>(${r.colour.map(fl).join(", ")}) * (1.0 + 2.5 * rain_${this.name}_flash());
  return vec4<f32>(min(c, vec3<f32>(1.0)), a);
}`;
    return {
      shaders: { [key]: { code, libs: flash.libs } },
      draws: [drawSpec({ label: this.name, shader: key, vertices: 6, instances: r.count, phase: "transparent", cull: "none", depthWrite: false, blend: "alpha" })],
    };
  }
}

class SplashDrawable implements Drawable {
  readonly skeletons: readonly Skeleton[] = [];
  readonly surfaces = [];
  constructor(readonly name: string, readonly r: RainSpec, readonly s: SplashSpec) {
    if (!(Number.isInteger(s.count) && s.count >= 1 && s.count <= r.count)) throw new Error(`splashes "${name}": count must be an integer in [1, rain count]`);
    if (!(s.radius > 0 && s.life > 0)) throw new Error(`splashes "${name}": radius and life must be positive`);
  }
  draws(): Emitted {
    const { r, s } = this;
    const key = `splash.${this.name}`;
    const code = /* wgsl */ `${rainCommon(r, "splash")}
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) @interpolate(flat) ring: vec4<f32>,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  // The ring of the previous cycle's landing: its age is the time since that landing.
  let clock = splash_clock(ii);
  let land = splash_land(ii, clock.x - 1.0);
  let age = clock.y * splash_PERIOD;
  var out: VOut;
  if (age > ${fl(s.life)}) {
    out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.world = vec3<f32>(0.0);
    out.ring = vec4<f32>(0.0);
    return out;
  }
  let grow = age / ${fl(s.life)};
  let radius = ${fl(s.radius)} * sqrt(grow);
  let c = vec2<f32>(land.x, land.y);
  let corner = vec2<f32>(select(-1.0, 1.0, vi == 1u || vi == 2u || vi == 4u), select(-1.0, 1.0, vi == 2u || vi == 4u || vi == 5u));
  let pad = radius + 0.1;
  let xz = c + corner * pad;
  out.world = vec3<f32>(xz.x, sea_height(xz), xz.y);
  out.clip = frame.view_proj * vec4<f32>(out.world, 1.0);
  out.ring = vec4<f32>(c, radius, (1.0 - grow) * (1.0 - grow) * exp(-2.0 * land.z * land.z));
  return out;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let fp = sea_footprint(in.world);
  let w = max(0.03 + 0.04 * in.ring.z, fp);
  let d = abs(distance(in.world.xz, in.ring.xy) - in.ring.z);
  let a = ${fl(s.opacity)} * in.ring.w * (1.0 - smoothstep(0.0, w, d)) * min(1.0, 0.04 / w);
  if (a <= 0.002) { discard; }
  return vec4<f32>(${s.colour.map(fl).join(", ")}, a);
}`;
    return {
      shaders: { [key]: { code, libs: [] } },
      draws: [drawSpec({ label: this.name, shader: key, vertices: 6, instances: s.count, phase: "on-water", cull: "none", depthWrite: false, blend: "alpha" })],
    };
  }
}

/**
 * Rain falling through a round shaft below a cloud: thin streaks, slanted by the wind, that stop at the ground. Drawn
 * by instancing: nothing is stored and the pattern never repeats.
 *
 * The shape and its law. Streak i falls on a loop of period top / speed, offset by a hash of i; in each loop (cycle c)
 * it is hashed to a landing point, at a radius r = radius sqrt(-ln(1 - 0.985 h)) from `centre` at a uniform angle (so
 * the streaks' density is a Gaussian of the distance from the centre, cut at about 2 radii). Its head moves along the
 * straight fall line (down at `speed`, sideways at `wind`) from height `top` to y = 0 at that point; the streak is the
 * `length` behind the head, a camera-facing quad faded at both ends and across, kept at least a pixel wide (fainter by
 * the ratio when widened), and cut where it is below the ground's surface (`sea_height`).
 *
 * Parameters: `flash` (extra brightness, e.g. a strike's flicker) takes an expression; everything else (`centre`,
 * `radius`, `top`, `count`, `speed`, `wind`, `length`, `width`, `colour`, `opacity`, `seed`) is a fixed number.
 *
 * What it cannot do, because of the law:
 * - start, stop or move: the shaft stands where it is at one strength (`count` and `opacity` are fixed), so a
 *   drifting storm or a passing shower is not this.
 * - gust: the fall line is straight and the same for every drop and every moment.
 * - land on bodies: a streak stops only at the ground's surface, never at a roof or anything else in its way.
 * - fill the sky: it is one round shaft; widespread rain is a large radius (and a large count) or several shafts.
 *
 * Going past it: `splashes` draws the rings the same streaks make where they land. Relatives, by the same generator
 * (an index hashed to a place, a loop in time, a new place each loop):
 * - fall speed near 0 and a wandering sideways drift: snow, ash, or seeds in the air.
 * - the loop running upward from the ground: sparks, bubbles, embers.
 * - landing points hashed over a surface instead of a disc: drips from a roof's edge, spray off a crest.
 */
export function rain(name: string, r: RainSpec): Drawable {
  return new RainDrawable(name, r);
}

/**
 * Rings where rain lands: for each of the first `count` streaks of the same `RainSpec`, the ring it made where it
 * landed at the end of its previous fall, laid on the ground's surface (it follows a swell), growing and fading.
 *
 * The shape and its law: a ring of age a (seconds since that landing, up to `life`) has radius radius sqrt(a / life),
 * the curve of a spreading ripple, and opacity opacity (1 - a / life)^2; its line is 0.03 + 0.04 radius wide (at
 * least a pixel's footprint, fainter when widened). The landings are the rain's own hashes, so every ring is under a
 * streak that just fell.
 *
 * Parameters: `count` (at most the rain's), `radius`, `life`, `colour` and `opacity`, fixed numbers; the rain's spec,
 * which fixes where and when.
 *
 * What it cannot do, because of the law:
 * - splash upward: it is a flat ring on the surface, no crown of droplets, no bounce.
 * - land on bodies or anything but the ground's surface (on `nothing` there is no surface to see them on).
 * - interact: rings overlap by drawing over each other, without interference or a wake.
 * - outlast the fall: a ring lives at most one fall period; a `life` longer than top / speed is cut short.
 *
 * Relatives: the same rings keyed by another generator (a fountain's landing points, fish rising) are a few lines of
 * WGSL on the same pattern; for one ring that carries things, `ringWave` deforms the sea itself.
 */
export function splashes(name: string, r: RainSpec, s: SplashSpec): Drawable {
  return new SplashDrawable(name, r, s);
}

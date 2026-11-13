// The sea: one of the grounds, and a chart, local (x, z, height above the surface), with a swell that moves in time;
// the water is drawn as a glazed `Surface` in that chart. The surface is a projected grid (`Detail` kind "projected"):
// cells of about SEA_CELL x `View.cellPixels` pixels laid over the image of the still water out to `reach`, each vertex
// the point of the still water its pixel sees, lifted to the swell there (exactly the height function at that point).
// Its cells are the same size on screen everywhere, so the far sea is no longer drawn with triangles far smaller than a
// pixel. It is evaluated on the GPU only, coloured per pixel by the style's `water`, with foam where the water meets
// any opaque body found from the scene's depth.
//
// Vertices move over the water as the camera moves (a projected grid "swims"). What that can change is small: colour,
// crest, foam and slope are evaluated per pixel at the interpolated point, and a point of the swell sampled anywhere
// is still on the swell; only the straight edges between vertices cut the crests, by at most A (pi c / L)^2 / 2 for
// cells c across a wave of length L and amplitude A (0.003 for a swell 2 units high and 40 long, at 1-unit cells).

import {
  add, cross, distance, gt, lift, max, mul, normalize, or, select, sin, smoothstep, sub, substitute, time, variable, vec2, vec3, type Expr, type In,
} from "../expr.ts";
import { gradient } from "../grad.ts";
import { CELL_PIXELS } from "../artefact.ts";
import type { Bakeable, CompileContext, Drawable, Emitted } from "../compile/context.ts";
import { drawGlazed, spacing, type Fragment, type SurfaceDrawable } from "../draw/surface.ts";
import type { Contact } from "../style.ts";
import { eyePosition, viewDir, wgslFn } from "../lib/wgsl.ts";
import { NO_SKELETON, type Chart, type F, type Frame, type Skeleton, type Surface } from "../map/types.ts";

export type SwellSpec = {
  /** Direction of travel in the xz plane (normalised here). */
  readonly direction: readonly [number, number];
  /** Wavelength, world units. */
  readonly length: number;
  /** Crest-to-trough height, world units. */
  readonly height: number;
  /** Phase speed, world units per second. */
  readonly speed: number;
  /** Phase offset, radians. Default 0. */
  readonly phase?: number;
};

/**
 * A deformation of the sea (a whirlpool, src/geom/whirlpool.ts): a map of the sea plane that is exactly the identity
 * outside its reach. The sea evaluates its swell, and the deformation its own marks, in the deformation's coordinates,
 * so everything on the water winds with it; the surface is also pushed down by `dip`.
 */
export interface SeaDeform {
  /** Where the water at sea-plane point xz (world x, z) at time t sits in the deformation's own plane coordinates. */
  toLocal(xz: Expr<"vec2">, t: In<"f32">): Expr<"vec2">;
  /** How far the surface is pushed down at sea-plane point xz at time t (0 outside the reach; below 0 raises it: a wave). */
  dip(xz: Expr<"vec2">, t: In<"f32">): F;
  /** The most it raises the surface above where it would be, world units (0 for one that only dips): the sea's grid keeps a margin for it. */
  readonly rise: number;
  /**
   * How much of the swell survives at sea-plane point xz, 0..1 (1 outside the reach). A whirlpool smooths the swell
   * toward its throat, where the swell wound into it would otherwise crowd below a pixel.
   */
  calm(xz: Expr<"vec2">): F;
  /**
   * Its marks on the water at sea-plane point xz, for a pixel footprint `fp` (world units): foam 0..1, and a shade
   * added to the swell's crest value (-1 trough .. 1 crest). Both 0 outside the reach. GPU or CPU. `lean`, if it has
   * one: the direction on the sea plane its foam leans (a ring wave's crest breaks outward); a style that prints the
   * foam as curled heads curls them that way.
   */
  look(xz: Expr<"vec2">, t: In<"f32">, fp: F): { readonly foam: F; readonly shade: F; readonly lean?: Expr<"vec2"> };
  /**
   * Whether sea-plane point xz is in its reach. Where this is false the deformation must be exactly nothing: `toLocal`
   * returns xz, `dip` 0, `calm` 1, `look` 0 and 0, bit for bit, so the sea may skip evaluating it there.
   */
  reaches(xz: Expr<"vec2">): Expr<"bool">;
}

export type SeaSpec = {
  readonly swell: readonly SwellSpec[];
  /** Deformations of the water, applied in order (each sees the previous one's coordinates). Default none. */
  readonly deform?: readonly SeaDeform[];
  /** How far the water is drawn, as view depth in world units. Default 400. */
  readonly reach?: number;
  /** Width of the foam band where the water meets a body, world units. Default 0.3. */
  readonly foam?: number;
};

/** One sinusoidal component, canonical: unit direction, wavenumber, amplitude, angular frequency, phase. */
type Wave = { readonly dir: readonly [number, number]; readonly k: number; readonly amp: number; readonly omega: number; readonly phase: number };

/** The free variable the sea's gradient is taken with respect to (then replaced by the point asked about). */
const SEA_XZ = variable("loft_sea_xz", "vec2");

/** Sea cells on screen, in units of `View.cellPixels`: shading is per pixel, so the cells carry only the swell's shape. */
const SEA_CELL = 2.25;

/**
 * The point of the still water (y = 0) that grid corner (u, v) of the projected grid sees: NDC x across the screen
 * widened by the host's margin, NDC y over the rows the host found meeting the water (src/host/detail.ts).
 * `LOFT_DETAIL_SLOT` is the sea draw's override; the host chose only rows whose rays meet the water ahead.
 */
const seaPlane = wgslFn<"vec2">({
  name: "loft_sea_plane", ret: "vec2", wgsl: /* wgsl */ `
fn loft_sea_plane(u: f32, v: f32) -> vec2<f32> {
  let rows = loft_detail[LOFT_DETAIL_SLOT];
  let m = loft_detail[LOFT_DETAIL_SLOT + 1u].x;
  let ndc = vec2<f32>(mix(-1.0 - m, 1.0 + m, u), mix(rows.z, rows.w, v));
  let a = frame.inv_view_proj * vec4<f32>(ndc, 0.0, 1.0);
  let b = frame.inv_view_proj * vec4<f32>(ndc, 1.0, 1.0);
  let o = a.xyz / a.w;
  let d = b.xyz / b.w - o;
  return (o + d * (-o.y / d.y)).xz;
}`,
});

/** Longest extent of one pixel's footprint on the sea at p (`sea_footprint` in sceneWgsl). */
const seaFootprint = wgslFn<"f32">({ name: "loft_sea_footprint", ret: "f32", wgsl: "fn loft_sea_footprint(p: vec3<f32>) -> f32 { return sea_footprint(p); }" });

/**
 * Tap offsets, in units of the band's width on screen: 8 round the outer edge, then 8 at 0.55 turned by half a step,
 * so the nearest-surface estimate has 16 directions (with 8 the foam's outer edge showed an 8-pointed star of streaks).
 */
const RING = Array.from({ length: 16 }, (_, k) => {
  const a = (k * Math.PI) / 4 + (k >= 8 ? Math.PI / 8 : 0), r = k >= 8 ? 0.55 : 1;
  return [r * Math.cos(a), r * Math.sin(a)];
});
const fl = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/**
 * How close the water at p (seen at pixel px) is to an opaque body, for a band `width` wide: 1 at the body, 0 at the
 * band's edge, below 0 beyond it. A sea pixel is near a body when some opaque surface lies within the band of it in
 * 3D: a ring of taps round the pixel, at the band's size on screen, finds the body on either side of the waterline
 * (behind the water and above it), so any opaque thing gets its waterline, at a cost per pixel that does not grow
 * with the scene. It reads the scene's depth, so it may only be called from a draw with `sceneDepth` (its definition
 * goes in that draw's module, not in sceneWgsl).
 */
const contactBand = wgslFn<"f32">({
  name: "loft_contact_band", ret: "f32", wgsl: /* wgsl */ `
const LOFT_FOAM_RING = array<vec2<f32>, 16>(${RING.map(([x, y]) => `vec2<f32>(${fl(+x.toFixed(6))}, ${fl(+y.toFixed(6))})`).join(", ")});
fn loft_contact_band(p: vec3<f32>, px: vec2<f32>, width: f32) -> f32 {
  // The band's width on screen; at least a pixel (far away), at most 40 (a body filling the view).
  let r = clamp(width / pixel_world(p), 1.0, 40.0);
  // The ring turns from pixel to pixel (interleaved gradient noise, fixed in screen space): a fixed ring overestimates
  // the gap between its directions and drew radial streaks out of the band's edge; a turning one leaves fine grain.
  let turn = 6.2831853 * fract(52.9829189 * fract(dot(floor(px), vec2<f32>(0.06711056, 0.00583715))));
  let rot = mat2x2<f32>(cos(turn), sin(turn), -sin(turn), cos(turn));
  var gap = distance(scene_position(px), p);
  for (var k = 0u; k < 8u; k++) { gap = min(gap, distance(scene_position(px + rot * LOFT_FOAM_RING[k] * r), p)); }
  // Only near a body is the inner ring worth reading.
  if (gap < 2.0 * width) {
    for (var k = 8u; k < 16u; k++) { gap = min(gap, distance(scene_position(px + rot * LOFT_FOAM_RING[k] * r), p)); }
  }
  return 1.0 - gap / width;
}`,
});

/**
 * The same closeness as `loft_contact_band` (1 at a body, 0 at `width`, below 0 beyond), measured so that a style can
 * cut clean shapes from it. The band's ring turns by a hashed angle at every pixel and has two radii, so it is grainy
 * (a pixel whose ring misses a thin leg reads "nothing near" beside one whose ring hits it) and it sits on two
 * plateaus (a hit on the inner ring, a hit on the outer). Here, with four more reads near a body than the band's 17:
 *  - the four pixels of a 2 x 2 quad turn the ring by four fixed quarter steps and share what they find (the least gap
 *    of the four, taken with two fine derivatives): 32 directions a radius, no hash, so no grain and no holes round a
 *    body four pixels wide or more. The value is one per quad;
 *  - four more taps along the direction of the nearest hit, at radii that also differ by the pixel of the quad (16
 *    radii a quad), find the body's nearest edge that way, so the gap falls smoothly as the body nears instead of
 *    stepping from one ring to the other (the inner ring is read only where the scene's clearance says it can see
 *    something, these only after a hit: 9 reads far from a body, 21 near one);
 *  - the quad's one gap is then tilted across its four pixels toward that hit (a pixel nearer the body by one pixel is
 *    nearer by one pixel's world size), so the level changes from pixel to pixel as a distance does and an edge cut
 *    from it is antialiased like any other, not stepped in twos.
 * It returns the level in x and, in y and z, the unit direction across the water (world x, z) from this water to the
 * body point that was nearest: the way the level rises, for a style that needs the level a little way off (level there
 * = level here + offset . direction / width, to first order) or a side to lean to. Zero where there is none.
 * Every tap is within the band's reach of the pixel, so wherever the sea's `clear` case holds the level is below 0 too. It
 * takes derivatives of values all four pixels of the quad computed: only in a draw whose case is constant on each quad
 * (the sea's), and only with `sceneDepth`.
 */
const contactLevel = wgslFn<"vec3">({
  name: "loft_contact_level", ret: "vec3", wgsl: /* wgsl */ `
const LOFT_LEVEL_RING = array<vec2<f32>, 16>(${RING.map(([x, y]) => `vec2<f32>(${fl(+x.toFixed(6))}, ${fl(+y.toFixed(6))})`).join(", ")});
/// How far the water at p is from the body point q, for the level: across the water in full; up and down, nothing for
/// the first quarter of the width and double beyond it. A tap that lands a little way up a leg or a cliff (or down
/// its sunk part) then reads the distance to where that body stands in the water, whichever height it landed at, so
/// the level does not step with the taps' spacing; and a body well above the water (a belly, a raised claw) is far.
fn loft_level_gap(q: vec3<f32>, p: vec3<f32>, width: f32) -> f32 {
  let d = q - p;
  let up = 2.0 * max(abs(d.y) - 0.25 * width, 0.0);
  return sqrt(dot(d.xz, d.xz) + up * up);
}
@diagnostic(off, derivative_uniformity)
fn loft_contact_level(p: vec3<f32>, px: vec2<f32>, width: f32) -> vec3<f32> {
  let r = clamp(width / pixel_world(p), 1.0, 40.0);
  // Which pixel of its quad this is: 0 or 1 each way, 0..3 together.
  let cell = floor(px) - 2.0 * floor(floor(px) * 0.5);
  let m = cell.x + 2.0 * cell.y;
  let turn = m * (6.2831853 / 32.0);
  let rot = mat2x2<f32>(cos(turn), sin(turn), -sin(turn), cos(turn));
  // Capped, so the differences below are exact enough where a tap reads the far plane.
  let under = scene_position(px);
  var gap = min(loft_level_gap(under, p, width), 4.0 * width);
  var toward = vec2<f32>(0.0);
  // Where the nearest body point found lies from this water, across the water (world x, z).
  var reach = (under - p).xz;
  for (var k = 0u; k < 8u; k++) {
    let v = rot * LOFT_LEVEL_RING[k] * r;
    let q = scene_position(px + v);
    let g = loft_level_gap(q, p, width);
    if (g < gap) { gap = g; toward = v; reach = (q - p).xz; }
  }
  // The inner ring is read only where it can see something: where the scene's clearance (a lower bound on the distance
  // to any opaque pixel) is within its reach. Elsewhere every one of its taps reads the far plane, so skipping it
  // changes nothing; most of the pixels this runs on are such, and their cost is their reads. (Skipping it as the band
  // does, when the outer ring found nothing near, was tried: a pointed foot inside the outer ring lost its foam.)
  if (scene_clearance(px) <= 0.55 * r + 1.0) {
    for (var k = 8u; k < 16u; k++) {
      let v = rot * LOFT_LEVEL_RING[k] * r;
      let q = scene_position(px + v);
      let g = loft_level_gap(q, p, width);
      if (g < gap) { gap = g; toward = v; reach = (q - p).xz; }
    }
  }
  // Along the nearest hit, if a ring had one (with none there is no direction to look in).
  if (dot(toward, toward) > 0.0) {
    let ray = toward;
    for (var k = 0u; k < 4u; k++) {
      let v = ray * ((f32(k) + (m + 0.5) * 0.25) * 0.25);
      let q = scene_position(px + v);
      let g = loft_level_gap(q, p, width);
      if (g < gap) { gap = g; toward = v; reach = (q - p).xz; }
    }
  }
  // The least gap of the quad, and the offset of the tap that found it. A fine derivative is (the right pixel) - (the
  // left) for both pixels of a pair, so the other pixel's value is this one's plus or minus it: plus on the left
  // pixel. Which pixel is the left one is read from the derivative of the parity itself, so nothing is assumed about
  // where quads start. The offset is from its own pixel: re-based to the quad's middle here.
  let from_mid = cell - vec2<f32>(0.5);
  let hit = toward + from_mid;
  let sx = select(-1.0, 1.0, (dpdxFine(cell.x) > 0.0) == (cell.x < 0.5));
  let gx = gap + sx * dpdxFine(gap);
  let hx = hit + sx * dpdxFine(hit);
  let rx = reach + sx * dpdxFine(reach);
  let pair_gap = min(gap, gx);
  let pair_hit = select(hit, hx, gx < gap);
  let pair_reach = select(reach, rx, gx < gap);
  let sy = select(-1.0, 1.0, (dpdyFine(cell.y) > 0.0) == (cell.y < 0.5));
  let gy = pair_gap + sy * dpdyFine(pair_gap);
  let hy = pair_hit + sy * dpdyFine(pair_hit);
  let ry = pair_reach + sy * dpdyFine(pair_reach);
  let quad_gap = min(pair_gap, gy);
  let quad_hit = select(pair_hit, hy, gy < pair_gap);
  let quad_reach = select(pair_reach, ry, gy < pair_gap);
  // Tilted toward the hit: this pixel's place in the quad, along the unit direction from the quad's middle to the hit.
  let d = length(quad_hit);
  let tilt = select(0.0, dot(from_mid, quad_hit) / max(d, 1e-6), d > 0.75);
  // The unit direction to that body point across the water; none (zero) where it is right under this water or far.
  let far = length(quad_reach);
  let dir = select(vec2<f32>(0.0), quad_reach / max(far, 1e-6), far > 0.02 * width && quad_gap < 3.9 * width);
  return vec3<f32>(1.0 - (quad_gap - tilt * pixel_world(p)) / width, dir);
}`,
});

/**
 * Foam from the contact band, 0..1, antialiased by the pixel footprint fp: full at the body, gone at the foam width;
 * the threshold wobbles slowly so the edge reads as lapping foam.
 */
const contactFoam = wgslFn<"f32">({
  name: "loft_contact_foam", ret: "f32", wgsl: /* wgsl */ `
fn loft_contact_foam(p: vec3<f32>, band: f32, fp: f32, width: f32) -> f32 {
  let t = frame.time.x;
  let wobble = 0.12 * sin(p.x * 2.3 + t * 1.9) * sin(p.z * 2.9 - t * 1.4);
  let aa = max(fp / width, 1e-3);
  let core = smoothstep(0.42 + wobble - aa, 0.42 + wobble + aa, band);
  let fringe = smoothstep(0.12 + wobble - aa, 0.12 + wobble + aa, band);
  return core * 0.85 + fringe * 0.15;
}`,
});

/**
 * 1 where the contact band at p (seen at pixel px) may see an opaque surface, 0 where it cannot: its taps reach at most
 * r from px (r as in loft_contact_band), so the texels they read have centres within r + 0.71 of px; where the scene's
 * clearance (SCENE_CLEARANCE_WGSL, a lower bound on the distance to any opaque pixel) exceeds r + 1, none of them is
 * opaque and the band is 1 - (distance to the far plane) / width, below -800 in every camera. Same constraint as
 * loft_contact_band: only in a draw with `sceneDepth`.
 */
const seaNear = wgslFn<"f32">({
  name: "loft_sea_near", ret: "f32", wgsl: /* wgsl */ `
fn loft_sea_near(p: vec3<f32>, px: vec2<f32>, width: f32) -> f32 {
  return select(1.0, 0.0, scene_clearance(px) > clamp(width / pixel_world(p), 1.0, 40.0) + 1.0);
}`,
});

/**
 * The larger of x (0 or 1) over the pixel's 2 x 2 quad, so a choice made from it is the same on all four pixels. Each
 * fine derivative is the difference between the two pixels of a pair: x + |dx| is the pair's larger, then down the
 * column the same. Fragment stage, in uniform control flow.
 */
const quadMax = wgslFn<"f32">({
  name: "loft_quad_max", ret: "f32", wgsl: /* wgsl */ `
fn loft_quad_max(x: f32) -> f32 {
  let a = min(x + abs(dpdxFine(x)), 1.0);
  return min(a + abs(dpdyFine(a)), 1.0);
}`,
});

/**
 * The cases the water is drawn in, per 2 x 2 quad (docs/gpu_native.md "The sea"): whether a body may be near (the
 * contact band and the style's contact foam are computed only then), and whether any deformation reaches the water
 * (a whirlpool's map and marks are evaluated only then). Elsewhere what is skipped is exactly 0 or the identity.
 */
type ContactCase = Contact["kind"];
type ReachCase = "open" | "deformed";
const CONTACT_CASES: readonly ContactCase[] = ["clear", "near"];

/**
 * A sea, made by `sea`: at once a ground that draws itself (kind "sea", the moving, see-through one beside `plane` and
 * `nothing`) and a chart, (x, z, height above the surface), so things are placed on the water by its coordinates. What
 * a user reads off it: `height(xz, t)` and `gradient(xz, t)` of the surface (expressions, GPU or CPU), `frame(c)` (the
 * point and the water's tilted frame there), `local(xz, t)` (where water at xz sits in its deformations' coordinates)
 * and `at(t)` (the chart frozen at time t). It cannot overhang: the surface is a height over each point of the plane,
 * one sheet, so a crest never curls over a trough.
 */
export class Sea implements Chart, Drawable {
  /** One kind of ground (src/draw/ground.ts): the one that moves and is see-through. */
  readonly kind = "sea";
  readonly name = "sea";
  readonly skeletons: readonly Skeleton[] = [];
  /** The water follows the camera and reads the scene's depth: nothing to bake. */
  readonly surfaces: readonly Bakeable[] = [];
  private readonly drawn: SurfaceDrawable;

  constructor(readonly waves: readonly Wave[], readonly reach: number, readonly foam: number, readonly deforms: readonly SeaDeform[] = []) {
    // Transparent: what shows through the water is the submerged body (tinted by its own shader) or, where nothing
    // is below, the sky shader's under-horizon colour. The host sizes the grid to the screen each frame; the counts
    // here are only its declared size (`stats.maxTriangles`): what it draws at 1280 x 800 with water to every edge.
    const lift = waves.reduce((a, w) => a + w.amp, 0) + deforms.reduce((a, d) => a + d.rise, 0);
    const declared = (pixels: number) => Math.ceil((pixels * 1.1) / (SEA_CELL * CELL_PIXELS));
    // Case index: contact (clear 0, near 1) + 2 x reach (open 0, deformed 1); a sea with no deformation is always open.
    const reaches: readonly ReachCase[] = deforms.length > 0 ? ["open", "deformed"] : ["open"];
    const cases = reaches.flatMap((r) => CONTACT_CASES.map((c) => (fr: Fragment) => this.water(fr, c, r)));
    this.drawn = drawGlazed("sea", this.surface(), {
      colour: { kind: "cases", choose: (fr) => this.choose(fr), cases },
      grid: { u: spacing.even(declared(1280)), v: spacing.even(declared(800)) }, phase: "water", sceneDepth: true,
      detail: { kind: "projected", cell: SEA_CELL, plane: 0, reach, lift },
    });
  }

  draws(ctx: CompileContext): Emitted { return this.drawn.draws(ctx); }

  private phaseOf(w: Wave, xz: Expr<"vec2">, t: In<"f32">): F {
    return add(sub(mul(add(mul(xz.x, w.dir[0]), mul(xz.y, w.dir[1])), w.k), mul(t, w.omega)), w.phase);
  }

  /** The swell alone, in the plane coordinates it is evaluated in (the deformations' local coordinates). */
  private swellAt(xz: Expr<"vec2">, t: In<"f32">): F {
    return this.waves.reduce<F>((h, w) => add(h, mul(sin(this.phaseOf(w, xz, t)), w.amp)), lift<"f32">(0));
  }

  /** Where the water at a sea-plane point sits in the last deformation's coordinates (xz itself with none). */
  local(xz: Expr<"vec2">, t: In<"f32"> = time): Expr<"vec2"> {
    return localIn(this.deforms, xz, t);
  }

  /** The swell where the water at xz came from, calmed by the deformations (their dips not taken off). */
  private calmed(deforms: readonly SeaDeform[], xz: Expr<"vec2">, t: In<"f32">): F {
    return deforms.reduce<F>((h, d) => mul(h, d.calm(xz)), this.swellAt(localIn(deforms, xz, t), t));
  }

  private heightIn(deforms: readonly SeaDeform[], xz: Expr<"vec2">, t: In<"f32">): F {
    return deforms.reduce<F>((h, d) => sub(h, d.dip(xz, t)), this.calmed(deforms, xz, t));
  }

  /** Surface height at a point of the xz plane: the swell where that water came from, less every deformation's dip. */
  height(xz: Expr<"vec2">, t: In<"f32"> = time): F {
    return this.heightIn(this.deforms, xz, t);
  }

  private gradientIn(deforms: readonly SeaDeform[], xz: Expr<"vec2">, t: In<"f32">): Expr<"vec2"> {
    const g = gradient(this.heightIn(deforms, SEA_XZ, t), SEA_XZ);
    return substitute([g], SEA_XZ, xz)[0] as Expr<"vec2">;
  }

  /**
   * d(height)/dx and d(height)/dz. Symbolic (src/grad.ts) through the deformations' maps, which no hand-written
   * gradient could follow; with none, it reduces to the swell's analytic gradient (the constructors simplify).
   */
  gradient(xz: Expr<"vec2">, t: In<"f32"> = time): Expr<"vec2"> {
    return this.gradientIn(this.deforms, xz, t);
  }

  /** Floating on the open sea: a point given in sea coordinates is where it is and has not turned (afloat.ts). */
  carry(at: Expr<"vec2">): { readonly xz: Expr<"vec2">; readonly turn: F } {
    return { xz: at, turn: lift<"f32">(0) };
  }

  /** (x, z, height above the surface) to the point and a frame there: y the water's normal, x along +x on the slope. */
  frame(c: Expr<"vec3">): Frame {
    const xz = vec2(c.x, c.y), g = this.gradient(xz);
    const x = normalize(vec3(1, g.x, 0)), y = normalize(vec3(mul(g.x, -1), 1, mul(g.y, -1)));
    return { o: vec3(c.x, add(this.height(xz), c.z), c.y), x, y, z: cross(x, y) };
  }

  at(t: F): Chart {
    const slice = (fr: Frame): Frame => { const [o, x, y, z] = substitute([fr.o, fr.x, fr.y, fr.z], time, t) as Expr<"vec3">[]; return { o, x, y, z }; };
    return { frame: (c) => slice(this.frame(c)), at: (t2) => this.at(t2), atNear: (t2) => this.at(t2) };
  }
  atNear(t: F): Chart { return this.at(t); }

  /** The water: the projected grid (seaPlane), laid in this chart at height 0. */
  private surface(): Surface {
    const xz = (u: F, v: F) => seaPlane(u, v);
    return {
      point: (u, v) => { const p = xz(u, v); return this.frame(vec3(p.x, p.y, 0)).o; },
      normal: (u, v) => { const p = xz(u, v); return this.frame(vec3(p.x, p.y, 0)).y; },
      anchor: (u, v) => vec3(u, v, 0), // the water follows the camera: nothing of it is fixed but its grid
      topology: { u: ["free", "free"], v: "free" },
      skeleton: NO_SKELETON,
    };
  }

  /** The phase of the largest swell at xz, in cycles (0 everywhere for a sea without swell: it has no crests). */
  private dominantPhase(xz: Expr<"vec2">): F {
    const w = this.waves.reduce<Wave | undefined>((best, v) => (best === undefined || v.amp > best.amp ? v : best), undefined);
    return w === undefined ? lift<"f32">(0) : mul(this.phaseOf(w, xz, time), 1 / (2 * Math.PI));
  }

  /** The direction the largest swell travels (zero for a sea without swell). */
  private dominantDirection(): Expr<"vec2"> {
    const w = this.waves.reduce<Wave | undefined>((best, v) => (best === undefined || v.amp > best.amp ? v : best), undefined);
    return w === undefined ? vec2(0, 0) : vec2(w.dir[0], w.dir[1]);
  }

  /**
   * Which case a quad of water is drawn in (index into the cases built in the constructor): near if any pixel of the
   * quad may see a body, deformed if any is in a deformation's reach. The same on all four pixels (quadMax), so every
   * derivative inside a case reads pixels that ran it.
   */
  private choose(fr: Fragment): F {
    const near = quadMax(seaNear(fr.world, fr.px, this.foam));
    if (this.deforms.length === 0) return near;
    const xz = fr.world.xz;
    const inReach = this.deforms.map((d) => d.reaches(xz)).reduce((a, b) => or(a, b));
    return add(near, mul(quadMax(select(inReach, 1, 0)), 2));
  }

  /**
   * The water's colour at a pixel in one case: the style's `water`, with the swell's slope and crest, contact foam
   * where a body may be near, and the deformations' marks where they reach. Outside those cases what is left out is
   * exactly nothing (Contact "clear"; SeaDeform.reaches), so every case equals the whole where it runs.
   */
  private water(fr: Fragment, contactCase: ContactCase, reach: ReachCase): Expr<"vec4"> {
    const deforms = reachedBy(this.deforms, reach);
    const amplitude = Math.max(this.waves.reduce((a, w) => a + w.amp, 0), 1e-3);
    const shortest = this.waves.reduce((l, w) => Math.min(l, (2 * Math.PI) / w.k), 1e3);
    const xz = fr.world.xz;
    const fp = seaFootprint(fr.world);
    // Where a pixel covers a good part of the shortest wave, its slope and crest shading can only alias (bands of
    // stripes toward the horizon): fade that detail out by the pixel's footprint.
    const detail = sub(1, smoothstep(0.04, 0.2, fp.div(shortest)));
    const g = mul(this.gradientIn(deforms, xz, time), detail);
    // The deformations' marks, each in its own coordinates (foam arms winding into a whirlpool, a darker throat).
    const marks = deforms.map((d) => d.look(xz, time, fp));
    const swell = this.calmed(deforms, xz, time);
    const contact = this.contactAt(fr, contactCase);
    return fr.style.water({
      normal: normalize(vec3(mul(g.x, -1), 1, mul(g.y, -1))),
      sun: lift<"vec3">(fr.sun),
      view: mul(viewDir(fr.world), -1),
      world: fr.world,
      // Per pixel, not the interpolated vertex height: far grid cells are large and their edges would show. The crest
      // is the swell's alone (where the water came from); a dip is shading the deformation chooses, not a trough.
      crest: marks.reduce<F>((c, m) => add(c, m.shade), mul(swell.div(amplitude), detail)),
      distance: distance(fr.world, eyePosition()),
      foam: marks.reduce<F>((f, m) => max(f, m.foam), this.contactFoamOf(fr, contact, fp)),
      contact,
      marks: marks.reduce<F>((f, m) => max(f, m.foam), lift<"f32">(0)),
      // The lean of a deformation that has one, where it marks the water (the last such, should two overlap).
      marksLean: marks.reduce<Expr<"vec2">>((l, m) => (m.lean === undefined ? l : select(gt(m.foam, 0), m.lean, l)), vec2(0, 0)),
      swell: this.dominantDirection(),
      phase: this.dominantPhase(xz),
    });
  }

  private contactAt(fr: Fragment, c: ContactCase): Contact {
    switch (c) {
      case "clear": return { kind: "clear" };
      case "near": {
        const level = contactLevel(fr.world, fr.px, this.foam);
        return { kind: "near", band: contactBand(fr.world, fr.px, this.foam), level: level.x, toward: vec2(level.y, level.z), width: this.foam };
      }
    }
  }

  /** The sea's own shaping of the band into foam; 0 where no body is near (the band there is far below its edges). */
  private contactFoamOf(fr: Fragment, c: Contact, fp: F): F {
    switch (c.kind) {
      case "clear": return lift<"f32">(0);
      case "near": return contactFoam(fr.world, c.band, fp, this.foam);
    }
  }
}

/** Where the water at a sea-plane point sits in the last of these deformations' coordinates (xz itself with none). */
function localIn(deforms: readonly SeaDeform[], xz: Expr<"vec2">, t: In<"f32">): Expr<"vec2"> {
  return deforms.reduce((p, d) => d.toLocal(p, t), xz);
}

/** The deformations a case evaluates: none in the open sea (where every one is exactly nothing), all of them else. */
function reachedBy(deforms: readonly SeaDeform[], r: ReachCase): readonly SeaDeform[] {
  switch (r) {
    case "open": return [];
    case "deformed": return deforms;
  }
}

/**
 * A moving water surface over the xz plane: a sum of travelling sine waves, deformed by maps of the plane. One of the
 * grounds a scene stands on, beside `plane` (still and opaque) and `nothing`; and a chart things are placed in.
 *
 * The shape and its law. Each swell i has a unit direction d_i, wavenumber k_i = 2 pi / length, amplitude
 * a_i = height / 2 and angular frequency w_i = k_i speed, and the still surface is
 *   h(x, t) = sum_i a_i sin(k_i d_i . x - w_i t + phase_i).
 * Each deformation D (applied in order) moves where the water is read: h is evaluated at D.toLocal(x, t), multiplied by
 * D.calm(x), and lowered by D.dip(x, t). Height, slope (symbolic, through the deformations) and the frame at a point
 * all come from that one expression, so what floats on it sits exactly on what is drawn.
 *
 * Parameters: the swells (`direction`, `length`, `height`, `speed`, `phase`), `reach` and `foam` are fixed numbers at
 * build; the motion is time in the law, not changing parameters. Deformations bring their own (a `whirlpool`'s, a
 * `ringWave`'s).
 *
 * What it cannot do, because of that law:
 * - sharp crests and wide troughs: a sum of sines is as round on top as below, and points only rise and fall, never
 *   move sideways (no trochoidal, Gerstner, profile).
 * - break, curl or overhang: the surface is a height over each point of the plane.
 * - keep wave speed and length physically tied: `speed` is free, so short waves may outrun long ones; deep water would
 *   have speed = sqrt(g length / 2 pi).
 * - change in time other than travelling: a swell does not grow, die out, or turn, and never ends at a shore.
 * - depth: there is no bottom and nothing beneath the surface but what shows through it.
 *
 * Going past it: a `SeaDeform` of your own (any map of the plane that is the identity outside its reach, with its dip,
 * calm and marks) bends the water without touching the swell; the sea's `height`, `gradient` and `frame` follow it.
 * Relatives, each by changing one tie in the law:
 * - move points sideways as well as up, x' = x + sum_i d_i a_i cos(phase_i): Gerstner waves, sharp crests and flat
 *   troughs (they fold over themselves once k a passes 1).
 * - tie speed to length by the dispersion relation, w_i = sqrt(g k_i): a group of swells then disperses as real water.
 * - an amplitude that is a function of x (a slow envelope): a swell that fades behind a headland or grows over a shoal.
 * - a radially symmetric deformation in closed form: `whirlpool` (a twist and an inward drift, integrated exactly) and
 *   `ringWave` (one crest and its trough running outward).
 */
export function sea(spec: SeaSpec): Sea {
  const waves = spec.swell.map((s, i): Wave => {
    const l = Math.hypot(s.direction[0], s.direction[1]);
    if (!(l > 0)) throw new Error(`sea: swell ${i} has a zero direction`);
    if (!(s.length > 0)) throw new Error(`sea: swell ${i} needs a positive length, got ${s.length}`);
    const k = (2 * Math.PI) / s.length;
    return { dir: [s.direction[0] / l, s.direction[1] / l], k, amp: s.height / 2, omega: k * s.speed, phase: s.phase ?? 0 };
  });
  const foam = spec.foam ?? 0.3;
  if (!(foam > 0)) throw new Error(`sea: foam width must be positive, got ${foam}`);
  return new Sea(waves, spec.reach ?? 400, foam, spec.deform ?? []);
}

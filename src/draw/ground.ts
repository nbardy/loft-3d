// What a scene stands on (DESIGN.md 13): a sea, a plane, or nothing.
//
// The ground is the surface every shader knows by `sea_height(xz)`: depth below it tints a submerged body, shadows
// are lifted along the sun onto it, rain and the shadow block stop at it, a fog bank ends on it. A sea is the ground
// that moves and is see-through (src/geom/sea.ts). The plane is the still surface y = 0, drawn opaque in the style's
// `ground` colour. Nothing is no surface: its height is `BOTTOMLESS`, far below anything drawn, so every consumer of
// `sea_height` sees every point above the ground (none tinted, discarded or splashed) without asking which ground it is.
//
// What it cannot do: a plane has no height, extent or colour of its own (move the things; draw a table top as a thing;
// the colour is the style's). A ground that is neither flat nor a sea (terrain) is not a kind here: it would be a
// fourth variant with its own height function, drawn as a glazed surface, and every dispatcher below would name it.

import { lift, type Expr, type In } from "../expr.ts";
import { drawSpec, type Drawable } from "../compile/context.ts";
import type { Sea } from "../geom/sea.ts";
import type { F } from "../map/types.ts";

/** The flat ground y = 0, to the horizon, in the style's ground colour (`Style.ground`), taking cast shadows. */
export type Plane = Drawable & { readonly kind: "plane" };
/** No ground: the things hang in the style's sky (its horizon colour below the horizon); no cast shadows. */
export type Nothing = Drawable & { readonly kind: "nothing" };
/** What `scene({ ground })` takes. */
export type Ground = Sea | Plane | Nothing;

/** The height of nothing: far below anything drawn (depth below it is negative everywhere a body can be). */
export const BOTTOMLESS = -1e9;

/** A thing that needs a particular ground, in a scene that stands on another. */
export class GroundError extends Error {
  constructor(who: string, needs: string, ground: Ground["kind"]) {
    super(`${who} needs ${needs}; this scene's ground is ${ground === "nothing" ? "nothing" : `a ${ground}`}. Fix: ${needs === "a sea" ? "ground: sea({ swell: [...] })" : "ground: plane or ground: sea({ swell: [...] })"}, or take ${who} out of the scene`);
    this.name = "GroundError";
  }
}

/** The ground's height at a point of the xz plane (what shaders call `sea_height`): the swell, 0, or `BOTTOMLESS`. */
export function levelOf(ground: Ground): (xz: Expr<"vec2">, t?: In<"f32">) => F {
  switch (ground.kind) {
    case "sea": return (xz, t) => ground.height(xz, t);
    case "plane": return () => lift<"f32">(0);
    case "nothing": return () => lift<"f32">(BOTTOMLESS);
  }
}

/** The ground's surface, for what lies on it (a telegraph): a sea or a plane; nothing has no surface. */
export function surfaceOf(ground: Ground, who: string): (xz: Expr<"vec2">, t?: In<"f32">) => F {
  switch (ground.kind) {
    case "sea": case "plane": return levelOf(ground);
    case "nothing": throw new GroundError(who, "a surface to lie on (a sea or a plane)", ground.kind);
  }
}

/** The ground as a sea, for what only water does (a wake). */
export function seaOf(ground: Ground, who: string): Sea {
  switch (ground.kind) {
    case "sea": return ground;
    case "plane": case "nothing": throw new GroundError(who, "a sea", ground.kind);
  }
}

// One full-screen triangle, as the sky is. Each pixel's ray meets y = 0 in closed form and writes that point's depth
// for the depth test (the pass writes none), so a body in front hides the plane and anything below it is covered.
// Beyond the far plane the depth is held just inside it (the colour is still the true point's: fogged to the horizon).
const PLANE_WGSL = /* wgsl */ `
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};
struct GOut { @location(0) colour: vec4<f32>, @builtin(frag_depth) depth: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let xy = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var out: VOut;
  out.clip = vec4<f32>(xy, 0.5, 1.0);
  out.ndc = xy;
  return out;
}
@fragment fn fs(in: VOut) -> GOut {
  let a = frame.inv_view_proj * vec4<f32>(in.ndc, 0.0, 1.0);
  let b = frame.inv_view_proj * vec4<f32>(in.ndc, 1.0, 1.0);
  let o = a.xyz / a.w;
  let d = b.xyz / b.w - o;
  let s = -o.y / d.y;
  // Looking away from the plane (or along it): the sky shows. Written so a NaN from d.y = 0 also discards.
  if (!(s > 0.0)) { discard; }
  let p = o + d * s;
  let clip = frame.view_proj * vec4<f32>(p, 1.0);
  var out: GOut;
  out.depth = clamp(clip.z / clip.w, 0.0, 0.99999);
  out.colour = vec4<f32>(ground_colour(p, -view_dir(p), distance(p, frame.eye.xyz), 0.0), 1.0);
  return out;
}`;

/**
 * The ground choice for a flat floor at y = 0 that runs to the horizon, in the style's ground colour and receiving
 * cast shadows; `scene({ ground: plane })`.
 */
export const plane: Plane = {
  kind: "plane",
  name: "ground",
  skeletons: [],
  surfaces: [],
  draws: () => ({
    shaders: { ground: { code: PLANE_WGSL, libs: [] } },
    draws: [drawSpec({ label: "ground", shader: "ground", vertices: 3, phase: "water", cull: "none", depthWrite: false })],
  }),
};

/**
 * The ground choice for no floor at all: things hang in the style's sky and cast no shadows; `scene({ ground: nothing
 * })`.
 */
export const nothing: Nothing = {
  kind: "nothing",
  name: "ground",
  skeletons: [],
  surfaces: [],
  draws: () => ({ shaders: {}, draws: [] }),
};

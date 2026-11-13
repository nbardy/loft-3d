// The WGSL every shader shares (`Artefact.sceneWgsl`): the tables' bindings and accessors, the ground's height field
// (`sea_height`, whatever the ground: src/draw/ground.ts), the style's functions and small helpers. Module-scope WGSL is order-independent, so the parts are simply concatenated.

import { lift, variable, vec2, type Expr } from "../expr.ts";
import { levelOf, type Ground } from "../draw/ground.ts";
import { shadeVariables, type Style } from "../style.ts";
import { sunDir, type Sun } from "../sun.ts";
import { emitFn, type Slots } from "./bind.ts";

export const lit = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));
export const vec3Lit = (v: readonly number[]): string => `vec3<f32>(${v.map(lit).join(", ")})`;

/** The style's and the ground's functions. Emitted once, before the drawables' shared code is collected. */
export function styleWgsl(slots: Slots, style: Style, ground: Ground, sun: readonly [number, number, number], at: Sun): string {
  const c = <T extends "f32" | "vec3">(name: string, ty: T) => variable(`c_${name}`, ty);
  const shadeCtx = shadeVariables(sunDir(at));
  // A style that prints its shadow as a block afterwards (`Style.block`) gives the bodies its colour before the block;
  // `style.shade` stays the whole colour for whatever shades a fragment on its own (a smear).
  const body = style.block === undefined ? style.shade(shadeCtx) : style.block.body(shadeCtx);
  const shadeArgs = [["c_base", "vec3"], ["c_normal", "vec3"], ["c_view", "vec3"], ["c_world", "vec3"], ["c_depth", "f32"], ["c_uv", "vec2"], ["c_anchor", "vec3"], ["c_id", "f32"]] as const;
  const layerCtx = { world: c("world", "vec3"), view: c("view", "vec3"), distance: c("distance", "f32"), amount: c("amount", "f32") };
  const layerArgs = [["c_world", "vec3"], ["c_view", "vec3"], ["c_distance", "f32"], ["c_amount", "f32"]] as const;
  const xz = variable("xz", "vec2");
  // What the ground's surface is coloured by where a shadow lies on it: the sea's shadow layer (blended over the water),
  // or the plane's own colour at the shadow's coverage (src/draw/shadows.ts); nothing has no surface to colour.
  const onGround = (): string[] => {
    switch (ground.kind) {
      case "sea": return [emitFn(slots, "sea_shadow", layerArgs, "vec4<f32>", [style.shadow(layerCtx)], (v) => v[0])];
      case "plane": {
        const groundCtx = { world: c("world", "vec3"), view: c("view", "vec3"), distance: c("distance", "f32"), sun: lift<"vec3">(sunDir(at)), shadow: c("shadow", "f32") };
        return [emitFn(slots, "ground_colour", [["c_world", "vec3"], ["c_view", "vec3"], ["c_distance", "f32"], ["c_shadow", "f32"]], "vec3<f32>", [style.ground(groundCtx)], (v) => v[0])];
      }
      case "nothing": return [];
    }
  };
  const gradient = (): Expr<"vec2"> => {
    switch (ground.kind) {
      case "sea": return ground.gradient(xz);
      case "plane": case "nothing": return vec2(0, 0);
    }
  };
  return [
    `const SUN: vec3<f32> = ${vec3Lit(sun)};`,
    emitFn(slots, "sea_height", [["xz", "vec2"]], "f32", [levelOf(ground)(xz)], (v) => v[0]),
    emitFn(slots, "sea_gradient", [["xz", "vec2"]], "vec2<f32>", [gradient()], (v) => v[0]),
    emitFn(slots, "shade", shadeArgs, "vec3<f32>", [body], (v) => v[0]),
    emitFn(slots, "ink", shadeArgs, "vec3<f32>", [style.ink(shadeCtx)], (v) => v[0]),
    emitFn(slots, "mark", shadeArgs, "f32", [style.mark(shadeCtx)], (v) => v[0]),
    ...onGround(),
    emitFn(slots, "sky", [["c_dir", "vec3"]], "vec3<f32>", [style.sky({ dir: c("dir", "vec3"), sun: lift<"vec3">(sunDir(at)) })], (v) => v[0]),
    emitFn(slots, "outline_world", [], "f32", [style.outline], (v) => v[0]),
  ].join("\n");
}

/** Helpers with no scene content: a surface vertex, grid corners, pixel sizes, the outline width, sea footprints. */
export const CORE_WGSL = /* wgsl */ `
/// A surface sample in the vertex stage: world position, unit normal, surface coordinates.
struct SurfV { pos: vec3<f32>, normal: vec3<f32>, uv: vec2<f32>, anchor: vec3<f32> };
/// A stable identity in [0, 1) for copy i of a drawable whose own is id (golden-ratio steps, so neighbours differ).
fn copy_id(id: f32, i: u32) -> f32 { return fract(id + f32(i) * 0.6180340); }
/// Grid corner offsets of the six vertices of a quad: triangles (0,0)(1,0)(1,1) and (0,0)(1,1)(0,1).
fn quad_corner(c: u32) -> vec2<u32> {
  return vec2<u32>(select(0u, 1u, c == 1u || c == 2u || c == 4u), select(0u, 1u, c == 2u || c == 4u || c == 5u));
}
/// World size of one pixel at p, across the view (exact for perspective and orthographic cameras alike).
fn pixel_world(p: vec3<f32>) -> f32 {
  let clip = frame.view_proj * vec4<f32>(p, 1.0);
  // Row 1 of view_proj is the projection's y scale times a unit row of the view rotation (perspective and
  // orthographic alike), so its length is that scale. One pixel at depth w is then 2 w / (height * scale).
  let fy = length(vec3<f32>(frame.view_proj[0][1], frame.view_proj[1][1], frame.view_proj[2][1]));
  return 2.0 * clip.w / (frame.viewport.y * fy);
}
/// The outline's offset: the style's world width, but never thinner than 1.5 pixels (so far views keep their ink).
fn ink_width(p: vec3<f32>) -> f32 {
  return max(outline_world(), 1.5 * pixel_world(p));
}
/// Longest extent of one pixel's footprint on the sea at p: a pixel stretched by the grazing angle. Analytic, so it is
/// smooth across the sea grid's triangles. (It was fwidth of the interpolated position, which jumps from one large far
/// triangle to the next and drew their outlines into the water as light wedges.)
fn sea_footprint(p: vec3<f32>) -> f32 {
  return pixel_world(p) / max(abs(view_dir(p).y), 0.02);
}`;

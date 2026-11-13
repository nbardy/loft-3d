// The sky: one full-screen triangle behind everything, coloured by the style along each view ray.

import { drawSpec, type CompileContext, type Drawable } from "../compile/context.ts";

/**
 * Below the horizon a style's sky is its water seen through the sea. On a plane or on nothing there is no water: the
 * ray is levelled there, so the style's horizon colour continues down (behind a plane it shows only past the far plane).
 */
const skyWgsl = (dir: string): string => /* wgsl */ `
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let xy = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var out: VOut;
  // Just inside the far plane, with no depth write: everything drawn later is nearer.
  out.clip = vec4<f32>(xy, 0.99999, 1.0);
  out.ndc = xy;
  return out;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let near = frame.inv_view_proj * vec4<f32>(in.ndc, 0.0, 1.0);
  let far = frame.inv_view_proj * vec4<f32>(in.ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - near.xyz / near.w);
  return vec4<f32>(sky(${dir}), 1.0);
}`;
const SKY_WGSL = skyWgsl("dir");
// Straight down the levelled ray would be zero: the tiny z keeps it a horizon direction (one azimuth) there.
const LEVELLED_WGSL = skyWgsl("normalize(vec3<f32>(dir.x, max(dir.y, 0.0), dir.z + 1e-7))");

function code(ctx: CompileContext): string {
  switch (ctx.ground.kind) {
    case "sea": return SKY_WGSL;
    case "plane": case "nothing": return LEVELLED_WGSL;
  }
}

export const sky: Drawable = {
  name: "sky",
  skeletons: [],
  surfaces: [],
  draws: (ctx) => ({ shaders: { sky: { code: code(ctx), libs: [] } }, draws: [drawSpec({ label: "sky", shader: "sky", vertices: 3, phase: "background", cull: "none", depthWrite: false })] }),
};

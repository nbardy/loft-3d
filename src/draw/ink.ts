// The ink outline as a full-screen pass from the opaque scene's depth (`Scene.outline` "screen"), the alternative to
// drawing every outlined body a second time pushed out along its normal ("hull", src/draw/surface.ts).
//
// Which surfaces want ink travels in the picture's alpha, which otherwise carries the style's `mark`: an outlined
// surface writes 0.49 mark, any other 0.51 + 0.49 mark (MARK_WGSL). The pass decodes it and writes the mark back, so
// the style's own post passes (woodblock's key line reads it) see what they always saw, at 7 bits.
//
// A pixel p is ink where some outlined surface q within the ink width of p (the hull's width: the style's world
// width at q, at least 1.5 px) is nearer than p's own surface by more than a step: p lies just outside q's silhouette,
// where the hull's back faces would have shown. The ink colour is the style's `ink` with q's shaded colour as the base
// (a post pass cannot know q's paint) and q's depth below the water. Traced solids write raw marks; in toon (mark 1)
// they read as not outlined, which is right (they ink themselves).
//
// What it cannot do as the hull does: ink a silhouette that is under the water (the water blended over q raises its
// alpha above 0.5, so q reads as not outlined), and see an outline wider than SEARCH pixels.

/** WGSL for opaque fragments: the alpha that carries `mark` and whether the surface wants screen ink. */
export const MARK_WGSL = /* wgsl */ `
fn loft_mark_ink(mark: f32, inked: bool) -> f32 { return select(0.51 + 0.49 * clamp(mark, 0.0, 1.0), 0.49 * clamp(mark, 0.0, 1.0), inked); }`;

/** Farthest search, pixels: the ink width is clamped to this (the hull's close-up widths stay under it in the examples). */
const SEARCH = 8;

export const INK_POST = /* wgsl */ `
const INK_DIRS = array<vec2<f32>, 8>(vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
  vec2(0.7071, 0.7071), vec2(-0.7071, -0.7071), vec2(0.7071, -0.7071), vec2(-0.7071, 0.7071));
const INK_RADII = array<f32, 6>(1.0, 2.0, 3.0, 4.5, 6.0, ${SEARCH}.0);
fn ink_view_depth(px: vec2<f32>) -> f32 { return dot(scene_position(px) - frame.eye.xyz, frame.forward.xyz); }
fn ink_decode(a: f32) -> f32 { return select((a - 0.51) / 0.49, a / 0.49, a < 0.5); }

@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> {
  let px = in.px.xy;
  let here = post_color(in.uv);
  let z = select(1e30, ink_view_depth(px), scene_depth(px) < 1.0);
  var cover = 0.0;
  var colour = vec3<f32>(0.0);
  for (var r = 0u; r < 6u; r++) {
    let radius = INK_RADII[r];
    for (var k = 0u; k < 8u; k++) {
      let q = floor(px + INK_DIRS[k] * radius) + 0.5;
      if (scene_depth(q) >= 1.0) { continue; }
      let zq = ink_view_depth(q);
      let world = scene_position(q);
      let step = max(3.0 * outline_world(), 0.01 * zq);
      if (z - zq <= step) { continue; }
      let cq = textureLoad(loft_post_colour, vec2<i32>(q), 0);
      if (cq.a >= 0.5) { continue; }
      // The hull's width at q, in pixels, and how much of this pixel it covers.
      let width = min(ink_width(world) / pixel_world(world), ${SEARCH}.0);
      let c = clamp(width + 0.5 - radius, 0.0, 1.0);
      if (c > cover) {
        let depth = sea_height(world.xz) - world.y;
        colour = ink(cq.rgb, -frame.forward.xyz, -view_dir(world), world, depth, vec2<f32>(0.0), world, 0.0);
        cover = c;
      }
    }
  }
  return vec4<f32>(mix(here.rgb, colour, cover), ink_decode(here.a));
}`;

// Full-screen passes a style runs after the scene (`Style.post`), each with its numbers as options.
//
// The laws:
//  - `paperGrain`: the picture times 1 + g, g = (fibre noise - 0.5) `fibre` + (a per-pixel hash - 0.5) `tooth` (0.4 +
//    luminance): fibres are value noise stretched 9:1 along x (the way the sheet was laid), the tooth shows most in pale
//    inks, where a print's paper shows through. Fixed to the screen: the picture is the sheet.
//  - `bloom`: what is brighter than a threshold (luminance graded over `from`..`to`) gathered by 40 taps on a spiral
//    out to `radius` pixels at 800 px high, Gaussian weighted, added `gain` times and softly compressed above 0.8 so a
//    bright core goes to tinted white instead of clipping flat. The spiral turns pixel to pixel (interleaved gradient
//    noise), leaving fine grain instead of ghost copies.
//  - `reflection`: for a pixel of open water, light from bodies above it in the picture (a reflection in gently moving
//    water lies below what it reflects), gathered over 24 steps of 4 px up a column that wavers with time, the part of
//    each over 0.1 added at `gain`.
//
// Parameters: numbers fixed when the style is built; sizes in pixels scale with the picture's height (800 px = 1).
//
// Cannot: anything that needs a second target or a mip chain (bloom is one pass, so its radius is bounded by its 40
// taps: wider means sparser); paper that moves with the camera or the world (it is the frame's); a reflection of
// anything that is not an opaque body above the water, or a true mirror (it is a smear down the screen, right only
// for a camera that looks across the water, not down on it). `reflection` reads the sea (`sty_water`, `sea_height`):
// it is for a style that draws water.
//
// Going past it: a `PostSpec` is any WGSL fragment over `post_color`, `scene_depth`, `scene_position` and the scene's own
// functions (`POST_COMMON` has hashes, noise, depth, normals, "is this the sea"). Relatives: grain whose fibre runs along
// the picture's own edges (a brush texture); bloom whose threshold is a hue (only the reds glow, a sunset); a
// reflection whose column length follows the water's distance (longer far off, as the real one is); ink from depth
// edges (the woodblock's first key line, 2026-11-11: it was ragged and cost 0.37 ms).

import type { PostSpec } from "../compile/context.ts";
import { POST_COMMON } from "./shared.ts";

/** A number as a WGSL float literal. */
const lit = (x: number): string => {
  if (!Number.isFinite(x)) throw new Error(`post: ${x} is not a number WGSL can take`);
  return Number.isInteger(x) ? `${x}.0` : `${x}`;
};

/** Paper fibre and tooth. Defaults: fibre 0.07, tooth 0.035 (the woodblock print's paper). */
export function paperGrain(o: { readonly fibre?: number; readonly tooth?: number } = {}): PostSpec {
  const fibre = o.fibre ?? 0.07, tooth = o.tooth ?? 0.035;
  return {
    label: "paper grain",
    wgsl: /* wgsl */ `${POST_COMMON}
@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> {
  let c = post_color(in.uv).rgb;
  let scale = max(frame.viewport.y / 800.0, 0.375);
  let q = in.px.xy / scale;
  let fibre = sty_noise(q * vec2<f32>(0.08, 0.7)) * 0.6 + sty_noise(q * vec2<f32>(0.03, 0.25)) * 0.4;
  let tooth = sty_hash(vec2<i32>(in.px.xy));
  let light = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  let g = (fibre - 0.5) * ${lit(fibre)} + (tooth - 0.5) * ${lit(tooth)} * (0.4 + light);
  return vec4<f32>(c * (1.0 + g), 1.0);
}
`,
  };
}

/** Bloom. Defaults: radius 30 px, gain 1.6, brightness from 0.12 to 0.5 (biolume's). */
export function bloom(o: { readonly radius?: number; readonly gain?: number; readonly from?: number; readonly to?: number } = {}): PostSpec {
  const radius = o.radius ?? 30, gain = o.gain ?? 1.6, from = o.from ?? 0.12, to = o.to ?? 0.5;
  if (!(to > from)) throw new Error(`bloom: the brightness range must rise (from ${from} to ${to})`);
  return {
    label: "bloom",
    wgsl: /* wgsl */ `${POST_COMMON}
const BL_TAPS: u32 = 40u;
fn bl_bright(c: vec3<f32>) -> vec3<f32> {
  let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  return c * smoothstep(${lit(from)}, ${lit(to)}, l);
}
@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> {
  let c = post_color(in.uv).rgb;
  let scale = max(frame.viewport.y / 800.0, 0.375);
  let px = in.px.xy;
  let turn = 6.2831853 * fract(52.9829189 * fract(dot(floor(px), vec2<f32>(0.06711056, 0.00583715))));
  var acc = vec3<f32>(0.0);
  var total = 0.0;
  for (var i = 0u; i < BL_TAPS; i++) {
    let t = (f32(i) + 0.5) / f32(BL_TAPS);
    let r = ${lit(radius)} * scale * sqrt(t);
    let a = f32(i) * 2.3999632 + turn;
    let w = exp(-3.0 * t);
    acc += bl_bright(post_color((px + vec2<f32>(cos(a), sin(a)) * r) * frame.viewport.zw).rgb) * w;
    total += w;
  }
  let glow = acc / total;
  // Added, then softly compressed so a bright core saturates to white-tinted colour instead of clipping flat.
  let lit = c + glow * ${lit(gain)};
  return vec4<f32>(lit / (1.0 + 0.25 * max(lit - vec3<f32>(0.8), vec3<f32>(0.0))), 1.0);
}
`,
  };
}

/** The light of bodies smeared down the water below them. Default gain 0.09 (biolume's). */
export function reflection(o: { readonly gain?: number } = {}): PostSpec {
  const gain = o.gain ?? 0.09;
  return {
    label: "reflection",
    wgsl: /* wgsl */ `${POST_COMMON}
@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> {
  let c = post_color(in.uv).rgb;
  let px = in.px.xy;
  if (sty_water(px) < 0.5) { return vec4<f32>(c, 1.0); }
  let scale = max(frame.viewport.y / 800.0, 0.375);
  var acc = vec3<f32>(0.0);
  for (var k = 1u; k <= 24u; k++) {
    let fk = f32(k);
    let wave = sin(px.y * 0.11 / scale + fk * 0.7 + frame.time.x * 1.3) * 2.5 * scale;
    let q = px + vec2<f32>(wave, -fk * 4.0 * scale);
    let p = scene_position(q);
    // Only bodies above the water reflect.
    if (sty_solid(q) && p.y > sea_height(p.xz)) {
      let s = post_color(q * frame.viewport.zw).rgb;
      acc += max(s - vec3<f32>(0.1), vec3<f32>(0.0)) * exp(-fk * 0.11);
    }
  }
  return vec4<f32>(c + acc * ${lit(gain)}, 1.0);
}
`,
  };
}

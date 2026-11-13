// Biolume: a night sea. Sky and water near black; bodies dark, with their paint's bright and saturated features
// turned into light, cyan or magenta by hue; a rim of cold light on every silhouette; foam and the waterline glowing
// faintly where bodies break the water. Two post passes (`reflection`, `bloom`): the glow smeared down the water, then
// bloom, which glows whatever is bright (in this picture, only what emits).

import { abs, add, dot, exp, fract, length, lift, max, min, mix, mul, normalize, param, pow, saturate, sin, smoothstep, sub, time, vec3, vec4, type Expr } from "../expr.ts";
import { hash22, luminance, noise2 } from "../lib/index.ts";
import { fwidth } from "../lib/wgsl.ts";
import type { Contact, Rgb, Style } from "../style.ts";
import { bloom, reflection } from "./post.ts";
import { rgb } from "./shared.ts";

const C = {
  cyan: [0.15, 0.95, 1.0],
  magenta: [1.0, 0.22, 0.85],
  night: [0.006, 0.012, 0.024],
  horizon: [0.02, 0.04, 0.07],
  water: [0.02, 0.045, 0.08],
  body: [0.035, 0.04, 0.07],
  moon: [0.35, 0.45, 0.7],
} as const satisfies Record<string, Rgb>;

/**
 * Light from a paint: as strong as the paint is bright and vivid; magenta for purples, pinks and reds (red and blue
 * both above green), cyan for the rest (creams, yellows, greens, blues).
 */
function glowOf(base: Expr<"vec3">): Expr<"vec3"> {
  const hi = max(max(base.x, base.y), base.z), lo = min(min(base.x, base.y), base.z);
  const vivid = sub(hi, lo);
  const strength = smoothstep(0.42, 0.7, add(mul(luminance(base), 0.45), mul(vivid, 0.6)));
  const purple = smoothstep(0.08, 0.22, sub(mul(add(base.x, base.z), 0.5), base.y));
  return mul(mix(rgb(C.cyan), rgb(C.magenta), purple), strength);
}

/**
 * The night style: near-black sky, water and bodies, where the bright, saturated parts of a body's paint become light
 * (cyan or magenta by hue), a cold rim of light on every silhouette, and glowing foam where bodies break the water.
 * Composed of the `reflection` and `bloom` post passes.
 */
export function biolume(): Style {
  const outline = param("biolume.outline", 0.02, { min: 0, max: 0.1 });
  const fog = (d: Expr<"f32">): Expr<"f32"> => saturate(sub(1, exp(mul(d, -0.012))));
  return {
    name: "biolume",
    outline,
    clear: C.night,
    post: [reflection(), bloom()],
    shade: (ctx) => {
      const ndl = dot(ctx.normal, ctx.sun);
      const facing = saturate(dot(ctx.normal, ctx.view));
      // Dark skin under a faint moon, the paint's own hue barely kept.
      const skin = mul(mix(rgb(C.body), mul(ctx.base, 0.08), 0.5), add(0.5, mul(saturate(ndl), 0.8)));
      // Emission is brightest where the surface faces the eye and falls toward the silhouette, as light through
      // translucent tissue does; the rim, not the pattern, draws the outline.
      const glow = mul(glowOf(ctx.base), mul(0.8, add(0.2, mul(mul(facing, facing), 0.8))));
      const rim = mul(rgb(C.cyan), mul(pow(sub(1, facing), 3), 0.55));
      const c = add(add(skin, glow), rim);
      // Under water the body sinks into the dark, its light lasting longer than its skin.
      const sink = exp(mul(max(ctx.depth, 0), -1.1));
      return mix(rgb(C.water), mul(c, add(0.25, mul(sink, 0.75))), sink);
    },
    // The hull is a thin line of the rim's light.
    mark: () => lift<"f32">(1),
    ink: (ctx) => mul(rgb(C.cyan), mul(0.35, exp(mul(max(ctx.depth, 0), -1.5)))),
    water: (ctx) => {
      const facing = saturate(dot(ctx.normal, ctx.view));
      const xz = ctx.world.xz;
      // Faint moonlit swell, so the water reads as a surface and not a void: a broad sheen, glints, and sparse
      // plankton that twinkle (one per cell of a world-space lattice: they stay where they are as the camera moves).
      const half = normalize(add(ctx.sun, ctx.view));
      const spec = dot(ctx.normal, half);
      const sheen = add(mul(smoothstep(0.75, 1.0, spec), 0.22), mul(smoothstep(0.975, 0.99, add(spec, mul(noise2(mul(xz, 4)), 0.012))), 0.3));
      let c: Expr<"vec3"> = add(mul(rgb(C.water), add(0.75, mul(ctx.crest, 0.35))), mul(rgb(C.moon), sheen));
      // Moonlit ripple lines along the swell, faint, fading with distance before they can alias.
      const ripple = add(mul(ctx.phase, 6), mul(ctx.crest, 0.8));
      const rfw = max(fwidth(ripple), 1e-4);
      const rline = mul(sub(1, smoothstep(sub(0.06, rfw), add(0.06, rfw), abs(sub(fract(ripple), 0.5)))), sub(1, smoothstep(0.1, 0.3, rfw)));
      c = add(c, mul(rgb(C.moon), mul(rline, mul(add(0.5, mul(ctx.crest, 0.5)), 0.07))));
      const cell = mul(xz, 2.5);
      const h = hash22(cell);
      const spark = mul(smoothstep(0.93, 0.99, h.x), sub(1, smoothstep(0.0, 0.08, length(sub(fract(cell), add(mul(h, 0.6), 0.2))))));
      const twinkle = add(0.5, mul(sin(add(mul(time, 2.3), mul(h.y, 40))), 0.5));
      c = add(c, mul(rgb(C.cyan), mul(spark, mul(twinkle, 0.5))));
      // Where bodies disturb the water it glows: a soft halo through the contact band, the foam brighter on it,
      // flickering along its edge.
      const flicker = add(0.65, mul(noise2(mul(xz, 3.0)), 0.35));
      c = add(c, mul(rgb(C.cyan), add(halo(ctx.contact), mul(ctx.foam, mul(flicker, 0.75)))));
      c = mix(c, rgb(C.horizon), fog(ctx.distance));
      // Translucent looking down, so light under the surface shows; opaque toward grazing angles.
      const alpha = saturate(max(add(0.6, mul(pow(sub(1, facing), 3), 0.4)), ctx.foam));
      return vec4(c, alpha);
    },
    shadow: (ctx) => vec4(vec3(0, 0, 0), mul(ctx.amount, 0.3)),
    // A plane: a moonlit floor twice the water's tone (so a shadow reads on it), shadows near the night, fogged as the
    // water is.
    ground: (ctx) => mix(mul(rgb(C.water), sub(2.2, mul(ctx.shadow, 1.7))), rgb(C.horizon), fog(ctx.distance)),
    sky: (ctx) => {
      const up = ctx.dir.y;
      const above = mix(rgb(C.horizon), rgb(C.night), pow(saturate(up), 0.5));
      return mix(above, rgb(C.water), sub(1, smoothstep(-0.002, 0.0, up)));
    },
  };
}

/** The glow round a body breaking the water: saturate(band)^2 x 0.22; nothing where no body is near (0 there exactly). */
function halo(contact: Contact): Expr<"f32"> {
  switch (contact.kind) {
    case "clear": return lift<"f32">(0);
    case "near": { const near = saturate(contact.band); return mul(mul(near, near), 0.22); }
  }
}

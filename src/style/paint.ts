// Paint treatments: what a style does to a body's paint before it lights it, and the weight of the line inside its
// hull. Each is a small sum type with an "as painted" variant that changes nothing (the same shader to the byte).
//
// The laws:
//  - `standsOut(hue, c)`: how far a colour stands out as a hue: red, min(r - g, r - b); yellow, min(r, g) - b.
//  - `warmed`: a paint that stands out as red by `margin` is multiplied by `gain` (brick (0.66, 0.22, 0.13) by
//    (1.27, 1.18, 1) is (0.84, 0.26, 0.13)).
//  - `mottled`: two octaves of noise over the surface's anchor (the skin at rest), `size` world units across, cut hard at
//    `cut`, printed at `value` of the paint, on red paints only. The blotches ride the body; they never swim.
//  - `weighted`: a line of the key ink inside the hull, from the silhouette in (`pixelsInside`) to a width in world
//    units: `swelling` grows from nothing where the surface faces the key to `width` where it faces away (an inker's
//    line, thin in the light); `wandering` takes its width from noise over the anchor as well as from the light, between
//    `least` and `most` (a pencil pressed harder and softer as it goes).
//
// Parameters: numbers fixed when the style is built; the key (`light.key`) turns with the camera if it is `offLens`.
//
// Cannot: change a paint's hue except by a fixed gain; blotch anything but red paints; draw a line anywhere but along the
// outline (a crease, a fold, a seam inside the silhouette has N.V far from 0 and gets nothing); a line wider than the
// fragment's own derivative is smooth over (it is measured to first order, so it bulges where the mesh is coarse).
//
// Going past it: each handler is a function of the shade context, so a style can repaint `ctx.base` any way it likes
// before its rule (`{ ...ctx, base: yours }`). Relatives: blotches whose cut follows the light (paint flaking on the lit
// side); a gain that follows depth below the water (paint going cold as it sinks); a line whose width follows the
// surface's curvature (fwidth of the normal: heavy where the form turns fast, as an illustrator draws a crease); a
// second line at a fixed offset inside the first (a double outline, an inlay).

import { add, div, dot, max, min, mix, mul, saturate, smoothstep, sub, vec3, type Expr } from "../expr.ts";
import { noise3 } from "../lib/noise.ts";
import { pixelWorld } from "../lib/wgsl.ts";
import type { Rgb, ShadeCtx } from "../style.ts";
import { keyOf, light, type Key } from "./light.ts";
import { edgeOf, pixelsInside, rgb } from "./shared.ts";

/** A hue a paint can stand out as: `red` when its red stands above both green and blue, `yellow` when red and green stand above blue. */
export type Hue = "red" | "yellow";

/** How far a paint stands out as the hue (positive: it does). One handler per hue. */
export function standsOut(hue: Hue, c: Expr<"vec3">): Expr<"f32"> {
  switch (hue) {
    case "red": return min(sub(c.x, c.y), sub(c.x, c.z));
    case "yellow": return sub(min(c.x, c.y), c.z);
  }
}

/** The warm paints as painted, or hotter: a paint that stands out as red by `margin` multiplied by `gain`. */
export type Warm = { readonly kind: "asPainted" } | { readonly kind: "hotter"; readonly margin: number; readonly gain: Rgb };
/** Darker blotches on the red paints, in the anchor: the larger octave `size` world units across, cut at `cut`, at `value` of the paint. */
export type Mottle = { readonly kind: "off" } | { readonly kind: "blotches"; readonly size: number; readonly cut: number; readonly value: number; readonly margin: number };
/**
 * The line inside the hull. `even`: none (the hull alone). `swelling`: up to `width` world units, heavier on the side
 * away from `key`. `wandering`: between `least` and `most` world units by noise over the anchor (`size` across) and by
 * the light from `key`.
 */
export type LineWeight =
  | { readonly kind: "even" }
  | { readonly kind: "swelling"; readonly width: number; readonly key: Key }
  | { readonly kind: "wandering"; readonly least: number; readonly most: number; readonly size: number; readonly key: Key };

const positive = (what: string, x: number): number => {
  if (!(x > 0)) throw new Error(`paint: ${what} must be positive, got ${x}`);
  return x;
};

/**
 * Builders for how a style treats a body's paint before lighting it: `hotter` (warm reds pushed warmer), `mottle`
 * (darker blotches on red paints), and the weight of the line inside the hull, `swelling` or `wandering`. Each returns
 * a plain value for a style's spec.
 */
export const paint = {
  hotter: (o: { readonly margin?: number; readonly gain?: Rgb } = {}): Warm => ({ kind: "hotter", margin: o.margin ?? 0.33, gain: o.gain ?? [1.27, 1.18, 1] }),
  mottle: (o: { readonly size?: number; readonly cut?: number; readonly value?: number; readonly margin?: number } = {}): Mottle =>
    ({ kind: "blotches", size: positive("mottle size", o.size ?? 0.42), cut: o.cut ?? 0.3, value: o.value ?? 0.74, margin: o.margin ?? 0.3 }),
  swelling: (o: { readonly width?: number; readonly key?: Key } = {}): LineWeight => ({ kind: "swelling", width: positive("line swelling", o.width ?? 0.05), key: o.key ?? light.key.offLens(45) }),
  wandering: (o: { readonly least?: number; readonly most?: number; readonly size?: number; readonly key?: Key } = {}): LineWeight => {
    const least = o.least ?? 0.005, most = positive("line most", o.most ?? 0.05);
    if (!(least >= 0 && least < most)) throw new Error(`paint: a wandering line needs 0 <= least < most, got ${least} and ${most}`);
    return { kind: "wandering", least, most, size: positive("line wander size", o.size ?? 0.6), key: o.key ?? light.key.offLens(45) };
  },
};

/** The warm paints, as painted or hotter. One handler per kind. */
export function warmed(w: Warm, c: Expr<"vec3">): Expr<"vec3"> {
  switch (w.kind) {
    case "asPainted": return c;
    case "hotter": return mix(c, saturate(mul(c, rgb(w.gain))), edgeOf(standsOut("red", c), w.margin, 1e-5));
  }
}

/** Blotches on the red paints, in the surface's own coordinates. One handler per kind. */
export function mottled(m: Mottle, c: Expr<"vec3">, ctx: ShadeCtx): Expr<"vec3"> {
  switch (m.kind) {
    case "off": return c;
    case "blotches": {
      const a = mul(ctx.anchor, 1 / m.size);
      const n = add(noise3(a), mul(noise3(add(mul(a, 2.3), vec3(7.1, 3.3, 1.9))), 0.45));
      const blot = mul(edgeOf(n, m.cut, 1e-5), edgeOf(standsOut("red", c), m.margin, 1e-5));
      return mix(c, mul(c, m.value), blot);
    }
  }
}

/** How far a surface is turned from the key, 0 facing it (and a little past) to 1 facing away. */
const turnedFrom = (key: Key, ctx: ShadeCtx): Expr<"f32"> => saturate(mul(sub(0.35, dot(ctx.normal, keyOf(key, ctx))), 1 / 0.9));

/** A line `wide` pixels in from the silhouette (never drawn under a quarter of a pixel), 0..1. */
const inside = (ctx: ShadeCtx, wide: Expr<"f32">): Expr<"f32"> =>
  mul(sub(1, smoothstep(sub(wide, 0.75), add(wide, 0.75), pixelsInside(ctx))), saturate(sub(wide, 0.25)));

/** The line inside the hull printed over a colour in `ink`. One handler per weight. */
export function weighted(l: LineWeight, c: Expr<"vec3">, ink: Rgb, ctx: ShadeCtx): Expr<"vec3"> {
  switch (l.kind) {
    case "even": return c;
    case "swelling": return mix(c, rgb(ink), inside(ctx, mul(div(l.width, pixelWorld(ctx.world)), turnedFrom(l.key, ctx))));
    case "wandering": {
      // The noise (-1..1) and the light share the say: a line heavy in shadow, and wandering everywhere.
      const n = noise3(mul(ctx.anchor, 1 / l.size));
      const w = mix(l.least, l.most, saturate(add(mul(n, 0.6), mul(turnedFrom(l.key, ctx), 0.7))));
      return mix(c, rgb(ink), inside(ctx, div(w, pixelWorld(ctx.world))));
    }
  }
}

// The sky as a print paints it: an ink at the horizon with washes wiped over it by the view's height, a sun disc,
// cloud bands, and one ink below the horizon.
//
// The law: c = horizon; for each wash in order, c = mix(c, wash.ink, smoothstep(wash.from, wash.to, y)), y the view
// direction's height. Washes that abut are a gradient's colour stops (orange-gold through vermilion and violet to
// indigo); washes that overlap are a printer's bokashi (cream graded to haze, indigo wiped in over it). The sun is a disc
// of fixed angular radius, flat; a cloud band is a flat shape lying on one height between two bearings, its top
// scalloped, with a key line. Below the horizon (y < 0) the sky is `below`, the edge a hair soft.
//
// Parameters: every number is fixed when the style is built (a sky has no per-frame input). The sun disc does not
// follow a movable scene sun (`scene({ sun: movable(...) })`): it is drawn where `toward` says.
//
// Cannot: a curve other than smoothstep between two heights (a power law as `toon` grades, an exponential), anything
// that varies with bearing except the clouds (a glow round the sun, a horizon brighter on the sun's side), stars, or
// clouds that are not flat bands (cumulus, a moving layer).
//
// Going past it: a style's `sky` is any function of `SkyCtx` (view direction and sun), so mix your own terms over what
// `skyOf` returns, or write the grade yourself (`toon` and `biolume` do). The relatives worth trying: a grade in the angle from the sun instead of the height (dot(dir, sun) in place of y gives a
// glow that turns with the sun); washes in a noise of the direction (a mottled, hand-wiped sky); bands at a bearing that
// moves with time (drifting cloud); a disc whose ink is a wash of its own height (a sun reddening as it sets).

import { abs, add, atan2, dot, lt, max, mix, mul, saturate, select, sin, smoothstep, sub, type Expr } from "../expr.ts";
import type { Rgb, SkyCtx } from "../style.ts";
import { rgb } from "./shared.ts";

/** An ink wiped over the sky from nothing at view height `from` to full at `to`. */
export type Wash = { readonly ink: Rgb; readonly from: number; readonly to: number };

/**
 * A sun disc: none, or one in the direction `toward` (world; normalised here), `radius` radians across its half, in
 * `ink`, flat. Below the horizon the sky prints `below`, so a disc whose centre is near the horizon is half set.
 */
export type SkySun = { readonly kind: "none" } | { readonly kind: "disc"; readonly toward: readonly [number, number, number]; readonly radius: number; readonly ink: Rgb };

/**
 * Cloud bands: none, or flat bands in `ink` with a key line in `key`, each lying on a view height `at` (its flat
 * underside) between two bearings (radians about up, from +x toward +z), its top scalloped in `lumps` across that span
 * and `thick` at most. `line` is the key line's width in view height.
 */
export type SkyClouds =
  | { readonly kind: "none" }
  | { readonly kind: "bands"; readonly ink: Rgb; readonly key: Rgb; readonly line: number; readonly bands: readonly { readonly at: number; readonly thick: number; readonly from: number; readonly to: number; readonly lumps: number }[] };

/** A whole sky: the horizon's ink, the washes over it in order, the ink below the horizon, a sun and clouds. */
export type Sky = { readonly horizon: Rgb; readonly washes: readonly Wash[]; readonly below: Rgb; readonly sun: SkySun; readonly clouds: SkyClouds };

/** The sky along a view ray: the washes, then the sun and the clouds printed over them; below the horizon `below`. */
export function skyOf(sky: Sky, ctx: SkyCtx): Expr<"vec3"> {
  const up = ctx.dir.y;
  const above = clouded(sky.clouds, sunned(sky.sun, washed(sky, up), ctx.dir), ctx.dir);
  return mix(above, rgb(sky.below), sub(1, smoothstep(-0.002, 0.0, up)));
}

function washed(sky: Sky, up: Expr<"f32">): Expr<"vec3"> {
  return sky.washes.reduce<Expr<"vec3">>((c, w) => {
    if (!(w.to > w.from)) throw new Error(`sky: a wash must rise (from ${w.from} to ${w.to})`);
    return mix(c, rgb(w.ink), smoothstep(w.from, w.to, up));
  }, rgb(sky.horizon));
}

/** A sun printed over the sky, its edge a pixel or so soft. One handler per kind. */
function sunned(s: SkySun, c: Expr<"vec3">, dir: Expr<"vec3">): Expr<"vec3"> {
  switch (s.kind) {
    case "none": return c;
    case "disc": {
      const l = Math.hypot(...s.toward);
      if (!(l > 0) || !(s.radius > 0)) throw new Error("sky: a sun needs a direction and a positive radius");
      const toward = s.toward.map((x) => x / l) as [number, number, number];
      // The angle from the sun's centre, small-angle: 1 - cos a is about a^2 / 2, so a = sqrt(2 (1 - cos a)).
      const off = mul(max(sub(1, dot(dir, rgb(toward))), 0), 2);
      return mix(c, rgb(s.ink), sub(1, smoothstep(s.radius * s.radius * 0.985, s.radius * s.radius, off)));
    }
  }
}

/** Cloud bands over the sky: a flat underside on its height, a scalloped top tapering to nothing at both ends, a key line. */
function clouded(k: SkyClouds, c: Expr<"vec3">, dir: Expr<"vec3">): Expr<"vec3"> {
  switch (k.kind) {
    case "none": return c;
    case "bands": {
      const bearing = atan2(dir.z, dir.x), up = dir.y;
      return k.bands.reduce<Expr<"vec3">>((out, b) => {
        if (!(b.to > b.from) || !(b.thick > 0)) throw new Error("sky: a cloud band needs from < to and a positive thickness");
        // The bearing unwrapped past `from`: atan2 jumps from pi to -pi straight behind +x, which is where a camera
        // looking along -x sees the sky, so a band may run past pi (from 2.85 to 3.22 is the middle of such a view).
        const unwrapped = select(lt(bearing, b.from), add(bearing, 2 * Math.PI), bearing);
        const u = saturate(mul(sub(unwrapped, b.from), 1 / (b.to - b.from)));
        // Its height across the span: tapered by a half sine, scalloped by |sin| (round tops meeting in notches).
        const top = mul(mul(sin(mul(u, Math.PI)), b.thick), add(0.6, mul(abs(sin(mul(u, Math.PI * b.lumps))), 0.4)));
        const h = sub(up, b.at);
        // Inside: above the underside and below the top (both with the key line's width as the edge).
        const inside = mul(smoothstep(0, k.line * 0.3, h), sub(1, smoothstep(sub(top, k.line * 0.3), top, h)));
        const core = mul(smoothstep(k.line, k.line * 1.3, h), sub(1, smoothstep(sub(top, k.line * 1.3), sub(top, k.line), h)));
        return mix(mix(out, rgb(k.key), inside), rgb(k.ink), core);
      }, c);
    }
  }
}

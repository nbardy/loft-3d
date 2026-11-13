// One generic drawable per signature (DESIGN.md 7.4): `draw.surface`, `draw.curve`, `draw.points`, `draw.field`
// (field.ts), `draw.relief` (relief.ts) and `draw.density` (../soft/density.ts) are all implemented.
// the tracers of docs/folding_and_tracing.md.

import { add, clamp, cross, div, length, lift, max, mul, sub, type In } from "../expr.ts";
import { viewDir } from "../lib/wgsl.ts";
import type { Drawable } from "../compile/context.ts";
import { NO_SKELETON, type Curve, type F, type P3, type Paint, type Points, type Poses, type Surface } from "../map/types.ts";
import { atRest } from "../map/surface.ts";
import { drawFlat, drawGlazed, drawSurface, spacing, type Grid } from "./surface.ts";
import { drawField } from "./field.ts";
import { drawRelief } from "./relief.ts";
import { drawCopies } from "./copies.ts";
import { DensityDrawable, type DensityOptions } from "../soft/density.ts";
import type { Medium } from "../soft/medium.ts";
export type { DensityOptions };

/** A drawable that can be drawn once per point of a `Points`. */
export interface Instanceable {
  instanced(name: string, points: Points): Drawable;
}

/** A drawable that can be drawn once per pose of a `Poses`: turned and scaled along each axis. */
export interface Poseable {
  posed(name: string, poses: Poses): Drawable;
}

/** An axis-aligned box: the proxy a tracer starts and ends its march in. */
export type Bounds = { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };

export type { FieldOptions } from "./field.ts";
export type { ReliefOptions } from "./relief.ts";
export type { CopiesHit, CopiesOptions } from "./copies.ts";

export type CurveOptions = {
  /** Half-width of the stroke at u, world units. */
  readonly width: (u: F) => In<"f32">;
  /** Colour along the stroke: (u, v) with v across it (0 one side, 1 the other). Unlit. */
  readonly paint: Paint;
  /** Segments along the curve. */
  readonly segments: number;
};

/** Parameter step for a curve's tangent. */
const DU = 1e-3;

/** A ribbon along the curve facing the camera: the stroke's surface (it reads the camera, so it is shader-only). */
function ribbon(curve: Curve, width: (u: F) => In<"f32">): Surface {
  const side = (u: F): P3 => {
    const t = sub(curve(clamp(add(u, DU), 0, 1)), curve(clamp(sub(u, DU), 0, 1)));
    const c = cross(t, viewDir(curve(u)));
    return div(c, max(length(c), 1e-12));
  };
  const point = (u: F, v: F): P3 => add(curve(u), mul(side(u), mul(sub(mul(v, 2), 1), lift<"f32">(width(u)))));
  return { point, normal: (u) => mul(viewDir(curve(u)), -1), anchor: atRest(point), topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON };
}

/**
 * Wraps a shape as a `Drawable`, which is how it reaches the screen. A scene's `things` list takes only Drawables, so a
 * surface, curve, field or point set that is not wrapped by one of these (or by `glow`, `flare`, `impostors`) is never
 * drawn. Every member takes a unique `name` (it names the shaders) as its first argument.
 * - `surface`: a parametric surface (u, v) -> point, lit by the scene's style.
 * - `glazed`: a surface with its own colour and alpha, blended over what is behind it.
 * - `curve`: a camera-facing ribbon stroke along a curve, unlit.
 * - `points`: one copy of a drawable per point of a `Points`.
 * - `posed`: one copy of a drawable per pose, each turned and scaled along its own axes.
 * - `field`: a signed distance field, sphere-traced per pixel inside a bounding box.
 * - `relief`: bumps, scales or spikes ray-marched on top of a surface, in its own coordinates.
 * - `copies`: a list of spheres, capsules or rounded cones, each intersected exactly per pixel.
 * - `density`: a cloud or fog (a `Medium`) integrated along each view ray.
 */
export const draw = {
  /** A parametric surface (u, v) -> point, lit by the scene's style: a grid in the vertex stage, paint per pixel, an outline as asked. */
  surface: drawSurface,
  /** A surface that supplies its own colour and alpha and is blended over what is behind it, instead of being lit by the style. */
  glazed: drawGlazed,
  /** A stroke: a ribbon of half-width `width(u)` along the curve, facing the camera, coloured by `paint` (unlit). */
  curve(name: string, curve: Curve, o: CurveOptions): Drawable {
    const grid: Grid = { u: spacing.even(o.segments), v: spacing.even(1) };
    return drawFlat(name, ribbon(curve, o.width), { paint: o.paint, grid });
  },
  /** One copy of a drawable `thing` (one that can be instanced) per point of `points`, each in its point's frame and scale. */
  points(name: string, points: Points, thing: Instanceable): Drawable {
    return thing.instanced(name, points);
  },
  /**
   * One copy of `thing` per pose (`posed`, `posedList`): each turned by its own frame and scaled along each of its axes,
   * normals turned with it; paint is told the copy's index and its world normal (`PaintAt`). One draw for all of them.
   */
  posed(name: string, poses: Poses, thing: Poseable): Drawable {
    return thing.posed(name, poses);
  },
  /** A solid given as a signed distance field, sphere-traced per pixel inside its bounds; suits folded and recursive solids. */
  field: drawField,
  /** Height detail (scales, spikes, bumps) ray-marched in a thin shell over a surface, in the surface's own (u, v) coordinates. */
  relief: drawRelief,
  /** A list of copies of one simple solid (sphere, capsule or rounded cone), each intersected exactly per pixel; suits trees and branching forms. */
  copies: drawCopies,
  /**
   * A medium (Gaussian puffs and fog banks: `src/soft/medium.ts`) integrated along each view ray in closed form, up to
   * the opaque scene, lit by the sun, the sky and flashes inside it (`src/soft/density.ts`).
   */
  density(name: string, medium: Medium, o: DensityOptions): Drawable {
    return new DensityDrawable(name, medium, o);
  },
};


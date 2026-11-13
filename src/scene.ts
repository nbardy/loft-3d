// A scene says what things are; `compile` decides where each part is evaluated.

import { OPEN, type Camera, type Loop } from "./artefact.ts";
import type { Drawable, V3 } from "./compile/context.ts";
import { light } from "./draw/light.ts";
import { shadows } from "./draw/shadows.ts";
import { sky } from "./draw/sky.ts";
import type { Ground } from "./draw/ground.ts";
import type { Style } from "./style.ts";
import type { Sun } from "./sun.ts";
import { SceneError } from "./errors.ts";
import { refuseScene } from "./mistakes.ts";

export type SceneSpec = {
  /** What the scene stands on: `sea({ swell })`, `plane` (flat, y = 0) or `nothing` (src/draw/ground.ts). */
  readonly ground: Ground;
  /** Strands, crests, drawn surfaces and points, or any other `Drawable`. */
  readonly things: readonly Drawable[];
  readonly style: Style;
  /**
   * Direction toward the sun (normalised here): a vector, fixed, or `movable([x, y, z])` (src/sun.ts), which makes it the
   * host input `sun` with that direction as its default.
   */
  readonly sun: readonly [number, number, number] | Extract<Sun, { kind: "input" }>;
  readonly cameras?: Readonly<Record<string, Camera>>;
  /** How ink outlines are drawn (`OutlineMethod`). Default `DEFAULT_OUTLINE`. */
  readonly outline?: OutlineMethod;
  /** The scene comes round every this many seconds (its author has made every motion periodic in it). Default: it does not loop (`OPEN`). */
  readonly period?: number;
};

/**
 * hull: every outlined surface drawn a second time, pushed out along its normal, front faces culled.
 * screen: one full-screen pass after the scene finds the outlined surfaces' silhouettes in the depth (src/draw/ink.ts).
 */
export type OutlineMethod = "hull" | "screen";
export const DEFAULT_OUTLINE: OutlineMethod = "hull";

export type Scene = {
  readonly ground: Ground;
  /** Everything drawn: the sky, the ground and the shadows the scene derives, then the spec's things. */
  readonly things: readonly Drawable[];
  readonly style: Style;
  /** The sun as stated: the fixed direction, or a movable sun's default. */
  readonly sun: V3;
  /** The sun as shaders read it: that literal, or a host input. */
  readonly sunAt: Sun;
  readonly cameras: Readonly<Record<string, Camera>>;
  readonly outline: OutlineMethod;
  readonly loop: Loop;
};

/**
 * Assembles a scene: a ground, the things drawn (each a `Drawable`), a style, a sun direction above the horizon, and
 * optionally named cameras, an outline method and a loop period. Returns a `Scene`, which `compile` turns into an
 * artefact a host draws. The sky, ground and shadows are added to `things` for you. Throws if two things share a name,
 * the sun is not above the horizon, or the period is not a positive number of seconds.
 */
export function scene(spec: SceneSpec): Scene {
  refuseScene(spec);
  // Classified once: a bare vector is a fixed sun.
  const stated: readonly [number, number, number] = "kind" in spec.sun ? spec.sun.dir : spec.sun;
  const l = Math.hypot(...stated);
  if (!(stated[1] > 0.05 * l)) throw new Error(`scene: the sun must be above the horizon (sun.y > 0), got [${stated.join(", ")}]`);
  const sun: V3 = [stated[0] / l, stated[1] / l, stated[2] / l];
  const sunAt: Sun = "kind" in spec.sun ? { kind: "input", name: spec.sun.name, dir: sun } : { kind: "fixed", dir: sun };
  const things: Drawable[] = [sky, spec.ground, shadows, ...blockOf(spec.style), ...spec.things];
  const names = new Set<string>();
  for (const t of things) {
    if (names.has(t.name)) {
      const own = [sky, spec.ground, shadows, light].some((d) => d.name === t.name);
      throw new SceneError("scene()", `two things named "${t.name}"`, own ? `a name the scene's own ${t.name} does not take` : "a different name for each thing (names key shaders)", `rename one: "${t.name}2"`);
    }
    names.add(t.name);
  }
  if (spec.period !== undefined && !(spec.period > 0 && Number.isFinite(spec.period))) throw new Error(`scene: the period must be a positive number of seconds, got ${spec.period}`);
  const loop: Loop = spec.period === undefined ? OPEN : { kind: "every", seconds: spec.period };
  return { ground: spec.ground, things, style: spec.style, sun, sunAt, cameras: spec.cameras ?? {}, outline: spec.outline ?? DEFAULT_OUTLINE, loop };
}

/** A style that prints its shadow as a block after the bodies (`Style.block`) has it drawn by `light` (src/draw/light.ts). */
const blockOf = (style: Style): readonly Drawable[] => (style.block === undefined ? [] : [light]);

/** The same scene in another style: the things as written, and the new style's shadow block in place of the old one's. */
export function restyled(scene: Scene, style: Style): Scene {
  const written = scene.things.filter((t) => t !== light);
  const at = written.indexOf(shadows) + 1;
  return { ...scene, style, things: [...written.slice(0, at), ...blockOf(style), ...written.slice(at)] };
}

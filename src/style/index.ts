// Styles by name, and a scene drawn in another style. A look is a program (`Style`, src/style.ts); swapping it never
// touches the scene: the things, the sea and the cameras stay as written, only the program that lights and paints
// them changes.

import { restyled, type Scene } from "../scene.ts";
import type { Style } from "../style.ts";
import { biolume } from "./biolume.ts";
import { neon } from "./neon.ts";
import { papercraft } from "./papercraft.ts";
import { sketch } from "./sketch.ts";
import { toon } from "./toon.ts";
import { woodblock } from "./woodblock.ts";

/**
 * Every named style, each at its defaults. Constructors, not values: a style declares params, and params are global
 * by name (DESIGN.md 7.6), so a style is built when it is chosen, not when this module loads.
 */
export const STYLES = {
  toon: () => toon({ bands: 3, outline: 0.04 }),
  woodblock,
  biolume,
  papercraft,
  sketch,
  neon,
} as const satisfies Record<string, () => Style>;

export type StyleName = keyof typeof STYLES;
/**
 * The names of the built-in styles, as the keys of `STYLES` (`toon`, `woodblock`, `biolume`, `papercraft`, `sketch`,
 * `neon`); what `styleNamed` and the gallery's `--styles` accept.
 */
export const STYLE_NAMES = Object.keys(STYLES) as readonly StyleName[];

/** The named style; an unknown name throws, listing the known ones. */
export function styleNamed(name: string): Style {
  if (!(name in STYLES)) throw new Error(`unknown style "${name}" (styles: ${STYLE_NAMES.join(", ")})`);
  return STYLES[name as StyleName]();
}

/** The same scene drawn in another style. */
export function withStyle(scene: Scene, style: Style): Scene {
  return restyled(scene, style);
}

/** The same scene, its style in one of that style's named lightings (`Style.lights`); an unknown name throws, listing them. */
export function withLight(scene: Scene, name: string): Scene {
  const lights = scene.style.lights;
  if (lights === undefined) throw new Error(`the style "${scene.style.name}" has one lighting (no named ones to choose "${name}" from)`);
  const made = lights[name];
  if (made === undefined) throw new Error(`the style "${scene.style.name}" has no lighting "${name}" (lightings: ${Object.keys(lights).join(", ")})`);
  return restyled(scene, made());
}

// The parts every style is composed from (docs/styles.md), then the styles. A built-in style imports only these.
export { light, LIGHT, lit, litBodies, printedBlock, pullOf, markOf, blockInk, keyOf, type Bodies, type BlockInk, type Block, type Bokashi, type Cast, type Core, type Hatch, type Highlight, type Key, type LightName, type LightRecipe, type Overlap, type Pull, type Rim, type Terminator, type Waterline } from "./light.ts";
export { skyOf, type Sky, type SkyClouds, type SkySun, type Wash } from "./sky.ts";
export { swellLines, type SwellLines } from "./sea.ts";
export { contactFoam, marksFoam, printLayers, foam, marksAs, type ContactFoam, type FoamInk, type HeadSize, type InkLayers, type MarksPrint } from "./foam.ts";
export { rollingFoam, curledHeads, crown, behind, joined, rollOf, slopeOf, along, pixelOn, type Lean, type Roll, type White, type WhiteOn } from "./whitewater.ts";
export { paint, warmed, mottled, weighted, standsOut, type Hue, type LineWeight, type Mottle, type Warm } from "./paint.ts";
export { paperGrain, bloom, reflection } from "./post.ts";
export { edgeOf, pixelsInside, rgb, wgslRgb, POST_COMMON } from "./shared.ts";
export { toon, type ToonSpec } from "./toon.ts";
export { woodblock, print, seaPalette, LOOKS, REFERENCE_PAINT, WOODBLOCK_PALETTE, WOODBLOCK_SEA, type Accent, type AccentInk, type InkKey, type LookName, type Print, type SeaPalette, type WoodblockEye, type WoodblockInks, type WoodblockLook, type WoodblockSpec } from "./woodblock.ts";
export { biolume } from "./biolume.ts";
export { papercraft } from "./papercraft.ts";
export { sketch } from "./sketch.ts";
export { neon } from "./neon.ts";

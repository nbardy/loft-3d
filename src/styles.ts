// Styles layer: how a scene is painted. A style is one value of type `Style`; the named styles are compositions of the
// parts exported here (docs/styles.md), and a built-in style uses nothing a user cannot import. Appearance only; no
// geometry lives here.
export { palette, dorsalness, type Style, type ShadeCtx, type WaterCtx, type Contact, type LayerCtx, type SkyCtx, type GroundCtx } from "./style.ts";
// Styles and the parts they are composed from (src/style/index.ts, docs/styles.md). `Key`, `Cast` and `Layer` are taken
// by curves and expressions: the lighting recipe's are `LightKey` and `LightCast` here.
export {
  STYLES, STYLE_NAMES, styleNamed, withStyle, withLight, type StyleName,
  light, LIGHT, lit, litBodies, printedBlock, pullOf, markOf, blockInk, keyOf, type Bodies, type BlockInk, type Block, type Bokashi, type Cast as LightCast, type Core, type Hatch, type Highlight, type Key as LightKey, type LightName, type LightRecipe, type Overlap, type Pull, type Rim, type Terminator, type Waterline,
  skyOf, type Sky, type SkyClouds, type SkySun, type Wash,
  swellLines, type SwellLines,
  contactFoam, marksFoam, printLayers, foam, marksAs, type ContactFoam, type FoamInk, type HeadSize, type InkLayers, type MarksPrint,
  rollingFoam, curledHeads, crown, behind, joined, rollOf, slopeOf, along, pixelOn, type Lean, type Roll, type White, type WhiteOn,
  paint, warmed, mottled, weighted, standsOut, type Hue, type LineWeight, type Mottle, type Warm,
  paperGrain, bloom, reflection,
  edgeOf, pixelsInside, rgb, wgslRgb, POST_COMMON,
  toon, type ToonSpec,
  woodblock, print, seaPalette, LOOKS, REFERENCE_PAINT, WOODBLOCK_PALETTE, WOODBLOCK_SEA, type Accent, type AccentInk, type InkKey, type LookName, type Print, type SeaPalette, type WoodblockEye, type WoodblockInks, type WoodblockLook, type WoodblockSpec,
  biolume, papercraft, sketch, neon,
} from "./style/index.ts";
// What a style is written with beyond expressions: the shade context's block types, a colour's luminance, hashes and
// fragment-stage derivatives (noise2 and Branch are exported by the core layer).
export { type BlockCast, type BlockOverlap, type ShadowBlock } from "./style.ts";
export { noise3, hash2, hash22, cellular2, luminance, fwidth, pixelWorld, wgslFn } from "./lib/index.ts";

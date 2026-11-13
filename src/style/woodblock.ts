// Woodblock: a colour print. Bodies are flat areas from a fixed palette of five inks (indigo, a paler blue, cream,
// one vermilion accent, black), each chosen by the lit value of the paint in bands, so nothing on a body is a
// gradient. The black key line is the outline hull: geometry, thick and of even weight, antialiased by the frame's
// own multisampling. (It was a post pass that cut lines from depth and normal edges, one decision per pixel: the lines
// came out ragged and broken beside the hull outlines of the other styles, and it cost 0.37 ms a frame. 2026-11-11.)
// Then paper. The sea is flat blues with printed lines along the swell's contours and foam where it meets a body.
//
// What is woodblock's own here: its inks, the print rules (which paints print in which inks), the sea's palettes, the
// whirlpool's eye, and the looks. Everything else is a part (docs/styles.md): the lighting recipe (`litBodies`), paint
// treatments (`warmed`, `mottled`, `weighted`), the sky (`skyOf`), the swell's lines (`swellLines`), foam
// (`contactFoam`, `marksFoam`) and paper (`paperGrain`).

import { distance, dot, f, lt, min, mix, mul, param, select, smoothstep, sub, vec4, type Expr } from "../expr.ts";
import { luminance } from "../lib/index.ts";
import type { Rgb, ShadeCtx, Style } from "../style.ts";
import { contactFoam, foam, marksAs, marksFoam, printLayers, type ContactFoam, type FoamInk, type MarksPrint } from "./foam.ts";
import { LIGHT, litBodies, type Bodies, type BlockInk, type LightRecipe } from "./light.ts";
import { mottled, paint, standsOut, warmed, weighted, type Hue, type LineWeight, type Mottle, type Warm } from "./paint.ts";
import { paperGrain } from "./post.ts";
import { swellLines } from "./sea.ts";
import { edgeOf, rgb } from "./shared.ts";
import { skyOf, type Sky } from "./sky.ts";

/** The five inks. Everything a body shows is one of these (antialiased edges aside), unless a scene states its own. */
export const WOODBLOCK_PALETTE = {
  black: [0.075, 0.07, 0.09],
  indigo: [0.13, 0.2, 0.37],
  pale: [0.47, 0.6, 0.72],
  cream: [0.93, 0.88, 0.75],
  vermilion: [0.82, 0.25, 0.16],
} as const satisfies Record<string, Rgb>;

/** Sea inks: the print's water is its own blues (not body inks), darker in the troughs; haze at the horizon. */
export const WOODBLOCK_SEA = { deep: [0.11, 0.18, 0.35], mid: [0.16, 0.26, 0.45], line: [0.58, 0.68, 0.78], haze: [0.7, 0.76, 0.78] } as const satisfies Record<string, Rgb>;
const SEA = WOODBLOCK_SEA;

/**
 * The key block's four inks: the bands a body prints in by value (black, indigo, pale, cream), and what the sky, the
 * foam, the shadows and the paper are printed in. A scene may state its own.
 */
export type WoodblockInks = { readonly black: Rgb; readonly indigo: Rgb; readonly pale: Rgb; readonly cream: Rgb };

/**
 * Value bands, in lit luminance: below `black` the key block's black, then indigo, the pale blue, and cream. A paint
 * whose red stands above both its green and blue by `warm` prints vermilion whatever its value.
 */
const BAND = { black: 0.08, indigo: 0.34, pale: 0.6, warm: 0.28 } as const;
/** Two tones of light: a paint's luminance is multiplied by these on its shadow and lit sides before the bands. */
const TONES = { shadow: 0.66, lit: 1.06 } as const;

// ---- which paints print in which inks -------------------------------------------------------------------------------

/** One accent ink, printed where the paint's luminance is at least `from` (the first from 0; a paler one above it). */
export type AccentInk = { readonly ink: Rgb; readonly from: number };
/** The warm ink: paints that stand out as `hue` by `margin` print in it, flat (unlit: the accent is its own light). */
export type Accent = { readonly hue: Hue; readonly margin: number; readonly inks: readonly AccentInk[] };

/**
 * Which paints print in which inks (the rule a scene states):
 *  - `bands`: by value. The paint's luminance times a two-tone light, in bands of the key block's inks; an accent
 *    paint prints the accent. The print's own rule. A paint within `reach` (rgb distance) of a `named` key prints in
 *    that key's two inks instead: the one blue sail in a print that is otherwise black, indigo, cream and one warm ink.
 *  - `keys`: by name. Each key is a paint colour that prints in two inks of its own (in shadow, lit); a paint prints as
 *    the nearest key. A palette per monster (slate and olive coils); a key whose two inks are one is flat.
 *  - `overprint`: as painted. Every paint is already an ink: the lit side prints it, the shadow side prints it
 *    overprinted by `ink` (`amount` of it, then times `value`); a paint darker than `black` prints the key black.
 */
export type Print =
  | { readonly kind: "bands"; readonly accent: Accent; readonly named: readonly InkKey[]; readonly reach: number }
  | { readonly kind: "keys"; readonly keys: readonly InkKey[] }
  | { readonly kind: "overprint"; readonly ink: Rgb; readonly amount: number; readonly value: number; readonly black: number };
/** A key of the `keys` rule: the paint colour that names it, and the inks it prints in. */
export type InkKey = { readonly key: Rgb; readonly shadow: Rgb; readonly lit: Rgb };

const VERMILION: Accent = { hue: "red", margin: BAND.warm, inks: [{ ink: WOODBLOCK_PALETTE.vermilion, from: 0 }] };

/**
 * Builders for the rule that decides which ink a paint prints in under the woodblock style: `print.bands` (by the
 * paint's value, with a warm accent ink), `print.keys` (by the nearest of named paint colours) or `print.overprint`
 * (the paint as it is, the shadow side overprinted).
 */
export const print = {
  /** By value in bands, with the accent (vermilion for red paints by default). */
  bands(o: { readonly accent?: Accent; readonly named?: Readonly<Record<string, InkKey>>; readonly reach?: number } = {}): Print {
    const accent = o.accent ?? VERMILION;
    if (accent.inks.length === 0 || accent.inks[0]!.from !== 0) throw new Error("woodblock accent: give at least one ink, the first from 0");
    accent.inks.forEach((k, i) => { if (i > 0 && !(k.from > accent.inks[i - 1]!.from)) throw new Error(`woodblock accent: ink ${i} must start above ink ${i - 1} (from ${k.from})`); });
    const reach = o.reach ?? 0.2;
    if (!(reach > 0)) throw new Error(`woodblock bands: reach must be positive, got ${reach}`);
    return { kind: "bands", accent, named: Object.values(o.named ?? {}), reach };
  },
  /** By name: each paint prints in the inks of the nearest key. */
  keys(keys: Readonly<Record<string, InkKey>>): Print {
    const list = Object.values(keys);
    if (list.length === 0) throw new Error("woodblock keys: no keys");
    return { kind: "keys", keys: list };
  },
  /** As painted, the shadow side overprinted. */
  overprint(o: { readonly ink: Rgb; readonly amount: number; readonly value: number; readonly black: number }): Print {
    return { kind: "overprint", ...o };
  },
};

/**
 * The eye of a whirlpool: where a deformation's shading darkens the water below `below` (in the crest's units,
 * negative down), the key black is printed, `amount` of it. None by default.
 */
export type WoodblockEye = { readonly kind: "none" } | { readonly kind: "ink"; readonly below: number; readonly amount: number };

/**
 * The sea's inks. `swell`: the print's own (two blues split at the crest, pale lines). `deep`: one flat deep ink with
 * thin cream lines, as the reference prints (sea about (0.09, 0.2, 0.3), lines (0.78, 0.65, 0.5)); `trough` the darker
 * ink the troughs take, `width` the lines' half width as a share of their spacing, at trough and crest.
 */
export type SeaPalette =
  | { readonly kind: "swell" }
  | { readonly kind: "deep"; readonly sea: Rgb; readonly trough: Rgb; readonly line: Rgb; readonly width: readonly [number, number]; readonly haze: Rgb };

/**
 * Builders for the colours of the woodblock style's water (`SeaPalette`): `seaPalette.swell()` for the print's own two
 * blues, or `seaPalette.deep(overrides)` for one deep ink with thin pale lines.
 */
export const seaPalette = {
  swell: (): SeaPalette => ({ kind: "swell" }),
  deep: (o: Partial<Omit<Extract<SeaPalette, { kind: "deep" }>, "kind">> = {}): SeaPalette => ({
    kind: "deep", sea: o.sea ?? [0.08, 0.17, 0.3], trough: o.trough ?? [0.055, 0.12, 0.24], line: o.line ?? [0.8, 0.68, 0.52], width: o.width ?? [0.012, 0.04], haze: o.haze ?? [0.17, 0.24, 0.38],
  }),
};

export type WoodblockSpec = {
  /** The key block's inks. Default `WOODBLOCK_PALETTE`'s. */
  readonly inks?: Partial<WoodblockInks>;
  /** Which paints print in which inks. Default `print.bands()`. */
  readonly print?: Print;
  /** The sky (`skyOf`). Default: cream at the horizon, the haze washed in over 0..0.12, indigo over 0.18..0.5, the deep sea below. */
  readonly sky?: Partial<Sky>;
  readonly water?: { readonly eye?: WoodblockEye; /** The sea's inks. Default `seaPalette.swell()`, the print as it was. */ readonly palette?: SeaPalette };
  /**
   * The key line's width as a multiple of the param `woodblock.outline` (0.05 world units unless tuned). Default 1. A
   * factor, not a width: the param is one per process, and two styles declaring it with different defaults collide.
   */
  readonly outline?: number;
  /** How paints are inked before the print rule: hotter warm paints, mottling, the line's weight. Each off by default. */
  readonly paint?: { readonly warm?: Warm; readonly mottle?: Mottle; readonly line?: LineWeight };
  /** The pattern of the foam where a body meets the water. Default `foam.ridge()`, the print as it was. */
  readonly foam?: ContactFoam;
  /** How the foam the sea's deformations mark is printed. Default `marksAs.flat()`, the print as it was. */
  readonly marks?: MarksPrint;
  /**
   * How the bodies are lit: a recipe of shading treatments (src/style/light.ts; `LIGHT` has the named ones). Absent:
   * the print as it was, the rule's own two tones split at N.L = 0. Under a recipe the rule prints its lit inks and the
   * shadow is one overprinted block.
   */
  readonly light?: LightRecipe;
};

/** The accent ink for a paint: the first, and each paler one over it from its luminance up. */
function accentInk(a: Accent, base: Expr<"vec3">): Expr<"vec3"> {
  return a.inks.slice(1).reduce<Expr<"vec3">>((c, k) => mix(c, rgb(k.ink), edgeOf(luminance(base), k.from, 1e-5)), rgb(a.inks[0]!.ink));
}

/** 0 on the shadow side of the terminator, 1 lit: two tones of light, a hard edge. */
const litSide = (ctx: ShadeCtx): Expr<"f32"> => edgeOf(dot(ctx.normal, ctx.sun), 0.0, 1e-5);
/**
 * Which of a rule's two tones a fragment takes, asked for wherever the rule reads it: `litSide` for the print as it
 * was, all light under a recipe (whose block prints the shadow).
 */
type Lit = () => Expr<"f32">;

// Every edge here is antialiased by about a pixel and no more (`soft` is tiny): a wider minimum turned a slowly
// changing value (n.l across a grazing flank, a soft paint gradient) into a visible gradient between two inks, which
// the palette test caught on the shell.
/** By value: black, indigo, pale blue or cream by the lit value in bands; the accent's ink for an accent paint. */
function bands(inks: WoodblockInks, p: Extract<Print, { kind: "bands" }>, ctx: ShadeCtx, lit: Lit): Expr<"vec3"> {
  const accent = p.accent;
  const base = ctx.base;
  const value = mul(luminance(base), mix(TONES.shadow, TONES.lit, lit()));
  let c: Expr<"vec3"> = rgb(inks.black);
  c = mix(c, rgb(inks.indigo), edgeOf(value, BAND.black, 1e-5));
  c = mix(c, rgb(inks.pale), edgeOf(value, BAND.indigo, 1e-5));
  c = mix(c, rgb(inks.cream), edgeOf(value, BAND.pale, 1e-5));
  const byValue = mix(c, accentInk(accent, base), edgeOf(standsOut(accent.hue, base), accent.margin, 1e-5));
  return p.named.reduce<Expr<"vec3">>((out, k) =>
    mix(out, mix(rgb(k.shadow), rgb(k.lit), lit()), edgeOf(sub(p.reach, distance(base, rgb(k.key))), 0, 1e-5)), byValue);
}

/** By name: the nearest key's ink, in shadow or lit. */
function keyed(keys: readonly InkKey[], ctx: ShadeCtx, lit: Lit): Expr<"vec3"> {
  const side = lit();
  const inkOf = (k: InkKey) => mix(rgb(k.shadow), rgb(k.lit), side);
  let best: Expr<"f32"> = distance(ctx.base, rgb(keys[0]!.key));
  let colour = inkOf(keys[0]!);
  for (const k of keys.slice(1)) {
    const d = distance(ctx.base, rgb(k.key));
    colour = select(lt(d, best), inkOf(k), colour);
    best = min(best, d);
  }
  return colour;
}

/** As painted: lit side the paint, shadow side overprinted; near-black paint the key black on both. */
function overprinted(inks: WoodblockInks, o: Extract<Print, { kind: "overprint" }>, ctx: ShadeCtx, lit: Lit): Expr<"vec3"> {
  const shadow = mul(mix(ctx.base, rgb(o.ink), o.amount), o.value);
  return mix(rgb(inks.black), mix(shadow, ctx.base, lit()), edgeOf(luminance(ctx.base), o.black, 1e-5));
}

/** The rule's shading. One handler per rule. */
function printed(inks: WoodblockInks, p: Print, ctx: ShadeCtx, lit: Lit): Expr<"vec3"> {
  switch (p.kind) {
    case "bands": return bands(inks, p, ctx, lit);
    case "keys": return keyed(p.keys, ctx, lit);
    case "overprint": return overprinted(inks, p, ctx, lit);
  }
}

/**
 * The shadow block a rule prints under a recipe that states none: an overprint rule's own ink; for the rules whose
 * shadow is a second ink per paint (bands, keys), the key block's indigo at the crab's depth.
 */
function ownBlock(inks: WoodblockInks, p: Print): BlockInk {
  switch (p.kind) {
    case "bands": case "keys": return { ink: inks.indigo, amount: 0.42, value: 0.78 };
    case "overprint": return { ink: p.ink, amount: p.amount, value: p.value };
  }
}

/** The paints as a spec's paint options ink them: the shade context with its base repainted, and the line over a colour. */
type Painting = { readonly base: (ctx: ShadeCtx) => ShadeCtx; readonly line: (c: Expr<"vec3">, ctx: ShadeCtx) => Expr<"vec3"> };
function paintingOf(p: NonNullable<WoodblockSpec["paint"]>, inks: WoodblockInks): Painting {
  const warm = p.warm ?? { kind: "asPainted" }, mottle = p.mottle ?? { kind: "off" }, line = p.line ?? { kind: "even" };
  return {
    base: (ctx) => ({ ...ctx, base: mottled(mottle, warmed(warm, ctx.base), ctx) }),
    line: (c, ctx) => weighted(line, c, inks.black, ctx),
  };
}
/** No paint options: the context and the colour untouched (the print as it was, the same shader to the byte). */
const AS_PAINTED: Painting = { base: (ctx) => ctx, line: (c) => c };

/** The sea's inks: trough, crest, line, the lines' half widths (trough, crest) and the far haze. One handler per palette. */
type SeaInks = { readonly deep: Rgb; readonly mid: Rgb; readonly line: Rgb; readonly width: readonly [number, number]; readonly haze: Rgb };
function seaInks(p: SeaPalette): SeaInks {
  switch (p.kind) {
    case "swell": return { deep: SEA.deep, mid: SEA.mid, line: SEA.line, width: [0.025, 0.075], haze: SEA.haze };
    case "deep": return { deep: p.trough, mid: p.sea, line: p.line, width: p.width, haze: p.haze };
  }
}

/** The print as it was: the rule's two tones, split at N.L = 0. No post pass reads a mark. */
function asPrinted(inks: WoodblockInks, rule: Print, pt: Painting): Bodies {
  return { shade: (raw) => { const ctx = pt.base(raw); return pt.line(printed(inks, rule, ctx, () => litSide(ctx)), ctx); }, mark: () => f(1) };
}

/** Under a recipe: the rule's lit inks, the line on them before the block (the block over black is black). */
function underRecipe(inks: WoodblockInks, rule: Print, recipe: LightRecipe, pt: Painting): Bodies {
  return litBodies(recipe, ownBlock(inks, rule), (raw) => printed(inks, rule, pt.base(raw), () => f(1)), (c, raw) => pt.line(c, pt.base(raw)));
}

/** The whirlpool's eye printed black over the water, or nothing. */
function eyed(e: WoodblockEye, inks: WoodblockInks, c: Expr<"vec3">, crest: Expr<"f32">): Expr<"vec3"> {
  switch (e.kind) {
    case "none": return c;
    case "ink": return mix(c, rgb(inks.black), mul(edgeOf(mul(crest, -1), -e.below, 0.02), e.amount));
  }
}

/**
 * The woodblock print, with the scene's own inks, rule, sky and eye if it states them. Stated nothing, it is the print
 * as it was (`woodblock()` is unchanged pixel for pixel; examples/bosses/*.ts each wrapped it before these options).
 */
export function woodblock(spec: WoodblockSpec = {}): Style {
  const inks: WoodblockInks = { ...WOODBLOCK_PALETTE, ...spec.inks };
  const rule = spec.print ?? print.bands();
  const sky: Sky = {
    horizon: inks.cream, washes: [{ ink: SEA.haze, from: 0, to: 0.12 }, { ink: inks.indigo, from: 0.18, to: 0.5 }], below: SEA.deep,
    sun: { kind: "none" }, clouds: { kind: "none" }, ...spec.sky,
  };
  const eye: WoodblockEye = spec.water?.eye ?? { kind: "none" };
  const pattern: ContactFoam = spec.foam ?? foam.ridge();
  const crestPrint: MarksPrint = spec.marks ?? marksAs.flat();
  const width = param("woodblock.outline", 0.05, { min: 0, max: 0.2 });
  if (spec.outline !== undefined && !(spec.outline > 0)) throw new Error(`woodblock outline factor must be positive, got ${spec.outline}`);
  const outline = spec.outline === undefined ? width : mul(width, spec.outline);
  const pt: Painting = spec.paint === undefined ? AS_PAINTED : paintingOf(spec.paint, inks);
  const bodies: Bodies = spec.light === undefined ? asPrinted(inks, rule, pt) : underRecipe(inks, rule, spec.light, pt);
  const sea = seaInks(spec.water?.palette ?? seaPalette.swell());
  const foamInks: Record<FoamInk, Rgb> = { fill: inks.cream, line: inks.black, edge: inks.indigo };
  return {
    name: "woodblock",
    ...bodies,
    // The named recipes on this same print: what `--light name` chooses.
    lights: Object.fromEntries(Object.entries(LOOKS).map(([name, look]) => [name, () => woodblock(look.on(spec))])),
    // The key line: the hull, this wide in world units and never under 1.5 px.
    outline,
    clear: inks.cream,
    post: [paperGrain()],
    ink: () => rgb(inks.black),
    water: (ctx) => {
      const lines = swellLines(ctx, { perWave: 5, width: sea.width });
      // Two flat blues, trough and crest, split along the lines' own contour; the lines over them.
      let c: Expr<"vec3"> = mix(rgb(sea.deep), rgb(sea.mid), edgeOf(lines.swell, 0.2, 0.01));
      c = mix(c, rgb(sea.line), mul(lines.cover, 0.9));
      c = printLayers(c, contactFoam(pattern, ctx, lines), foamInks);
      // The far sea fades toward the haze at the horizon as a bokashi (a graded wiping of the block, as the sky's): two
      // flat steps at 70 and 140 units printed hard pale bands across the far sea, the second straight across a
      // maelstrom's view (examples/maelstrom.ts --style woodblock).
      c = mix(c, rgb(sea.haze), mul(smoothstep(50, 220, ctx.distance), 0.85));
      // The foam the sea's deformations give (a whirlpool's arms), printed over everything: it was left out, and
      // examples/bosses/maelstrom_wyrm.ts printed it back in by hand (2026-11-11). Zero without a deformation.
      c = printLayers(c, marksFoam(crestPrint, ctx), foamInks);
      // Opaque: a print shows nothing under its water.
      return vec4(eyed(eye, inks, c, ctx.crest), 1);
    },
    shadow: (ctx) => vec4(rgb(inks.indigo), mul(edgeOf(ctx.amount, 0.3, 0.01), 0.5)),
    // A plane: the paper under a light wash, its shadow cut flat in indigo as on the water, hazed toward the sky's own
    // horizon (whatever its grade) as the far sea is.
    ground: (ctx) => mix(mix(mul(rgb(inks.cream), 0.88), rgb(inks.indigo), mul(edgeOf(ctx.shadow, 0.3, 0.01), 0.5)), rgb(sky.horizon), mul(smoothstep(50, 220, ctx.distance), 0.85)),
    sky: (ctx) => skyOf(sky, ctx),
  };
}

// ---- looks: the named ways to print a scene, chosen by name (`--light`, a design's `light` look) ------------------------

/** The reference pictures' paint (crab_round4, lineup): hotter warm paints, mottled, the line swelling in shadow. */
export const REFERENCE_PAINT: NonNullable<WoodblockSpec["paint"]> = { warm: paint.hotter(), mottle: paint.mottle(), line: paint.swelling() };

/** A look: what it is for, and the spec it makes of a scene's own (the scene's inks, rule and foam kept). */
export type WoodblockLook = { readonly about: string; readonly on: (s: WoodblockSpec) => WoodblockSpec };
const lightOnly = (about: string, r: LightRecipe): WoodblockLook => ({ about, on: (s) => ({ ...s, light: r }) });
/** The reference palette over a spec: paint, a key line 1.4 times as heavy (0.07), the deep sea. */
const referenced = (s: WoodblockSpec): WoodblockSpec => ({ ...s, paint: REFERENCE_PAINT, outline: 1.4, water: { ...s.water, palette: seaPalette.deep() } });

/**
 * Every named look of the woodblock print: each recipe of `LIGHT` alone, the reference palette alone, and two
 * combinations of them. docs/lighting.md has a line each.
 */
export const LOOKS = {
  ...(Object.fromEntries(Object.entries(LIGHT).map(([name, r]) => [name, lightOnly(`the ${name} lighting recipe`, r)])) as Record<keyof typeof LIGHT, WoodblockLook>),
  /** The reference palette (hotter red, mottling, swelling lines, the deep sea with cream lines) with the print's own shading. */
  referencePalette: { about: "the reference palette with the print's own two tones", on: referenced },
  /** The video's look: the engraving (`hatched`) in the reference palette. */
  engraving: { about: "hatched, in the reference palette", on: (s) => referenced({ ...s, light: LIGHT.hatched }) },
  /** The video's look with the sun low behind: `sunset` in the reference palette. */
  engravingSunset: { about: "the sunset recipe, in the reference palette: the video at sunset", on: (s) => referenced({ ...s, light: LIGHT.sunset }) },
} satisfies Record<string, WoodblockLook>;
export type LookName = keyof typeof LOOKS;

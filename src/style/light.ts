// Lighting for a print: a recipe of shading treatments, each on or off with its own options (docs/lighting.md).
//
// A recipe is a value. Each treatment is a sum type with an `off`; one function (`lit`) combines them in a fixed order,
// with one handler per treatment. What they share is the print's shadow block: a tone, 1 where the block leaves the
// paper alone and 0 where it prints whole. The core shadow, the hatching, the waterline band and the wash each give a
// tone and the darkest wins (one block prints once, however many reasons it has to). The rim cuts its edge out of the
// block. The highlight is a lighter ink on what the block left unprinted. A style prints the block over its lit inks
// with `printedBlock`, or, when the recipe has shadows that fall from one thing on another (`cast`, `overlap`), hands
// the tone on in its mark and lets `src/draw/light.ts` lower it and print the block afterwards (`Style.block`).
//
// Inherited: the overprinted shadow block, bokashi, the engraver's swelling cross line, paper left for a light, the
// white line beside the key line (the print); two and three hard tones and a key light kept off the lens (cel
// animation). Ours: the terminator measured round a form's section, the block carried in the picture's alpha, hatching
// whose line count follows the screen.
//
// Any style lights its bodies by a recipe with `litBodies(recipe, ownBlock, ink, after)`: woodblock over its print rule,
// toon over its bands, sketch over bare paper.
//
// Cannot: more than one of each treatment (one hatch direction, one rim, one key per treatment); light that is not one
// direction for the whole picture (a lamp, a point light falling off); colour in the shadow other than one block ink
// (a shadow that turns cooler on blue paint and warmer on red); hatching anywhere but rings along a body's length (or
// level lines on a traced solid).
// Going past it: `lit` returns the colour and the tone separately, so a style can combine two recipes' tones with `min`
// (cross-hatching: a second hatch whose terminator sits deeper), choose an ink by the tone instead of overprinting one,
// or read `keyOf` for a light of its own. Relatives: a tone that is a stipple instead of lines (dots on a lattice in the
// anchor, their radius from the same terminator measure: the stipple foam's law moved onto the body); a hatch whose
// spacing follows the paint's value (darker paints closer lines, which is how an etcher holds local colour without ink).

import { abs, add, cross, div, dot, exp, f, floor, fract, gt, log, max, min, mix, mul, normalize, saturate, select, smoothstep, sqrt, sub, vec2, vec3, type Expr } from "../expr.ts";
import { luminance } from "../lib/index.ts";
import { hash2 } from "../lib/noise.ts";
import { fwidth, pixelWorld, wgslFn } from "../lib/wgsl.ts";
import type { BlockCast, BlockOverlap, Rgb, ShadeCtx, Style } from "../style.ts";
import { edgeOf, pixelsInside, rgb } from "./shared.ts";

type F = Expr<"f32">;
type V = Expr<"vec3">;

// ---- the treatments -------------------------------------------------------------------------------------------------

/**
 * Where the light that turns the forms comes from.
 *  - `sun`: the scene's sun.
 *  - `offLens`: the sun, but never nearer the lens than `least` degrees: when the camera looks down the sun (the
 *    game camera is 23 degrees off it, and a ball then shows 4% of itself in shadow) the form light is the sun swung
 *    away from the view axis, in the plane of the two, until it is `least` off. A camera already further off than
 *    that sees the sun itself. One direction for the whole picture; it turns with the camera, not with the things.
 *  - `camera`: a light fixed to the camera, `side` degrees right of the lens (negative: left) and `up` above it: the
 *    form light of a picture lit from behind (a sunset), where the sun leaves every face the camera sees in shadow and
 *    a printer still turns the forms toward the viewer. Cast shadows and rims still follow the sun.
 */
export type Key = { readonly kind: "sun" } | { readonly kind: "offLens"; readonly least: number } | { readonly kind: "camera"; readonly side: number; readonly up: number };

/**
 * Where the shadow side begins, as a signed measure that is positive in the light.
 *  - `sun`: N.K - at. `at` 0 is the geometric terminator; above 0 the shadow comes round toward the light.
 *  - `section`: N.K - at |K across the form|, the form's long direction being dP/dm of the surface's own coordinates.
 *    On a limb this puts the same share of every section in shadow however the limb points (a bare threshold blacks
 *    out a limb that points at the sun and pulses as it swings); on an end cap, and on a surface with no coordinates
 *    (a traced solid), it is the `sun` rule.
 */
export type Terminator =
  | { readonly kind: "sun"; readonly at: number; readonly key: Key }
  | { readonly kind: "section"; readonly at: number; readonly key: Key };

/** The core shadow: the block printed flat on the shadow side of `edge`. */
export type Core = { readonly kind: "off" } | { readonly kind: "flat"; readonly edge: Terminator };

/**
 * A third, lighter tone: `amount` of `ink` over the lit ink, hard-edged, where the surface faces half way between the
 * key and the eye within `size` degrees: a patch of sin^2(size) of a ball's disc, a stripe along a limb that lies
 * across that direction. Never under the block, nor on the key block's black.
 */
export type Highlight = { readonly kind: "off" } | { readonly kind: "shoulder"; readonly size: number; readonly ink: Rgb; readonly amount: number; readonly key: Key };

/**
 * Shadows one thing casts on another: from the capsules of every skeleton, onto bodies up to `reach` behind along the
 * sun. A capsule thinner than `thin` casts nothing (an antenna, a whisker, a ship's rigging: a print leaves those out).
 */
export type Cast = { readonly kind: "off" } | { readonly kind: "capsules"; readonly reach: number; readonly thin: number };

/** A flat band where a body stands in the water: `amount` of the block from the waterline up to `height`. */
export type Waterline = { readonly kind: "off" } | { readonly kind: "band"; readonly height: number; readonly amount: number };

/** A flat band on whatever lies less than `gap` behind a nearer part, `width` wide round that part's outline. */
export type Overlap = { readonly kind: "off" } | { readonly kind: "band"; readonly width: number; readonly gap: number; readonly amount: number };

/**
 * Bokashi, the one soft thing: the block wiped to a grade. `foot`: full at the water, gone `foot` above it (a wash
 * along one direction of the picture, as a printer wipes it). `under`: from nothing where the surface faces `under[0]`
 * downward (-N.y) to full at `under[1]` (the underside of every form). The darker of the two, times `amount`.
 */
export type Bokashi = { readonly kind: "off" } | { readonly kind: "wash"; readonly foot: number; readonly under: readonly [number, number]; readonly amount: number };

/**
 * Shadow carried by lines across the form (rings of constant length along a body's spine; level lines on a traced
 * solid). A line's weight swells from nothing `over` above `edge` (in N.K) to `cap` of the spacing `deep` below it.
 * `spacing`: world units between lines. `least`: the fewest pixels a period may take: nearer than that the lines keep
 * their spacing, further away every other line is dropped (cross-faded) and the rest thicken, so the tone holds and
 * nothing is drawn finer than the screen. Nearer, the lines split the same way (every period gains a line between), so
 * a close camera sees an engraving of about `least` to 2 `least` pixels a period, never a few fat stripes. Lines sit on
 * whole phases of the surface's own length, so a change of level adds or drops lines and never moves one.
 * `ragged`: each line's own terminator is moved by up to this much of N.K (a hash of the line's index), so the lines end
 * at different lengths, as an engraver's do, and the shadow's edge is a comb, not a ruled curve. 0: all end together.
 */
export type Hatch = { readonly kind: "off" } | { readonly kind: "cross"; readonly edge: Terminator; readonly over: number; readonly deep: number; readonly cap: number; readonly spacing: number; readonly least: number; readonly ragged: number };

/**
 * A light edge inside the key line where the surface turns from the eye on the key's side: `width` world units (never
 * under 1.5 pixels), `amount` of `ink`, cut out of the block. It reads only against a body the block has darkened.
 */
export type Rim = { readonly kind: "off" } | { readonly kind: "edge"; readonly width: number; readonly ink: Rgb; readonly amount: number; readonly key: Key };

/** The shadow block's ink: the style's own (its print rule's), or stated: a full shadow is mix(colour, ink, amount) * value. */
export type Block = { readonly kind: "rule" } | { readonly kind: "ink"; readonly ink: Rgb; readonly amount: number; readonly value: number };
export type BlockInk = { readonly ink: Rgb; readonly amount: number; readonly value: number };

export type LightRecipe = {
  readonly core: Core;
  readonly hatch: Hatch;
  readonly waterline: Waterline;
  readonly bokashi: Bokashi;
  readonly rim: Rim;
  readonly highlight: Highlight;
  readonly cast: Cast;
  readonly overlap: Overlap;
  readonly block: Block;
};

// ---- building one ---------------------------------------------------------------------------------------------------

const OFF = { kind: "off" } as const;
const CREAM: Rgb = [0.93, 0.88, 0.75];

function within(what: string, x: number, lo: number, hi: number): number {
  if (!(x >= lo && x <= hi)) throw new Error(`light: ${what} must be in [${lo}, ${hi}], got ${x}`);
  return x;
}
function positive(what: string, x: number): number {
  if (!(x > 0)) throw new Error(`light: ${what} must be positive, got ${x}`);
  return x;
}

/** The form light most recipes use: the sun kept 45 degrees off the lens. */
const OFF_LENS: Key = { kind: "offLens", least: 45 };

/** A terminator round the section at `at` (default 0.4), lit by `key` (default the sun kept 45 degrees off the lens). */
function section(o: { readonly at?: number; readonly key?: Key } = {}): Terminator {
  return { kind: "section", at: within("terminator", o.at ?? 0.4, -0.95, 0.95), key: o.key ?? OFF_LENS };
}

/**
 * Builders for the lighting treatments a style can lay over its bodies: `key` (where the light comes from), `edge`
 * (where a shadow begins on a form), and the treatments `core`, `highlight`, `cast`, `waterline`, `overlap`,
 * `bokashi`, `hatch`, `rim` and `block`, which `light.recipe` gathers into a `LightRecipe`. Each treatment is a
 * plain value; a treatment left out is off.
 */
export const light = {
  key: {
    sun: (): Key => ({ kind: "sun" }),
    offLens: (least = 45): Key => ({ kind: "offLens", least: within("offLens degrees", least, 0, 89) }),
    camera: (side = -35, up = 30): Key => ({ kind: "camera", side: within("camera key side (degrees)", side, -89, 89), up: within("camera key up (degrees)", up, -89, 89) }),
  },
  edge: {
    section,
    sun: (o: { readonly at?: number; readonly key?: Key } = {}): Terminator => ({ kind: "sun", at: within("terminator", o.at ?? 0.4, -0.95, 0.95), key: o.key ?? OFF_LENS }),
  },
  core: (edge: Terminator = section()): Core => ({ kind: "flat", edge }),
  highlight: (o: { readonly size?: number; readonly ink?: Rgb; readonly amount?: number; readonly key?: Key } = {}): Highlight =>
    ({ kind: "shoulder", size: within("highlight size (degrees)", o.size ?? 13, 1, 60), ink: o.ink ?? CREAM, amount: within("highlight amount", o.amount ?? 0.32, 0, 1), key: o.key ?? OFF_LENS }),
  cast: (o: { readonly reach?: number; readonly thin?: number } = {}): Cast => ({ kind: "capsules", reach: positive("cast reach", o.reach ?? 9), thin: o.thin ?? 0.13 }),
  waterline: (o: { readonly height?: number; readonly amount?: number } = {}): Waterline =>
    ({ kind: "band", height: positive("waterline height", o.height ?? 0.22), amount: within("waterline amount", o.amount ?? 1, 0, 1) }),
  overlap: (o: { readonly width?: number; readonly gap?: number; readonly amount?: number } = {}): Overlap =>
    ({ kind: "band", width: positive("overlap width", o.width ?? 0.16), gap: positive("overlap gap", o.gap ?? 1.6), amount: within("overlap amount", o.amount ?? 1, 0, 1) }),
  bokashi: (o: { readonly foot?: number; readonly under?: readonly [number, number]; readonly amount?: number } = {}): Bokashi => {
    const under = o.under ?? [-0.15, 0.75];
    if (!(under[1] > under[0])) throw new Error(`light: bokashi under must rise, got [${under.join(", ")}]`);
    return { kind: "wash", foot: positive("bokashi foot", o.foot ?? 2.2), under, amount: within("bokashi amount", o.amount ?? 1, 0, 1) };
  },
  hatch: (o: { readonly edge?: Terminator; readonly over?: number; readonly deep?: number; readonly cap?: number; readonly spacing?: number; readonly least?: number; readonly ragged?: number } = {}): Hatch => ({
    kind: "cross", edge: o.edge ?? section({ at: 0.3, key: { kind: "offLens", least: 60 } }), over: positive("hatch over", o.over ?? 0.16), deep: positive("hatch deep", o.deep ?? 0.32),
    cap: within("hatch cap", o.cap ?? 0.72, 0, 1), spacing: positive("hatch spacing", o.spacing ?? 0.2), least: positive("hatch least pixels", o.least ?? 5),
    ragged: within("hatch ragged", o.ragged ?? 0.1, 0, 0.5),
  }),
  rim: (o: { readonly width?: number; readonly ink?: Rgb; readonly amount?: number; readonly key?: Key } = {}): Rim =>
    ({ kind: "edge", width: positive("rim width", o.width ?? 0.1), ink: o.ink ?? CREAM, amount: within("rim amount", o.amount ?? 0.9, 0, 1), key: o.key ?? { kind: "sun" } }),
  block: (o: BlockInk): Block => ({ kind: "ink", ink: o.ink, amount: within("block amount", o.amount, 0, 1), value: within("block value", o.value, 0, 1) }),
  /** A recipe from the treatments given; every other one is off, and the block is the style's own ink. */
  recipe: (r: Partial<LightRecipe> = {}): LightRecipe =>
    ({ core: OFF, hatch: OFF, waterline: OFF, bokashi: OFF, rim: OFF, highlight: OFF, cast: OFF, overlap: OFF, block: { kind: "rule" }, ...r }),
};

// ---- the library ----------------------------------------------------------------------------------------------------

/**
 * The engraver's ink: each colour's own shade, not black (black lines over cream read as a zebra, 2026-11-12): a full
 * line is 55% of a near-black brown over the colour, at 60% value. Brick (0.66, 0.22, 0.13) lines in (0.26, 0.08, 0.06),
 * cream in a warm grey (0.29, 0.25, 0.22).
 */
const ENGRAVED: Block = light.block({ ink: [0.12, 0.04, 0.06], amount: 0.6, value: 0.5 });

/** A deeper, warmer block than the crab's indigo: a shadow of about 60% of the ink's value that keeps its hue. */
const WARM: Block = light.block({ ink: [0.2, 0.1, 0.12], amount: 0.3, value: 0.9 });

/**
 * The named recipes (docs/lighting.md has a line each, with what it costs). `woodblock({ light: LIGHT.threeTone })`, or
 * `--light threeTone` on any scene drawn in the woodblock style.
 */
export const LIGHT = {
  /** No shading at all: every surface in its lit ink, the key line and nothing else. */
  flat: light.recipe(),
  /** Two tones: the shadow side of every form, and the shadows the parts cast on each other. */
  twoTone: light.recipe({ core: light.core(), cast: light.cast(), block: WARM }),
  /** Two tones and a third: a hard lighter shape on every form's sunward shoulder. */
  threeTone: light.recipe({ core: light.core(), cast: light.cast(), highlight: light.highlight(), block: WARM }),
  /** Flat inks with a graded wash under every form and up from the water. The one soft recipe. */
  // The wash from a form's middle down (the painted reference grades a form's whole lower half into indigo), in the
  // print's indigo, deeper than the core's block: a grade that stops at a quarter strength reads as dirt, not form.
  bokashi: light.recipe({ bokashi: light.bokashi({ under: [-0.3, 0.55] }), block: light.block({ ink: [0.13, 0.2, 0.37], amount: 0.62, value: 0.72 }) }),
  /** The shadow side drawn in lines across the form that swell as it turns away; no flat shadow. */
  hatched: light.recipe({ hatch: light.hatch(), block: ENGRAVED }),
  /** Flat inks, and a dark band wherever a part lies on another or stands in the water. */
  contact: light.recipe({ waterline: light.waterline(), overlap: light.overlap({ width: 0.22 }), cast: light.cast({ reach: 1.2 }), block: WARM }),
  /** Night, a storm, a lamp behind: the body mostly in a deep indigo block, a cream edge toward the light. */
  rim: light.recipe({
    core: light.core(light.edge.sun({ at: 0.72, key: light.key.sun() })), rim: light.rim(), cast: light.cast(),
    block: light.block({ ink: [0.1, 0.13, 0.3], amount: 0.62, value: 0.8 }),
  }),
  /** The cel set: two tones, cast shadows, contact bands and sparse highlights. The nearest honest match to the painted `shade_best`. */
  cel: light.recipe({
    core: light.core(), cast: light.cast(), highlight: light.highlight(), waterline: light.waterline({ height: 0.14 }), overlap: light.overlap({ width: 0.1, gap: 1.2 }), block: WARM,
  }),
  /**
   * The sun low behind the subject: the forms turned by a light fixed up and left of the camera (hatched, as the
   * engraving), the shadow block lifted and violet so no face goes black, and a warm gold rim on the sunward edge.
   */
  sunset: light.recipe({
    hatch: light.hatch({ edge: light.edge.section({ at: 0.2, key: light.key.camera(-35, 30) }) }),
    // The undersides washed into the violet, so the picture is lit from behind and not at noon; the faces' upper halves
    // keep their lit ink.
    bokashi: light.bokashi({ foot: 1.5, under: [-0.25, 0.7], amount: 0.6 }),
    rim: light.rim({ width: 0.09, ink: [1.0, 0.7, 0.32], amount: 0.95 }),
    block: light.block({ ink: [0.3, 0.12, 0.32], amount: 0.5, value: 0.72 }),
  }),
} as const satisfies Record<string, LightRecipe>;
export type LightName = keyof typeof LIGHT;

// ---- what a camera and a surface know ---------------------------------------------------------------------------------

/** The unit direction from the picture toward the eye, one for the whole frame (minus the camera's forward). GPU-only. */
const towardEye = wgslFn<"vec3">({ name: "loft_toward_eye", ret: "vec3", wgsl: "fn loft_toward_eye() -> vec3<f32> { return -frame.forward.xyz; }" });

/**
 * A surface's long direction at a fragment, as a vector no longer than 1: the direction of the gradient over the
 * surface of the length along it (a body's anchor is its skin straightened at rest, x the arc length of its spine), at
 * full length on a shaft, where that gradient is about 1, and fading to nothing on an end cap, where the length
 * barely changes. From the screen derivatives of the world point and of that length. Fragment stage only.
 * (First tried as dP/dm from the derivatives of the body coordinates: on an end cap that is radial, not the spine, and
 * it stepped from triangle to triangle; the face printed sawteeth. 2026-11-12.)
 */
const longDir = wgslFn<"vec3">({
  name: "loft_long_dir", ret: "vec3",
  wgsl: /* wgsl */ `fn loft_long_dir(p: vec3<f32>, n: vec3<f32>, s: f32) -> vec3<f32> {
  let px = dpdx(p);
  let py = dpdy(p);
  let det = dot(n, cross(px, py));
  let g = (cross(py, n) * dpdx(s) + cross(n, px) * dpdy(s)) / select(1.0, det, abs(det) > 1e-12);
  let l = length(g);
  // Its direction, weighted by how much of a shaft this is: the gradient's size wanders with every bulge of the skin
  // (and from one triangle to the next), and a threshold scaled by it stepped along the grid.
  return select(vec3<f32>(0.0), g / max(l, 1e-6) * smoothstep(0.25, 0.6, l), abs(det) > 1e-12 && l < 4.0);
}`,
});

/** How fast a value changes across the screen, per pixel (the length of its screen gradient). Fragment stage only. */
const screenRate = wgslFn<"f32">({ name: "loft_screen_rate", ret: "f32", wgsl: "fn loft_screen_rate(x: f32) -> f32 { return length(vec2<f32>(dpdx(x), dpdy(x))); }" });

/** The key light's direction. One handler per kind. */
export function keyOf(k: Key, ctx: ShadeCtx): V {
  switch (k.kind) {
    case "sun": return ctx.sun;
    case "offLens": return offLens(ctx.sun, k.least);
    case "camera": return cameraKey(k.side, k.up);
  }
}

/** A direction fixed to the camera: toward the eye turned `side` degrees right and `up` degrees up. */
function cameraKey(side: number, up: number): V {
  const s = (side * Math.PI) / 180, u = (up * Math.PI) / 180;
  const eye = towardEye();
  // The camera's right and up from its forward and the world's up, as the host's lookAt makes them.
  const right = normalize(cross(mul(eye, -1), vec3(0, 1, 0)));
  const upward = cross(right, mul(eye, -1));
  return normalize(add(add(mul(eye, Math.cos(s) * Math.cos(u)), mul(right, Math.sin(s) * Math.cos(u))), mul(upward, Math.sin(u))));
}

/** The sun swung away from the eye, in the plane of the two, until it is `least` degrees off the view axis. */
function offLens(sun: V, least: number): V {
  const a = (least * Math.PI) / 180;
  const eye = towardEye();
  const along = dot(sun, eye);
  // The sun's part across the view; a sun dead behind the lens has none, and is swung upward.
  const across = add(sub(sun, mul(eye, along)), vec3(0, 1e-4, 0));
  const swung = add(mul(normalize(across), Math.sin(a)), mul(eye, Math.cos(a)));
  return select(gt(along, Math.cos(a)), swung, sun);
}

/**
 * How much of a direction lies across the form's long direction, 0..1. 1 on an end cap, and on a surface with no
 * coordinates of its own (a traced solid, whose `uv` is (0, 0) and whose anchor is only its world point).
 */
function across(dir: V, ctx: ShadeCtx): F {
  const d = dot(dir, longDir(ctx.world, ctx.normal, ctx.anchor.x));
  return select(gt(dot(ctx.uv, ctx.uv), 0), sqrt(max(sub(1, mul(d, d)), 0)), 1);
}

/** The terminator's measure: positive in the light. One handler per rule. */
function turn(t: Terminator, ctx: ShadeCtx): F {
  const key = keyOf(t.key, ctx);
  switch (t.kind) {
    case "sun": return sub(dot(ctx.normal, key), t.at);
    case "section": return sub(dot(ctx.normal, key), mul(across(key, ctx), t.at));
  }
}

/** Height above the water. */
const above = (ctx: ShadeCtx): F => mul(ctx.depth, -1);

// ---- one handler per treatment: each a tone, 1 where the block does not print ----------------------------------------

function cored(c: Core, ctx: ShadeCtx): F {
  switch (c.kind) {
    case "off": return f(1);
    case "flat": return edgeOf(turn(c.edge, ctx), 0, 1e-5);
  }
}

function hatched(h: Hatch, ctx: ShadeCtx): F {
  switch (h.kind) {
    case "off": return f(1);
    case "cross": return sub(1, crossLines(h, ctx));
  }
}

/** The lines' coverage, 0..1. */
function crossLines(h: Extract<Hatch, { kind: "cross" }>, ctx: ShadeCtx): F {
  // The share of a period a line takes: nothing `over` above the terminator, `cap` at `deep` below it.
  const measure = turn(h.edge, ctx);
  // Rings seen end on (a limb pointing at the eye, an eyelid) print as a bullseye: none where the form's long direction
  // is within about 20 degrees of the view.
  const sideOn = sub(1, smoothstep(0.8, 0.95, abs(dot(longDir(ctx.world, ctx.normal, ctx.anchor.x), ctx.view))));
  const duty = (p: F, k: F): F => {
    // Each line ends at its own place: its terminator moved by a hash of its index on the finest level (p's phases are
    // line centres; dividing by k, p's lines per phase, names a line the same at every level, so a level change does
    // not change a line's length).
    const jag = mul(sub(hash2(vec2(div(floor(add(p, 0.5)), k), 0.37)), 0.5), 2 * h.ragged);
    return mul(mul(saturate(div(sub(h.over, add(measure, jag)), h.over + h.deep)), h.cap), sideOn);
  };
  // Along the form: a body's anchor is its skin straightened at rest (x the length along the spine); a traced solid's
  // is its world point, where lines at level heights are the engraver's for a cliff or a crown.
  const along = select(gt(dot(ctx.uv, ctx.uv), 0), ctx.anchor.x, ctx.anchor.y);
  const phase = div(along, h.spacing);
  // Octaves by screen size: a period is never under `least` pixels. Level k keeps every 2^k-th line (lines sit on
  // whole phases, so a coarser level's are among a finer one's); between two levels the dropped lines fade.
  // Measured on the lines themselves (how many periods a pixel crosses), not from the world size of a pixel: where a
  // form's length runs toward the camera its rings crowd on screen, and a level from the pixel's world size left them
  // two pixels apart on the head in `face` (2026-11-12). Negative near (lines split), positive far (lines merge to
  // tone); four splits at most.
  const rate = max(screenRate(phase), 1e-6);
  const level = max(div(log(mul(rate, h.least)), Math.LN2), -4);
  const whole = floor(level), part = sub(level, whole);
  const scale = exp(mul(whole, -Math.LN2));
  const fw = max(mul(fwidth(phase), scale), 1e-5);
  const line = (p: F, w: F, k: F): F => {
    const off = abs(sub(fract(add(p, 0.5)), 0.5));
    const d = duty(p, k);
    const half = mul(d, 0.5);
    // A line thinner than about a pixel prints as its share of that pixel.
    return mul(sub(1, smoothstep(sub(half, mul(w, 0.75)), add(half, mul(w, 0.75)), off)), saturate(div(d, mul(w, 1.5))));
  };
  const fine = mul(phase, scale);
  return mix(line(fine, fw, scale), line(mul(fine, 0.5), mul(fw, 0.5), mul(scale, 0.5)), smoothstep(0.15, 0.85, part));
}

function waterlined(w: Waterline, ctx: ShadeCtx): F {
  switch (w.kind) {
    case "off": return f(1);
    case "band": return sub(1, mul(edgeOf(sub(w.height, above(ctx)), 0, 1e-5), w.amount));
  }
}

function washed(b: Bokashi, ctx: ShadeCtx): F {
  switch (b.kind) {
    case "off": return f(1);
    case "wash": {
      const foot = sub(1, smoothstep(0, b.foot, above(ctx)));
      const under = smoothstep(b.under[0], b.under[1], mul(ctx.normal.y, -1));
      return sub(1, mul(max(foot, under), b.amount));
    }
  }
}

/** The rim: how much of its edge is here (0 for none), and its ink. */
function rimmed(r: Rim, ctx: ShadeCtx): { readonly edge: F; readonly ink: Rgb } {
  switch (r.kind) {
    case "off": return { edge: f(0), ink: [0, 0, 0] };
    case "edge": {
      const away = pixelsInside(ctx);
      const wide = max(div(r.width, pixelWorld(ctx.world)), 1.5);
      const inside = sub(1, smoothstep(sub(wide, 0.75), add(wide, 0.75), away));
      return { edge: mul(mul(inside, edgeOf(dot(ctx.normal, keyOf(r.key, ctx)), 0.12, 1e-5)), r.amount), ink: r.ink };
    }
  }
}

/** The highlight on a colour the block has left `tone` unprinted. */
function highlit(h: Highlight, c: V, tone: F, ctx: ShadeCtx): V {
  switch (h.kind) {
    case "off": return c;
    case "shoulder": {
      const half = normalize(add(keyOf(h.key, ctx), towardEye()));
      // A plain cone about the half vector, not measured round the section as the terminator is: where a face is
      // nearly flat the surface faces the half vector almost evenly, and the small steps of a section's measure from
      // one triangle to the next moved this edge by many pixels (a palm's highlight came out in stairs).
      const shape = edgeOf(dot(ctx.normal, half), Math.cos((h.size * Math.PI) / 180), 1e-5);
      // Not on the key block's black (a painted line, a pupil): a light on black is grey.
      const inked = edgeOf(luminance(c), 0.12, 1e-5);
      return mix(c, rgb(h.ink), mul(mul(mul(shape, tone), inked), h.amount));
    }
  }
}

// ---- the recipe ---------------------------------------------------------------------------------------------------------

/**
 * A recipe over a lit ink: the colour before the block (the highlight and the rim on it) and the block's tone. The
 * fixed order: the block's own prints, the darkest winning (core, hatching, waterline, wash); the rim's edge cut out of
 * the block; the highlight on what the block left; the rim's ink.
 */
export function lit(r: LightRecipe, ink: V, ctx: ShadeCtx): { readonly colour: V; readonly tone: F } {
  const rim = rimmed(r.rim, ctx);
  const tone = max(min(min(cored(r.core, ctx), hatched(r.hatch, ctx)), min(waterlined(r.waterline, ctx), washed(r.bokashi, ctx))), rim.edge);
  return { colour: mix(highlit(r.highlight, ink, tone, ctx), rgb(rim.ink), rim.edge), tone };
}

/** What a style's bodies are: their colour, their mark, and the shadow block if one is printed after them. */
export type Bodies = Pick<Style, "shade" | "mark" | "block">;

/**
 * A style's bodies lit by a recipe: `ink` is the colour a body has in full light (whatever the style makes of its
 * paint), `after` a last touch on the lit colour before the block prints over it (a key line: the block over black is
 * black), `own` the block's ink where the recipe states none (`block: { kind: "rule" }`). With nothing cast from one
 * thing on another the block is printed in each fragment; otherwise its tone goes in the mark and the block is printed
 * after the bodies (`Style.block`), `shade` staying the whole colour for a fragment shaded alone (a smear).
 *
 * Cannot: light anything but bodies (water and sky have their own functions), or change the order of the treatments
 * (`lit`'s). A colour that depends on the tone (a paint that changes hue in shadow) needs `lit` directly.
 * Going past it: call `lit(recipe, ink, ctx)` yourself and print `printedBlock(pullOf(...), colour, tone)` however you
 * like: two recipes whose tones are combined by `min` (cross-hatching in two directions), a tone that picks an ink.
 */
export function litBodies(recipe: LightRecipe, own: BlockInk, ink: (ctx: ShadeCtx) => V, after: (c: V, ctx: ShadeCtx) => V = (c) => c): Bodies {
  const pull = pullOf(blockInk(recipe.block, own));
  const both = (ctx: ShadeCtx) => { const b = lit(recipe, ink(ctx), ctx); return { colour: after(b.colour, ctx), tone: b.tone }; };
  const whole: Bodies["shade"] = (ctx) => { const b = both(ctx); return printedBlock(pull, b.colour, b.tone); };
  const cast = castOf(recipe.cast), overlap = overlapOf(recipe.overlap);
  if (cast.kind === "none" && overlap.kind === "none") return { shade: whole, mark: () => f(1) };
  return { shade: whole, mark: (ctx) => markOf(pull, both(ctx).tone), block: { body: (ctx) => both(ctx).colour, ink: pull.add, floor: pull.floor, cast, overlap } };
}

/** The block's ink: the style's own, or the recipe's. */
export function blockInk(b: Block, own: BlockInk): BlockInk {
  switch (b.kind) {
    case "rule": return own;
    case "ink": return b;
  }
}

/**
 * How a block prints, as the two numbers a blend needs: where the tone is t the picture is colour * m + `add` * (1 - m)
 * with m = mix(`floor`, 1, t). At t = 0 that is mix(colour, ink, amount) * value.
 */
export type Pull = { readonly floor: number; readonly add: Rgb };
/**
 * Reduces a shadow block's ink to the two numbers a blend needs (`floor` and `add`), so a tone can be printed over a
 * colour; throws if the block would print nothing.
 */
export function pullOf(b: BlockInk): Pull {
  const floor = (1 - b.amount) * b.value;
  if (!(floor < 1 - 1e-3)) throw new Error(`light: the shadow block prints nothing (amount ${b.amount}, value ${b.value}); give it an ink`);
  const k = (b.amount * b.value) / (1 - floor);
  return { floor, add: [b.ink[0] * k, b.ink[1] * k, b.ink[2] * k] };
}

/** The tone as the picture's alpha carries it: `floor` under a whole block, 1 where it does not print. */
export const markOf = (p: Pull, tone: F): F => mix(p.floor, 1, tone);

/** The block printed over a colour, in the fragment itself. */
export function printedBlock(p: Pull, colour: V, tone: F): V {
  const m = markOf(p, tone);
  return add(mul(colour, m), mul(rgb(p.add), sub(1, m)));
}

/** What of a recipe is printed after the bodies are drawn. One handler per treatment. */
export function castOf(c: Cast): BlockCast {
  switch (c.kind) {
    case "off": return { kind: "none" };
    case "capsules": return { kind: "capsules", reach: c.reach, thin: c.thin };
  }
}
export function overlapOf(o: Overlap): BlockOverlap {
  switch (o.kind) {
    case "off": return { kind: "none" };
    case "band": return { kind: "band", width: o.width, gap: o.gap, amount: o.amount };
  }
}

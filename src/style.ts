// A style is a program in the same expression language (DESIGN.md 2.6): it maps a shading context to a colour. The
// compiler emits `shade`, `ink`, `water` and `sky` once into `sceneWgsl` as functions shared by every shader, so a
// style is swappable without touching a scene. The styles and the parts they are built from: src/style/, docs/styles.md.

import { add, clamp, fract, leaves, lift, mix, mul, sin, smoothstep, sub, abs, TAU, variable, type Expr, type In } from "./expr.ts";
import type { PostSpec } from "./compile/context.ts";

export type Rgb = readonly [number, number, number];

/** What a body fragment knows. Directions are unit vectors; `view` points from the surface toward the eye. */
export type ShadeCtx = {
  readonly base: Expr<"vec3">;
  readonly normal: Expr<"vec3">;
  readonly sun: Expr<"vec3">;
  readonly view: Expr<"vec3">;
  readonly world: Expr<"vec3">;
  /** Depth below the sea surface (negative above it). */
  readonly depth: Expr<"f32">;
  /** The surface's own coordinates (u, v) here (body coordinates (m, v) on a body); (0, 0) on a traced solid. */
  readonly uv: Expr<"vec2">;
  /**
   * The surface's anchor here (`Surface.anchor`): a point fixed to the thing, at about world scale. Patterns written
   * over it (facets, line wobble, hatching) ride a moving body instead of sliding through it. On a traced solid, the
   * world point.
   */
  readonly anchor: Expr<"vec3">;
  /** A stable identity of the thing in [0, 1): a hash of the drawable's name, varied per copy of `draw.points`. */
  readonly id: Expr<"f32">;
};

/** What a sea fragment knows: its normal, and the foam the compiler derived for this pixel. */
export type WaterCtx = {
  readonly normal: Expr<"vec3">;
  readonly sun: Expr<"vec3">;
  readonly view: Expr<"vec3">;
  readonly world: Expr<"vec3">;
  /** Height of the swell here as a share of its amplitude, -1 trough to 1 crest. */
  readonly crest: Expr<"f32">;
  /** Distance from the eye. */
  readonly distance: Expr<"f32">;
  /** Foam coverage, 0..1, antialiased: where the water meets a body (from the opaque scene's depth). */
  readonly foam: Expr<"f32">;
  /**
   * Whether a body is near, as the sea found it. `foam` is its band shaped one way; a style that wants its own shape
   * (clawed, scalloped) dispatches on this.
   */
  readonly contact: Contact;
  /**
   * The foam the sea's deformations mark on the water here (a whirlpool's arms), 0..1, antialiased; 0 on a sea without
   * deformations. `foam` already holds it (the larger of this and the contact foam); a style that shapes its own
   * contact foam from `contact` prints this beside it.
   */
  readonly marks: Expr<"f32">;
  /**
   * Which way the marks' foam leans, on the sea plane (x, z): outward for a ring wave. Zero where no deformation that
   * has a lean marks the water (a whirlpool has none).
   */
  readonly marksLean: Expr<"vec2">;
  /** The direction the largest swell travels, a unit vector on the sea plane (x, z); zero on a sea without swell. */
  readonly swell: Expr<"vec2">;
  /**
   * Where on the swell this is: the phase of the largest swell component, in cycles (one per wavelength, increasing
   * along its direction of travel; a crest at fract = 0.25). Lines of constant phase run along the crests, so a style
   * can print lines that follow the swell; 0 everywhere on a sea without swell.
   */
  readonly phase: Expr<"f32">;
};

/**
 * How near a body is to a pixel of water. The sea draws its water in cases (src/geom/sea.ts) and tells the style which
 * one it is in, so a style prints its contact foam only where a body can be near and does not compute it elsewhere.
 */
export type Contact =
  /**
   * No opaque surface lies within the sea's search of this pixel (or of the other pixels of its 2 x 2 quad): the
   * band would be below -800 here, where every contact term of every style is exactly 0. `foam` holds only the
   * deformations' marks. A style prints no contact foam.
   */
  | { readonly kind: "clear" }
  /**
   * A body may be near. `band`: how close, continuously: 1 at the body, 0 at the sea's foam width, negative beyond it
   * (as far as the search sees). It is grainy from pixel to pixel and sits on two plateaus (src/geom/sea.ts,
   * `loft_contact_band`): good for a soft edge or for specks, not for a clean shape. `level`: the same closeness without
   * the grain or the plateaus, one value per 2 x 2 pixels (`loft_contact_level`), for a style that cuts flat shapes
   * from it. Each is computed only if the style reads it. `toward`: the unit direction across the water (x, z) to the nearest
   * body point, zero where there is none: the way `level` rises, by 1 / `width` a world unit, so the level a short way
   * off is known to first order (a shape can be sized by the level at its own centre and stay whole). It comes with
   * `level`. `width`: the sea's foam width, world units (the distance over which both fall from 1 to 0), so a
   * pattern can size itself to the scene's sea.
   */
  | { readonly kind: "near"; readonly band: Expr<"f32">; readonly level: Expr<"f32">; readonly toward: Expr<"vec2">; readonly width: number };

/** A layer laid on the water after it is drawn (a cast shadow, a marker): where, and how much of it covers here. */
export type LayerCtx = {
  readonly world: Expr<"vec3">;
  readonly view: Expr<"vec3">;
  readonly distance: Expr<"f32">;
  /** Coverage, 0..1, antialiased. */
  readonly amount: Expr<"f32">;
};

export type SkyCtx = { readonly dir: Expr<"vec3">; readonly sun: Expr<"vec3"> };

/** What a fragment of a plane ground knows (src/draw/ground.ts): where it is, and how much of a cast shadow covers it. */
export type GroundCtx = {
  readonly world: Expr<"vec3">;
  readonly view: Expr<"vec3">;
  readonly sun: Expr<"vec3">;
  readonly distance: Expr<"f32">;
  /** Cast shadow coverage, 0..1, antialiased: the shadow is drawn as the ground's own colour at this coverage. */
  readonly shadow: Expr<"f32">;
};

/**
 * A shadow printed as a block after the bodies are drawn (docs/lighting.md). A style that has one writes a tone in its
 * `mark` (the picture's alpha): 1 where nothing prints, down to `floor` where the block prints whole. Its bodies are
 * drawn in `body`'s colour; `light` (src/draw/light.ts) then lowers the tone where a thing casts a shadow on another
 * or lies over it (blending with min, so shadows over each other are one shadow), and prints the block once:
 * picture * tone + `ink` * (1 - tone). The style's own post passes then find alpha 1 on every body.
 */
export type ShadowBlock = {
  /** A body's colour before the block is printed. `Style.shade` stays the whole colour, for a fragment shaded on its own. */
  body(ctx: ShadeCtx): Expr<"vec3">;
  /** The ink the block adds where it prints whole, already scaled: a full shadow is colour * `floor` + `ink` * (1 - `floor`). */
  readonly ink: Rgb;
  /** The tone of a full shadow, in (0, 1). */
  readonly floor: number;
  /** Shadows a thing casts on the others. */
  readonly cast: BlockCast;
  /** A band on whatever lies close behind a nearer part. */
  readonly overlap: BlockOverlap;
};
export type BlockCast =
  | { readonly kind: "none" }
  /** From the capsules of every thing's skeleton, as the shadows on the water are, onto bodies up to `reach` behind; none from a capsule thinner than `thin`. */
  | { readonly kind: "capsules"; readonly reach: number; readonly thin: number };
export type BlockOverlap =
  | { readonly kind: "none" }
  /** `width` wide (world units) round a part that stands less than `gap` in front; `amount` of the block (0..1). */
  | { readonly kind: "band"; readonly width: number; readonly gap: number; readonly amount: number };

export type Style = {
  readonly name: string;
  shade(ctx: ShadeCtx): Expr<"vec3">;
  /** Colour of the outline pass. */
  ink(ctx: ShadeCtx): Expr<"vec3">;
  /**
   * A number the style's post passes read back from the picture's alpha where an opaque body was drawn
   * (`post_color(uv).a`), so a post pass can follow the body (woodblock's line weight). 1 for a style that reads none.
   */
  mark(ctx: ShadeCtx): Expr<"f32">;
  /** Outline width, world units (the host never sees it below a minimum in pixels). */
  readonly outline: Expr<"f32">;
  /** Sea colour and alpha (what shows through the water below it is already tinted by `shade`). */
  water(ctx: WaterCtx): Expr<"vec4">;
  /** A cast shadow on the water, as colour and alpha blended over the water already drawn. */
  shadow(ctx: LayerCtx): Expr<"vec4">;
  /** Full-screen passes after the scene, in order (ink from depth edges, paper grain); empty for none. */
  readonly post: readonly PostSpec[];
  /**
   * A plane ground's colour (`scene({ ground: plane })`), with its cast shadow in it at `ctx.shadow`; opaque. A sea or
   * nothing never calls it.
   */
  ground(ctx: GroundCtx): Expr<"vec3">;
  /** Background along a view ray, above and below the horizon. */
  sky(ctx: SkyCtx): Expr<"vec3">;
  /** Clear colour: the horizon. */
  readonly clear: Rgb;
  /** The style's shadow printed as a block after the bodies; absent for a style that shades each fragment whole. */
  readonly block?: ShadowBlock;
  /**
   * The same style lit other ways, by name: what `--light name` chooses on any scene drawn in this style, without the
   * scene being edited. Constructors, as `STYLES` are. Absent for a style with one lighting.
   */
  readonly lights?: Readonly<Record<string, () => Style>>;
};

// ---- paint helpers ----------------------------------------------------------------------------------------------

const RGBI = (c: In<"vec3">): Expr<"vec3"> => lift<"vec3">(c);

/** 1 on the back (dorsal half), 0 on the belly, with a soft edge low on the flank. */
export function dorsalness(v: Expr<"f32">): Expr<"f32"> {
  // A narrow edge: a crisp belly line reads as drawn, a wide one as airbrushed.
  return smoothstep(-0.3, -0.12, sin(mul(v, TAU)));
}

/**
 * Colour recipes for painting a body, as functions of its length coordinate `m` (metres) and its around coordinate `v`
 * (0 to 1): `countershade` (dark back, pale belly), `bands`, `spot`, and `clamp`. Each takes and returns a vec3 colour,
 * so they layer by passing one result as the next one's `under`.
 */
export const palette = {
  /** Dark back, pale belly (counter-shading). */
  countershade(v: Expr<"f32">, c: { readonly back: In<"vec3">; readonly belly: In<"vec3"> }): Expr<"vec3"> {
    return mix(RGBI(c.belly), RGBI(c.back), dorsalness(v));
  },
  /**
   * Saddle bands across the back: `count` bands over [from, to] in m, each `width` of its period, fading out on the
   * belly. Returns `under` with the bands painted on.
   */
  bands(m: Expr<"f32">, v: Expr<"f32">, under: Expr<"vec3">, b: { readonly colour: In<"vec3">; readonly count: number; readonly width: number; readonly from?: number; readonly to?: number }): Expr<"vec3"> {
    const from = b.from ?? 0, to = b.to ?? 1;
    const x = mul(sub(m, from), 1 / (to - from));
    const d = mul(abs(sub(fract(mul(x, b.count)), 0.5)), 2);
    const inside = mul(smoothstep(-0.001, 0.0, x), sub(1, smoothstep(1.0, 1.001, x)));
    const mask = mul(mul(sub(1, smoothstep(b.width * 0.7, b.width, d)), inside), dorsalness(v));
    return mix(under, RGBI(b.colour), mask);
  },
  /** A spot on the skin centred at (m0, v0), radius in m (v is scaled by `aspect` so the spot can be round). */
  spot(m: Expr<"f32">, v: Expr<"f32">, under: Expr<"vec3">, s: { readonly at: readonly [number, number]; readonly radius: number; readonly colour: In<"vec3">; readonly aspect?: number }): Expr<"vec3"> {
    const dm = sub(m, s.at[0]);
    const dv = mul(sub(fract(add(sub(v, s.at[1]), 0.5)), 0.5), s.aspect ?? 1);
    const r2 = add(mul(dm, dm), mul(dv, dv));
    const mask = sub(1, smoothstep(s.radius * s.radius * 0.9, s.radius * s.radius * 1.1, r2));
    return mix(under, RGBI(s.colour), mask);
  },
  /** Clamp a colour to [0, 1]. */
  clamp: (c: Expr<"vec3">): Expr<"vec3"> => clamp(c, 0, 1),
};

const BODY_VARS = ["c_uv", "c_anchor", "c_id"] as const;
const readsCache = new WeakMap<Style, boolean>();
/**
 * Whether the style's body functions read the surface's coordinates, anchor or identity. A drawable computes the anchor
 * in its vertex stage only when they do, so a style that ignores them (toon) pays nothing for them.
 */
export function readsBody(style: Style): boolean {
  const seen = readsCache.get(style);
  if (seen !== undefined) return seen;
  const ctx = shadeVariables([0, 1, 0]);
  const vars = leaves([style.shade(ctx), style.ink(ctx), style.mark(ctx)]).vars;
  const reads = BODY_VARS.some((n) => vars.has(n));
  readsCache.set(style, reads);
  return reads;
}

/** The shade context as the free variables the compiler emits `shade`, `ink` and `mark` over (src/compile/scene_wgsl.ts). */
export function shadeVariables(sun: In<"vec3">): ShadeCtx {
  return {
    base: variable("c_base", "vec3"), normal: variable("c_normal", "vec3"), sun: lift<"vec3">(sun), view: variable("c_view", "vec3"),
    world: variable("c_world", "vec3"), depth: variable("c_depth", "f32"), uv: variable("c_uv", "vec2"), anchor: variable("c_anchor", "vec3"),
    id: variable("c_id", "f32"),
  };
}

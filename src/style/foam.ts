// Foam where the water meets a body, and the foam a sea's deformations mark on it, printed in any style's inks.
//
// The law: a pattern is a function of how close a body is (`Contact`: the grainy band, or the level, one value a 2 x 2
// quad with the direction to the body) and of where the water is (world x, z), and it returns coverage, not colour: a
// list of layers, each an ink (`fill`, the foam's body; `line`, its key line; `edge`, a softer outline) and how much of
// the pixel it covers, printed in order over the water by `printLayers` in the inks a style chooses. Every pattern
// prints nothing where the sea found no body near (`Contact` "clear": an empty list).
//
// The patterns (`ContactFoam`; docs/art_direction/DIRECTION.md, "Contact foam" and "White water"):
//  - `ridge`: a collar, filaments along the zero lines of a noise field, an edge round them, specks. Reads the band.
//  - `rings`: `count` thin arcs along the level's lines, broken, moving outward `drift` arcs a second; no fill.
//  - `apron`: one flat shape with a scalloped edge (lobes `lobe` wide) and one key line.
//  - `stipple`: dots only (the larger `dot` apart), dense at the body and thinning outward.
//  - `breakers`: a narrow collar and a blade along each of the swell's printed lines (`swellLines`) where it meets the body.
//  - `curls`: a low collar of round lobes lying over each other, the larger with a curled head; a ripple arc beyond.
//  - `roll`: white water (src/style/whitewater.ts): a rolling mass, a few hooked heads leaning with the swell, droplets.
// The marks (`MarksPrint`): `flat`, fill where the mark is over 0.45; `heads`, a line of curled heads along it, leaning
// the way the deformation says (`WaterCtx.marksLean`), over a thin flat core.
//
// Parameters: numbers fixed when the style is built, in world units. A pattern's sizes suit a sea whose foam width
// (`SeaSpec.foam`) is about three of its periods; `roll` sizes itself from the foam width.
//
// Cannot: foam that is not shaped by distance to a body (a wake behind a moving one, foam that drifts away and decays:
// the sea gives no history); any shading inside the foam (each layer is flat); foam under a body or behind it (only the
// water drawn sees it); a size that follows the body's speed. The level is rough by a pixel or two: shapes are drawn in
// the world and only sized by it.
//
// Going past it: `Contact` is in every `WaterCtx`, so a style can shape its own foam from `band` or `level` (biolume's
// halo and papercraft's collar do). The white water painter takes any mass with a slope: a splash, a ring wave's crest,
// a wake you compute yourself (examples/bosses/lib/impact.ts). Relatives: rings whose count follows `toward` against the
// swell (foam piling on the up-swell side only); stipple whose dot size follows the swell's phase (spray thrown off the
// crests); lobes on a lattice in the level and the bearing round the body (a collar that is one continuous scallop).

import { abs, add, and, atan2, f, floor, fract, gt, length, lt, max, mix, mul, saturate, select, sin, smoothstep, step, sub, time, vec2, type Expr } from "../expr.ts";
import { hash22, noise2 } from "../lib/index.ts";
import { fwidth } from "../lib/wgsl.ts";
import type { Rgb, WaterCtx } from "../style.ts";
import type { SwellLines } from "./sea.ts";
import { edgeOf, rgb } from "./shared.ts";
import { along, curledHeads, rollingFoam, rollOf, type White } from "./whitewater.ts";

type F = Expr<"f32">;

/** The foam's inks: `fill` its body, `line` its key line, `edge` the softer outline of the `ridge` pattern. */
export type FoamInk = "fill" | "line" | "edge";
/** Coverage of each of the foam's inks, in printing order (a later layer prints over an earlier one). */
export type InkLayers = readonly { readonly ink: FoamInk; readonly cover: F }[];

/** Layers printed over a colour in a style's inks. */
export function printLayers(under: Expr<"vec3">, layers: InkLayers, inks: Readonly<Record<FoamInk, Rgb>>): Expr<"vec3"> {
  return layers.reduce((c, l) => mix(c, rgb(inks[l.ink]), l.cover), under);
}

export type ContactFoam =
  | { readonly kind: "ridge" }
  | { readonly kind: "rings"; readonly count: number; readonly drift: number }
  | { readonly kind: "apron"; readonly lobe: number }
  | { readonly kind: "stipple"; readonly dot: number }
  | { readonly kind: "breakers"; readonly reach: number }
  | { readonly kind: "curls"; readonly lobe: number }
  | { readonly kind: "roll"; readonly head: HeadSize };

/** How large a roll's largest curled head is: a share of the sea's foam width (so it follows the scene's sea), or a world radius. */
export type HeadSize = { readonly kind: "ofWidth"; readonly share: number } | { readonly kind: "world"; readonly radius: number };

/** How the foam the sea's deformations mark is printed: `flat` over 0.45, or a line of curled heads of world radius `head`. */
export type MarksPrint = { readonly kind: "flat" } | { readonly kind: "heads"; readonly head: number };

const positive = (what: string, x: number): number => {
  if (!(x > 0)) throw new Error(`foam: ${what} must be positive, got ${x}`);
  return x;
};

/**
 * Builders for the pattern of foam printed where water meets a body (`ContactFoam`): `ridge`, `rings`, `apron`,
 * `stipple`, `breakers`, `curls` and `roll`. Each takes optional sizes in world units and returns a plain value.
 */
export const foam = {
  /** Filaments along the zero lines of a noise (the first foam). */
  ridge(): ContactFoam { return { kind: "ridge" }; },
  /** Ripple arcs. `count`: arcs across the band, default 3; `drift`: arcs a second outward, default 0.4. */
  rings(o: { readonly count?: number; readonly drift?: number } = {}): ContactFoam {
    return { kind: "rings", count: positive("rings count", o.count ?? 3), drift: o.drift ?? 0.4 };
  },
  /** A flat scalloped apron. `lobe`: the width of a scallop, default 0.36. */
  apron(o: { readonly lobe?: number } = {}): ContactFoam { return { kind: "apron", lobe: positive("apron lobe", o.lobe ?? 0.36) }; },
  /** Dots. `dot`: the spacing of the larger dots, default 0.17. */
  stipple(o: { readonly dot?: number } = {}): ContactFoam { return { kind: "stipple", dot: positive("stipple dot", o.dot ?? 0.17) }; },
  /** The swell's own lines breaking on the body. `reach`: how far down the level a blade runs (0..1), default 0.72. */
  breakers(o: { readonly reach?: number } = {}): ContactFoam { return { kind: "breakers", reach: positive("breakers reach", o.reach ?? 0.72) }; },
  /** Rolling lobes with curled heads. `lobe`: the spacing of the lobes, default 0.5. */
  curls(o: { readonly lobe?: number } = {}): ContactFoam { return { kind: "curls", lobe: positive("curls lobe", o.lobe ?? 0.5) }; },
  /**
   * The rolling mass with curled heads. `head`: the world radius of the largest head; left out, it is half the
   * sea's foam width (0.42 on a sea whose foam width is 0.85).
   */
  roll(o: { readonly head?: number } = {}): ContactFoam {
    return { kind: "roll", head: o.head === undefined ? { kind: "ofWidth", share: 0.5 } : { kind: "world", radius: positive("roll head", o.head) } };
  },
};

/**
 * Builders for how the foam that a sea's deformations mark is printed (`MarksPrint`): `marksAs.flat()` as a flat
 * fill, or `marksAs.heads({ head })` as a line of curled heads.
 */
export const marksAs = {
  /** Fill where the mark is over 0.45. */
  flat(): MarksPrint { return { kind: "flat" }; },
  /** A line of curled heads. `head`: the world radius of the largest, default 0.35. */
  heads(o: { readonly head?: number } = {}): MarksPrint { return { kind: "heads", head: positive("crest head", o.head ?? 0.35) }; },
};

/** Where a pattern is printed: the water's world (x, z), the direction the swell travels, the swell's printed lines, and the body's closeness. */
type Near = {
  readonly xz: Expr<"vec2">; readonly drift: Expr<"vec2">; readonly lines: Pick<SwellLines, "off" | "live">;
  readonly band: F; readonly level: F; readonly toward: Expr<"vec2">; readonly width: number;
};

/** The contact foam: nothing where the sea found no body near, the pattern where one may be. */
export function contactFoam(p: ContactFoam, ctx: WaterCtx, lines: Pick<SwellLines, "off" | "live">): InkLayers {
  const contact = ctx.contact;
  switch (contact.kind) {
    case "clear": return [];
    case "near": return patterned(p, { xz: ctx.world.xz, drift: ctx.swell, lines, band: contact.band, level: contact.level, toward: contact.toward, width: contact.width });
  }
}

/** One handler per pattern. */
function patterned(p: ContactFoam, on: Near): InkLayers {
  switch (p.kind) {
    case "ridge": return ridge(on);
    case "rings": return [{ ink: "fill", cover: arcs(on, { count: p.count, drift: p.drift, from: 0.06, to: 1.2, weight: 0.2 }) }];
    case "apron": return flat(on, mul(lobes(on, p.lobe, 0).union, 0.4), 0.075); // the lobes' shape is in cells, about a third of a foam width each
    case "stipple": return stipple(p, on);
    case "breakers": return breakers(p, on);
    case "curls": return curls(p, on);
    case "roll": return rolled(p, on);
  }
}

/** The deformations' foam (`WaterCtx.marks`). One handler per print. */
export function marksFoam(p: MarksPrint, ctx: WaterCtx): InkLayers {
  switch (p.kind) {
    case "flat": return [{ ink: "fill", cover: edgeOf(ctx.marks, 0.45, 0.02) }];
    case "heads": {
      // The mark is over 0.45 where the flat print is filled: the heads are sized from a little under that, so they
      // stand along the flat print's edge and outlast it as the wave weakens; the flat core is its upper part only.
      const white = curledHeads({ xz: ctx.world.xz, mass: smoothstep(0.2, 0.7, ctx.marks), slope: vec2(0, 0), lean: { kind: "toward", dir: ctx.marksLean } }, rollOf(p.head));
      return [{ ink: "fill", cover: edgeOf(ctx.marks, 0.62, 0.02) }, ...whiteLayers(white)];
    }
  }
}

/** How much of the line ink a foam's key line prints: a little of the water shows through, as the crash foam's does. */
const KEY = 0.9;

/** White water as layers: its key line, then its fill. */
const whiteLayers = (w: White): InkLayers => [{ ink: "line", cover: mul(w.line, KEY) }, { ink: "fill", cover: w.fill }];

/** A head's world radius on a sea whose foam is `width` wide. */
function headOf(h: HeadSize, width: number): number {
  switch (h.kind) {
    case "ofWidth": return h.share * width;
    case "world": return h.radius;
  }
}

/** The collar as white water, sized by the contact level and curling the way the swell travels, over a ripple arc or two. */
function rolled(p: Extract<ContactFoam, { kind: "roll" }>, on: Near): InkLayers {
  // The level rises toward the body by 1 / width a world unit: its slope, so lobes and heads are sized whole.
  const white = rollingFoam({ xz: on.xz, mass: on.level, slope: mul(on.toward, 1 / on.width), lean: { kind: "toward", dir: on.drift } }, rollOf(headOf(p.head, on.width)));
  const ripple = arcs(on, { count: 5, drift: 0, from: 0.02, to: 0.34, weight: 0.24 });
  return [{ ink: "fill", cover: ripple }, ...whiteLayers(white)];
}

/**
 * Ridge foam, from the band: a collar at the body, and filaments that taper outward along the zero lines of a noise
 * field (thin where |noise| is small, narrower the farther out), an edge round the whole shape, and loose specks beyond.
 * (The zero lines of a noise are closed curves: it prints a net, not claws.)
 */
function ridge(on: Near): InkLayers {
  const near = on.band;
  const ridge = abs(noise2(mul(on.xz, 3.4)));
  const shape = max(sub(near, 0.6), sub(mul(near, 0.3), ridge));
  const fill = mul(edgeOf(shape, 0, 0.004), edgeOf(near, 0.02, 0.01));
  const rim = mul(mul(edgeOf(shape, -0.06, 0.004), sub(1, fill)), edgeOf(near, 0.05, 0.01));
  const speck = mul(specks(mul(on.xz, 8)), mul(smoothstep(-0.4, -0.1, near), sub(1, smoothstep(0.1, 0.3, near))));
  return [{ ink: "edge", cover: rim }, { ink: "fill", cover: max(fill, speck) }];
}

/** A flat shape with one key line: filled where `shape` (in units of the level) is above 0, the line within `line` below. */
function flat(on: Near, shape: F, line: number): InkLayers {
  const near = edgeOf(on.level, 0.04, 0.01);
  const fill = mul(edgeOf(shape, 0, 0.004), near);
  const key = mul(mul(edgeOf(shape, -line, 0.004), sub(1, fill)), near);
  return [{ ink: "line", cover: mul(key, KEY) }, { ink: "fill", cover: fill }];
}

/**
 * Thin arcs along the level's own lines, `count` of them across the level, drifting outward `drift` arcs a second (0:
 * still): each thins to nothing toward the level's outer edge, and is broken by its own slow mask, which also tapers
 * its ends. `from`..`to` is the part of the level they are drawn in. Coverage 0..1.
 */
function arcs(on: Near, o: { readonly count: number; readonly drift: number; readonly from: number; readonly to: number; readonly weight: number }): F {
  const phase = add(mul(on.level, o.count), mul(time, o.drift));
  const off = abs(sub(fract(phase), 0.5)); // 0 on an arc
  const n = floor(phase);
  const mask = mul(sin(add(along(on.xz, 25, 0.45), mul(n, 2.4))), sin(add(along(on.xz, 115, 0.38), mul(n, 1.7))));
  const inside = mul(smoothstep(o.from, o.from + 0.25, on.level), sub(1, smoothstep(o.to - 0.08, o.to, on.level)));
  const half = mul(mul(inside, smoothstep(-0.45, 0.05, mask)), o.weight);
  return mul(edgeOf(sub(half, off), 0.01, 0.004, 0.08), edgeOf(on.level, 0.04, 0.01));
}

/**
 * Round lobes on a jittered lattice, `period` apart, each growing with the level: full size near the body, nothing at
 * the level's outer edge. A lobe's edge is a circle in the world, so it is clean whatever the level's small steps do;
 * the level only sizes it. Of the lobes that cover a pixel (it is inside one, or within `line` cells outside it, on
 * its key line) the one with the higher hash is in front. `sizes`: the least and greatest radius at full growth, in
 * cells. (A wider range, 0.3 to 0.8 with most lobes small, was tried for the curls: the lobes stopped overlapping and
 * the collar read as loose bubbles, not a mass.) Returned for the pixel: `front`, the front lobe's hash (-1
 * where none covers it); `inside`, how far inside that lobe's edge this is, in cells (negative on its key line);
 * `local`, where in that lobe (the offset from its centre over its radius); `union`, how far inside the nearest edge
 * of all the lobes together (negative outside them all).
 */
function lobes(on: Near, period: number, line: number, sizes: readonly [number, number] = [0.44, 0.78]): { readonly front: F; readonly inside: F; readonly local: Expr<"vec2">; readonly union: F } {
  const q = vec2(along(on.xz, 21, period), along(on.xz, 111, period));
  const cell = floor(q), at = sub(q, cell);
  // The four cells whose lobes can reach here: this one and the three on the pixel's side of it (a lobe's centre is
  // within 0.2 of its cell's middle and its radius at most 0.78, so it never reaches past the middle of a neighbour).
  const side = vec2(select(lt(at.x, 0.5), -1, 1), select(lt(at.y, 0.5), -1, 1));
  const grow = smoothstep(0.08, 0.6, on.level);
  let front: F = f(-1), inside: F = f(-1), local: Expr<"vec2"> = vec2(0, 0), union: F = f(-1);
  for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const c = add(cell, vec2(mul(side.x, i), mul(side.y, j)));
    const h = hash22(c);
    const off = sub(q, add(add(c, 0.5), mul(sub(h, 0.5), 0.4)));
    const radius = mul(grow, mix(sizes[0], sizes[1], h.y));
    // A lobe under an eighth of a cell is not drawn, and a small one has a thinner key line: at full width the line
    // round a lobe that small printed a black blot with a cream dot in it.
    const s = select(gt(radius, 0.12), sub(radius, length(off)), -1);
    const wins = and(gt(s, mul(smoothstep(0.12, 0.4, radius), -line)), gt(h.x, front));
    inside = select(wins, s, inside);
    local = select(wins, off.div(max(radius, 1e-3)), local);
    front = select(wins, h.x, front);
    union = max(union, s);
  }
  return { front, inside, local, union };
}

/**
 * Dots. Two lattices of cells, one dot a cell: the dot's radius grows from nothing as the level passes the cell's own
 * hashed threshold, so dots are dense and large at the body and few and small outward, and a dot comes and goes by
 * size, never at once.
 */
function stipple(p: Extract<ContactFoam, { kind: "stipple" }>, on: Near): InkLayers {
  // The pixel's size on the water, world units: smooth (the position is), where fwidth of a dot's own distance would
  // jump at every cell border.
  const pixel = max(fwidth(on.xz.x), fwidth(on.xz.y));
  const layer = (degrees: number, period: number, big: number): F => {
    const q = vec2(along(on.xz, degrees, period), along(on.xz, degrees + 90, period));
    const h = hash22(q);
    const r = length(sub(sub(fract(q), 0.5), mul(sub(h, 0.5), 0.44)));
    const radius = mul(mul(saturate(mul(sub(on.level, add(mul(h.x, 0.75), 0.05)), 1 / 0.3)), big), mix(0.55, 1, h.y));
    const fw = max(mul(pixel, 0.75 / period), 1e-4);
    const disc = sub(1, smoothstep(sub(radius, fw), add(radius, fw), r));
    // Where a cell is under about two pixels the dots cannot be drawn: print their share of the cell instead (the
    // same tone, no shimmer). A dot smaller than a pixel prints as its share of that pixel; none prints none.
    const share = mul(mul(radius, radius), Math.PI);
    return mul(mix(disc, share, smoothstep(0.25, 0.6, fw)), saturate(mul(radius, 1 / 0.02)));
  };
  return [{ ink: "fill", cover: max(layer(12, p.dot, 0.27), layer(51, p.dot * 0.62, 0.27)) }];
}

/**
 * The swell's own lines breaking on the body: a low collar of small lobes, and along each printed line that comes
 * within the level a blade of foam that tapers away from the body. A blade's sides are cut by the distance to its line
 * (smooth, in the world), only its tip by the level. The blades move with the swell because the lines do.
 */
function breakers(p: Extract<ContactFoam, { kind: "breakers" }>, on: Near): InkLayers {
  // 1 on a line, 0 from 0.06 of the spacing away; squared, so a blade's sides are concave.
  const onLine = saturate(sub(1, mul(on.lines.off, 1 / 0.06)));
  const blade = add(sub(on.level, 0.8), mul(mul(mul(onLine, onLine), on.lines.live), p.reach));
  // The collar is the lobes drawn in by a third of a cell: low, so the blades stand clear of it.
  const collar = sub(mul(lobes(on, 0.3, 0).union, 0.4), 0.13);
  return flat(on, max(blade, collar), 0.05);
}

/**
 * Rolling foam, after the round 4 pictures (docs/art_direction/crab_round4): a low collar of round lobes, each with its
 * key line and lying over the one behind it, the larger ones with a curled head (a turn and a half of a spiral cut out
 * of the fill, so the water shows in it); and a ripple arc or two beyond.
 */
function curls(p: Extract<ContactFoam, { kind: "curls" }>, on: Near): InkLayers {
  const l = lobes(on, p.lobe, 0.11);
  const covered = edgeOf(l.front, 0, 1e-5);
  const fill = mul(edgeOf(l.inside, 0, 0.004), covered);
  // The curled head: an arm of a spiral from the lobe's edge inward, widest at the edge and tapering to its middle,
  // in the lobes whose hash is over 0.6 (the ones most in front), and only where a cell is over about 18 pixels: in a
  // smaller lobe the arm is a blot (from the game camera the collar is plain lobes, as in the round 4 game view).
  const rn = length(l.local);
  const turn = add(mul(atan2(l.local.y, l.local.x), 1 / (2 * Math.PI)), mul(rn, 1.5));
  const arm = abs(sub(fract(add(turn, mul(l.front, 7))), 0.5));
  const room = sub(1, smoothstep(0.045, 0.07, max(fwidth(on.xz.x), fwidth(on.xz.y)).div(p.lobe)));
  const curl = mul(mul(mul(edgeOf(sub(mul(smoothstep(0.1, 0.9, rn), 0.14), arm), 0, 0.004, 0.1), fill), step(0.6, l.front)), room);
  const near = edgeOf(on.level, 0.04, 0.01);
  // Beyond the collar, a ripple arc or two on the level's own lines.
  const ripple = mul(arcs(on, { count: 5, drift: 0, from: 0.02, to: 0.34, weight: 0.24 }), sub(1, covered));
  return [
    { ink: "fill", cover: ripple },
    { ink: "line", cover: mul(mul(sub(covered, fill), KEY), near) },
    { ink: "fill", cover: mul(mul(fill, sub(1, curl)), near) },
  ];
}

/** Round specks of spray, one per cell of p at a hashed spot, on about a third of the cells; 0..1 coverage. */
function specks(p: Expr<"vec2">): F {
  const h = hash22(p);
  const at = sub(sub(fract(p), 0.5), mul(sub(h, 0.5), 0.5));
  const r = length(at);
  const radius = mul(smoothstep(0.62, 0.9, h.x), 0.22);
  const fw = max(fwidth(r), 1e-4);
  return sub(1, smoothstep(sub(radius, fw), add(radius, fw), r));
}

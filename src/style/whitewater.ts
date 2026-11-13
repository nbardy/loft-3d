// White water as a print draws it (docs/art_direction/DIRECTION.md, "White water"): a rolling cream mass with a
// few large curled heads, droplets beyond it, a key line round everything. One painter for every event that makes
// white water. An event's drawer (the sea's contact collar and its marks in src/style/foam.ts, a burst's own patch
// in examples/bosses/lib/impact.ts) gives it three things and prints what it returns:
//  - a mass: 0 where there is no white water, 1 in the thick of it. It sizes the shapes; it does not cut them. Every
//    edge here is a curve drawn in the world (a circle, a spiral), so a mass that is rough (the sea's contact level is,
//    by a pixel or two) still gives clean edges, and nothing swims when the mass moves: shapes grow and shrink in place.
//  - a lean: the direction on the water the heads curl toward, or none.
//  - a head: the world radius of the largest curled head. Every other size follows from it.
// It returns coverage (`White`: fill and line), never colour: the caller prints it in its own inks (src/style/foam.ts,
// `printLayers`).
//
// Cannot: white water that is not flat on the water (a crest that stands up, spray in the air: those are soft things,
// src/soft/); motion of its own (shapes grow and shrink in place as the mass changes; nothing flows along the water); a
// head that curls in a direction that varies within one head.
// Going past it: any mass is accepted, so a style or an event can make one from anything it can compute (a wake from a
// path, a ring from a time). Relatives: the heads' lattice laid in polar coordinates round a centre (a crown of curls
// round a splash, as `crown` does with fingers); droplets whose cell size follows the mass (finer spray far from the
// body); the roll's lobes cut by the swell's printed lines (`swellLines.off`) so the foam rides the lines.

import { abs, add, and, atan2, dot, f, floor, fract, gt, length, lt, max, min, mix, mul, saturate, select, smoothstep, step, sub, vec2, type Expr } from "../expr.ts";
import { hash22 } from "../lib/index.ts";
import { fwidth, wgslFn } from "../lib/wgsl.ts";

type F = Expr<"f32">;
type V2 = Expr<"vec2">;

/** Which way the heads curl: toward a direction on the water (x, z; any length, zero for none there), or each its own way. */
export type Lean = { readonly kind: "none" } | { readonly kind: "toward"; readonly dir: V2 };

/**
 * Where white water is printed: the water's world (x, z), the mass there, the lean, and the mass's `slope`: how it
 * changes across the water (per world unit, x and z), to first order, or zero if that is not known. With a slope a
 * shape is sized by the mass at its own centre (mass here + offset . slope), so it is one whole circle or hook
 * whatever the mass does across it; with none it is sized by the mass at each pixel and is squeezed where that falls.
 */
export type WhiteOn = { readonly xz: V2; readonly mass: F; readonly slope: V2; readonly lean: Lean };

/**
 * How a value on the water changes across it, per world unit (x, z), from its screen derivatives and the position's:
 * the slope of a mass that is a smooth formula (a splash's shape, a wave's mark). Not for the sea's contact level (one
 * value a quad: the sea gives that one's direction itself). It turns its diagnostic off for itself: in the sea's cases
 * every pixel of a quad computes the same formula.
 */
export const slopeOf = wgslFn<"vec2">({
  name: "loft_slope_on_water", ret: "vec2", wgsl: /* wgsl */ `
@diagnostic(off, derivative_uniformity)
fn loft_slope_on_water(m: f32, xz: vec2<f32>) -> vec2<f32> {
  let a = dpdx(xz); let b = dpdy(xz);
  let det = a.x * b.y - a.y * b.x;
  let dm = vec2<f32>(dpdx(m), dpdy(m));
  return select(vec2<f32>(0.0), vec2<f32>(dm.x * b.y - dm.y * a.y, dm.y * a.x - dm.x * b.x) / det, abs(det) > 1e-12);
}`,
});

/** The mass a lattice offset away: `off` the offset in cells of a lattice at `degrees` with cells `cell` across. */
function massAt(on: WhiteOn, degrees: number, cell: number, off: V2): F {
  const a = (degrees * Math.PI) / 180;
  const along1 = dot(on.slope, vec2(Math.cos(a), Math.sin(a))), along2 = dot(on.slope, vec2(-Math.sin(a), Math.cos(a)));
  return add(on.mass, mul(add(mul(off.x, along1), mul(off.y, along2)), cell));
}

/** What is printed at a pixel: how much of it is the white water's fill, and how much its key line (never both: the line is beside the fill). */
export type White = { readonly fill: F; readonly line: F };

/**
 * The sizes of one event's white water: the largest head's radius and the key line's width (world units), and the
 * share of the heads' cells that hold a head.
 */
export type Roll = { readonly head: number; readonly line: number; readonly held: number };

/**
 * A roll whose key line is a tenth of its head (never under 1.5 pixels: `lineOf`). `held`: three cells in four for a
 * collar (a narrow band: few cells touch it); a burst fills a disc and wants fewer, or it is all heads.
 */
export function rollOf(head: number, held = 0.75): Roll {
  if (!(head > 0)) throw new Error(`white water: a head's radius must be positive, got ${head}`);
  if (!(held >= 0 && held <= 1)) throw new Error(`white water: the share of cells with a head must be 0..1, got ${held}`);
  return { head, line: head * 0.1, held };
}

/** xz along the unit direction at `degrees` from +x, in periods of `period`. */
export const along = (xz: V2, degrees: number, period: number): F => {
  const a = (degrees * Math.PI) / 180;
  return dot(xz, vec2(Math.cos(a) / period, Math.sin(a) / period));
};

/** The world size of a pixel on the water. Smooth (the position is), so it antialiases shapes whose own value jumps from cell to cell. */
export const pixelOn = (xz: V2): F => max(max(fwidth(xz.x), fwidth(xz.y)), 1e-5);

/** 0 where the world distance d is under `at`, 1 over it, antialiased over a pixel. */
const over = (d: F, at: F | number, pixel: F): F => smoothstep(sub(at, mul(pixel, 0.75)), add(at, mul(pixel, 0.75)), d);

/** The key line's width here: the roll's, and never under 1.5 pixels. */
const lineOf = (r: Roll, pixel: F): F => max(mul(pixel, 1.5), r.line);

// ---- the heads ------------------------------------------------------------------------------------------------------

/** How fast a head's edge winds in: its radius falls by this share over one turn from the beak. */
const WIND = 0.5;

/** A layer's print and where it covers what is behind it (its cream, its key line, the water in its curl). */
type Layer = White & { readonly covers: F };

/**
 * Curled heads, one to a cell of a lattice 2.3 head radii across, in `held` of the cells, half to full size and
 * sized by the mass. A head is a hook: with a the share of a turn from its beak (0..1) and r the distance from its
 * centre, u = (1 - r / R) / WIND - a is below 0 outside it, 0 on its edge (one turn of a spiral, so the edge ends in a
 * pointed beak over a notch WIND R deep, half the head) and a whole number on every further turn inward; u steps by exactly 1 across
 * the beak's line, so "how far past a whole number" is continuous there and one rule draws the edge and the spiral.
 * Inside, past the first turn, a channel of water follows the spiral in and closes to a line (the curl); it is drawn
 * only where the head is over about 9 pixels in radius, so a small or distant head is the hook alone.
 */
function heads(on: WhiteOn, r: Roll, pixel: F): Layer {
  const cell = r.head * 2.3;
  const q = vec2(along(on.xz, 33, cell), along(on.xz, 123, cell));
  const c = floor(q), h = hash22(c);
  const centre = add(add(c, 0.5), mul(sub(h, 0.5), 0.12));
  // The mass at the head's centre, and how far the head may reach before the mass runs out (it must fit inside it).
  const here = massAt(on, 33, cell, sub(centre, q));
  const steep = length(on.slope);
  const fits = select(gt(steep, 1e-4), sub(here, 0.05).div(max(steep, 1e-4)), 1e3);
  // Two more numbers for the cell from the two it has: which cells hold a head, and how large.
  const held = step(1 - r.held, fract(mul(h.x, 7.13))), size = mix(0.45, 1, fract(mul(h.y, 5.71)));
  const off = mul(sub(q, centre), cell); // world, from the head's centre
  const radius = mul(max(min(mul(r.head, size), fits), 0), mul(held, smoothstep(0.12, 0.3, here)));
  const safe = max(radius, 1e-4), dist = length(off);
  const a = fract(mul(sub(atan2(off.y, off.x), beak(on.lean, h)), 1 / (2 * Math.PI)));
  const u = sub(mul(sub(1, dist.div(safe)), 1 / WIND), a);
  const turn = mul(safe, WIND); // world distance between one turn of the spiral and the next
  const line = lineOf(r, pixel);
  const present = step(1e-3, radius);
  // World distances to the spiral: outward to the next turn out (the key line lies on the outside of each turn), and
  // inward from the last turn in.
  const outward = mul(sub(1, fract(u)), turn), inward = mul(fract(u), turn);
  const room = smoothstep(7, 10, radius.div(pixel));
  const inside = over(mul(u, turn), 0, pixel);
  const past = mul(over(mul(sub(u, 1), turn), 0, pixel), room); // past the first turn, where the curl is drawn
  // The edge's line (outside the head) always; the further turns' only with room.
  // (Outside the head only within one turn of its edge: u is a whole number on circles all the way out.)
  const spiral = mul(mul(sub(1, over(outward, line, pixel)), mix(sub(1, inside), 1, mul(room, step(u, 1.95)))), step(-1, u));
  // The channel: just inside the second turn, a quarter of the head wide at its mouth, closing by u = 1.9; a key line
  // along its inner bank while it is open.
  const width = mul(mul(safe, 0.26), saturate(sub(1, mul(sub(u, 1), 1 / 0.9))));
  const channel = mul(past, sub(1, over(inward, width, pixel)));
  const bank = mul(mul(past, mul(over(inward, width, pixel), sub(1, over(inward, add(width, line), pixel)))), step(mul(line, 0.5), width));
  // The beak's underside: the straight edge from the beak's point down to the notch, where u steps from inside to outside.
  const under = mul(mul(inside, sub(1, over(mul(mul(a, 2 * Math.PI), dist), line, pixel))), step(u, 1));
  const key = mul(saturate(add(add(spiral, bank), under)), present);
  const cream = mul(mul(mul(inside, sub(1, channel)), sub(1, key)), present);
  // It covers what is behind it wherever it prints, and in its channel (the water shows there, not the roll behind).
  return { fill: cream, line: key, covers: mul(saturate(add(inside, key)), present) };
}

/** The angle a head's beak points at: along the lean, or by the cell's hash. */
function beak(lean: Lean, h: V2): F {
  switch (lean.kind) {
    case "none": return mul(h.x, 2 * Math.PI);
    // A zero lean (no direction there) gives angle 0: the tiny x keeps atan2 away from (0, 0).
    case "toward": return atan2(lean.dir.y, add(lean.dir.x, 1e-6));
  }
}

// ---- the roll and the droplets ----------------------------------------------------------------------------------------

/**
 * The rolling mass: round lobes on a jittered lattice 0.8 of a head across, each growing with the mass, all of them one
 * cream shape with one key line round it and none inside (every lobe outlined read as pebbles in a row, and then as
 * bubbles). Lobes are large or absent, so the shape's edge is a few shallow scallops; what lies beyond it is the
 * droplets' to draw.
 */
function roll(on: WhiteOn, r: Roll, pixel: F): Layer {
  const cell = r.head * 0.8;
  const q = vec2(along(on.xz, 21, cell), along(on.xz, 111, cell));
  const c0 = floor(q), at = sub(q, c0);
  // The four cells whose lobes can reach here: this one and the three on the pixel's side of it (a lobe's centre is
  // within 0.2 of its cell's middle and its radius at most 0.78, so it never reaches past the middle of a neighbour).
  const side = vec2(select(lt(at.x, 0.5), -1, 1), select(lt(at.y, 0.5), -1, 1));
  let union: F = f(-1); // world distance inside the nearest lobe's edge
  for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const c = add(c0, vec2(mul(side.x, i), mul(side.y, j)));
    const h = hash22(c);
    const off = sub(q, add(add(c, 0.5), mul(sub(h, 0.5), 0.4)));
    // Sized by the mass at the lobe's own centre: the roll ends where that falls under about four tenths, so the heads
    // (which reach to where it is nearly nothing) stand out past its edge.
    const radius = mul(smoothstep(0.28, 0.6, massAt(on, 21, cell, mul(off, -1))), mix(0.6, 0.78, h.y));
    // A lobe under three tenths of a cell is not drawn: small ones stood apart from the mass as a froth of bubbles.
    union = max(union, mul(select(gt(radius, 0.3), sub(radius, length(off)), -1), cell));
  }
  const cream = over(union, 0, pixel);
  const key = mul(over(union, mul(lineOf(r, pixel), -1), pixel), sub(1, cream));
  return { fill: cream, line: key, covers: saturate(add(cream, key)) };
}

/**
 * Flung droplets: round dots with a key line, one to a cell of a lattice 0.55 of a head across in about one cell in
 * three, only where the mass is thin (the outer fringe: 0.04 to 0.4), a tenth to a fifth of a head in radius.
 */
function droplets(on: WhiteOn, r: Roll, pixel: F): Layer {
  const cell = r.head * 0.55;
  const q = vec2(along(on.xz, 67, cell), along(on.xz, 157, cell));
  const h = hash22(q);
  const fringe = mul(smoothstep(0.04, 0.12, on.mass), sub(1, smoothstep(0.25, 0.4, on.mass)));
  const radius = mul(mul(mul(r.head, mix(0.09, 0.19, h.y)), step(0.68, h.x)), fringe);
  const s = sub(radius, mul(length(sub(sub(fract(q), 0.5), mul(sub(fract(mul(h, vec2(5.3, 9.1))), 0.5), 0.3))), cell));
  const present = step(mul(pixel, 0.6), radius); // under about a pixel across it is not printed
  const cream = mul(over(s, 0, pixel), present);
  // A droplet's line is thinner than a head's: half, and never over half its own radius.
  const key = mul(mul(over(s, mul(min(mul(lineOf(r, pixel), 0.6), mul(radius, 0.5)), -1), pixel), sub(1, cream)), present);
  return { fill: cream, line: key, covers: saturate(add(cream, key)) };
}

// ---- the painter ------------------------------------------------------------------------------------------------------

const none: White = { fill: f(0), line: f(0) };
/** One print over another. */
const overPrint = (back: White, front: Layer): White => ({ fill: mix(back.fill, front.fill, front.covers), line: mix(back.line, front.line, front.covers) });
/** Nothing where the mass is under 0.03 (so an event that gives exactly 0 away from itself prints exactly nothing there). */
const gated = (w: White, mass: F): White => { const g = step(0.03, mass); return { fill: mul(w.fill, g), line: mul(w.line, g) }; };

/** The whole of it: the droplets, the roll over them, and the curled heads in front. */
export function rollingFoam(on: WhiteOn, r: Roll): White {
  const pixel = pixelOn(on.xz);
  return gated(overPrint(overPrint(overPrint(none, droplets(on, r, pixel)), roll(on, r, pixel)), heads(on, r, pixel)), on.mass);
}

/** The heads alone: a line of them where the mass is a narrow band (a wave's crest), with no roll behind. */
export function curledHeads(on: WhiteOn, r: Roll): White {
  return gated(overPrint(none, heads(on, r, pixelOn(on.xz))), on.mass);
}

/**
 * A crown: pointed fingers thrown outward round a centre. `d`: the offset from the centre (world x, z); `rim`: the
 * radius the fingers stand on; `reach`: how far the longest runs beyond it (0: no crown). `count` fingers round the
 * turn, alternately long and short by a hash of each, concave-sided, a key line round the lot.
 */
export function crown(d: V2, rim: F, reach: F, count: number, r: Roll): White {
  const pixel = pixelOn(d);
  // Fingers round, 0..count; turned by up to 0.7 of a finger's spacing along their length, so they curve one way
  // (claws, where straight ones were the points of a star).
  const out = saturate(sub(length(d), rim).div(max(reach, 1e-4)));
  const turn = add(mul(add(mul(atan2(d.y, d.x), 1 / (2 * Math.PI)), 0.5), count), mul(mul(out, out), 0.7));
  const k = floor(turn), across = abs(sub(fract(turn), 0.5)); // 0 on a finger's middle line, 0.5 between two
  const tall = mix(0.45, 1, hash22(vec2(k, count)).x);
  // A finger's length at this bearing: full on its middle line, falling to nothing between two (squared: concave sides).
  const share = saturate(sub(1, mul(across, 2)));
  const edge = add(rim, mul(mul(reach, tall), mul(share, share)));
  const s = sub(edge, length(d)); // world distance inside the crown's edge, along the radius
  const line = lineOf(r, pixel);
  const cream = over(s, 0, pixel);
  const live = step(1e-4, reach);
  return { fill: mul(cream, live), line: mul(mul(over(s, mul(line, -1), pixel), sub(1, cream)), live) };
}

/** One print behind another: the front one wherever it prints anything (its cream or its key line), the back one elsewhere. */
export function behind(back: White, front: White): White {
  return overPrint(back, { ...front, covers: saturate(add(front.fill, front.line)) });
}

/** Two prints as one: where either is cream it is cream; the key line only where neither is. */
export function joined(a: White, b: White): White {
  const cream = max(a.fill, b.fill);
  return { fill: cream, line: min(max(a.line, b.line), sub(1, cream)) };
}

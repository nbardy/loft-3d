// The Tithe Fleet: a drowned admiral's flagship and three phantom escorts riding low and wrong on the swell, with one
// small living ship (blue sails) for scale. Woodblock print: black hulls, bone rags, one red pennant on the flagship.
// Subject: the game's design notes, section 6.5 (room-runners-arena-lib, notes/design/2026-11-01_fleet_spells_bosses.md).
//
// Nothing is see-through or glowing: the ghost is in the shapes. The hulls are solid black with a bone rim under the
// rail (from the strategy camera, a hull of plank lines read as line-work); rags hang in torn strips slit to the yard;
// masts are snapped at different heights, a broken topmast leans on the rail; a few planks are missing (the ribs show);
// weed hangs at a waterline that has climbed the topsides; chains drape the sides; every hull lists and trims as no
// sound ship would, and rolls uneasily on two slow incommensurate clocks; a pale wake trails each. The flagship is
// 18 long, its escorts 7.4 and the living sloop 3.8, so the flagship dwarfs them.
//
// Draws: every kind of part is ONE posed draw for all the ships that have it (`posedList`, examples/bosses/tithe/kit.ts):
//   flagship hull (2, with its outline), deck, bulwarks, transom             5
//   escort hulls (2), decks, bulwarks, transoms (three copies each)          5
//   spars (every mast, yard, bowsprit and fallen spar of all four ships)     1
//   rags: flagship's, escorts'                                               2
//   pennant                                                                  1
//   rigging (every rope, one stroke), chains and weed (one stroke)           2
//   wakes (one glazed strip for all four)                                    1
//   broadside: two telegraphs, every puff/shell/splash (2, with its
//   outline), shell trails, the foam where the shells land (one a side)     7
// = 24 for the fleet and its attack (the level of detail may split a posed draw into runs of two or three levels),
// against about 180 for four ships built by `ship`. The living sloop is the shared scale ship, about 25 more.
//
// The signature attack is the flagship's Spectral Broadside: two capsules along the beams (src/spacetime telegraphs),
// a ripple of the gun ports opening from stern to bow as the tell, a jolt and a billow of the rags as it fires, smoke
// puffs, shells in flight with trails, and splash columns where they land at the arming time. It loops on time.

import {
  abs, add, clamp, cos, div, every, exp, floor, fract, lift, mapNormal, max, mix, mul, pick, posedList, saturate, sin, size,
  smoothstep, step, sub, time, turn, vec2, vec3, vec4, draw, attack, hit, telegraph, ropes, scene, sea, spacing,
  woodblock, print, NO_SKELETON, WOODBLOCK_PALETTE, beats, dragged, impact, slowInOut, swing,
  type Drawable, type Expr, type F, type Frame, type P3, type Paint, type PoseSpec, type Poses,
  type Rope, type Sea, type Surface,
} from "../../src/index.ts";
import { hull, type Hull, type HullSpec } from "../recipes/hull.ts";
import { atRest } from "../../src/map/surface.ts";
import { noise2 } from "../../src/lib/noise.ts";
import { sdBox } from "../../src/lib/sdf2.ts";
import { fwidth } from "../../src/lib/wgsl.ts";
import {
  ballPoint, bulwarkLoop, dirWorld, frameOf, framePose, linesOf, ragPoint, ridingFrame, slice, sparPose, toWorld,
  tubePoint, unitPart, v3, type Riding, type V3,
} from "./tithe/kit.ts";
import { SAIL, scaleShip } from "./lib/scale_ship.ts";
import { impactFoam, impactPaint, type Splash } from "./lib/impact.ts";
import { PRINT_WARNING } from "./lib/warning.ts";

// =====================================================================================================================
// The numbers an art director changes
// =====================================================================================================================

/** Paints. Woodblock prints each by its lit value (black < 0.08, indigo < 0.34, pale < 0.6, cream), red as vermilion. */
export const INK = {
  hull: [0.055, 0.05, 0.065], // black: below the black band lit or not
  hollow: [0.27, 0.27, 0.33], // where planks are missing: indigo, crossed by black ribs
  bone: [0.93, 0.89, 0.78], // rags, the rail's rim, opened ports, smoke and shells: cream in the light, pale in shadow
  weed: [0.24, 0.28, 0.24], // weed at the waterline: indigo strands in the black (pale ones read as line-work)
  spar: [0.05, 0.045, 0.055], // masts, yards: black (lit value must stay under 0.08)
  pennant: [0.82, 0.24, 0.15], // the one red thing
  chain: WOODBLOCK_PALETTE.pale, // chains and weed strands (flat strokes: their colour is final)
  rope: WOODBLOCK_PALETTE.black,
} as const;

/** The flagship's lines: a high-castled galleon, 18 long (about three times the living sloop). */
export const FLAGSHIP_HULL: HullSpec = {
  length: 18, beam: 5.4, depth: 2.0, freeboard: 1.8, sheer: [1.0, 1.2], castle: [2.1, 1.0], entry: 2.6, run: 3.2,
  fullness: 3.2, deadrise: 0.12, tumblehome: 0.22, transom: 0.7, rake: 0.42, widest: 0.5,
};
/** The escorts' lines (all three share them): a brig, 7.4 long, so the flagship dwarfs it. */
export const ESCORT_HULL: HullSpec = {
  length: 7.4, beam: 2.2, depth: 0.85, freeboard: 0.7, sheer: [0.25, 0.4], castle: [0.4, 0.15], entry: 2.1, run: 2.6,
  fullness: 2.7, tumblehome: 0.12, transom: 0.55, rake: 0.5,
};

/** Where each ghost rides and how wrong it rides. Flagship first. Headings in radians from +x toward +z. */
export const RIDING: readonly Omit<Riding, "length" | "beam">[] = [
  { at: [0, 0], heading: 0, sink: 0.75, list: -0.07, roll: 0.035, trim: 0.015, phase: 0 }, // 4 degrees to port
  { at: [17, -14], heading: 0.12, sink: 0.3, list: 0.13, roll: 0.05, trim: 0.035, phase: 1.3 }, // heeled, bow down
  { at: [-16, 13], heading: -0.1, sink: 0.27, list: -0.17, roll: 0.06, trim: -0.02, phase: 2.9 }, // hard over to port
  { at: [-21, -15], heading: 0.18, sink: 0.35, list: 0.06, roll: 0.07, trim: -0.05, phase: 4.4 }, // stern sinking
];

/** The rigs. Masts fore to aft: place along the hull (u), height as a share of `mast`, the share still standing, lean. */
type Yard = { readonly at: number; readonly span: number; readonly cant: number; readonly rag: number };
type Mast = { readonly u: number; readonly height: number; readonly kept: number; readonly lean: number; readonly yards: readonly Yard[] };
type Rig = { readonly mast: number; readonly bowsprit: number; readonly masts: readonly Mast[] };
/**
 * Yards: height up the full mast, span as a share of the beam, cant (radians: one arm dropped), and how far down to the
 * yard below its rag hangs (0: bare yard). A yard above the break is gone with the topmast.
 */
export const RIGS: readonly Rig[] = [
  {
    mast: 16, bowsprit: 6, masts: [
      { u: 0.75, height: 0.86, kept: 0.64, lean: 0.05, yards: [{ at: 0.36, span: 1.7, cant: 0.1, rag: 0.95 }, { at: 0.6, span: 1.3, cant: -0.32, rag: 0.8 }] },
      { u: 0.5, height: 1, kept: 0.9, lean: -0.015, yards: [{ at: 0.34, span: 1.95, cant: -0.05, rag: 1 }, { at: 0.58, span: 1.5, cant: 0.08, rag: 0.9 }, { at: 0.8, span: 1.1, cant: 0.22, rag: 0.75 }] },
      { u: 0.25, height: 0.74, kept: 0.5, lean: -0.08, yards: [{ at: 0.42, span: 1.3, cant: 0.45, rag: 0.7 }] },
    ],
  },
  {
    mast: 7, bowsprit: 2.3, masts: [
      { u: 0.69, height: 0.92, kept: 0.56, lean: 0.06, yards: [{ at: 0.37, span: 1.8, cant: 0.05, rag: 0.9 }] },
      { u: 0.41, height: 1, kept: 0.92, lean: -0.03, yards: [{ at: 0.37, span: 2, cant: -0.12, rag: 1 }, { at: 0.62, span: 1.5, cant: 0.3, rag: 0.7 }] },
    ],
  },
  {
    mast: 7, bowsprit: 1, masts: [
      { u: 0.69, height: 0.92, kept: 1, lean: -0.02, yards: [{ at: 0.37, span: 1.8, cant: -0.08, rag: 1 }, { at: 0.62, span: 1.4, cant: 0.04, rag: 0.85 }, { at: 0.83, span: 1.05, cant: -0.4, rag: 0 }] },
      { u: 0.41, height: 1, kept: 0.42, lean: 0.1, yards: [{ at: 0.37, span: 2, cant: 0.5, rag: 0.6 }] },
    ],
  },
  {
    mast: 7, bowsprit: 2.4, masts: [
      { u: 0.69, height: 0.92, kept: 0.38, lean: -0.05, yards: [{ at: 0.37, span: 1.8, cant: -0.25, rag: 0.8 }] },
      { u: 0.41, height: 1, kept: 0.78, lean: 0.04, yards: [{ at: 0.37, span: 2, cant: 0.08, rag: 1 }, { at: 0.62, span: 1.5, cant: -0.15, rag: 0.8 }] },
    ],
  },
];

export const RAGS = {
  /** Depth of a rag's belly as a share of its width, wind square on it; how much it breathes; extra billow in the tell. */
  billow: 0.12, breathe: 0.25, tellBillow: 1.4,
  /** Strips per rag (each slit to near the yard, its foot torn to a point). */
  strips: 7,
};

/** The wind (the direction it blows toward). Rags belly to it, the pennant streams along it. */
export const WIND = [0.85, 0.4] as const;

/** The flagship's Spectral Broadside. Seconds, world units. */
export const BROADSIDE = {
  period: 8, // it loops: one broadside every `period` seconds
  armAt: 5.2, // arming time within the loop: the hit lands, the marker flashes
  warn: 1.7, // seconds of warning (the game's 30 ticks): the marker sharpens, the ports open stern to bow
  flight: 0.55, // shells' time of flight; the guns fire this long before arming
  ripple: 0.05, // seconds between guns
  reach: 24, // each capsule from the side outward
  radius: 4.5, // capsule radius
  guns: 7, // per side
  arc: 2.6, // shells' height at mid-flight
  jolt: 0.35, // the hull drops this far as it fires (pushed from 0.22, which did not read)
  rise: 0.12, // and rises this far before, drawing breath (the wrong way first)
  splash: 3.4, // splash column height
};

/** The pale wake behind each ghost: length as a multiple of the hull's. */
export const WAKE = { length: 1.6, spread: 0.36 };

/** The living ship (lib/scale_ship.ts), inside the starboard broadside's lane. */
const LIVING_AT = { at: [4, 19] as const, heading: 2.5 };

// =====================================================================================================================
// The sea, the hulls and their frames
// =====================================================================================================================

const water: Sea = sea({
  swell: [
    { direction: [1, 0.3], length: 13, height: 0.45, speed: 1.8 },
    { direction: [0.3, 1], length: 7, height: 0.16, speed: 1.2, phase: 1.1 },
  ],
});

const flagHull = hull(FLAGSHIP_HULL), escortHull = hull(ESCORT_HULL);
const hulls: readonly Hull[] = [flagHull, escortHull, escortHull, escortHull];

// =====================================================================================================================
// The living ship and the Spectral Broadside (declared first: the flagship's jolt reads the broadside's clock)
// =====================================================================================================================

const living = scaleShip;
const livingChart = living.afloatChart(water, { ...LIVING_AT, wind: WIND });

const B = BROADSIDE;
/** The two capsules along the flagship's beams (it lies at the origin, bow along +x): the game's hit shapes. */
const lane = (side: number) => {
  const a0 = FLAGSHIP_HULL.beam / 2 + 1;
  return hit.capsule({ a: [0, side * a0], b: [0, side * (a0 + B.reach)], radius: B.radius });
};
/** A broadside moves no body part: a remote attack, its hit shape and schedule only. The target is the living ship. */
const broadside = (side: number, name: string) => attack({
  name, arm: every(B.period, B.armAt), warn: B.warn, target: living.target(livingChart), motion: { kind: "remote", hit: lane(side) },
});
const broadsides = [broadside(1, "broadside_starboard"), broadside(-1, "broadside_port")] as const;
// The broadside's clock: seconds from this cycle's arming time (negative before it). Both sides fire together.
const clock = sub(time, broadsides[0].arm);
/** 0 before the warning, rising to 1 at arming, gone shortly after the guns fire. */
const tell = mul(saturate(div(add(clock, B.warn), B.warn)), sub(1, smoothstep(0.1, 0.8, clock)));
/** Seconds since the first gun fired (negative before). */
const fireAfter = add(clock, B.flight);
/**
 * The broadside in three beats from the start of the warning: the flagship draws breath (rises slowly) until the guns
 * fire, drops at the guns (a heavy impact) and bobs back past level once, slowly: it is dead and stately, not lively.
 */
const fireBeat = beats(add(clock, B.warn), { anticipate: B.warn - B.flight, act: 0.12, settle: 2.5 });
/**
 * The heave alone did not read from the strategy camera (a 0.35 drop of a hull seen from 60 units above is a few
 * pixels); rotation of tall things does: the rotten hull shudders in roll at the guns (0.045 rad, 1 Hz, dying), which
 * swings the 16-high mastheads about 0.7.
 */
const shudder = swing(fireBeat.after, 0.045, 1.0, 0.2);
const heave = add(mul(mul(slowInOut(fireBeat.anticipate), sub(1, fireBeat.act)), -B.rise), mul(sub(1, impact(fireBeat.after, 1, 1.2, 0.3)), B.jolt));

const frames: Frame[] = RIDING.map((r, k) => ridingFrame(water, {
  ...r, length: hulls[k].lines.length, beam: hulls[k].lines.beam,
  ...(k === 0 ? { jolt: heave, shudder } : {}),
}, WIND));
/** Every ghost's frame, once per frame on the CPU; everything on a ship reads its frame from here. */
const ships = posedList("ships", frames.map(framePose));
const G = RIDING.map((_, k) => frameOf(ships, k));

/** The wind in a ship's own (level) coordinates, from its heading: numbers, since the headings are. */
const windIn = (heading: number): V3 => {
  const l = Math.hypot(WIND[0], WIND[1]), wx = WIND[0] / l, wz = WIND[1] / l;
  return [wx * Math.cos(heading) + wz * Math.sin(heading), 0, -wx * Math.sin(heading) + wz * Math.cos(heading)];
};

// =====================================================================================================================
// Paint
// =====================================================================================================================

const rgb = (c: readonly number[]): P3 => vec3(c[0], c[1], c[2]);
/** 1 inside (d < 0), antialiased by a pixel. */
const inside = (d: F): F => { const w = max(fwidth(d), 1e-4); return sub(1, smoothstep(mul(w, -1), w, d)); };

type HullLook = { readonly sink: number; readonly tiers: readonly number[]; readonly pitch: number; readonly ports: readonly [number, number]; readonly tell: F };

/**
 * A ghost's hull in its own (u, v), from its lines: solid black, a few strakes gone with the ribs showing through, gun
 * ports in tiers (black until they open stern to bow, bone, as `tell` goes 0 to 1), a broad bone rim under the rail,
 * weed hanging at the waterline it now sits at. (Indigo plank seams and pale port lids read as line-work from the
 * strategy camera, not as a black hull.)
 */
function ghostHullPaint(h: Hull, o: HullLook): Paint {
  const PLANK = 0.3, RIM = 0.22;
  return (u, v) => {
    // Height up the side without evaluating the section (two superellipse pows per pixel cost the flagship's hull and
    // its outline draw, which pays the paint too, 0.77 ms from the game camera). Above the turn of the bilge, which is
    // all of a sunk hull that shows, the section's height is linear in its parameter: the same blend `Hull.section` uses.
    const x = h.x(u), top = h.sheerAt(u), yb = 0.2 * h.lines.freeboard;
    const below = add(mul(add(add(h.half(u), h.keel(u)), yb), 0.9), 1e-4);
    const wb = div(below, add(below, sub(top, yb)));
    const w = abs(sub(mul(v, 2), 1));
    const y = add(yb, mul(sub(top, yb), div(sub(w, wb), sub(1, wb))));
    let c: Expr<"vec3"> = rgb(INK.hull);
    const sy = div(y, PLANK), strake = floor(sy);
    // Missing strakes: a hashed few, above the water and below the rim; ribs show through.
    const cell = floor(div(add(x, mul(hashF(strake), 3)), 2.2));
    const gone = mul(mul(step(0.9, hashF(add(mul(strake, 17.3), cell))), step(o.sink + 0.25, y)), step(0.5, sub(top, y)));
    const rib = inside(sub(abs(sub(fract(div(x, 0.5)), 0.5)), 0.38).mul(-1));
    c = mix(c, mix(rgb(INK.hollow), rgb(INK.hull), rib), mul(gone, inside(sub(abs(sub(fract(sy), 0.5)), 0.42))));
    // Gun ports: black until they open, bone.
    const n = Math.round((o.ports[1] - o.ports[0]) * h.lines.length / o.pitch);
    const col = floor(div(x, o.pitch));
    const along = saturate(div(sub(add(mul(col, o.pitch), 0.5 * o.pitch), h.x(lift<"f32">(o.ports[0]))), (o.ports[1] - o.ports[0]) * h.lines.length));
    const inRange = mul(step(o.ports[0], u), step(u, o.ports[1]));
    const open = step(along, mul(o.tell, 1.02 + 1 / n));
    for (const ty of o.tiers) {
      const q = vec2(mul(sub(fract(div(x, o.pitch)), 0.5), o.pitch), sub(y, ty));
      const box = sdBox(q, vec2(0.17, 0.14));
      c = mix(c, rgb(INK.bone), mul(mul(inside(box), inRange), open));
    }
    // The bone rim under the rail: what reads from the strategy camera.
    c = mix(c, rgb(INK.bone), inside(sub(sub(top, y), RIM)));
    // Weed: strands of hashed length hanging from above the waterline.
    const k = floor(mul(x, 2.6));
    const weedTop = add(o.sink + 0.12, mul(hashF(add(k, 5.1)), 0.45));
    const strand = inside(sub(abs(sub(fract(mul(x, 2.6)), 0.5)), mix(0.18, 0.42, hashF(add(k, 9.7)))));
    c = mix(c, rgb(INK.weed), mul(strand, inside(sub(y, weedTop))));
    return c;
  };
}
const hashF = (x: F): F => fract(mul(sin(mul(x, 127.1)), 43758.5453));

/** Decks: black, a few planks gone to the indigo hold below. */
const deckPaint: Paint = (u, v) => {
  const pv = mul(v, 12), plank = floor(pv);
  const gone = step(0.85, hashF(add(mul(plank, 7.1), floor(add(mul(u, 9), hashF(plank))))));
  return mix(rgb(INK.hull), rgb(INK.hollow), gone);
};
/** The transom: black, a row of bone gallery lights under the taffrail. */
const transomPaint: Paint = (u, v) => {
  const lights = mul(inside(sub(abs(sub(fract(mul(u, 9)), 0.5)), 0.3)), mul(step(0.74, v), step(v, 0.86)));
  return mix(rgb(INK.hull), rgb(INK.bone), mul(lights, step(abs(sub(u, 0.5)), 0.3)));
};
/** Rags: bone, panel seams, burnt holes, a pale tide-stain toward the foot. */
const ragPaint = (seed: number): Paint => (u, v) => {
  let c: Expr<"vec3"> = rgb(INK.bone);
  c = mix(c, mul(rgb(INK.bone), 0.62), inside(sub(abs(sub(fract(mul(u, 14)), 0.5)), 0.44).mul(-1)));
  c = mix(c, mul(rgb(INK.bone), 0.6), mul(smoothstep(0.55, 0.6, v), 0.9));
  const hole = sub(0.38, noise2(vec2(add(mul(u, 5), seed), mul(v, 3.2))));
  return mix(c, rgb(INK.hull), mul(inside(hole), step(0.18, v)));
};

// =====================================================================================================================
// Hulls: one instanced draw per part per hull type
// =====================================================================================================================

function hullParts(tag: string, h: Hull, at: Poses, look: HullLook): Drawable[] {
  return [
    draw.surface(`${tag}_hull`, { ...h.skin, skeleton: h.skeleton() }, { paint: ghostHullPaint(h, look), grid: { u: spacing.ends(120, 0.35), v: spacing.even(48) }, sides: "one", outline: "hull" }).posed(`${tag}_hull`, at),
    draw.surface(`${tag}_deck`, h.deck, { paint: deckPaint, grid: { u: spacing.even(48), v: spacing.even(6) }, sides: "one", outline: "none" }).posed(`${tag}_deck`, at),
    draw.surface(`${tag}_bulwark`, bulwarkLoop(h), { paint: () => rgb(INK.hull), grid: { u: spacing.even(96), v: spacing.even(1) }, sides: "two", outline: "none" }).posed(`${tag}_bulwark`, at),
    draw.surface(`${tag}_transom`, h.transom, { paint: transomPaint, grid: { u: spacing.even(24), v: spacing.even(4) }, sides: "one", outline: "none" }).posed(`${tag}_transom`, at),
  ];
}

// =====================================================================================================================
// Rigs: spars, rags, ropes, chains and weed, in each ship's frame
// =====================================================================================================================

type Built = { spars: PoseSpec[]; rags: PoseSpec[]; ropes: Rope[]; chains: Rope[]; mainTop: V3 };

const sway = (rate: number, phase: number, amp: number): F => mul(sin(add(mul(time, rate), phase)), amp);

function rig(k: number): Built {
  const g = G[k], h = hulls[k], L = linesOf(h), R = RIGS[k], Lh = h.lines, r = RIDING[k];
  const out: Built = { spars: [], rags: [], ropes: [], chains: [], mainTop: [0, 0, 0] };
  const girth = 0.016 * R.mast + 0.03;
  const wl = windIn(r.heading);
  const rail = (u: number, side: number): V3 => [L.x(u), L.sheer(u) - 0.05, side * (L.half(u) * (1 - Lh.tumblehome) + 0.04)];
  let tallest = -1;
  R.masts.forEach((m, i) => {
    const h0 = m.height * R.mast;
    const foot: V3 = [L.x(m.u), L.deck(m.u) - 0.3, 0];
    const dir = v3.norm([-0.05, 1, m.lean]);
    const at = (f: number): V3 => v3.add(foot, v3.mul(dir, f * h0));
    const top = at(m.kept);
    out.spars.push(sparPose(g, foot, top, girth * (0.75 + 0.25 * m.height)));
    if (m.kept * h0 > tallest) { tallest = m.kept * h0; out.mainTop = top; }
    // Shrouds to the rails (three a side), and two broken ones hanging from the break.
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) out.ropes.push({ a: lift<"vec3">(at(Math.min(m.kept, 0.6) - 0.02 * j)), b: lift<"vec3">(rail(m.u - 0.025 * j + 0.01, side)), sag: 0.03 });
    }
    if (m.kept < 0.95) {
      // The topmast that broke off: its heel caught at the break, its head fallen onto the rail.
      const side = i % 2 === 0 ? 1 : -1;
      const fallLen = Math.min((1 - m.kept) * h0, 0.6 * h0);
      const restOn = rail(Math.min(Math.max(m.u - 0.08 * side, 0.08), 0.92), side);
      const d = v3.norm(v3.sub(restOn, top));
      out.spars.push(sparPose(g, v3.add(top, v3.mul(d, -0.3)), v3.add(top, v3.mul(d, fallLen)), girth * 0.6));
      for (const s of [-1, 1]) out.ropes.push({ a: lift<"vec3">(top), b: add(lift<"vec3">(v3.add(top, [0.4 * s, -0.55 * m.kept * h0, 0.7 * s])), vec3(sway(0.8, i + s, 0.3), 0, sway(0.6, i * 2 + s, 0.4))), sag: 0.05 });
    }
    // Yards that survive below the break, each with its rag hanging to the yard below (or toward the deck).
    const kept = m.yards.filter((y) => y.at < m.kept - 0.02);
    kept.forEach((y, j) => {
      const c = v3.add(at(y.at), [girth * 1.6, 0, 0]);
      const along = v3.norm([0.12 * (j % 2 === 0 ? 1 : -1), Math.sin(y.cant), Math.cos(y.cant)]);
      const span = y.span * Lh.beam;
      const a = v3.add(c, v3.mul(along, -span / 2)), b = v3.add(c, v3.mul(along, span / 2));
      out.spars.push(sparPose(g, a, b, girth * 0.55));
      // A lift parted: one yardarm's rope hangs loose and swings.
      out.ropes.push({ a: lift<"vec3">(b), b: add(lift<"vec3">(v3.add(b, [0, -2.2, 0.3])), vec3(sway(1.1, i + j, 0.25), 0, sway(0.7, i * 3 + j, 0.35))), sag: 0.02 });
      if (y.rag > 0) {
        const below = j > 0 ? at(kept[j - 1].at)[1] + girth : L.deck(m.u) + 0.9;
        const drop = Math.max((c[1] - below) * y.rag, 1.2);
        // The flagship's rags billow in the tell, gust out with the guns and swing on, each yard a little later.
        const gust = swing(dragged(fireAfter, i + j, 0.08), 0.9, 0.8, 0.25);
        out.rags.push(ragPose(g, c, along, span * 0.92, drop, wl, k === 0 ? add(tell, gust) : lift<"f32">(0), k + i * 1.7 + j * 2.3));
      }
    });
    // A stay forward: to the mast before it, or from the foremast to the bowsprit's end.
    const forward: V3 = i === 0 ? bowspritEnd(L, Lh, R) : (() => { const p = R.masts[i - 1]; const f = Math.min(p.kept, 0.7); return [L.x(p.u) - 0.05 * f * p.height * R.mast, L.deck(p.u) - 0.3 + f * p.height * R.mast, 0]; })();
    out.ropes.push({ a: lift<"vec3">(at(m.kept * 0.97)), b: lift<"vec3">(forward), sag: 0.05 });
  });
  // The bowsprit.
  const root: V3 = [L.x(1) - 0.08 * Lh.length, L.sheer(1) - 0.15, 0];
  out.spars.push(sparPose(g, root, bowspritEnd(L, Lh, R), girth * 0.6));
  // Chains: the anchor cable from the hawse into the water, and lengths draped along both sides.
  for (const side of [-1, 1]) {
    const hawse: V3 = [L.x(0.95) - 0.1, L.sheer(0.95) - 0.45, side * 0.35 * L.half(0.85)];
    out.chains.push({ a: lift<"vec3">(hawse), b: lift<"vec3">([hawse[0] + 2.2, -2.5, side * 1.0]), sag: 0.5 });
    for (const [u0, u1, y0] of [[0.3, 0.42, 0.5], [0.46, 0.6, 0.62], [0.63, 0.74, 0.55]] as const) {
      const y = r.sink + y0 * (Lh.freeboard - r.sink) + 0.15;
      const z = (u: number) => side * (L.half(u) * (1 - 0.4 * Lh.tumblehome) + 0.06);
      out.chains.push({ a: lift<"vec3">([L.x(u0), y, z(u0)]), b: lift<"vec3">([L.x(u1), y, z(u1)]), sag: 0.12 * Lh.length * (u1 - u0) });
    }
    // Weed strands trailing from the hull into the water, swaying.
    for (let j = 0; j < 9; j++) {
      const u = 0.18 + 0.075 * j + 0.02 * Math.sin(j * 7.1 + k);
      const z = side * (L.half(u) + 0.05);
      const y = r.sink + 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(j * 3.3 + k * 1.9));
      out.chains.push({ a: lift<"vec3">([L.x(u), y, z]), b: add(lift<"vec3">([L.x(u) - 0.3, r.sink - 0.5, z * 1.08]), vec3(sway(0.9, j + k, 0.25), 0, 0)), sag: 0.04 });
    }
  }
  // Ropes and chains are given in the ship's frame; the strokes want the world.
  const world = (rs: Rope[]): Rope[] => rs.map((q) => ({ a: toWorld(g, q.a), b: toWorld(g, q.b), sag: q.sag }));
  return { ...out, ropes: world(out.ropes), chains: world(out.chains) };
}

function bowspritEnd(L: ReturnType<typeof linesOf>, Lh: Hull["lines"], R: Rig): V3 {
  const root: V3 = [L.x(1) - 0.08 * Lh.length, L.sheer(1) - 0.15, 0];
  const a = 0.3, len = R.bowsprit + 0.08 * Lh.length;
  return [root[0] + Math.cos(a) * len, root[1] + Math.sin(a) * len, 0];
}

/**
 * A rag on a yard: the unit rag stretched across the yard (x), down (y) and out along its belly (z). It bellies
 * downwind: when the wind is on its other face it is turned end for end (x and z both flipped, so it is not mirrored).
 * A turn's axes are perpendicular, so the rag hangs square to its yard: on a canted yard it hangs tilted with the cant
 * (it was sheared to hang plumb, which a pose cannot do; the rag's plane, and so its belly, is the same).
 */
function ragPose(g: Frame, centre: V3, along: V3, width: number, drop: number, wl: V3, tellK: F, phase: number): PoseSpec {
  const up: V3 = [0, 1, 0];
  const face = v3.norm(v3.cross(along, up));
  const across = v3.dot(wl, face);
  const sgn = across >= 0 ? 1 : -1;
  const square = v3.norm(v3.sub(up, v3.mul(along, v3.dot(along, up))));
  const belly = mul(mul(RAGS.billow * width * (0.35 + 0.65 * Math.abs(across)), add(1, sway(0.7, phase, RAGS.breathe))), add(1, mul(tellK, RAGS.tellBillow)));
  return { at: toWorld(g, centre), turn: turn.axes(dirWorld(g, v3.mul(along, sgn)), dirWorld(g, square)), size: size.axes(vec3(width, drop, belly)) };
}

const built = RIDING.map((_, k) => rig(k));

// ---- the rig's draws ---------------------------------------------------------------------------------------------

const spars = draw.surface("tithe_spars", unitPart(tubePoint(0.4), { u: ["pole", "pole"], v: "periodic" }), {
  paint: () => rgb(INK.spar), grid: { u: spacing.even(6), v: spacing.even(10) }, sides: "one", outline: "none",
}).posed("tithe_spars", posedList("spars", built.flatMap((b) => b.spars)));

/** Rags in two draws: the flagship's (its tell billows them) and the escorts'; each alternates two tear patterns. */
function ragDraw(name: string, list: readonly PoseSpec[], seed: number): Drawable {
  return draw.surface(name, unitPart(ragPoint({ strips: RAGS.strips, seed, swing: seed }), { u: ["free", "free"], v: "free" }), {
    paint: ragPaint(seed), grid: { u: spacing.even(RAGS.strips * 6), v: spacing.even(10) }, sides: "two", outline: "border",
  }).posed(name, posedList(name, list));
}
const rags = [ragDraw("tithe_flag_rags", built[0].rags, 3.1), ragDraw("tithe_escort_rags", built.slice(1).flatMap((b) => b.rags), 8.7)];

const rigging = ropes("tithe_rigging", built.flatMap((b) => b.ropes), { width: 0.035, colour: INK.rope });
const chains = ropes("tithe_chains", built.flatMap((b) => b.chains), { width: 0.05, colour: INK.chain });

/** The flagship's pennant: a long red strip streaming downwind from its tallest standing masthead. */
function pennant(): Drawable {
  const wl = windIn(RIDING[0].heading), side: V3 = [wl[2], 0, -wl[0]];
  const length = 9, width = 0.75;
  const point = (u: F, v: F): P3 => {
    // It streams, and the guns' shock whips it: the whip runs out to the fly end, arriving there 0.35 s late.
    const whip = swing(dragged(fireAfter, u, 0.35), 3.2, 0.9, 0.25);
    const wave = add(add(sin(mul(sub(mul(u, 2.2), mul(time, 1.7)), Math.PI * 2)), mul(sin(mul(sub(mul(u, 4.3), mul(time, 2.9)), Math.PI * 2)), 0.3)), whip);
    const w = mul(width, sub(1, mul(u, 0.8)));
    // The fly end is torn into two tails.
    const across = mul(sub(v, 0.5), w);
    const along = add(mul(lift<"vec3">(wl), mul(u, length)), mul(lift<"vec3">(side), mul(mul(wave, u), length * 0.07)));
    return add(along, vec3(0, add(across, mul(mul(u, u), -length * 0.1)), 0));
  };
  const surf: Surface = { point, normal: mapNormal(point), anchor: atRest(point), topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON };
  const at = posedList("pennant", [{ ...framePose(G[0]), at: toWorld(G[0], v3.add(built[0].mainTop, [0, 0.15, 0])) }]);
  return draw.surface("tithe_pennant", surf, {
    paint: (u, v) => mix(rgb(INK.pennant), mul(rgb(INK.pennant), 0.72), inside(sub(abs(sub(v, 0.5)), 0.32).mul(-1))),
    grid: { u: spacing.even(36), v: spacing.even(2) }, sides: "two", outline: "border",
  }).posed("tithe_pennant", at);
}

// =====================================================================================================================
// The wakes: one glazed strip on the water for all four
// =====================================================================================================================

/**
 * Pale wakes astern of each ghost: two diverging arms and lines along the wake's middle, broken into claws by noise,
 * thinning out with distance. All four in one strip of cells; the cells between two wakes have zero width (as a ship's
 * ropes are joined in `lines`), so they draw nothing.
 */
function wakes(): Drawable {
  const S = 28, per = S + 3, N = RIDING.length, cells = N * per;
  const where = (u: F) => {
    const x = mul(u, cells);
    const k = clamp(floor(mul(add(x, 0.5), 1 / per)), 0, N - 1);
    const local = sub(x, mul(k, per));
    return { k, s: clamp(mul(sub(local, 1), 1 / S), 0, 1), on: mul(step(0.5, local), step(local, S + 1.5)) };
  };
  const hx = (k: F) => pick(k, RIDING.map((r) => r.at[0])), hz = (k: F) => pick(k, RIDING.map((r) => r.at[1]));
  const head = (k: F) => pick(k, RIDING.map((r) => r.heading));
  const half = (k: F) => pick(k, hulls.map((h) => 0.46 * h.lines.length)), beam = (k: F) => pick(k, hulls.map((h) => h.lines.beam));
  const len = (k: F) => pick(k, hulls.map((h) => WAKE.length * h.lines.length));
  const point = (u: F, v: F): P3 => {
    const { k, s, on } = where(u);
    const h = head(k), fwd = vec2(cos(h), sin(h)), side = vec2(mul(sin(h), -1), cos(h));
    const along = mul(s, len(k));
    const width = mul(add(mul(beam(k), 0.42), mul(along, WAKE.spread)), on);
    const xz = add(sub(vec2(hx(k), hz(k)), mul(fwd, add(half(k), along))), mul(side, mul(sub(mul(v, 2), 1), width)));
    return vec3(xz.x, add(water.height(xz), 0.03), xz.y);
  };
  const surface: Surface = { point, normal: () => vec3(0, 1, 0), anchor: (u, v) => vec3(u, v, 0), topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON };
  const cream = rgb(WOODBLOCK_PALETTE.cream);
  return draw.glazed("tithe_wakes", surface, {
    colour: (fr) => {
      const { s } = where(fr.u);
      const t = sub(mul(fr.v, 2), 1), xz = vec2(fr.world.x, fr.world.z);
      const n = noise2(mul(xz, 0.8));
      const arm = mul(inside(sub(abs(sub(abs(t), 0.84)), add(0.05, mul(s, 0.05)))), step(add(-0.35, mul(s, 1.1)), n));
      const middle = mul(mul(inside(sub(abs(sub(fract(add(mul(t, 4.5), mul(n, 0.8))), 0.5)), 0.42).mul(-1)), inside(sub(abs(t), mul(0.55, sub(1, s))))), step(add(-0.2, mul(s, 1.3)), noise2(mul(xz, 1.7))));
      const alpha = mul(max(arm, middle), mul(sub(1, smoothstep(0.7, 1, s)), smoothstep(0, 0.04, s)));
      return vec4(cream, alpha);
    },
    grid: { u: spacing.even(cells), v: spacing.even(8) }, phase: "on-water", sceneDepth: false,
  });
}

// =====================================================================================================================
// The Spectral Broadside: what it throws
// =====================================================================================================================

const FH = linesOf(flagHull);
const PORT_TIERS = [RIDING[0].sink + 0.42, RIDING[0].sink + 0.98] as const;
const PORTS: readonly [number, number] = [0.27, 0.74];

const telegraphs = broadsides.map((a) => telegraph(a, { style: PRINT_WARNING }));

/**
 * What the guns throw, as copies of one ball: two smoke puffs per gun, the shell in flight, a splash column and a
 * crown where it lands. Each copy's place and size are a function of the broadside's clock (size 0 when it is not
 * there), so one table and one draw carry the whole volley (inked round, as a print's spray is). Where each shell lands
 * the water bursts into foam (lib/impact.ts), one draw a side.
 */
function volley(): { readonly balls: Drawable; readonly trails: Drawable; readonly foam: readonly Drawable[] } {
  const g = G[0], list: PoseSpec[] = [], trails: Rope[] = [];
  const splashes: Record<number, Splash[]> = { 1: [], [-1]: [] };
  const up = dirWorld(g, [0, 1, 0]);
  for (const side of [1, -1]) {
    const out = dirWorld(g, [0, 0, side]);
    for (let j = 0; j < B.guns; j++) {
      const u = PORTS[0] + (PORTS[1] - PORTS[0]) * (j + 0.5) / B.guns;
      const mouthLocal: V3 = [FH.x(u), PORT_TIERS[0], side * (FH.half(u) + 0.2)];
      const mouth = toWorld(g, mouthLocal);
      const fire = -B.flight + (j - (B.guns - 1) / 2) * B.ripple;
      const age = sub(clock, fire);
      const live = (from: number, to: number): F => mul(step(from, age), step(age, to));
      // Smoke: a puff pushed out of the port, and a larger one beyond it, both rising and swelling, then gone.
      const vary = 0.7 + 0.6 * hashN(j * 1.3 + side * 0.7);
      for (const [delay, reach0, r0] of [[0, 1.4, 0.6], [0.07, 2.8, 0.95]] as const) {
        const r = r0 * vary, reach = reach0 * (1.6 - 0.6 * vary);
        const a = sub(age, delay);
        const grow = mul(smoothstep(0, 0.14, a), mul(add(1, mul(max(a, 0), 0.5)), sub(1, smoothstep(1.1, 1.9, a))));
        const o = add(add(mouth, mul(out, add(0.3, mul(reach, sub(1, exp(mul(max(a, 0), -2.6))))))), mul(up, mul(max(a, 0), 0.45)));
        list.push({ at: o, turn: turn.none, size: size.axes(mul(vec3(r, r * 0.8, r), mul(grow, step(0, a)))) });
      }
      // The shell: from the port to its landing point on the lane, on an arc.
      const dist = FLAGSHIP_HULL.beam / 2 + 4 + (B.reach - 6) * hashN(j * 3.1 + side);
      const land = vec2(FH.x(u) * 0.5, side * dist);
      const landY = water.height(land);
      const shellAt = (aa: F): P3 => {
        const s = saturate(div(aa, B.flight));
        const flat = mix(mouth, vec3(land.x, landY, land.y), s);
        return add(flat, vec3(0, mul(mul(mul(s, sub(1, s)), 4), B.arc), 0));
      };
      list.push({ at: shellAt(age), turn: turn.none, size: size.axes(mul(vec3(0.32, 0.32, 0.32), live(0, B.flight))) });
      trails.push({ a: shellAt(age), b: shellAt(max(sub(age, 0.16), 0)), sag: 0 });
      // The splash where it lands: a column that rises and falls, and a low crown round it.
      const a2 = sub(age, B.flight);
      const rise = mul(sin(mul(saturate(div(a2, 0.95)), Math.PI)), live(0, 0.95));
      const centre = vec3(land.x, landY, land.y);
      list.push({ at: centre, turn: turn.none, size: size.axes(mul(vec3(0.55, B.splash, 0.55), rise)) });
      list.push({ at: centre, turn: turn.none, size: size.axes(mul(vec3(1.5, 0.45, 1.5), mul(mul(smoothstep(0, 0.12, a2), sub(1, smoothstep(0.6, 1.3, a2))), step(0, a2)))) });
      splashes[side]!.push({ at: land, since: a2 });
    }
  }
  return {
    balls: draw.surface("tithe_volley", unitPart(ballPoint(), { u: ["pole", "pole"], v: "periodic" }), {
      paint: () => rgb(INK.bone), grid: { u: spacing.even(10), v: spacing.even(14) }, sides: "one", outline: "hull",
    }).posed("tithe_volley", posedList("volley", list)),
    trails: ropes("tithe_trails", trails, { width: 0.2, colour: WOODBLOCK_PALETTE.cream }),
    foam: ([1, -1] as const).map((side) => impactFoam(`tithe_splash_${side > 0 ? "starboard" : "port"}`, water, {
      area: lane(side), pad: 1.5, splashes: splashes[side]!, reach: 2.2, seconds: 1.2,
      foam: WOODBLOCK_PALETTE.cream, line: WOODBLOCK_PALETTE.black, paint: impactPaint.ridge(),
    })),
  };
}
const hashN = (x: number): number => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };
const shots = volley();

// =====================================================================================================================
// The scene
// =====================================================================================================================

const flagLook: HullLook = { sink: RIDING[0].sink, tiers: PORT_TIERS, pitch: 1.05, ports: PORTS, tell };
const escortLook: HullLook = { sink: 0.32, tiers: [0.6], pitch: 0.75, ports: [0.3, 0.7], tell: lift<"f32">(0) };

export default scene({
  ground: water,
  things: [
    ...hullParts("tithe_flag", flagHull, slice(ships, 0, 1), flagLook),
    ...hullParts("tithe_escort", escortHull, slice(ships, 1, 3), escortLook),
    spars, ...rags, pennant(), rigging, chains, wakes(),
    ...telegraphs, shots.balls, shots.trails, ...shots.foam,
    ...living.placed(livingChart, WIND),
  ],
  style: woodblock({ print: print.bands({ named: { sail: SAIL } }) }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    game: { kind: "perspective", eye: [-38, 46, 36], target: [-4, 0, -2], fovY: 0.62 },
    three: { kind: "perspective", eye: [23, 15, 27], target: [-1, 5.5, 0], fovY: 0.66 },
    close: { kind: "perspective", eye: [-21, 7.5, -15], target: [-5, 4, 0], fovY: 0.5 },
    top: { kind: "orthographic", eye: [0, 80, 0.001], target: [0, 0, 0], height: 64 },
  },
});

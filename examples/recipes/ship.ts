// RECIPE: a sailing ship from named numbers. Copy this file and edit it; it imports only the public entry and the hull
// recipe beside it.
// Uses: ./hull.ts
//
// What it makes: a ship of one, two or three masts, square or fore-and-aft rigged, on the lines-plan hull of
// `./hull.ts` (its lines are part of the spec). `masts` picks one of three fixed mast plans (positions along the hull
// and heights); `tiers` square sails go up each mast on fixed yard heights, yards shortening by 0.76 a tier; a
// fore-and-aft rig, or the aftermost mast of a square rig, carries a gaff sail; up to three jibs run from the bowsprit
// to the foremast. The wind, given in the world, braces the yards, swings the booms to leeward and bellies every sail;
// the cloth flutters by a wave travelling across it, stronger as a sail luffs. Team colour goes on the cloth.
//
// From which library pieces, all authored in the ship's own coordinates (x toward the bow, y up, z to starboard, the
// waterline at y = 0) and carried by one rigid chart:
//
//   masts, yards, bowsprit, boom and gaff    `strand` between two points (`spar` below), `place`d in the chart
//   square sails, gaff sails, jibs          `surface`s between spars: flat between them plus a belly along their
//                                            normal and a travelling flutter, `framedPose`d into the chart
//   standing and running rigging            one `ropes` stroke through every rope
//   pennant                                  a two-sided `surface` streaming downwind from the main truck
//   rudder                                   `thicken` of a `sheet` on the sternpost
//   on the water                             `afloat`: the water under the hull sets height, pitch and roll
//
// Parameters: `ShipSpec`, all numbers, fixed at build; the wind direction is fixed; placement (`afloat`, `placed`)
// takes a chart, so the ship follows the water or a grip. `target` is the hull as a `skin` target for checks.
//
// What it cannot do:
// - any rig but these: no lateen, junk, sprit or crab-claw sail, no fourth mast, no oars, no engine.
// - masts anywhere but the plan's places; sails of any cut but quadrilateral square, gaff and triangular jib.
// - a wind that changes, or a sail that is furled, torn or set aback by choice.
//
// What to change first when copying it: `PLANS` and `YARD_AT` (where masts stand and where yards hang), then the sail
// point functions in `squareRig`, `gaffRig` and `jib`. A different vessel is a new composition of the same pieces:
// a hull of your own lines (or `loft` through stations of your own), `strand`s for spars, `surface`s for sails,
// `ropes` for rigging.

import {
  abs, add, afloat, atan2, clamp, cos, cross, dot, draw, evaluate, fract, framedPose, inFrame, lift, max, min, mix, mul, normalize, place, pow,
  sheet, sin, size as sizes, sized, sizeLengths, smoothstep, spacing, strand, sub, surface, thicken, through, time, TAU, vec3, ropes as ropeStroke,
  type Chart, type Drawable, type Expr, type F, type Frame, type In, type P3, type Paint, type Rope, type Size, type Skeleton, type Strand,
  type Surface, type Target, type Waters,
} from "../../src/index.ts";
import { Hull, type HullSpec, type Rgb } from "./hull.ts";

export type ShipColours = {
  readonly hull: Rgb; readonly bottom: Rgb; readonly wale: Rgb; readonly trim: Rgb; readonly deck: Rgb;
  readonly spar: Rgb; readonly cloth: Rgb; readonly rope: Rgb;
  /** The team: stripes on the cloth and the pennant. */
  readonly team: Rgb;
};

export type ShipSpec = HullSpec & {
  /** An identifier: it prefixes every part's name. */
  readonly name: string;
  /** Masts, 1 to 3 (fore to aft). */
  readonly masts: number;
  /** Height of the main mast above the deck. */
  readonly mastHeight: number;
  /** Rake of the masts, radians aft. Default 0.05. */
  readonly mastRake?: number;
  /** Square sails per mast (0: a fore-and-aft rig, one gaff sail on every mast). */
  readonly tiers: number;
  /** Length of the lowest yard as a multiple of the beam. Default 1.7. */
  readonly yard?: number;
  /** A gaff sail on the aftermost mast of a square rig (a spanker): 1 or 0. Default 1. */
  readonly spanker?: number;
  /** Headsails on the bowsprit, 0 to 3. Default 2. */
  readonly jibs?: number;
  /** Bowsprit beyond the stem, world units. Default 0.3 of the length. */
  readonly bowsprit?: number;
  /** Depth of a sail's belly as a share of its width, in a wind square on it. Default 0.14. */
  readonly billow?: number;
  /** Amplitude of the flutter running across the cloth, world units. Default 0.05. */
  readonly flutter?: number;
  /** Heel under a wind straight across, radians. Default 0.1. */
  readonly heel?: number;
  /** Gun ports per side. Default 0. */
  readonly ports?: number;
  readonly colours: ShipColours;
};

export type Placement = {
  /** Where, in the water's own coordinates (x, z). */
  readonly at: In<"vec2">;
  /** Bow heading, radians from +x toward +z, in the water's coordinates. */
  readonly heading: In<"f32">;
  /** The direction the wind blows toward, on the sea plane (x, z). */
  readonly wind: readonly [number, number];
};

const UP = lift<"vec3">([0, 1, 0]);
const rgb = (c: Rgb): P3 => vec3(c[0], c[1], c[2]);
const powz = (x: F, k: number): F => pow(max(x, 1e-6), k);
const MAX_BRACE = 0.62;
const MAX_SWING = 1.0;

/** A mast: where it stands and how tall it is. */
type Mast = { readonly u: number; readonly height: number; readonly square: boolean; readonly gaff: boolean };

/** Fore to aft: positions along the hull and heights as fractions of the main mast. */
const PLANS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[0.6, 1]],
  2: [[0.69, 0.92], [0.41, 1]],
  3: [[0.74, 0.88], [0.5, 1], [0.24, 0.72]],
};

/** Square yards up a mast (fraction of its height) for tier i, from the course up. */
const YARD_AT = [0.37, 0.62, 0.83, 0.96];

export class Ship {
  readonly hull: Hull;
  readonly spec: Required<Omit<ShipSpec, keyof HullSpec>>;
  private readonly plan: readonly Mast[];

  constructor(spec: ShipSpec) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(spec.name)) throw new Error(`ship "${spec.name}": names must be identifiers`);
    const plan = PLANS[spec.masts];
    if (plan === undefined) throw new Error(`ship "${spec.name}": masts must be 1, 2 or 3, got ${spec.masts}`);
    if (!(Number.isInteger(spec.tiers) && spec.tiers >= 0 && spec.tiers <= YARD_AT.length)) throw new Error(`ship "${spec.name}": tiers must be an integer in 0..${YARD_AT.length}, got ${spec.tiers}`);
    this.hull = new Hull(spec);
    this.spec = {
      name: spec.name, masts: spec.masts, mastHeight: spec.mastHeight, mastRake: spec.mastRake ?? 0.05, tiers: spec.tiers,
      yard: spec.yard ?? 1.7, spanker: spec.spanker ?? 1, jibs: spec.jibs ?? 2, bowsprit: spec.bowsprit ?? 0.3 * spec.length,
      billow: spec.billow ?? 0.14, flutter: spec.flutter ?? 0.05, heel: spec.heel ?? 0.1, ports: spec.ports ?? 0, colours: spec.colours,
    };
    if (!(this.spec.jibs >= 0 && this.spec.jibs <= 3)) throw new Error(`ship "${spec.name}": jibs must be 0..3, got ${this.spec.jibs}`);
    const square = spec.tiers > 0;
    this.plan = plan.map(([u, h], i) => ({
      u, height: h * spec.mastHeight, square,
      gaff: !square || (i === plan.length - 1 && this.spec.spanker > 0),
    }));
  }

  /** Float the ship on the water (the sea, or a whirlpool in it) and assemble it there. */
  afloat(water: Waters, p: Placement, size: Size = sizes.even(1)): Drawable[] {
    return this.placed(this.afloatChart(water, p), p.wind, size);
  }

  /** The rigid chart `afloat` puts the ship in (for `target`, or to place more things on the ship). */
  afloatChart(water: Waters, p: Placement): Chart {
    return afloat(water, {
      at: p.at, heading: p.heading, length: this.hull.lines.length * 0.8, beam: this.hull.lines.beam,
      wind: { direction: p.wind, heel: this.spec.heel },
    });
  }

  /** The hull in `chart` as an attack's target: checks measure contact with its skin's own shape. */
  target(chart: Chart): Target {
    return { kind: "skin", skin: this.hull.skin, frame: chart.frame(lift<"vec3">([0, 0, 0])) };
  }

  /**
   * The ship in a rigid chart (its frame at the origin is the ship's), with the wind blowing toward `wind`. `size`
   * scales the whole ship along its own axes (x along the keel, y up, z across the beam): a ship squeezed in a grip.
   * Surfaces and rigging scale exactly; spars keep their thickness.
   */
  placed(rigid: Chart, wind: readonly [number, number], size: Size = sizes.even(1)): Drawable[] {
    const k = sizeLengths(size), chart = sized(rigid, k);
    const S = this.spec, H = this.hull, L = H.lines, C = S.colours, n = S.name;
    const G = chart.frame(lift<"vec3">([0, 0, 0]));
    const l = Math.hypot(wind[0], wind[1]);
    if (!(l > 0)) throw new Error(`ship "${n}": the wind needs a direction`);
    const W = vec3(wind[0] / l, 0, wind[1] / l);
    // The wind in the ship's frame, laid flat on its deck plane.
    const wl = normalize(vec3(dot(W, G.x), 0, dot(W, G.z)));
    const toWorld = (p: P3): P3 => add(G.o, inFrame(G, mul(p, k)));
    const surf = (s: Surface): Surface => framedPose(s, { frame: G, size });
    const lit = (name: string, s: Surface, paint: Paint, nu: number, nv: number, sides: "one" | "two") =>
      draw.surface(name, surf(s), { paint, grid: { u: spacing.even(nu), v: spacing.even(nv) }, sides, outline: sides === "one" ? "hull" : "border" });
    const out: Drawable[] = [];

    // ---- hull, deck, bulwarks, transom, rails, rudder -----------------------------------------------------------
    out.push(draw.surface(`${n}_hull`, { ...surf(H.skin), skeleton: mapSkeleton(H.skeleton(), toWorld) }, {
      paint: H.paint({ ...C, ports: S.ports }), grid: { u: spacing.ends(120, 0.35), v: spacing.even(56) }, sides: "one", outline: "hull",
    }));
    out.push(draw.surface(`${n}_deck`, surf(H.deck), { paint: deckPaint(C.deck), grid: { u: spacing.even(64), v: spacing.even(6) }, sides: "one", outline: "none" }));
    H.bulwarks.forEach((b, i) => out.push(draw.surface(`${n}_bulwark${i}`, surf(b), { paint: () => mul(rgb(C.hull), 0.8), grid: { u: spacing.even(64), v: spacing.even(1) }, sides: "two", outline: "none" })));
    out.push(draw.surface(`${n}_transom`, surf(H.transom), { paint: transomPaint(C), grid: { u: spacing.even(32), v: spacing.even(3) }, sides: "one", outline: "none" }));
    const railGirth = 0.035 + 0.02 * L.freeboard;
    for (const [side, v] of [["S", 1], ["P", 0]] as const) {
      out.push(place(strand({
        name: `${n}_rail${side}`, spine: (m) => H.skin.point(m, lift<"f32">(v)), stations: 24, girth: railGirth,
        section: { aspect: 0.8 }, tips: "round", paint: C.trim, up: [0, 1, 0], detail: { along: 96, around: 8 },
      }), chart));
    }
    out.push(lit(`${n}_rudder`, this.rudder(), () => mul(rgb(C.hull), 0.75), 10, 12, "one"));

    // ---- masts, yards, sails ------------------------------------------------------------------------------------
    const deckAt = (u: number): number => evalNum(H.sheerAt(lift<"f32">(u))) - L.bulwark * L.freeboard;
    const ropes: Rope[] = [];
    const mastTops: P3[] = [];
    this.plan.forEach((m, i) => {
      const x = evalNum(H.x(lift<"f32">(m.u))), y0 = deckAt(m.u), h = m.height;
      const foot: readonly [number, number, number] = [x, y0 - 0.4, 0];
      const top: readonly [number, number, number] = [x - Math.sin(S.mastRake) * h, y0 + h, 0];
      const at = (f: number): P3 => lift<"vec3">([foot[0] + (top[0] - foot[0]) * f, foot[1] + (top[1] - foot[1]) * f, 0]);
      mastTops.push(at(1));
      const girth = 0.022 * S.mastHeight + 0.03;
      out.push(place(spar(`${n}_mast${i}`, [lift<"vec3">(foot), lift<"vec3">(top)], girth, 0.5, C.spar, ["open", { round: 0.03 }]), chart));
      // Standing rigging: lower shrouds to the rail, topmast shrouds to the crosstrees, ratlines across the lower.
      const half = evalNum(H.half(lift<"f32">(m.u)));
      for (const side of [-1, 1]) {
        const shrouds: [P3, P3][] = [];
        for (let k = 0; k < 4; k++) {
          const chain = lift<"vec3">([x - 0.12 * h * (k / 3) + 0.04 * h, evalNum(H.sheerAt(lift<"f32">(m.u))) - 0.05, side * (half + 0.06)]);
          const head = add(at(0.6), vec3(0, 0, side * girth));
          shrouds.push([head, chain]);
          ropes.push({ a: head, b: chain, sag: 0.004 * h });
        }
        const cross = add(at(0.6), vec3(-0.02 * h, 0, side * 0.16 * L.beam));
        for (let k = 0; k < 2; k++) ropes.push({ a: add(at(0.94), vec3(0, 0, side * girth * 0.5)), b: add(cross, vec3(-0.04 * h * k, 0, 0)), sag: 0.002 * h });
        const rungs = Math.max(3, Math.floor((0.5 * h) / 0.32));
        for (let r = 1; r <= rungs; r++) {
          const t = r / (rungs + 1);
          ropes.push({ a: mix(shrouds[0][1], shrouds[0][0], t), b: mix(shrouds[3][1], shrouds[3][0], t), sag: 0.01 });
        }
      }
      if (m.square) this.squareRig(n, i, m, at, h, wl, chart, k, out, ropes);
      if (m.gaff) this.gaffRig(n, i, m, at, h, wl, chart, k, out, ropes, i === this.plan.length - 1);
    });

    // ---- bowsprit, jibs, stays --------------------------------------------------------------------------------
    const stemX = evalNum(H.section(lift<"f32">(1), lift<"f32">(0)).x);
    const spritAngle = 0.26;
    const spritRoot = lift<"vec3">([stemX - 0.08 * L.length, evalNum(H.sheerAt(lift<"f32">(1))) - 0.15, 0]);
    const spritTip = add(spritRoot, vec3(Math.cos(spritAngle) * (S.bowsprit + 0.08 * L.length), Math.sin(spritAngle) * (S.bowsprit + 0.08 * L.length), 0));
    out.push(place(spar(`${n}_bowsprit`, [spritRoot, spritTip], 0.6 * (0.022 * S.mastHeight + 0.03), 0.55, C.spar, ["open", { round: 0.05 }]), chart));
    const fore = this.plan[0];
    const foreAt = (f: number): P3 => mix(mastTops[0], lift<"vec3">([evalNum(mastTops[0].x) + Math.sin(S.mastRake) * fore.height, deckAt(fore.u) - 0.4, 0]), 1 - f);
    for (let j = 0; j < S.jibs; j++) {
      const tack = mix(spritRoot, spritTip, 1 - 0.28 * j);
      const head = foreAt(0.8 - 0.14 * j);
      ropes.push({ a: head, b: tack, sag: 0.01 });
      out.push(this.jib(`${n}_jib${j}`, tack, head, wl, G, k, C));
    }
    // Stays between masts, backstays to the quarters, the forestay to the stem.
    ropes.push({ a: foreAt(0.62), b: lift<"vec3">([stemX - 0.02, evalNum(H.sheerAt(lift<"f32">(1))), 0]), sag: 0.01 });
    for (let i = 1; i < this.plan.length; i++) ropes.push({ a: mastTops[i], b: mix(mastTops[i - 1], lift<"vec3">([evalNum(H.x(lift<"f32">(this.plan[i - 1].u))), deckAt(this.plan[i - 1].u), 0]), 0.35), sag: 0.02 });
    for (const side of [-1, 1]) {
      const q = 0.1;
      ropes.push({ a: mastTops[this.plan.length - 1], b: lift<"vec3">([evalNum(H.x(lift<"f32">(q))), evalNum(H.sheerAt(lift<"f32">(q))), side * evalNum(H.half(lift<"f32">(q)))]), sag: 0.03 });
    }

    // ---- pennant, rigging -------------------------------------------------------------------------------------
    const main = this.plan.reduce((a, b) => (b.height > a.height ? b : a));
    const mainTop = mastTops[this.plan.indexOf(main)];
    out.push(draw.surface(`${n}_pennant`, surf(pennant(mainTop, wl, 0.45 * S.mastHeight, 0.06 * S.mastHeight)), {
      paint: (u, v) => mix(rgb(C.team), mul(rgb(C.team), 0.7), smoothstep(0.45, 0.55, abs(sub(v, 0.5)).mul(2).add(u.mul(0.3)))),
      grid: { u: spacing.even(32), v: spacing.even(2) }, sides: "two", outline: "border",
    }));
    out.push(ropeStroke(`${n}_rigging`, ropes.map((r) => ({ a: toWorld(r.a), b: toWorld(r.b), sag: r.sag })), { width: 0.012 + 0.0015 * S.mastHeight, colour: C.rope }));
    return out;
  }

  /** Yards and square sails up mast i, braced to the wind. */
  private squareRig(n: string, i: number, m: Mast, at: (f: number) => P3, h: number, wl: P3, chart: Chart, k3: P3, out: Drawable[], ropes: Rope[]): void {
    const S = this.spec, C = S.colours;
    // Braced: the yard turns about the mast so the sail's forward face looks downwind, as far as the braces allow.
    // abs(): with the wind from ahead the yards stay braced the same way rather than flipping (the sails are aback).
    const brace = clamp(atan2(mul(wl.z, -1), max(abs(wl.x), 0.05)), -MAX_BRACE, MAX_BRACE);
    const along = vec3(sin(brace), 0, cos(brace));   // the yard's axis
    const face = vec3(cos(brace), 0, mul(sin(brace), -1)); // the sail's forward normal
    const fill = dot(wl, face);                        // + bellied forward, - aback
    const girth = 0.6 * (0.022 * S.mastHeight + 0.03);
    const yards = Array.from({ length: S.tiers }, (_, k) => {
      const len = S.yard * this.hull.lines.beam * Math.pow(0.76, k) * (m.height / S.mastHeight);
      const centre = add(at(YARD_AT[k]), mul(face, girth * 1.6));
      return { len, centre };
    });
    yards.forEach((y, k) => {
      const a = add(y.centre, mul(along, -y.len / 2)), b = add(y.centre, mul(along, y.len / 2));
      out.push(place(spar(`${n}_yard${i}_${k}`, [a, b], girth * (1 - 0.12 * k), 0.4, C.spar, [{ round: 0.04 }, { round: 0.04 }], true), chart));
      // Lifts: yardarms to the mast above.
      ropes.push({ a: a, b: at(Math.min(YARD_AT[k] + 0.12, 1)), sag: 0.01 }, { a: b, b: at(Math.min(YARD_AT[k] + 0.12, 1)), sag: 0.01 });
    });
    yards.forEach((y, k) => {
      // A sail hangs from yard k to the yard below (the course to a foot above the deck).
      const headW = y.len * 0.94, footW = k > 0 ? yards[k - 1].len * 0.94 : y.len * 0.9;
      const headC = sub(y.centre, vec3(0, girth * 1.2, 0));
      const footC = k > 0 ? add(yards[k - 1].centre, vec3(0, girth * 1.2, 0)) : add(at(0.08), mul(face, girth * 1.6));
      const width = 0.5 * (headW + footW);
      const flat = (u: F, v: F): P3 => mix(add(headC, mul(along, mul(sub(u, 0.5), headW))), add(footC, mul(along, mul(sub(u, 0.5), footW))), v);
      const point = (u: F, v: F): P3 => {
        const belly = mul(powz(sin(mul(u, Math.PI)), 0.7), add(mul(sin(mul(v, Math.PI)), 0.75), mul(v, 0.45)));
        const depth = mul(fill, S.billow * width);
        const flutter = mul(mul(fluttering(u, v, k * 1.7 + i * 2.3), mul(S.flutter, add(0.35, mul(sub(1, abs(fill)), 0.9)))), mul(powz(sin(mul(u, Math.PI)), 0.5), add(0.3, mul(v, 0.7))));
        // As it bellies the cloth draws up a little, so the foot rises toward the middle.
        const rise = mul(mul(abs(depth), mul(belly, v)), 0.25);
        return add(add(flat(u, v), mul(face, add(mul(belly, depth), flutter))), vec3(0, rise, 0));
      };
      out.push(draw.surface(`${n}_sail${i}_${k}`, framedChart(point, chart, k3), {
        paint: clothPaint(C, "square", k), grid: { u: spacing.even(22), v: spacing.even(14) }, sides: "two", outline: "border",
      }));
      if (k === 0) {
        // Sheets from the course's clews to the rail aft of the mast.
        for (const s of [0, 1]) ropes.push({ a: point(lift<"f32">(s), lift<"f32">(1)), b: lift<"vec3">([evalNum(at(0).x) - 0.12 * this.hull.lines.length, evalNum(this.hull.sheerAt(lift<"f32">(m.u - 0.12))), (s * 2 - 1) * 0.95 * evalNum(this.hull.half(lift<"f32">(m.u - 0.12)))]), sag: 0.02 });
      }
    });
  }

  /** A gaff sail on mast i: boom and gaff swung to leeward, the sail between them bellied downwind. */
  private gaffRig(n: string, i: number, m: Mast, at: (f: number) => P3, h: number, wl: P3, chart: Chart, k3: P3, out: Drawable[], ropes: Rope[], aftermost: boolean): void {
    const S = this.spec, C = S.colours, Lh = this.hull.lines;
    const fore = !m.square;
    // The boom swings to leeward: toward where the wind blows across the ship, eased fully out before the wind.
    const swing = mul(clamp(mul(wl.z, 2.2), -1, 1), MAX_SWING * (fore ? 1 : 0.8));
    const aft = vec3(mul(cos(swing), -1), 0, sin(swing));
    const boomLen = fore ? (aftermost ? 0.5 : 0.36) * Lh.length * (m.height / S.mastHeight) : 0.3 * Lh.length;
    const throatF = fore ? 0.82 : 0.6, boomF = fore ? 0.1 : 0.16;
    const peak = 0.55;
    const gaffDir = add(mul(aft, Math.cos(peak)), vec3(0, Math.sin(peak), 0));
    const gaffLen = boomLen * (fore ? 0.62 : 0.75);
    const boom0 = at(boomF), throat = at(throatF);
    const girth = 0.45 * (0.022 * S.mastHeight + 0.03);
    out.push(place(spar(`${n}_boom${i}`, [boom0, add(boom0, mul(aft, boomLen))], girth, 0.25, C.spar, ["open", { round: 0.05 }], true), chart));
    out.push(place(spar(`${n}_gaff${i}`, [throat, add(throat, mul(gaffDir, gaffLen))], girth * 0.85, 0.25, C.spar, ["open", { round: 0.05 }], true), chart));
    const side = vec3(aft.z, 0, mul(aft.x, -1));
    const fill = dot(wl, side);
    const point = (u: F, v: F): P3 => {
      const flat = mix(add(boom0, mul(aft, mul(u, boomLen * 0.97))), add(throat, mul(gaffDir, mul(u, gaffLen * 0.97))), v);
      const belly = mul(powz(sin(mul(u, Math.PI)), 0.8), powz(sin(mul(add(mul(v, 0.8), 0.1), Math.PI)), 0.7));
      const flutter = mul(mul(fluttering(u, v, i * 3.1), mul(S.flutter, add(0.35, mul(sub(1, abs(fill)), 0.9)))), mul(u, powz(sin(mul(v, Math.PI)), 0.5)));
      return add(flat, mul(side, add(mul(belly, mul(fill, S.billow * boomLen)), flutter)));
    };
    out.push(draw.surface(`${n}_gaffsail${i}`, framedChart(point, chart, k3), {
      paint: clothPaint(C, "gaff", i), grid: { u: spacing.even(22), v: spacing.even(16) }, sides: "two", outline: "border",
    }));
    ropes.push({ a: at(1), b: add(boom0, mul(aft, boomLen)), sag: 0.03 }, { a: at(0.97), b: add(throat, mul(gaffDir, gaffLen)), sag: 0.02 });
  }

  /** A jib from the tack on the bowsprit to its head on the stay, its clew sheeted aft to leeward. */
  private jib(name: string, tack: P3, head: P3, wl: P3, G: Frame, k3: P3, C: ShipColours): Drawable {
    const S = this.spec;
    const luff = sub(head, tack);
    const swing = clamp(mul(wl.z, 2), -1, 1);
    const clew = add(add(mix(tack, head, 0.08), vec3(mul(abs(luff.x), -0.46), 0, 0)), vec3(0, 0, mul(mul(swing, abs(luff.y)), 0.16)));
    const n0 = normalize(cross(luff, sub(clew, tack)));
    const fill = dot(wl, n0);
    const point = (u: F, v: F): P3 => {
      const flat = mix(mix(tack, head, u), clew, v);
      const belly = mul(powz(sin(mul(u, Math.PI)), 0.7), mul(mul(v, sub(1, v)), 4));
      const width = mul(abs(luff.y), 0.5);
      const flutter = mul(fluttering(u, v, 0.7), mul(S.flutter, mul(v, sub(1, v))));
      return add(flat, mul(n0, add(mul(mul(belly, fill), mul(width, S.billow * 1.6)), flutter)));
    };
    return draw.surface(name, framedFrame(point, G, k3), { paint: clothPaint(C, "jib", 0), grid: { u: spacing.even(20), v: spacing.even(10) }, sides: "two", outline: "border" });
  }

  /** The rudder: a thickened sheet hung on the sternpost, from the keel up to near the deck. */
  private rudder(): Surface {
    const H = this.hull, L = H.lines;
    const keel = H.section(lift<"f32">(0), lift<"f32">(0.5));
    const topY = 0.65 * L.freeboard;
    const post = (s: In<"f32">): P3 => {
      const y = mix(keel.y, lift<"f32">(topY), lift<"f32">(s));
      // The post follows the stern's centreline back as it rises (the counter rakes it aft).
      return vec3(add(keel.x, mul(sub(y, keel.y), -0.18)), y, 0);
    };
    const chord = (s: In<"f32">): F => mix(lift<"f32">(0.16 * L.depth + 0.1), lift<"f32">(0.05 * L.depth + 0.04), lift<"f32">(s));
    return thicken(sheet((s) => post(s), (s) => sub(post(s), vec3(chord(s), 0, 0))), 0.035 * L.beam / 3 + 0.02);
  }
}

/** A straight spar (a sweep): girth tapering by `taper` toward the far end, or toward both ends when `both`. */
function spar(name: string, ends: readonly [P3, P3], girth: number, taper: number, colour: Rgb, tips: Parameters<typeof strand>[0]["tips"], both = false): Strand {
  return strand({
    name, spine: (m) => through(m, [ends[0], ends[1]]), stations: 4,
    girth: (m) => mul(girth, both ? sub(1, mul(abs(sub(mul(m, 2), 1)), taper)) : sub(1, mul(m, taper))),
    tips, paint: colour, up: [0, 1, 0.3], detail: { along: 10, around: 10 },
  });
}

/** A ship-local surface written as a point function, scaled by `k` and carried by the rigid chart's frame at the origin. */
function framedChart(point: (u: F, v: F) => P3, chart: Chart, k: P3): Surface {
  return framedFrame(point, chart.frame(lift<"vec3">([0, 0, 0])), k);
}
function framedFrame(point: (u: F, v: F) => P3, G: Frame, k: P3): Surface {
  return framedPose(surface(point, { u: ["free", "free"], v: "free" }), { frame: G, size: sizes.axes(k) });
}

/** A wave travelling across the cloth, -1..1: two crossing trains so it never looks like a single ripple. */
function fluttering(u: F, v: F, phase: number): F {
  const a = sin(add(mul(sub(add(mul(u, 1.7), mul(v, 0.9)), mul(time, 1.25)), TAU), phase));
  const b = sin(add(mul(sub(add(mul(u, 3.1), mul(v, -1.3)), mul(time, 2.1)), TAU), phase * 1.9));
  return add(mul(a, 0.7), mul(b, 0.3));
}

/** Sailcloth: panels (vertical seams), tabling at the edges, and the team's stripe. */
function clothPaint(C: ShipColours, kind: "square" | "gaff" | "jib", k: number): Paint {
  const cloth = rgb(C.cloth), team = rgb(C.team);
  return (u, v) => {
    const panels = abs(sub(fract(mul(u, 9)), 0.5));
    let c = mix(cloth, mul(cloth, 0.86), smoothstep(0.43, 0.49, panels));
    const tabling = min(min(u, sub(1, u)), min(v, sub(1, v)));
    c = mix(mul(cloth, 0.82), c, smoothstep(0.015, 0.035, tabling));
    const band = stripeOf(kind, u, v, k);
    return mix(c, team, band);
  };
}
function stripeOf(kind: "square" | "gaff" | "jib", u: F, v: F, k: number): F {
  switch (kind) {
    // A broad band across each square sail; the course carries two.
    case "square": return k === 0
      ? max(sub(1, smoothstep(0.08, 0.1, abs(sub(v, 0.36)))), sub(1, smoothstep(0.08, 0.1, abs(sub(v, 0.68)))))
      : sub(1, smoothstep(0.12, 0.14, abs(sub(v, 0.5))));
    case "gaff": return sub(1, smoothstep(0.1, 0.12, abs(sub(u, 0.55))));
    case "jib": return mul(smoothstep(0.82, 0.84, v), 1);
  }
}

function deckPaint(c: Rgb): Paint {
  const wood = rgb(c);
  return (_u, v) => mix(wood, mul(wood, 0.8), smoothstep(0.4, 0.47, abs(sub(fract(mul(v, 14)), 0.5))));
}
function transomPaint(C: ShipColours): Paint {
  // (u, v): u round the stern section (port, keel, starboard), v from the section up to the chord across its top, so
  // lines of constant v near 1 run straight across just under the taffrail: the windows sit there.
  return (u, v) => {
    const across = abs(sub(u, 0.5));
    const lights = mul(sub(1, smoothstep(0.3, 0.34, abs(sub(fract(mul(u, 9)), 0.5)).mul(2))), mul(smoothstep(0.8, 0.82, v), sub(1, smoothstep(0.92, 0.94, v))));
    const win = mul(lights, sub(1, smoothstep(0.24, 0.26, across)));
    const base = mix(mul(rgb(C.hull), 0.9), rgb(C.trim), max(smoothstep(0.955, 0.965, v), mul(smoothstep(0.76, 0.77, v), sub(1, smoothstep(0.785, 0.795, v)))));
    return mix(base, vec3(0.98, 0.84, 0.42), win);
  };
}

/** A pennant at the truck: a strip streaming downwind, tapering, with a wave running out along it. */
function pennant(top: P3, wl: P3, length: number, width: number): Surface {
  const root = add(top, vec3(0, 0.08, 0));
  const side = vec3(wl.z, 0, mul(wl.x, -1));
  const point = (u: F, v: F): P3 => {
    const wave = sin(mul(sub(mul(u, 2.2), mul(time, 1.9)), TAU));
    const wave2 = sin(mul(sub(mul(u, 4.1), mul(time, 3.3)), TAU));
    const w = mul(width, sub(1, mul(u, 0.85)));
    const along = add(add(root, mul(wl, mul(u, length))), mul(side, mul(mul(add(wave, mul(wave2, 0.3)), u), length * 0.08)));
    return add(add(along, mul(UP, mul(sub(v, 0.5), w))), vec3(0, mul(mul(u, u), -length * 0.12), 0));
  };
  return surface(point, { u: ["free", "free"], v: "free" });
}

/** A skeleton given in local coordinates, carried to the world. */
function mapSkeleton(s: Skeleton, toWorld: (p: P3) => P3): Skeleton {
  return { joints: s.joints, joint: (k) => { const j = s.joint(k); return { p: toWorld(j.p), r: j.r }; } };
}

/** A constant expression's value (the lines are numbers; positions of masts and rails are decided when the ship is). */
function evalNum(e: Expr<"f32">): number {
  return evaluate(e) as number;
}

/** A ship from its spec (see the header for what it makes and what it cannot). */
export function ship(spec: ShipSpec): Ship {
  return new Ship(spec);
}


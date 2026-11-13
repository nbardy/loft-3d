// The spiral shell's closed form (docs/art_direction/DIRECTION.md, Round 5): one tube coiled round an axis by Raup's
// law (Raup 1966: every length grows by W in one turn, the tube's centre stands off the axis in proportion, and steps
// along the axis in proportion), with a mouth the crab's body sits in. Plain numbers first (`planOf`), then the map
// (`shellMap`): the same expressions draw the shell (back/spiral.ts) and, compiled for the CPU, place what grows on it
// and predict its picture (tools/spiral_theory.ts).
//
// Coordinates are the crab's (x forward, y up, z to its right; the body's origin rides `ride` above the still water),
// so everything here is carried by `rig.shell`. Nothing is a world coordinate.
//
// The coil:
//
//   point(back, phi) = tip + W^-back * ( (c + r cos phi) * out(back) + (-t + a sin phi) * axis )
//
// - `back`: turns back from the mouth (0 at the lip, `whorls` at the tip); out(back) is the unit direction from the
//   axis to the tube's centre, turning once per turn in the coil's plane;
// - `phi`: round the tube's section from its outer side (0) toward the spiral's face (a quarter turn), the axis (half)
//   and the far flank (three quarters); r and a are the section's half-extents across the coil and along the axis;
// - c = r: the tube touches the axis (Raup's D = 0, no navel); t = a + spire * c: every turn's crown lies on a cone
//   through the tip, `spire` steep (0: a flat spiral face).
//
// What follows from the law, and is used below:
// - Seen along the axis, the line where a turn meets the next one in (the suture) and any line of constant phi are
//   equiangular spirals of ratio W a turn. A band printed between two values of phi is therefore a spiral band whose
//   rings stand W apart; bands at 1 + cos(phi) = x and W x lie on one spiral (the outer turn's band runs on, one turn
//   in, as the next band). So the paint is a function of phi alone: `bandAt`.
// - In the mouth's plane the turn before takes the inner 1/W of the mouth; the body has the outer crescent, 2 r (1 - 1/W) deep.

import { add, compileJs, cos, exp, floor, log, max, min, mul, saturate, sin, smoothstep, sqrt, sub, variable, vec3, type F, type P3 } from "../../../../src/index.ts";
import { TAU, type V3 } from "../ink.ts";
import type { Numbers } from "../numbers.ts";

const addV = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mulV = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dotV = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unitV = (a: V3): V3 => mulV(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** The surface's grid: cells along the outside from tip to lip, round the lip's roll, down the throat; and round the section. */
export const GRID = { outer: 60, roll: 6, throat: 8, round: 32 } as const;
const NU = GRID.outer + GRID.roll + GRID.throat;
/** The stations in u, each on a grid line: where the outside ends at the lip, and where the roll ends in the throat. */
export const U = { lip: GRID.outer / NU, throat: (GRID.outer + GRID.roll) / NU } as const;

/**
 * Where the drawn grid's lines fall in u (s: the grid line's share, 0 to 1): along the outside, spaced by the tube's
 * size, so a turn W times smaller gets about W times fewer cells (each about the same on screen); the lip's roll and
 * the throat as they are. A mix of that (two parts) and even spacing in turns (one part), so the curl keeps enough
 * cells to read as round. Each station (U.lip, U.throat) stays on a grid line.
 */
export function gridU(n: Numbers): (s: F) => F {
  const W = n.spiral.growth, whorls = n.spiral.whorls, q0 = W ** -whorls;
  return (s: F): F => {
    const f = mul(min(s, U.lip), 1 / U.lip);
    const bySize = mul(log(add(q0, mul(f, 1 - q0))), -1 / Math.log(W));
    const back = add(mul(bySize, 2 / 3), mul(sub(1, f), whorls / 3));
    return add(mul(sub(1, mul(back, 1 / whorls)), U.lip), max(sub(s, U.lip), 0));
  };
}

/**
 * The shell in plain numbers, from the build's: the axis (unit, out of the spiral's face), the coil plane's two axes
 * (`fore` the forward one, `rise` = axis x fore), the tip, the section, where the suture runs and where the bands are.
 */
export function planOf(n: Numbers) {
  const S = n.spiral, W = S.growth;
  if (!(W > 1)) throw new Error(`spiral: growth must be above 1 (every turn larger than the last), got ${W}`);
  const r = S.mouth.radial, a = S.mouth.axial, c = r, t = a + S.spire * c;
  const axis: V3 = [-Math.sin(S.rake) * Math.cos(S.tilt), Math.sin(S.tilt), Math.cos(S.rake) * Math.cos(S.tilt)];
  const fore = unitV(addV([1, 0, 0], mulV(axis, -axis[0])));
  // The hand: which way the tube turns about the axis going back from the mouth. `rise` is the coil plane's second
  // axis, so mirroring it mirrors the coil while the spire still points along `axis`.
  const turn = handOf(S.hand);
  const rise = mulV(crossV(axis, fore), turn);
  const outAt = (back: number): V3 => { const psi = S.mouthAt + TAU * back; return addV(mulV(fore, Math.cos(psi)), mulV(rise, Math.sin(psi))); };
  /** The body's point in the mouth (crab coordinates), and from it the tip: the outer lip passes `seat.lip` beyond the body's point. */
  const seat: V3 = [n.carapace.from + S.seat.in, S.seat.up, S.seat.side];
  const tip = addV(addV(seat, mulV(outAt(0), -(2 * r - S.seat.lip))), mulV(axis, t));

  // The suture: where the turn before (the section shrunk by W about the tip) comes out of this one, on the face's
  // side. In units of r, the section is the ellipse centred (1, -t / r) with half-axes (1, a / r); the root is found
  // on the smaller ellipse by bisection between its outer side (phi = 0: inside the larger turn) and its crown (a
  // quarter turn: outside it, on the face).
  const q = a / r, tq = t / r;
  const inside = (phi: number): number => {
    const x = (1 + Math.cos(phi)) / W, h = (-tq + q * Math.sin(phi)) / W;
    return (x - 1) ** 2 + ((h + tq) / q) ** 2 - 1;
  };
  let lo = 0, hi = Math.PI / 2;
  if (!(inside(lo) < 0 && inside(hi) > 0)) throw new Error(`spiral: the turns do not overlap on the face's side (growth ${W}, spire ${S.spire}): no suture to print along`);
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (inside(mid) < 0) lo = mid; else hi = mid; }
  /** The suture's distance from the axis in units of the turn's own r that it lies on (the larger one): 1 + cos(phi) there. */
  const sutureX = (1 + Math.cos(lo)) / W;
  return {
    W, whorls: S.whorls, r, a, c, t, axis, fore, rise, turn, tip, seat, outAt, sutureX,
    /** Where each turn but the last shows, round its section: from where the next turn out covers it to its own suture. */
    shows: [lo, Math.acos(sutureX - 1)] as const,
    lnW: Math.log(W),
  };
}
export type Plan = ReturnType<typeof planOf>;

/**
 * The coil's hand, read once: +1 turns the tube counterclockwise about the axis going back from the mouth, seen from the
 * face (the picked picture's hand, a right-handed shell); -1 its mirror. Worn with the spire to the crab's right, a
 * right-handed shell's mouth faces forward with its outer lip on top (a real hermit's: its abdomen curls right); with the
 * spire to the left, only the left-handed one does.
 */
function handOf(hand: "dextral" | "sinistral"): 1 | -1 {
  switch (hand) {
    case "dextral": return 1;
    case "sinistral": return -1;
  }
}

/** The printed bands' numbers: `count` cream bands round the section, each `cream` of its period, the first one's
 * middle `at` periods round from the tube's outer side (phi = 0). */
export type Band = { readonly count: number; readonly cream: number; readonly at: number };

/**
 * Where a point of the section lies in the printed bands. The bands are lines of constant phi, so each runs the whole
 * length of the tube from the curl to the lip: on the spiral's face they are spirals, and on the last whorl they wind
 * round the dome. They are spaced evenly in arc length round the section, not in phi: the section is an ellipse
 * (a along the axis, r across), and s = phi + e sin(2 phi) / 2 with e = (a - r) / (a + r) is its arc length to first
 * order in e (ds/dphi = 1 + e cos 2phi: a : r between the outer side and the crown, as the ellipse's own speed). So a
 * band is as wide on the dome as on the face, and every whorl carries the same `count` bands, shrunk by W a turn.
 *
 * (The first build spaced bands in log(1 + cos phi), so that seen along the axis the rings stood W apart: true on the
 * face, but it left less than one ring over the outer 107 degrees of the last whorl, and the dome printed plain brick.)
 *
 * `ring` numbers the band (0 to count - 1 round the section); `across` is how far through its cream it is (0 one
 * edge, 1 the other; above 1 it is in the brick after it).
 */
export function bandAt(p: Plan, band: Band, phi: F): { readonly ring: F; readonly across: F } {
  const e = (p.a - p.r) / (p.a + p.r);
  const s = add(phi, mul(sin(mul(phi, 2)), e / 2));
  const g = add(mul(s, band.count / TAU), band.cream / 2 - band.at);
  const ring = floor(g);
  return { ring, across: mul(sub(g, ring), 1 / band.cream) };
}

/**
 * The face's coil: one cream band per turn on the strip of the section that shows on the spiral's face, from where the
 * next turn out covers it (phi = shows[0]) to its own suture (shows[1]). `across` is 0 at the first, 1 at the second;
 * `inFace` is 1 on the strip (and a hair beyond it, so the strip's edges are the coil's, not a rim band's), else 0. The
 * cream takes the suture's side: on turn k it runs up to the suture, where turn k + 1 comes out showing its brick side,
 * so cream and brick alternate turn by turn across the face and the cream reads as one coil to the curl (the picked
 * picture's read), not as rings.
 */
export function coilAt(p: Plan, phi: F): { readonly across: F; readonly inFace: F } {
  const [lo, hi] = p.shows;
  const up = mul(sub(phi, mul(floor(mul(phi, 1 / TAU)), TAU)), 1);
  const across = mul(sub(up, lo), 1 / (hi - lo));
  return { across, inFace: mul(smoothstep(-0.06, -0.05, across), sub(1, smoothstep(1.05, 1.06, across))) };
}

/** The cream bands round the whole section, as [from, to] in phi (radians from the tube's outer side toward the face,
 * 0 to 2 pi; a band across phi = 0 is split in two): where the key lines and the barnacle runs go. In order of phi. */
export function bandEdges(p: Plan, band: Band): (readonly [number, number])[] {
  const e = (p.a - p.r) / (p.a + p.r), sOf = (phi: number) => phi + (e / 2) * Math.sin(2 * phi);
  /** phi at arc s (s is increasing in phi for e < 1): bisection. */
  const phiAt = (s: number): number => { let lo = s - 1, hi = s + 1; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (sOf(m) < s) lo = m; else hi = m; } return (lo + hi) / 2; };
  const out: (readonly [number, number])[] = [];
  for (let k = 0; k < band.count; k++) {
    const from = phiAt(((k + band.at - band.cream / 2) * TAU) / band.count), to = phiAt(((k + band.at + band.cream / 2) * TAU) / band.count);
    const wrap = (x: number) => ((x % TAU) + TAU) % TAU;
    out.push([wrap(from), wrap(to)] as const);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** The lip's roll and the throat, as the build's numbers give them: the section's size at the mouth outside and inside. */
const lipOf = (n: Numbers) => { const L = n.spiral.lip; return { out: 1 + L.flare, in: 1 + L.flare - L.thick, advance: L.thick / (4 * Math.PI), flareOver: 0.07 }; };

/**
 * The shell's map in crab coordinates. `outside(back, phi)` is the bare coil with its proud bands (what things stand
 * on); `point(u, v)` is the drawn surface: the outside from tip (u = 0) to lip (U.lip), the lip's roll (to U.throat),
 * then the throat running back inside to a dark end (u = 1). v runs once round the section.
 */
export function shellMap(n: Numbers) {
  const p = planOf(n), S = n.spiral, L = lipOf(n);
  const axis = vec3(...p.axis), fore = vec3(...p.fore), rise = vec3(...p.rise), tip = vec3(...p.tip);
  /** The coil's point for a section scaled by `k`: turns back from the mouth, round the section. */
  const coil = (back: F, phi: F, k: F): P3 => {
    const s = exp(mul(back, -p.lnW)), psi = add(S.mouthAt, mul(back, TAU));
    const out = add(mul(fore, cos(psi)), mul(rise, sin(psi)));
    return add(tip, mul(add(mul(out, add(p.c, mul(mul(k, p.r), cos(phi)))), mul(axis, add(-p.t, mul(mul(k, p.a), sin(phi))))), s));
  };
  /** How proud of the tube a cream band stands at phi: a rounded hump across the band. */
  const proud = (phi: F): F => {
    const { across } = bandAt(p, S.band, phi);
    return mul(mul(smoothstep(0, 0.3, across), sub(1, smoothstep(0.7, 1, across))), S.band.proud);
  };
  /** The flare toward the mouth: the section grows by `lip.flare` over the last `flareOver` of a turn. */
  const flared = (back: F): F => add(1, mul(sub(1, smoothstep(0, L.flareOver, back)), S.lip.flare));
  const outside = (back: F, phi: F): P3 => coil(back, phi, mul(flared(back), add(1, proud(phi))));
  // v runs against phi for a right-handed coil: it turns counterclockwise going back (seen from the face), so with u from
  // tip to mouth d/du x d/dv faces out of the tube only if v turns the other way (checked in tools/spiral_theory.ts).
  // The mirror turns v with phi.
  const phiOf = (v: F): F => mul(v, -TAU * p.turn);
  const point = (u: F, v: F): P3 => {
    const phi = phiOf(v);
    // Along the outside: `whorls` back at u = 0, the lip at U.lip; the tip closes over its last tenth of a turn (by
    // turns, not cells: the drawn grid is spaced by the tube's size, `gridU`).
    const along = saturate(mul(u, 1 / U.lip));
    const closeTip = sqrt(saturate(mul(mul(along, p.whorls), 10)));
    // Round the lip (w from 0 to 1): the section shrinks from its flared size to the throat's while the roll leans
    // a little past the mouth's plane, a half-round bead.
    const w = saturate(mul(sub(u, U.lip), 1 / (U.throat - U.lip)));
    const rolled = sub(L.out, mul(sub(1, cos(mul(w, Math.PI))), (L.out - L.in) / 2));
    // Down the throat (d from 0 to 1): back inside by `lip.throat` of a turn, closing to a point at its end.
    const d = saturate(mul(sub(u, U.throat), 1 / (1 - U.throat)));
    const back = add(add(mul(sub(1, along), p.whorls), mul(sin(mul(w, Math.PI)), -L.advance)), mul(d, S.lip.throat));
    const onOutside = sub(1, smoothstep(0, 0.5, w));
    const k = mul(mul(mul(mix1(rolled, flared(back), onOutside), add(1, mul(proud(phi), onOutside))), closeTip), sqrt(max(sub(1, mul(d, d)), 0)));
    return coil(back, phi, k);
  };
  return { plan: p, outside, point, phiOf };
}
const mix1 = (a: F, b: F, t: F): F => add(a, mul(sub(b, a), t));

/** The shell's closed forms on the CPU: the outside's point and unit normal (out of the tube) at (turns back, phi). */
export function shellTwin(n: Numbers) {
  const m = shellMap(n), B = variable("spiral_back", "f32"), PH = variable("spiral_phi", "f32");
  const f = compileJs([m.outside(B, PH)]);
  const at = (back: number, phi: number): V3 => f({ vars: { spiral_back: back, spiral_phi: phi }, inputs: {}, params: {} })[0] as unknown as V3;
  const p = m.plan;
  const normal = (back: number, phi: number): V3 => {
    const e = 1e-3, db = addV(at(back - e, phi), mulV(at(back + e, phi), -1)), dp = addV(at(back, phi + e), mulV(at(back, phi - e), -1));
    // `back` falls toward the mouth and phi turns from the outer side to the face; with the coil turning counterclockwise
    // going back (seen from the face), (d/dphi) x (toward the mouth) points out.
    return mulV(unitV(crossV(dp, db)), p.turn);
  };
  const U2 = variable("spiral_u", "f32"), V2 = variable("spiral_v", "f32");
  const g = compileJs([m.point(U2, V2)]);
  const drawn = (u: number, v: number): V3 => g({ vars: { spiral_u: u, spiral_v: v }, inputs: {}, params: {} })[0] as unknown as V3;
  /**
   * Where a crab-coordinate point is against the bare coil (bands and flare aside), in the coil's own cylinder
   * coordinates: inside the section of every turn that passes its bearing, or of none. Ahead of the mouth's plane there
   * is no turn `back` < 0, so a point in front of the open mouth is outside. Inside only the last whorl and within
   * `MOUTH` turns of the lip, it is in the mouth (where a hermit's body and the roots of what leaves it may be); any
   * other inside point is in the shell's wall (an earlier whorl, or deep in the last one).
   */
  const where = (q: V3): Where => {
    const d = addV(q, mulV(p.tip, -1)), h = dotV(d, p.axis), x = dotV(d, p.fore), y = dotV(d, p.rise);
    const rho = Math.hypot(x, y), turn = (Math.atan2(y, x) - n.spiral.mouthAt) / TAU, first = turn - Math.floor(turn);
    const turns: number[] = [];
    for (let back = first; back <= p.whorls; back += 1) {
      const s = p.W ** -back;
      if (((rho / s - p.c) / p.r) ** 2 + ((h / s + p.t) / p.a) ** 2 < 1) turns.push(back);
    }
    if (turns.length === 0) return { kind: "outside" };
    return turns.length === 1 && turns[0]! < MOUTH ? { kind: "mouth", back: turns[0]! } : { kind: "wall", back: turns[turns.length - 1]! };
  };
  const inside = (q: V3): boolean => where(q).kind !== "outside";
  return { plan: m.plan, at, normal, drawn, inside, where };
}

/** Where a point is against the shell (`shellTwin`'s `where`): outside it, in its mouth, or in its wall; `back` is the
 * turn (from the lip) whose section holds it. */
export type Where = { readonly kind: "outside" } | { readonly kind: "mouth"; readonly back: number } | { readonly kind: "wall"; readonly back: number };
/** How far back into the last whorl, in turns, the mouth reaches: what a body in the shell may fill. */
const MOUTH = 0.15;

/** The plain vector arithmetic the plan is written in, for what is placed from it. */
export const vmath = { add: addV, mul: mulV, dot: dotV, cross: crossV, unit: unitV };

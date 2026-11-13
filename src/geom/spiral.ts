// Shapes on an equiangular (logarithmic) spiral, every length scaling together so the form is self-similar (Raup 1966).
// `coil` carries a section round an axis by Raup's parameters (W the growth per whorl, D the inner-to-outer distance
// ratio, T the translation along the axis): shells, ammonites, turbans. `spiralTube` is the same law in one plane, a
// tube whose radius grows with the spiral (length, curl, taper): horns, hooks, tusks, tendrils. Both are closed form,
// and each has its mechanism exported one step down (`coilAt`, `spiralLine`).

import { abs, add, cos, exp, fract, lift, log, lt, mul, pow, select, sin, sub, div, sqrt, max, TAU, vec3, type In } from "../expr.ts";
import { surface } from "../map/surface.ts";
import type { F, P3, Surface, Topology } from "../map/types.ts";
import { strand, type PaintSpec, type Strand } from "./strand.ts";

/** Raup's coiling law: how a coil grows, turns and drops, apart from its section. */
export type CoilLaw = {
  /** Whorls from the apex (u = 0) to the aperture (u = 1). */
  readonly turns: number;
  /** Raup's W: how much every length grows in one whorl (above 1). */
  readonly growth: number;
  /** The section's half-width across the coil at u = 1 (world units): with `umbilicus` it sets how far the section's centre stands off the axis. */
  readonly aperture: number;
  /** Raup's D: the section's inner distance from the axis over its outer distance, 0 (touching the axis) to below 1. */
  readonly umbilicus: number;
  /** Raup's T: drop of the section along the axis per unit of its distance from the axis. 0 coils flat (a nautilus). */
  readonly spire: number;
  /** Coiling seen from the apex: "right" (dextral) or "left". Default right. */
  readonly hand?: "right" | "left";
};

/**
 * A coil's section at whorl position u and angle phi round it, counterclockwise from the outer side (phi = 0, away
 * from the axis) toward the spire (a quarter turn): an ellipse `aspect` tall with growth `ridges` folded in, or any
 * closed curve of your own, (u, phi) => [across, along] in world units at the aperture's scale (across away from the
 * axis, along up the axis, both from the section's centre).
 */
export type CoilSection =
  | { readonly aspect?: number; readonly ridges?: { readonly perTurn: number; readonly height: number } }
  | ((u: F, phi: F) => readonly [F, F]);

export type CoilSpec = CoilLaw & {
  /** Default an ellipse of aspect 1 (a round section) without ridges. */
  readonly section?: CoilSection;
};

/**
 * A coil: a section carried round an axis while every length grows by the same factor each whorl (Raup 1966), so the
 * form is self-similar. Named for its shape: a snail's shell, a nautilus, a ram's horn seen whole, an ammonite, a
 * turban, a spiral staircase of a tower, a rolled leaf, a curled pastry, an ear.
 *
 * The shape and its law. Apex at the origin, spire along +y, aperture toward -y; (u, v) with u from apex (0) to
 * aperture (1) and v once round the section. With s = W^(turns (u - 1)) and theta = 2 pi turns u,
 *   point = s R_y(theta) [ (c + across) x + (-T c + along) y ],   c = aperture (1 + D) / (1 - D),
 * so the section's centre, its size and its drop along the axis all grow by W each whorl: the point at u + 1 / turns is
 * W times the point at u. Turn count, growth, standing off and drop are tied to one another by that one factor.
 *
 * Parameters: the law's five numbers (`turns`, `growth`, `aperture`, `umbilicus`, `spire`) and `hand` are fixed at
 * build. The section is the open slot: an ellipse (`aspect`, `ridges`), or a function of (u, phi) that may read time,
 * inputs and params, so the section can change along the coil and move.
 *
 * What it cannot do, because of the law:
 * - growth that changes along the coil (a shell that stops growing, a coil that tightens late): W is one number.
 * - a pitch that does not grow with the coil: the drop is T times the distance from the axis, so W = 1 (a spring, a
 *   helix of constant pitch) is excluded, and a flat spiral is T = 0, never a gently rising one with constant step.
 * - turns spaced evenly (a rope coil, a watch spring): in a logarithmic spiral the turns crowd toward the apex.
 * - an axis that bends (a shell that uncoils, Spirula's open hook, a corkscrew whose axis wanders).
 * - a mouth: the tube ends at u = 1 with an open rim; no lip rolled outward, no throat.
 *
 * Going past it is one step down: `coilAt` below places any point (across, along) of a section at any whorl position u,
 * so `surface((u, v) => coilAt(law)(u, ...mySection(u, v)), COIL_TOPOLOGY)` keeps the coiling and changes everything
 * else; u is an expression, so it may run past 1 (a flare), stop, or run back inside (a throat: the section shrinking as
 * u falls again), and points at chosen (u, phi) place things on the coil. `coilPlan` gives the same law in plain numbers
 * for checks: where a whorl is covered by the next one out (the suture, to paint the strip that shows) and which whorls
 * hold a point (to keep things out of the wall). Relatives, each by changing one tie in the law:
 * - growth as a function of u: s = exp(turns * integral of ln W), so a coil that slows its growth and closes its mouth.
 *   Write s yourself in a `surface`; the rest of `coilAt` is three lines.
 * - drop decoupled from growth: along = -T c s + p u (an added pitch p): a helix when W = 1, a rising flat spiral at T = 0.
 * - Archimedes' spiral: distance from the axis c + k theta, size fixed: evenly spaced turns.
 * - an axis that is itself a curve: a `strand` whose spine is your coil's centre line, `spiralLine` for one in a plane.
 * Self-similarity also makes paint easy: `whorl` and `ridgePhase` below give growth-line coordinates, and lines of
 * constant phi are spirals on the face (bands that run the whole coil).
 */
export function coil(spec: CoilSpec): Surface {
  const at = coilAt(spec), hand = handOf(spec.hand);
  const section = sectionOf(spec.section ?? {}, spec);
  // The section turns with v in the sense that makes d/du x d/dv face out of the coil for either hand.
  return surface((u, v) => { const [x, y] = section(u, mul(v, -TAU * hand)); return at(u, x, y); }, COIL_TOPOLOGY);
}

/**
 * The (u, v) layout of a `coil`, for `surface((u, v) => coilAt(law)(u, ...), COIL_TOPOLOGY)`: u from the apex (0, an
 * edge closed by a flat disc when the surface is made solid; the coil is tiny there) to the aperture (1, a free open
 * rim), v once round the section and glued to itself. It cannot describe a coil whose mouth is closed or whose apex
 * ends in a point: give your own `Topology` (`pole` at that end) for those.
 */
export const COIL_TOPOLOGY = { u: ["cap", "free"], v: "periodic" } as const satisfies Topology;

/**
 * `coil`'s law without its section: the point `across` away from the axis and `along` up it from the section's centre,
 * at whorl position u (0 apex, 1 aperture; any expression), in world units at the aperture's scale. See `coil` for the
 * law, the relatives and the recipe this is one step down of.
 *
 * The law: with s = W^(turns (u - 1)) and theta = 2 pi turns u (signed by `hand`),
 *   point = s R_y(theta) [ (c + across) x + (-T c + along) y ],   c = aperture (1 + D) / (1 - D).
 * u, across and along take expressions, so a section can move, u can run past 1 (a flare) or back (a throat), and
 * points of the coil can be placed; the law's numbers are fixed.
 *
 * What it cannot do, because the law's numbers are fixed at build:
 * - grow, turn or drop by amounts that change in time or along u: `turns`, `growth`, `umbilicus` and `spire` are
 *   numbers, not expressions (write s yourself in a `surface` for growth as a function of u).
 * - coil without growing: growth must be above 1 (it throws), so a helix of constant radius is not this law.
 * - leave its axis: the axis is y through the origin; place the result in a chart to move it.
 */
export function coilAt(law: CoilLaw): (u: F, across: F, along: F) => P3 {
  const { turns, growth, aperture, umbilicus: D, spire } = law;
  if (!(growth > 1)) throw new Error(`coil: growth must be above 1 (every whorl larger than the last), got ${growth}`);
  if (!(D >= 0 && D < 1)) throw new Error(`coil: umbilicus must be in [0, 1), got ${D}`);
  if (!(turns > 0)) throw new Error(`coil: turns must be positive, got ${turns}`);
  const hand = handOf(law.hand), centre = (aperture * (1 + D)) / (1 - D), lnW = Math.log(growth);
  return (u, across, along) => {
    const scale = exp(mul(sub(u, 1), lnW * turns));
    const theta = mul(u, TAU * turns * hand);
    const r = add(centre, across);
    const y = add(-spire * centre, along);
    return mul(vec3(mul(r, cos(theta)), y, mul(r, sin(theta))), scale);
  };
}

/** The section as a function of (u, phi), classified once. */
function sectionOf(s: CoilSection, law: CoilLaw): (u: F, phi: F) => readonly [F, F] {
  if (typeof s === "function") return s;
  const ridges = s.ridges ?? { perTurn: 1, height: 0 };
  if (!Number.isInteger(ridges.perTurn) || ridges.perTurn < 1) throw new Error(`coil: ridges.perTurn must be a positive whole number, got ${ridges.perTurn}`);
  const a = law.aperture, b = law.aperture * (s.aspect ?? 1);
  return (u, phi) => {
    // A ridge is a sharp crest once per 1 / (turns perTurn) of u: the section swells there.
    const rib = add(1, mul(pow(abs(sin(mul(u, Math.PI * law.turns * ridges.perTurn))), 6), ridges.height));
    return [mul(cos(phi), mul(rib, a)), mul(sin(phi), mul(rib, b))];
  };
}

function handOf(hand: CoilLaw["hand"]): 1 | -1 {
  switch (hand ?? "right") {
    case "right": return 1;
    case "left": return -1;
  }
}

/**
 * `coil`'s law in plain numbers, on the CPU, for checks and placement: where a whorl's section is hidden inside the
 * next one out, and which whorls hold a point. For an elliptical section of `aspect`, in the coil's own coordinates:
 * - `centre`: the section's centre off the axis at u = 1, and `drop`: its depth below the apex there;
 * - `covered`: the arc of phi (radians, as in `CoilSection`, from `from` to `to` going up) of any whorl's section that
 *   lies inside the next whorl out, so it never shows; its ends are the suture. Undefined when the whorls stand apart.
 * - `holding(q)`: the whorl positions u whose section holds the point q (empty when q is outside the coil).
 * It cannot see a section of your own: it reasons about the ellipse of `aspect` alone, without ridges or a section
 * function, and the arc it finds is sampled (720 steps, then bisected), so a covered arc narrower than half a degree
 * may be missed.
 */
export function coilPlan(spec: CoilLaw & { readonly aspect?: number }): {
  readonly centre: number; readonly drop: number;
  readonly covered: { readonly from: number; readonly to: number } | undefined;
  readonly holding: (q: V3) => readonly number[];
} {
  coilAt(spec);
  const { turns, growth: W, aperture: a, umbilicus: D, spire } = spec;
  const b = a * (spec.aspect ?? 1), c = (a * (1 + D)) / (1 - D), drop = spire * c, hand = handOf(spec.hand);
  // A point of a whorl's section at phi lies inside the next whorl out (W times larger about the apex) when it is
  // inside that whorl's ellipse: centre (W c, -W drop), half-axes (W a, W b).
  const inNext = (phi: number): boolean => ((c + a * Math.cos(phi) - W * c) / (W * a)) ** 2 + ((-drop + b * Math.sin(phi) + W * drop) / (W * b)) ** 2 < 1;
  const N = 720, at = (k: number) => (k * 2 * Math.PI) / N;
  const edge = (lo: number, hi: number): number => {
    const want = inNext(hi);
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (inNext(m) === want) hi = m; else lo = m; }
    return (lo + hi) / 2;
  };
  let from: number | undefined, to: number | undefined;
  for (let k = 0; k < N; k++) {
    const here = inNext(at(k)), next = inNext(at(k + 1));
    if (!here && next) from = edge(at(k), at(k + 1));
    if (here && !next) to = edge(at(k), at(k + 1));
  }
  const covered = from === undefined || to === undefined ? (inNext(0) ? { from: 0, to: 2 * Math.PI } : undefined)
    : { from, to: to > from ? to : to + 2 * Math.PI };
  const holding = (q: V3): number[] => {
    const rho = Math.hypot(q[0], q[2]), turn = (hand * Math.atan2(q[2], q[0])) / (2 * Math.PI);
    const out: number[] = [];
    for (let u = (turn - Math.floor(turn)) / turns; u <= 1; u += 1 / turns) {
      const s = W ** (turns * (u - 1));
      if (((rho / s - c) / a) ** 2 + ((q[1] / s + drop) / b) ** 2 < 1) out.push(u);
    }
    return out;
  };
  return { centre: c, drop, covered, holding };
}

/**
 * Whorls from the apex at whorl position u of a coil of `turns` (u turns): a coordinate along the growth of a coil, for
 * paint, so a band at a whole number of whorls follows one turn of the coil. It cannot follow growth lines that are
 * not evenly spaced in u: it counts turns, not the coil's size.
 */
export const whorl = (u: F, turns: number): F => mul(u, turns);
/**
 * Where u lies within the ridges of a coil's section: fract(u turns perTurn), 0 between two ridges and 0.5 on a
 * ridge's crest, so paint can darken ridges or the furrows between them in step with `coil`'s `ridges`. It cannot
 * follow ridges of a section function of your own: it matches `coil`'s ridges of `perTurn` per whorl only.
 */
export const ridgePhase = (u: F, turns: number, perTurn: number): F => fract(mul(u, turns * perTurn));

export type SpiralTubeSpec = {
  readonly name: string;
  /** Length along the centre line. */
  readonly length: In<"f32">;
  /** Total turn of the centre line from root to tip, radians (0 straight, a tusk; 2 a ram's sweep). */
  readonly curl: In<"f32">;
  /** Tip radius over root radius (the spiral's growth over the horn, so the curl tightens as it tapers). */
  readonly taper: In<"f32">;
  /** Radius at the root. */
  readonly girth: In<"f32">;
  /** Direction the horn leaves its root along, and the direction it curls toward (made perpendicular to `out`); in its local frame. */
  readonly out: V3;
  readonly toward: V3;
  /** Sideways drift (out of the curl's plane) as a share of length: a corkscrew. Default 0. */
  readonly twist?: In<"f32">;
  readonly paint: PaintSpec;
  readonly detail?: { readonly along?: number; readonly around?: number };
};

/**
 * A tapered tube on an equiangular (logarithmic) spiral. Named for its shape, not for a use: a horn, a hooked finger,
 * a tooth, a tusk, a tendril and a moustache have all been drawn with it, which is also a warning: reach for it by
 * habit and everything pointed in your picture will be the same curve.
 *
 * The shape. The centre line turns through `curl` radians in the plane of `out` and `toward`, and the radius goes from
 * `girth` at the root to `girth * taper` at the tip. The two are tied by one law: with e^(k theta) = 1 + m (taper - 1),
 * arc length is linear in m (0 at the root, 1 at the tip) and the radius is girth * e^(k theta), the spiral's own growth.
 * So the form is self-similar, as a shell's is: it tightens exactly as it thins.
 *
 * Parameters: `length`, `curl`, `taper`, `girth`, `twist` take numbers, expressions or host inputs (so they can move
 * in time); `out` and `toward` are fixed directions.
 *
 * What it cannot do, because of that one law:
 * - curl that does not follow the taper: a thick tight coil, a thin lazy one, a curl that reverses (an S), a straight
 *   run and then a hook. With `taper` 1 it is a plain circular arc.
 * - leave its plane properly: `twist` is a sideways drift growing as m^2, not a helix of constant pitch.
 * - a radius that is not linear along its length: no swelling club, no waist, no ridges.
 * - any section but round, and any ends but an open root and a point.
 *
 * Going past it is one step down, not a rewrite: `spiralLine` below gives this tube's centre line, radius and up
 * direction as `strand` takes them, so `strand({ name, ...spiralLine(o), section, tips, girth, paint })` changes the
 * section, the ends or the radius and keeps the curve. For another curve, write your own line with the same shape of
 * result ({ spine, girth, up }). The recipe behind this one: choose the heading along the line, theta(m), and the
 * spine is length times the integral of (cos theta, sin theta). Relatives worth trying:
 * - theta linear in m: a circular arc; add a constant drift along `up` and it is a helix (a corkscrew, a spring).
 * - theta growing as m^2 (a clothoid): straight at the root, curling faster and faster: a fern head, a tendril, a
 *   scorpion's tail. No closed form: sample it once with `tabulate`, or lay it through points with `through`.
 * - radius from the axis growing by a fixed step per turn (Archimedes' spiral): turns evenly spaced, a rope coil or a
 *   watch spring, where this one's turns crowd toward the tip.
 * - theta = curl * sin(pi m) or any curve of your own: S-bends and hooks.
 * A strand, so it has a skeleton, casts a shadow and carries body coordinates (m along, v round) for paint.
 */
export function spiralTube(spec: SpiralTubeSpec): Strand {
  return strand({
    name: spec.name, stations: 12, ...spiralLine(spec),
    tips: ["open", { point: 0.12 }],
    paint: spec.paint,
    detail: { along: spec.detail?.along ?? 24, around: spec.detail?.around ?? 12 },
  });
}

/**
 * `spiralTube`'s centre line, its radius along it and its up direction, named as `strand` takes them, so the tube is
 * never a dead end (see `spiralTube` for the law and its relatives). Spread it into your own `strand` and override what
 * you need; or add to its `spine` (a kink, a wobble in time) or multiply its `girth` (a swelling, ridges): both are
 * functions of m, the share of the way from root (0) to tip (1).
 *
 * What it cannot do is what the law cannot (adding to the result is how to get past each):
 * - curl that does not follow the taper: the heading is ln(1 + m (taper - 1)) / k, tied to the radius.
 * - a sideways run other than `twist` m^2: no helix of constant pitch.
 * - a radius that is not linear in m: girth (1 + m (taper - 1)).
 * - an up direction that turns: `up` is the fixed normal of the curl's plane.
 */
export function spiralLine(spec: Pick<SpiralTubeSpec, "length" | "curl" | "taper" | "girth" | "out" | "toward" | "twist">): { readonly spine: (m: F) => P3; readonly girth: (m: F) => F; readonly up: P3 } {
  const L = lift<"f32">(spec.length), curl = lift<"f32">(spec.curl), taper = lift<"f32">(spec.taper), girth = lift<"f32">(spec.girth);
  const [o, w, sd] = basis(spec.out, spec.toward);
  const out = lift<"vec3">(o), toward = lift<"vec3">(w), side = lift<"vec3">(sd);
  const k = div(log(taper), max(curl, 1e-4));
  // Near taper 1 the spiral is a circle (k -> 0): use the limits, so the slider can pass through 1.
  const flat = lt(abs(k), 1e-4);
  const kk = select(flat, 1e-4, k);
  const q = sqrt(add(1, mul(kk, kk)));
  const rho0 = select(flat, div(L, max(curl, 1e-4)), div(mul(L, kk), mul(q, sub(taper, 1))));
  const spine = (m: F): P3 => {
    const g = add(1, mul(m, sub(taper, 1)));
    const theta = select(flat, mul(m, curl), div(log(g), kk));
    // rho0 (k - i) / q (e^(k theta) e^(i theta) - 1): real part along `out`, imaginary toward `toward`.
    const re = sub(mul(g, cos(theta)), 1), im = mul(g, sin(theta));
    const along = div(mul(rho0, add(mul(kk, re), im)), q);
    const across = div(mul(rho0, sub(mul(kk, im), re)), q);
    return add(add(mul(out, along), mul(toward, across)), mul(side, mul(mul(L, lift<"f32">(spec.twist ?? 0)), mul(m, m))));
  };
  return { spine, girth: (m) => mul(girth, add(1, mul(m, sub(taper, 1)))), up: side };
}

type V3 = readonly [number, number, number];

/** Unit `out`, `toward` made perpendicular to it, and their cross product. */
function basis(out: V3, toward: V3): [V3, V3, V3] {
  const unitOf = (v: readonly number[], what: string): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]);
    if (!(l > 1e-6)) throw new Error(`spiralTube: ${what} must be a non-zero direction not parallel to out`);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const o = unitOf(out, "out");
  const d = o[0] * toward[0] + o[1] * toward[1] + o[2] * toward[2];
  const w = unitOf([toward[0] - d * o[0], toward[1] - d * o[1], toward[2] - d * o[2]], "toward");
  return [o, w, [o[1] * w[2] - o[2] * w[1], o[2] * w[0] - o[0] * w[2], o[0] * w[1] - o[1] * w[0]]];
}

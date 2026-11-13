// A whirlpool is a deformation of the sea (DESIGN.md 8.3): a chart of the sea plane whose twist accumulates with time
// and is faster toward the centre, with an inward drift and a funnel, and which is exactly the identity beyond its
// radius. The sea takes it as a deformation (`sea({ deform: [pool] })`): the surface dips into the funnel, and the
// swell, the foam arms and the shading are evaluated in the whirlpool's coordinates, so they wind into spirals. Things
// are placed in it through `pool.in(sea)`, a chart whose coordinates are the whirlpool's (x, z) and the height above
// the water (y): a floating thing placed there is carried round and tilts with the funnel wall, and a body whose spine
// is given there is wound into a coil (its skeleton is mapped; its cross-sections keep their shape).
//
// The flow, in closed form both ways. Write s = r / R (radius over the whirlpool's) and the radial clock
// L = tan(pi (s - 1/2)), which runs over the whole line as s runs over (0, 1). The flow moves every point inward at a
// constant rate in L and turns it at an angular speed that depends on L only:
//
//   dL/dt = -c,     d(angle)/dt = omega(L) = spin * sigmoid(-L)
//
// so ds/dt = -(c / pi) sin^2(pi s) (zero at the centre and, to second order, at the rim: the velocity field is C1
// across the edge, so the paint shows no seam there), and omega is `spin` at the centre and vanishes faster than any
// power of (1 - s) at the rim. Its integrals are the whirlpool's coordinates: the characteristic coordinates
//
//   xi  = L + c t                          (constant along each path; it advances, so the water streams inward)
//   eta = angle - turn(L),   turn(L) = (spin / c) softplus(-L)
//
// are constant along every path, and the whirlpool's plane coordinates are the point at radius R (1/2 + atan(xi) / pi)
// and angle eta. At any time the map from these to the sea plane is the same steady spiral moved inward by c t in L: a
// straight line given in whirlpool coordinates is a spiral on the water, at every time, and a pattern periodic in xi
// keeps its statistics forever (it never winds tighter, which advected paint would). `turn` vanishes at the rim like
// exp(-1 / (pi (1 - s))), so the map is the identity there with every derivative; outside, it is the identity exactly.
//
// The drift must be positive: without it every path is a circle and the characteristic coordinates do not exist.

import {
  abs, add, atan2, clamp, cos, cross, div, dot, exp, length, lift, log, lt, max, mul, normalize, pow, select, sin, smoothstep,
  sub, substitute, tan, time, variable, vec2, vec3, type Expr, type In,
} from "../expr.ts";
import { derivative } from "../grad.ts";
import { fold2 } from "../lib/fold.ts";
import { hash2 } from "../lib/noise.ts";
import type { Chart, F, Frame, P3 } from "../map/types.ts";
import type { Sea, SeaDeform } from "./sea.ts";

export type WhirlpoolSpec = {
  /** Centre on the sea plane (x, z). */
  readonly at: readonly [number, number];
  /** Radius of the whirlpool, world units: the map is the identity beyond it. */
  readonly radius: number;
  /** Angular speed at the centre, radians per second (positive turns from +x toward +z). */
  readonly spin: number;
  /** Depth of the funnel at the centre, world units. */
  readonly depth: number;
  /** Inward speed at half the radius, world units per second. Must be positive. */
  readonly drift: number;
  /** Radius of the funnel's throat as a fraction of the radius. Default 0.22. */
  readonly throat?: number;
  /** Foam arms. Default 5. */
  readonly arms?: number;
};

type V2 = Expr<"vec2">;

/** The flow at a point: inside or not, its radial clock, its angle, and where it sits relative to the centre. */
type Polar = { readonly inside: Expr<"bool">; readonly s: F; readonly L: F; readonly angle: F; readonly r: F };

/** log(1 + e^x), written so it neither overflows for large x nor loses everything for very negative x. */
const softplus = (x: F): F => add(max(x, 0), log(add(1, exp(mul(abs(x), -1)))));
const sigmoid = (x: F): F => div(1, add(1, exp(mul(x, -1))));

/** Closest a radius fraction gets to 0 or 1 inside the map (tan(pi (s - 1/2)) must stay finite and on its branch). */
const S_MIN = 1e-4, S_MAX = 1 - 1e-6;

/**
 * A whirlpool, made by `whirlpool`: a deformation a `sea` takes (`sea({ deform: [pool] })`), a map of the sea plane
 * that turns and draws the water inward and is exactly the identity beyond `radius`. What a user reads off it:
 * `flow(p, t)` (where whirlpool coordinates p are on the sea plane at time t, and how far a thing there has turned),
 * `toLocal` (the inverse), `dip` (the funnel's depth), `c` (the inward rate of the radial clock), and `in(sea)`, the
 * chart to place things in so they are carried round. It cannot be used alone: it draws nothing until a sea takes it.
 */
export class Whirlpool implements SeaDeform {
  /** The inward clock: dL/dt = -c. */
  readonly c: number;
  /** A whirlpool only dips. */
  readonly rise = 0;
  readonly throat: number;
  readonly arms: number;
  private readonly centre: V2;

  constructor(readonly spec: WhirlpoolSpec) {
    const { radius, spin, depth, drift } = spec;
    if (!(radius > 0)) throw new Error(`whirlpool: radius must be positive, got ${radius}`);
    if (!(drift > 0)) throw new Error(`whirlpool: drift must be positive (without it there are no whirlpool coordinates), got ${drift}`);
    if (!(depth >= 0)) throw new Error(`whirlpool: depth must be >= 0, got ${depth}`);
    if (!Number.isFinite(spin)) throw new Error(`whirlpool: spin must be a number, got ${spin}`);
    this.throat = spec.throat ?? 0.22;
    if (!(this.throat > 0)) throw new Error(`whirlpool: throat must be positive, got ${this.throat}`);
    this.arms = spec.arms ?? 5;
    if (!(Number.isInteger(this.arms) && this.arms >= 1)) throw new Error(`whirlpool: arms must be a positive integer, got ${this.arms}`);
    this.c = (Math.PI * drift) / radius;
    this.centre = lift<"vec2">([spec.at[0], spec.at[1]]);
  }

  /** Material angle minus sea-plane angle, as a function of the radial clock: how far the water has been turned. */
  turn(L: F): F {
    return mul(softplus(mul(L, -1)), this.spec.spin / this.c);
  }

  private polar(xz: V2): Polar {
    const d = sub(xz, this.centre);
    const r = length(d);
    const s = clamp(div(r, this.spec.radius), S_MIN, S_MAX);
    return { inside: lt(r, this.spec.radius), s, L: tan(mul(sub(s, 0.5), Math.PI)), angle: atan2(d.y, d.x), r };
  }

  /** The point at radius fraction 1/2 + atan(L) / pi and the given angle. */
  private point(L: F, angle: F): V2 {
    const s = add(0.5, div(atan2(L, 1), Math.PI));
    return add(this.centre, mul(vec2(cos(angle), sin(angle)), mul(s, this.spec.radius)));
  }

  /** Whirlpool plane coordinates to the sea plane at time t, and how far a thing there has turned. */
  flow(p: V2, t: In<"f32"> = time): { readonly xz: V2; readonly turn: F } {
    const m = this.polar(p);
    // xi = m.L; the sea-plane clock is xi - c t.
    const L = sub(m.L, mul(t, this.c));
    const turned = this.turn(L);
    return { xz: select(m.inside, this.point(L, add(m.angle, turned)), p), turn: select(m.inside, turned, 0) };
  }

  /** The inverse: where the water at sea-plane point xz at time t sits in whirlpool coordinates. */
  toLocal(xz: V2, t: In<"f32"> = time): V2 {
    const w = this.polar(xz);
    return select(w.inside, this.point(add(w.L, mul(t, this.c)), sub(w.angle, this.turn(w.L))), xz);
  }

  /** The funnel's shape at radius fraction s: 1 at the centre, a rounded throat, (1 - s^2)^3 so it meets the sea flat. */
  private funnel(s: F): F {
    const edge = max(sub(1, mul(s, s)), 0);
    return div(mul(mul(edge, edge), edge), add(1, mul(div(s, this.throat), div(s, this.throat))));
  }

  dip(xz: V2): F {
    const r = length(sub(xz, this.centre));
    return mul(this.funnel(div(r, this.spec.radius)), this.spec.depth);
  }

  /** The swell fades toward the throat: full beyond half the radius, gone at a tenth of it. */
  calm(xz: V2): F {
    return smoothstep(0.1, 0.5, div(length(sub(xz, this.centre)), this.spec.radius));
  }

  /**
   * Foam arms from the spiral fold, evaluated at the whirlpool coordinates (xi, eta): the fold's log-radius lane is
   * proportional to xi, so its bands are periodic in xi and stream inward without ever winding tighter. A minor fold
   * draws fine streaks between them; each dash (one fold cell) is kept or dropped by a hash of its cell, so the arms
   * break up. Faded out at the rim and in the throat, where the bands crowd below a pixel.
   */
  look(xz: V2, t: In<"f32">, fp: F): { readonly foam: F; readonly shade: F } {
    const w = this.polar(xz);
    const xi = add(w.L, mul(t, this.c)), eta = sub(w.angle, this.turn(w.L));
    // The fold reads log|q| = KAPPA xi; xi is clamped where the envelope is already 0 (exp would overflow at the rim).
    const q = mul(vec2(cos(eta), sin(eta)), exp(mul(clamp(xi, -14, 14), KAPPA)));
    // How fast a fold's band lane changes per world unit, for antialiasing: radially through L (and through the
    // turn, which shears eta along the radius), and round the circle.
    const dLdr = div(mul(add(1, mul(w.L, w.L)), Math.PI), this.spec.radius);
    const shear = mul(sigmoid(mul(w.L, -1)), this.spec.spin / this.c);
    const band = (arms: number, cells: number, width: number, keep: number): F => {
      const f = fold2.spiral({ arms, cells })(q);
      const rate = add(abs(mul(dLdr, add((KAPPA * cells) / (2 * Math.PI), mul(shear, arms / (2 * Math.PI))))), div(arms / (2 * Math.PI), mul(w.s, this.spec.radius)));
      const aa = add(mul(fp, rate), 0.02);
      const across = sub(1, smoothstep(sub(width, aa), add(width, aa), abs(f.x.y)));
      // Dashes: tapered toward the cell's ends (so the cell walls never show), some cells empty.
      const along = sub(1, smoothstep(0.18, 0.46, abs(f.x.x)));
      const kept = smoothstep(keep - 0.1, keep + 0.1, hash2(f.id));
      // Where the bands crowd below about a pixel, fade to their average rather than shimmer.
      const resolved = sub(1, smoothstep(0.15, 0.35, mul(fp, rate)));
      return mul(mul(mul(across, along), kept), resolved);
    };
    const A = this.arms;
    const arms = band(A, 2 * A, 0.16, 0.3);
    const streaks = mul(band(2 * A + 1, 6 * A + 3, 0.06, 0.5), 0.5);
    const envelope = mul(smoothstep(0.06, 0.2, w.s), sub(1, smoothstep(0.72, 0.97, w.s)));
    const foam = select(w.inside, mul(max(arms, streaks), mul(envelope, 0.9)), 0);
    // The throat darkens toward the deep-water colour; the funnel wall a little.
    const shade = select(w.inside, mul(pow(this.funnel(w.s), 0.5), -2.6), 0);
    return { foam, shade };
  }

  /**
   * Inside the radius. Beyond it every part is exactly nothing: `toLocal` and `look` select their outside values on
   * this same test, `dip` is (max(1 - s^2, 0))^3 = 0 and `calm` is smoothstep(0.1, 0.5, s) = 1 for s >= 1.
   */
  reaches(xz: V2): Expr<"bool"> {
    return this.polar(xz).inside;
  }

  /** The whirlpool in a sea that it deforms: the chart things are placed in. */
  in(sea: Sea): PoolChart {
    if (!sea.deforms.includes(this)) throw new Error("whirlpool.in(sea): this sea does not take the whirlpool as a deformation (sea({ deform: [pool] }))");
    return new PoolChart(this, sea, time);
  }
}

/** Radial scale of the foam folds: their log-radius lane is KAPPA xi. */
const KAPPA = 0.55;

/**
 * The whirlpool's chart on its sea. Coordinates (x, y, z): (x, z) the whirlpool's plane coordinates, y the height above
 * the water's surface (world up), so a body authored in world coordinates over a calm sea is placed by its own numbers.
 * The frame there: y the water's normal, x the whirlpool's x direction turned with the water and laid on the surface,
 * z = x cross y.
 */
export class PoolChart implements Chart {
  constructor(readonly pool: Whirlpool, readonly sea: Sea, private readonly t: F) {}

  frame(c: P3): Frame {
    const f = this.pool.flow(vec2(c.x, c.z), this.t);
    const g = this.sea.gradient(f.xz, this.t);
    const y = normalize(vec3(mul(g.x, -1), 1, mul(g.y, -1)));
    const dir = vec3(cos(f.turn), 0, sin(f.turn));
    const x = normalize(sub(dir, mul(y, dot(dir, y))));
    return { o: vec3(f.xz.x, add(this.sea.height(f.xz, this.t), c.y), f.xz.y), x, y, z: cross(x, y) };
  }

  at(t: F): Chart { return new PoolChart(this.pool, this.sea, t); }
  atNear(t: F): Chart { return this.at(t); }

  /** For afloat (src/geom/afloat.ts): a point given in whirlpool (x, z) is carried to the sea plane, turned with the water. */
  carry(at: V2): { readonly xz: V2; readonly turn: F } { return this.pool.flow(at, this.t); }
  height(xz: V2): F { return this.sea.height(xz, this.t); }

  /**
   * The velocity of the point at fixed whirlpool coordinates c, world units per second: the time derivative of the map
   * (symbolic, src/grad.ts), including the water's rise and fall there. A game's simulation drifts things with it.
   */
  velocity(c: In<"vec3">): P3 {
    if (this.t !== time) throw new Error("PoolChart.velocity: take it on the live chart, not a slice");
    return derivative(this.frame(lift<"vec3">(c)).o, time);
  }

  /** The horizontal velocity of the water at sea-plane point xz now (x, z): the same derivative, at the water there. */
  drift(xz: In<"vec2">): V2 {
    if (this.t !== time) throw new Error("PoolChart.drift: take it on the live chart, not a slice");
    const v = derivative(this.pool.flow(POOL_P, time).xz, time);
    return substitute([v], POOL_P, this.pool.toLocal(lift<"vec2">(xz), time))[0] as V2;
  }
}

const POOL_P = variable("loft_pool_p", "vec2");

/**
 * A whirlpool on a sea: water inside a disc turned and drawn inward, faster toward the centre, over a funnel that dips
 * below the surface, with foam arms winding in. Pass it to `sea({ deform: [pool] })`.
 *
 * The shape and its law. With s = r / radius and the radial clock L = tan(pi (s - 1/2)), every point of water moves
 * inward at a constant rate in L and turns at a speed set by L alone:
 *   dL/dt = -c (c = pi drift / radius),   d(angle)/dt = spin sigmoid(-L).
 * Both integrate in closed form: xi = L + c t and eta = angle - (spin / c) softplus(-L) are constant along each path,
 * so a straight line in whirlpool coordinates is a spiral on the water at every time, and paint periodic in xi streams
 * inward for ever without winding tighter. The map is the identity, with every derivative, at the rim. The funnel is
 * steady: depth (1 - s^2)^3 / (1 + (s / throat)^2).
 *
 * Parameters: `at`, `radius`, `spin`, `depth`, `drift`, `throat`, `arms` are fixed numbers at build. Time moves the
 * water through the law; the whirlpool itself does not change.
 *
 * What it cannot do, because of that law:
 * - turn without drawing in: drift must be positive, or the paths are circles and the coordinates above do not exist.
 * - push water outward (a boil, a spring): the clock only runs inward.
 * - wander, grow, spin up or die away: centre, radius, spin and depth are numbers, not expressions.
 * - an off-round or leaning funnel, or a rim raised above the sea: it only dips, the same at every angle.
 * - a hole: the funnel is a height of the sea, so it has a bottom at `depth` and never overhangs.
 *
 * Going past it: `flow` and `toLocal` are the whole map, so a `SeaDeform` of your own can wrap a whirlpool and change
 * its dip, calm or marks while keeping the flow. Relatives, each by changing one tie in the law:
 * - omega(L) of your own (any function vanishing fast as L grows): a vortex with a solid-turning core, a Rankine-like
 *   profile; eta keeps the form angle - integral of omega / c.
 * - c a function of t (integrate it once, xi = L + C(t)): a whirlpool that opens and closes.
 * - the same characteristic construction on a line instead of a circle (L along a channel, the turn a sideways shear):
 *   a rip current or a mill race.
 * - a ring that runs outward instead of turning: `ringWave`.
 */
export function whirlpool(spec: WhirlpoolSpec): Whirlpool {
  return new Whirlpool(spec);
}

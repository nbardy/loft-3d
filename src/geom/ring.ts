// A ring wave: what a slam leaves on the water (docs/throw_and_shove.md). One crest and the trough behind it leave
// the edge of a disc at an instant and run outward at a fixed speed; ahead of the front the water is exactly as it
// was. It is a deformation of the sea (`sea({ deform: [ring] })`), so everything that reads the sea's height rides it:
// a thing placed with `afloat` rises over the crest and heels on its faces with no animation of its own. Things afloat
// are also forced outward: a thing caught by the front's face is carried with it, at the wave's speed, for as long as
// the crest is tall enough to hold it, then dropped to coast (docs/throw_and_shove.md, "The ride"). A game reads the
// rule's parts (`arrival`, `speed`, `lag`, `holds`, `lifts`) and integrates its own floating things; `pushed` is Loft's
// stand-in, the same rule solved in closed form with a linear drag for a thing that starts at rest at its own place.
//
// Four facts the formulas are built on:
//   1. A ring's energy is spread round a growing circle, so its height falls as 1 / sqrt(r).
//   2. In water shallower than the pulse is long the wave does not disperse and runs at sqrt(g depth): the pulse keeps
//      its width, and the front that left radius R at the slam is at R + c t. Nothing moves before it arrives.
//   3. A floating thing cannot be pushed faster than the wave that pushes it. So a carried thing moves at the wave's
//      speed and no faster, and what the front cannot hold is given less.
//   4. A finite-height front is a bore: it runs at sqrt(g (depth + a)), faster the taller it is. The model keeps one
//      speed, and the scene should give the slowest the front has while it carries anything (at the holding height).

import { add, and, atan2, clamp, div, exp, gt, length, lift, lt, max, min, mul, select, sin, smoothstep, sqrt, sub, time, type Expr, type In } from "../expr.ts";
import type { SeaDeform } from "./sea.ts";

type F = Expr<"f32">;
type V2 = Expr<"vec2">;

export type RingSpec = {
  /** The disc the wave leaves: its centre on the sea plane (x, z) and its radius. */
  readonly centre: In<"vec2">;
  readonly radius: In<"f32">;
  /** Seconds since the slam at clock t (negative before it). */
  readonly since: (t: In<"f32">) => F;
  /** Speed of the front, world units per second (a bore of height a on depth d: sqrt(g (d + a)); give it at the holding height). */
  readonly speed: number;
  /** Height of the crest at the disc's edge; it falls as 1 / sqrt(r) beyond. */
  readonly height: number;
  /** Length of the pulse from its front to the end of its trough, world units. */
  readonly length: number;
  /** Distance from the centre at which the wave is gone (it fades over the last quarter of the way). */
  readonly reach: number;
  /**
   * The holding height: the front carries a floating thing with it while its crest is at least this tall, so a ride
   * ends at `radius (height / hold)^2` from the centre (or at three quarters of `reach`, where the wave starts to die,
   * if that is nearer). At most `height`.
   */
  readonly hold: number;
  /** Seconds for the water to take off a dropped thing's speed (1 / e): the stand-in's linear drag. It coasts `speed drag`. */
  readonly drag: number;
};

/** A thing's ride on the ring from its own place: what the stand-in is made of, and what a check measures it against. */
export type Ride = {
  /** Seconds after the slam that the front's face takes the thing (the edge's arrival plus the lag). */
  readonly taken: F;
  /** Seconds it is carried, how far, and its speed when it is let go (the wave's, or less for a thing the front could not hold). */
  readonly seconds: F; readonly distance: F; readonly letGo: F;
  /** Outward unit on the sea plane (x, z). */
  readonly out: V2;
};

/** The crest's share of the pulse's length, and the trough's depth as a share of the crest's height. */
const CREST = 0.5, TROUGH = 0.3;
/**
 * Where on the pulse a carried thing sits, as a share of its length behind the leading edge: on the face, ahead of the
 * crest (at 0.25), so a boat a few units long has its inward end near the crest and its outward end at the edge.
 */
const FACE = 0.06;
/** The share of `reach` at which the wave starts to die (it is gone at `reach`). */
const DYING = 0.75;

/**
 * A ring wave on the sea, as `ringWave` (or an attack's `ring` aftermath) makes it: a sea deformation to pass to
 * `sea({ deform })`, and the rule a game reads to move floating things itself: `arrival(place)` (seconds after the start
 * that the front reaches a place), `speed`, `lag`, `holds(place)`, `dropRadius`, `lifts(place, t)` (the surface's rise),
 * `ride(place)`; and Loft's stand-in for a thing at rest that it shoves, `pushed(place, t)` and `shoved(place)`.
 */
export class RingWave implements SeaDeform {
  readonly rise: number;
  private readonly centre: V2;
  private readonly radius: F;

  constructor(readonly spec: RingSpec) {
    const { speed, height, length: len, reach, hold, drag } = spec;
    for (const [k, v] of Object.entries({ speed, height, length: len, reach, hold, drag })) if (!(v > 0 && Number.isFinite(v))) throw new Error(`ringWave: ${k} must be a positive, finite number; got ${v}`);
    if (!(hold <= height)) throw new Error(`ringWave: the holding height (${hold}) is above the crest at the disc's edge (${height}): the front would carry nothing`);
    this.rise = height;
    this.centre = lift<"vec2">(spec.centre);
    this.radius = lift<"f32">(spec.radius);
  }

  /** Where a sea-plane point is in the pulse at time t: its distance out, how far behind the front (0..1 of the pulse), and whether the pulse is on it. */
  private at(xz: V2, t: In<"f32">): { readonly r: F; readonly xi: F; readonly on: Expr<"bool"> } {
    const r = length(sub(xz, this.centre)), tau = this.spec.since(t);
    const xi = div(sub(add(this.radius, mul(tau, this.spec.speed)), r), this.spec.length);
    return { r, xi, on: and(and(gt(tau, 0), lt(r, this.spec.reach)), and(gt(xi, 0), lt(xi, 1))) };
  }

  /** The share of the edge's height left at distance r: 1 / sqrt(r) from the disc's edge, to nothing at `reach`. */
  private spread(r: F): F {
    const fade = sub(1, smoothstep(DYING * this.spec.reach, this.spec.reach, r));
    return mul(sqrt(div(this.radius, max(r, this.radius))), fade);
  }

  /** The front's speed, world units per second: what a carried thing moves at. */
  get speed(): number { return this.spec.speed; }
  /** Seconds from the leading edge's arrival at a place to the face's: a thing there rises for this long before it is taken. */
  get lag(): number { return (FACE * this.spec.length) / this.spec.speed; }
  /** The radius at which the front lets go of what it carries: where its crest falls to the holding height, or where it starts to die. */
  get dropRadius(): F {
    const k = this.spec.height / this.spec.hold;
    return min(mul(this.radius, k * k), DYING * this.spec.reach);
  }
  /** 1 where the front is tall enough to carry a floating thing (inside the drop radius), else 0. */
  holds(place: In<"vec2">): F {
    return select(lt(length(sub(lift<"vec2">(place), this.centre)), this.dropRadius), 1, 0);
  }

  /** The pulse's shape at xi in (0, 1) behind the front: a crest of height 1, then a shallower trough; flat at both ends and between. */
  private shape(xi: F): F {
    const x = clamp(xi, 0, 1);
    const crest = sin(mul(x, Math.PI / CREST)), trough = sin(mul(sub(x, CREST), Math.PI / (1 - CREST)));
    return select(lt(x, CREST), mul(crest, crest), mul(mul(trough, trough), -TROUGH));
  }

  /** How far the wave lifts the surface at sea-plane point xz at time t (below 0 in its trough; exactly 0 off the pulse). */
  lifts(xz: In<"vec2">, t: In<"f32">): F {
    const p = lift<"vec2">(xz), w = this.at(p, t);
    return select(w.on, mul(mul(this.shape(w.xi), this.spread(w.r)), this.spec.height), 0);
  }

  /** Seconds after the slam that the front reaches sea-plane point xz (0 inside the disc). */
  arrival(xz: In<"vec2">): F {
    return div(max(sub(length(sub(lift<"vec2">(xz), this.centre)), this.radius), 0), this.spec.speed);
  }

  /**
   * The ride of a thing that floats at rest at `place` when the front comes. Inside the drop radius the face takes it
   * `lag` after the edge arrives and carries it at the wave's speed to the drop radius. Beyond, it is not carried: the
   * front gives it the wave's speed times the crest's height there over the holding height (less than the wave's), so
   * the shove is continuous across the drop radius and nothing past `reach` moves.
   */
  ride(place: In<"vec2">): Ride {
    const p = lift<"vec2">(place), d = sub(p, this.centre), r = length(d), c = this.spec.speed;
    const distance = max(sub(this.dropRadius, r), 0);
    const share = min(div(mul(this.spread(r), this.spec.height), this.spec.hold), 1);
    return { taken: add(this.arrival(p), this.lag), seconds: div(distance, c), distance, letGo: mul(share, c), out: div(d, max(r, 1e-4)) };
  }

  /**
   * Loft's stand-in for a floating thing on the ride: how far a thing afloat whose own place is `place` has been forced
   * outward at time t, on the sea plane (x, z). Exactly 0 until the face takes it; then `speed` times the seconds
   * carried; then the ride's distance plus a coast under a linear drag, `letGo drag (1 - exp(-q / drag))`, q seconds
   * after it is dropped.
   */
  pushed(place: In<"vec2">, t: In<"f32">): V2 {
    const k = this.ride(place), s = sub(this.spec.since(t), k.taken), q = max(sub(s, k.seconds), 0);
    const coast = mul(k.letGo, mul(sub(1, exp(mul(q, -1 / this.spec.drag))), this.spec.drag));
    return mul(k.out, select(lt(s, 0), 0, select(lt(s, k.seconds), mul(s, this.spec.speed), add(k.distance, coast))));
  }

  /** Where the stand-in ends: the ride's distance and the whole coast, outward. */
  shoved(place: In<"vec2">): V2 { const k = this.ride(place); return mul(k.out, add(k.distance, mul(k.letGo, this.spec.drag))); }

  // ---- as a deformation of the sea: it moves no water sideways and calms nothing; it lifts the surface and marks it ----

  toLocal(xz: V2): V2 { return xz; }
  calm(): F { return lift<"f32">(1); }
  dip(xz: V2, t: In<"f32">): F { return mul(this.lifts(xz, t), -1); }

  /**
   * Foam along the crest's front face, broken into dashes round the ring and thinning as the wave weakens; the crest
   * shaded lighter and the trough darker (in the swell's crest units).
   */
  look(xz: V2, t: In<"f32">): { readonly foam: F; readonly shade: F; readonly lean: V2 } {
    const w = this.at(xz, t), d = sub(xz, this.centre), strength = this.spread(w.r);
    const band = mul(smoothstep(0.03, 0.1, w.xi), sub(1, smoothstep(0.2, 0.3, w.xi)));
    const angle = atan2(d.y, d.x);
    const dash = add(0.5, mul(0.5, sin(add(mul(angle, 23), mul(3, sin(add(mul(angle, 5), mul(w.xi, 9))))))));
    const foam = mul(mul(band, add(0.4, mul(dash, 0.6))), sqrt(strength));
    // `lean`: the crest breaks outward (an added readout for a style that prints the foam as curled heads).
    return { foam: select(w.on, foam, 0), shade: select(w.on, mul(mul(this.shape(w.xi), strength), 1.6), 0), lean: div(d, max(w.r, 1e-4)) };
  }

  /** On the pulse: after the slam, between the front and the end of the trough, inside `reach`. Off it every part is exactly nothing. */
  reaches(xz: V2): Expr<"bool"> { return this.at(xz, time).on; }
}

/**
 * A ring wave: one crest and its trough leaving the edge of a disc at an instant and running out over the sea, shoving
 * what floats. The same wave an attack's `ring` aftermath makes, here with a centre, radius and clock of your own (a
 * splash where a thrown thing lands, a stone dropped in a pond).
 *
 * What it assumes (used so far by an attack's ring and by a splash where a thrown thing lands): the ground is a sea of
 * one depth, shallow next to the pulse's length (so the pulse runs at one speed without spreading), with nothing in it
 * to block or reflect the wave; and a floating thing is a point at its middle, taken by the front's face and carried at
 * the wave's speed. A subject that needs depth that changes, a shore, or a long thing turned by the wave does not fit.
 *
 * The law. With tau = since(t) and r the distance from `centre`, the front is at radius + speed tau; a point xi =
 * (radius + speed tau - r) / length behind it (0..1) is lifted height sqrt(radius / r) shape(xi), shape a crest (sin^2
 * over the first half) then a trough 0.3 as deep, faded to nothing over the last quarter of `reach`. Ahead of the front
 * and behind the trough the water is exactly as it was. A thing afloat at rest is taken by the face `lag` after the
 * front arrives and carried at `speed` while the crest there is at least `hold` tall (out to radius (height / hold)^2,
 * or three quarters of `reach`); then it coasts under a linear drag of `drag` seconds. Beyond the drop radius it is
 * given only the share height sqrt(radius / r) / hold of the speed, so the shove is continuous across it.
 *
 * Parameters: `centre`, `radius` and the `since` clock take expressions (a game starts the wave when it likes);
 * `speed`, `height`, `length`, `reach`, `hold` and `drag` are fixed numbers.
 *
 * What it cannot do, because of the law:
 * - change speed: one speed for the whole run, though a real front of finite height runs faster while it is tall.
 * - disperse, steepen or break: the pulse keeps its shape and length.
 * - meet anything: no shore, no reflection, no shadow behind a body, no sum with a second ring beyond adding heights.
 * - push a thing that is moving already, or turn one: the stand-in starts from rest at its own place and slides outward.
 * - exist on a ground that is not a sea.
 *
 * Going past it: the rule's parts (`arrival`, `speed`, `lag`, `holds`, `lifts`) are public, so a game integrates its own
 * floating things against them; and a `SeaDeform` of your own is any lift of the surface by place and time.
 * Relatives worth trying, each by changing one fact:
 * - a wave from a line: distance from a segment instead of a point; the crest barely falls near the line (a plane
 *   wave) and as 1 / sqrt(r) far away.
 * - deep-water ripples: several pulses, each at its wavelength's speed sqrt(g lambda / 2 pi), so the long ones lead and
 *   the ring spreads into a train.
 * - a bore that slows as it falls: speed sqrt(g (depth + a)) with a the crest's height at r, the front's time an
 *   integral of 1 / speed over r, tabulated once (`tabulate`).
 */
export function ringWave(spec: RingSpec): RingWave {
  return new RingWave(spec);
}

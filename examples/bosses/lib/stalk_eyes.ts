// RECIPE: an eye on a stalk that acts. Copy this file and edit it; it imports only the library's public entry.
//
// What it makes, and from what. The stalk is a `strand` on a bent spine (`bent`, a pose's bends evaluated once a frame);
// the eyeball a four-station `strand` placed at the stalk's tip through a `sized` chart (so it can swell without the
// strand's volume keeping turning it into an egg), facing where its socket is turned, its pupil sliding across it; two
// lids, each a spherical lune (`surface`) hinged on the eye's corners, close over it. One piece for an eye held up on a
// periscope and for one hung from a crook like a lantern: the difference is the pose and `hang`. Everything a vertex or
// a pixel reads is tabulated once a frame (`tabulate`; `prefix` names the tables). It also gives the marks a check reads
// (`expressionsRead`, `minScreenSize`). `lookOf` turns a target and an audience into a look: the socket turns part of the
// way, the pupil slides the rest.
// First drawn as the islander's eye (titan/face/dandy.ts); face_parts.ts has a fixed-size eye with an iris set in a
// head, where this ball swells and has none.
//
// Parameters (`StalkEyeSpec`): the bent stalk, its girths and paint; the ball's radius and `swell`; `hang`; the look
// (a function of the ball's middle); pupil size; inks; the lids' angles and slant. Angles, swell, pupil and the look are
// expressions; radii, girths, `hang` and the inks are numbers.
//
// What it cannot do:
// - an eye that is not a sphere, or a pupil that is not a disc (no slit, no bar);
// - lids that are not lunes of one sphere round the ball, hinged on one line (no lower lid that folds, no third lid);
// - a stalk that is not one strand (no joint, no branching, no retraction into a socket other than by the pose's bends);
// - more than the drawn ball in the marks: an iris has no mark.
//
// Copying it: change `lookOf` first (it decides what the eye says), then the ball's paint. Relatives worth trying:
// `hang` above 1 with a soft pose is a lantern (an anglerfish's lure, with the ball's paint made to glow); two balls on
// one stalk's tip is a snail's tentacle pair; the ball's paint with a band instead of a pupil is a slug's eye spot.

import {
  add, cos, cross, dot, draw, length, max, mix, mul, place, rigid, sin, spacing, sqrt, strand, sub, surface, tabulate, unit, vec2, vec3,
  edgeOf, sized, type Bent, type Drawable, type F, type Mark, type P3, type Strand,
} from "../../../src/index.ts";

type V3 = readonly [number, number, number];
const TAU = 2 * Math.PI;
const cut = (x: F, at: number | F): F => edgeOf(x, at, 1e-5);
/** The hinge of a pair of lids: the eye's side and up tipped by `slant` radians (positive raises the side's own end). As face_parts.ts has it. */
function lidHinge(axes: { readonly side: P3; readonly up: P3 }, slant: F): { readonly side: P3; readonly up: P3 } {
  return { side: add(mul(axes.side, cos(slant)), mul(axes.up, sin(slant))), up: sub(mul(axes.up, cos(slant)), mul(axes.side, sin(slant))) };
}

export type StalkEyeSpec = {
  /** Names the parts (`stalk<tag>`, `eye<tag>`, `lid<tag>`, `cheek<tag>`) and, with `prefix`, the per-frame tables. */
  readonly tag: string; readonly prefix: string;
  /** The stalk: its bent spine (its bends already once-a-frame values), its radius at root and tip, its paint over
   * (m, v), and how much a shortened stalk may thicken (the strand's `bulge`). */
  readonly stalk: { readonly bent: Bent; readonly girth: readonly [number, number]; readonly paint: (m: F, v: F) => P3; readonly bulge?: number };
  /** The eyeball's radius, times `swell` now. */
  readonly radius: number; readonly swell: F;
  /** Where the ball's middle is: the stalk's tip plus `hang` radii along the stalk's heading there (0: on the tip). */
  readonly hang: number;
  /** The up the socket's lids are hinged against, and the look from the ball's middle: where the socket faces (unit) and
   * where the pupil's middle is on the front cap (across toward the socket's right, and up; shares of the radius). `look`
   * is called once, with the middle as a once-a-frame value (see `lookOf`). */
  readonly up: P3; readonly look: (middle: P3) => Look;
  /** The pupil's radius, a share of the eye's. */
  readonly pupil: F;
  /** Inks: the white, the pupil, the ball's back; `glint` the highlight's size as a share of the pupil (0 for a dull eye);
   * `ring` a line round the eye's rim as a share of the radius (0 for none). */
  readonly ink: { readonly white: V3; readonly pupil: V3; readonly back: V3; readonly glint: number; readonly ring: number };
  /** The lids: how far each has come over the eye (radians from the eye's top, or bottom, toward its front: pi / 2 is
   * the middle line), the lid line's slant (radians, positive raises the socket's right corner), and their paint by
   * radians back from the lid's edge. */
  readonly lids: { readonly upper: F; readonly lower: F; readonly slant: F; readonly ink: (edge: F) => P3 };
  /**
   * What the marks are measured on, where that is not what is drawn: the stalk, the look and the lids as the expression
   * alone poses them (no swing, no wandering, no blink). A stalk that swings like a pendulum or an eye that wanders moves its marks by more than an expression
   * does, and `expressionsRead` would then tell two expressions apart by where the swing happened to be. Left out, the
   * marks are the drawn stalk's and the drawn look's.
   */
  readonly posed?: { readonly bent: Bent; readonly look: (middle: P3) => Look; readonly upper: F; readonly lower: F };
};

/** A look: where the socket faces (unit), and the pupil's middle on its front cap. */
export type Look = { readonly front: P3; readonly gaze: readonly [F, F] };

export type StalkEye = {
  readonly things: readonly Drawable[];
  /** The eyeball: what `minScreenSize` measures. */
  readonly ball: Strand;
  /** The ball's middle, world. */
  readonly middle: P3;
  /** The drawn vectors a viewer compares, for `expressionsRead`: stalk, upper, lower, pupil, corner (each `<name><tag>`). */
  readonly marks: Readonly<Record<string, Mark>>;
  /** The eye's width across the socket: a reference length for `expressionsRead`. */
  readonly width: Mark;
};

/** A lid's least angle is the caller's; behind the eye's top it always reaches this far back, radians. */
const LID_BACK = -0.4;

export function stalkEye(e: StalkEyeSpec): StalkEye {
  const tabF = (name: string, x: F): F => tabulate(`${e.prefix}_${e.tag}_${name}`, () => x, 2, "frame")(0) as F;
  const tabV = (name: string, x: P3): P3 => tabulate(`${e.prefix}_${e.tag}_${name}`, () => x, 2, "frame")(0) as P3;
  const R = e.radius, b = e.stalk.bent;
  const swell = tabF("swell", e.swell);
  const middle = tabV("middle", add(b.tip, mul(b.tipHeading, mul(swell, R * e.hang))));
  const look = e.look(middle);
  const front = tabV("front", look.front);
  const side0 = unit(cross(front, e.up)), up0 = cross(side0, front);
  const gx = tabF("gx", look.gaze[0]), gy = tabF("gy", look.gaze[1]), pupilR = tabF("pupil", e.pupil);
  const upper = tabF("upper", e.lids.upper), lower = tabF("lower", e.lids.lower), slant = tabF("slant", e.lids.slant);
  // The lids' hinge, tipped by the slant.
  const { side, up } = lidHinge({ side: side0, up: up0 }, slant);

  const stalk = strand({
    name: `stalk${e.tag}`, spine: (m) => b.spine(m), stations: 8,
    girth: (m) => mix(e.stalk.girth[0], e.stalk.girth[1], m), tips: ["open", "round"], detail: { along: 22, around: 10 },
    bulge: e.stalk.bulge ?? 1.5, paint: e.stalk.paint,
  });
  // The ball is built round its own origin, facing its own x, and placed in the socket's frame at its size now: a spine
  // that itself grew would be thinned by the strand's volume keeping (stretch is measured on the local spine).
  const ball = place(strand({
    name: `eye${e.tag}`, spine: (m) => vec3(mul(sub(m, 0.5), R * 2), 0, 0), stations: 4, girth: () => mul(swell, R),
    tips: [{ round: 0.5 }, { round: 0.5 }], up: [0, 1, 0], detail: { along: 18, around: 24 },
    paint: (m, v) => {
      // The front cap's own coordinates: across (toward the socket's right) and up, each -1 to 1.
      const z = sub(mul(m, 2), 1), r = sqrt(max(sub(1, mul(z, z)), 0));
      const x = mul(r, cos(mul(v, TAU))), y = mul(r, sin(mul(v, TAU)));
      const d = length(vec2(sub(x, gx), sub(y, gy))), onFront = cut(m, 0.5);
      const pupil = mul(cut(sub(pupilR, d), 0), onFront);
      const glint = mul(cut(sub(mul(pupilR, e.ink.glint), length(vec2(sub(x, sub(gx, mul(pupilR, 0.35))), sub(y, add(gy, mul(pupilR, 0.45)))))), 0), onFront);
      const rim = e.ink.ring > 0 ? mul(cut(r, 1 - e.ink.ring), onFront) : 0;
      const white = mix(mix(mix(vec3(...e.ink.white), vec3(...e.ink.pupil), pupil), vec3(...e.ink.white), glint), vec3(...e.ink.pupil), rim);
      // Dark behind: the white is a socket's opening, so from the side and from behind it reads as an eye facing away.
      return mix(vec3(...e.ink.back), white, cut(m, 0.36));
    },
  }), sized(rigid({ o: middle, x: front, y: up0, z: side0 }), vec3(swell, swell, swell)));
  // A lid: a spherical lune hinged on the eye's corners, from behind the eye's top (or bottom) forward to `angle`.
  const lid = (name: string, angle: F, from: 1 | -1, radius: number) => draw.surface(name, surface((u, v) => {
    const a = mix(LID_BACK, angle, u), c = mix(0.1, Math.PI - 0.1, v);
    const ringAt = add(mul(up, mul(cos(a), from)), mul(front, sin(a)));
    return add(middle, mul(add(mul(side, cos(c)), mul(ringAt, sin(c))), mul(swell, radius)));
  }, { u: ["free", "free"], v: "free" }), {
    paint: (u) => e.lids.ink(mul(sub(1, u), sub(angle, LID_BACK))), grid: { u: spacing.even(10), v: spacing.even(14) }, sides: "two", outline: "border",
  });
  const on = (dir: P3): P3 => add(middle, mul(dir, R));
  // The pupil's mark: from the eye's middle to the pupil's place on the ball, for a look.
  const pupilMark = (from: P3, k: Look): Mark => {
    const s0 = unit(cross(k.front, e.up)), u0 = cross(s0, k.front), [x, y] = k.gaze;
    return { from, to: add(from, mul(add(add(mul(s0, x), mul(u0, y)), mul(k.front, sqrt(max(sub(1, add(mul(x, x), mul(y, y))), 0)))), R)) };
  };
  const posedMiddle = e.posed === undefined ? middle : add(e.posed.bent.tip, mul(e.posed.bent.tipHeading, mul(swell, R * e.hang)));
  const markUpper = e.posed?.upper ?? upper, markLower = e.posed?.lower ?? lower;
  const marks: Record<string, Mark> = {
    [`stalk${e.tag}`]: e.posed === undefined ? { from: b.spine(0), to: middle } : { from: e.posed.bent.spine(0), to: posedMiddle },
    [`upper${e.tag}`]: { from: middle, to: on(add(mul(up, cos(markUpper)), mul(front, sin(markUpper)))) },
    [`lower${e.tag}`]: { from: middle, to: on(add(mul(up, mul(cos(markLower), -1)), mul(front, sin(markLower)))) },
    [`pupil${e.tag}`]: e.posed === undefined ? pupilMark(middle, { front, gaze: [gx, gy] }) : pupilMark(posedMiddle, e.posed.look(posedMiddle)),
    [`corner${e.tag}`]: { from: middle, to: on(side) },
  };
  return {
    ball, middle, marks, width: { from: on(mul(side0, -1)), to: on(side0) },
    things: [stalk, ball, lid(`cheek${e.tag}`, lower, -1, R * 1.07), lid(`lid${e.tag}`, upper, 1, R * 1.12)],
  };
}

/**
 * The socket's facing and the pupil's slide for a look at `target`. The socket faces its `audience`, `below` lower (the
 * sine of the angle: an eye squarely on a camera high above shows the lower cameras its underside); it turns `turn` of
 * the way from there to the look and the pupil slides the rest, `slide` of the radius when the look is square to the
 * socket (titan/face/dandy.ts: a high camera sees white, pupil and where it looks only if the eye does not turn all the
 * way). The audience is a place in the world, so a creature that is placed and turned still plays to it.
 */
export function lookOf(o: { readonly from: P3; readonly audience: P3; readonly below: number; readonly target: P3; readonly up: P3; readonly turn: number; readonly slide: number }): Look {
  const look = unit(sub(o.target, o.from));
  const facing = unit(sub(unit(sub(o.audience, o.from)), mul(o.up, o.below)));
  const front = unit(mix(facing, look, o.turn));
  const side0 = unit(cross(front, o.up)), up0 = cross(side0, front);
  return { front, gaze: [mul(dot(look, side0), o.slide), mul(dot(look, up0), o.slide)] };
}

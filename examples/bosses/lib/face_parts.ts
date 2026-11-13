// RECIPE: parts of a face, for any creature with a head. Copy this file and edit it; it imports only the library's
// public entry. First used by the Reefback Titan's `brow` face (titan/face/brow.ts; docs/art_direction/DIRECTION.md, Round 4).
//
// What it makes, and from what. Each part takes world points and directions as closed forms and plain inks, and knows
// nothing of the creature it is on:
// - `dome`: a head mass. A superellipsoid |x|^p + |y|^p + |z|^p = 1 (a `surface` with poles at the head's sides, `framed`
//   in the head's frame) with a height field of relief on its front (sockets, a muzzle, cheeks, a mouth that deepens)
//   and paint in the same face coordinates, so features are placed once and both follow. It gives back `skin(X, Y)`, the
//   point of its surface at a face coordinate, for whatever rides it.
// - `eyeball` and `lid`: a sphere (a four-station `strand`) whose iris slides over its front, and a spherical lune (a
//   `surface`) hinged on the eye's corners.
// - `gazeOf`: where the iris sits for a look, true while the look is in front of the eye and held at the rim past that,
//   so an eye sunk in a head still shows iris and pupil when its target is behind its ear.
// - `hoodBrow`: a brow half that rides the eye's own sphere (a `strand` through three points on it), from raised clear
//   of it to clamped down over it.
// - `tusk` and `handlebar`: a mandible and half a moustache; each is a shape with numbers (see each).
// - marks: `crisp`, `bump`, `ell`, `inkLine`, `inked`: edges and lines in paint and relief.
// Face coordinates are a picture's: X to the viewer's right, Y up the face, Z out of it toward the viewer (a
// right-handed frame, which a one-sided surface needs: mirrored, its front faces would be drawn as backs).
//
// Parameters. Points, directions, angles and the relief and paint functions take expressions, so everything can move
// in time; the dome's radii (but `down`, an expression so a jaw can drop), power and cell counts are numbers.
//
// What it cannot do:
// - a head that is not one superellipsoid: no snout that leaves the mass, no overhanging brow ridge in the relief
//   (relief is a height along Z, so it cannot undercut), nothing behind the face's front half;
// - an eye that is not a sphere, or a lid that is not a lune of a sphere round it (no slit pupils' lids, no cat's
//   third lid); an iris that is not a disc;
// - a brow that leaves its eye's sphere.
//
// Copying it: change the dome's `relief` and `paint` first (they are the face); then the eye's inks and `gazeOf`'s reach.
// Relatives worth trying: a dome with power below 2 is a star-shaped, pinched mass (a lizard's head); relief as a sum of
// `bump`s along a curve is a ridge or a scar; a lid with a second hinge angle is a squint.

import {
  abs, add, cos, div, dot, draw, framed, spiralTube, length, lift, lt, max, mix, mul, place, pow, rigid, rotateAbout, select, sin, smoothstep,
  spacing, sqrt, strand, sub, surface, through, TAU, vec2, vec3, edgeOf, type Drawable, type F, type Frame, type In, type P3, type Sampling, type Strand,
} from "../../../src/index.ts";

export type Ink = readonly [number, number, number];
type S = In<"f32">;

// ---- marks in paint and relief ----

/** A crisp ink edge: 1 where x is above `at`, about a pixel wide. Paint only (it takes a screen derivative). */
export const crisp = (x: F, at: number | F): F => edgeOf(x, at, 1e-5);
/** A smooth bump: 1 at distance 0, 0 from distance 1. For relief and for paint. */
export const bump = (d: F): F => sub(1, smoothstep(0, 1, d));
/** Elliptic distance from (cx, cy) with radii (rx, ry): 1 on the ellipse. */
export const ell = (x: F, y: F, cx: S, cy: S, rx: S, ry: S): F => length(vec2(div(sub(x, cx), rx), div(sub(y, cy), ry)));
/** Paint: an ink line of half-width w along the zero set of d. */
export const inkLine = (d: F, w: number | F): F => sub(1, crisp(abs(d), w));
/** Paint: 1 where d is below 0, with a crisp edge. */
export const inked = (d: F): F => sub(1, crisp(d, 0));

// ---- the head ----

export type DomeSpec = {
  readonly name: string;
  /** Where it stands: x to the viewer's right, y up the face, z out of it (right-handed, unit). */
  readonly frame: Frame;
  /** World units per unit of its own coordinates: radii, relief and `skin` are all in its own. */
  readonly scale: number;
  /** Half-sizes: across; up and down from the middle (a jaw that drops lengthens `down`); out of the face (and behind it). */
  readonly radii: { readonly across: number; readonly up: number; readonly down: S; readonly out: number };
  /** The superellipse's exponent: 2 an ellipsoid, 3 a boxier, heavier mass. */
  readonly power: number;
  /** Height out of the face over face coordinates (world units), on the front half. Geometry: `smoothstep`, never `crisp`. */
  readonly relief: (X: F, Y: F) => F;
  /** Paint over face coordinates; `front` is 1 on the face and 0 round the back. */
  readonly paint: (X: F, Y: F, front: F) => P3;
  /** Cells across (pole to pole) and round; the round ones crowd toward the face by `crowd` (0 even, below 1). */
  readonly detail: { readonly across: number; readonly around: number; readonly crowd?: number };
};
export type Dome = {
  readonly thing: Drawable;
  /** The skin at a face coordinate, `proud` above it, in the dome's own coordinates. */
  readonly skin: (X: S, Y: S, proud?: S) => P3;
  /** A point of the dome's own coordinates in the world. */
  readonly world: (p: In<"vec3">) => P3;
  /** A direction of the dome's own coordinates in the world. */
  readonly turned: (d: In<"vec3">) => P3;
};

export function dome(spec: DomeSpec): Dome {
  const { across, up, out } = spec.radii, down = lift<"f32">(spec.radii.down), p = spec.power, g = spec.frame;
  if (!(p >= 2)) throw new Error(`dome "${spec.name}": power must be at least 2 (an ellipsoid), got ${p}`);
  const tall = (ys: F): F => select(lt(ys, 0), down, up);
  // The sphere's poles are at the head's two sides (u = 0 the viewer's left), so the face is clear of them; v = 0 is
  // the middle of the face and runs up over the crown. Each direction is carried out to the superquadric
  // |x|^p + |y|^p + |z|^p = 1, then scaled by the radii.
  const faceOf = (u: F, v: F) => {
    const x = mul(cos(mul(u, Math.PI)), -1), r = sin(mul(u, Math.PI)), y = mul(r, sin(mul(v, TAU))), z = mul(r, cos(mul(v, TAU)));
    const k = pow(add(add(pow(abs(x), p), pow(abs(y), p)), pow(abs(z), p)), -1 / p);
    const ys = mul(y, k), zs = mul(z, k);
    return { X: mul(mul(x, k), across), Y: mul(ys, tall(ys)), zs, front: smoothstep(0.05, 0.45, zs) };
  };
  const point = (u: F, v: F): P3 => {
    const f = faceOf(u, v);
    return vec3(f.X, f.Y, add(mul(f.zs, out), mul(spec.relief(f.X, f.Y), f.front)));
  };
  const skin = (X: S, Y: S, proud: S = 0): P3 => {
    const x = lift<"f32">(X), y = lift<"f32">(Y);
    const zs = pow(max(sub(sub(1, pow(div(abs(x), across), p)), pow(div(abs(y), tall(y)), p)), 0), 1 / p);
    return vec3(x, y, add(add(mul(zs, out), mul(spec.relief(x, y), smoothstep(0.05, 0.45, zs))), proud));
  };
  const turned = (d: In<"vec3">): P3 => { const q = lift<"vec3">(d); return add(add(mul(g.x, q.x), mul(g.y, q.y)), mul(g.z, q.z)); };
  const k = spec.detail.crowd ?? 0;
  if (!(k >= 0 && k < 1)) throw new Error(`dome "${spec.name}": crowd must be in [0, 1), got ${k}`);
  // v from -0.5 to 0.5 with the seam at the back of the head; the cells are 1 - crowd of their even width at the face.
  const round: Sampling = { count: spec.detail.around, at: (s) => add(sub(s, 0.5), mul(sin(mul(s, TAU)), k / TAU)) };
  const shape = framed(surface(point, { u: ["pole", "pole"], v: "periodic" }), { frame: g, scale: lift<"f32">(spec.scale) });
  const thing = draw.surface(spec.name, shape, {
    paint: (u, v) => { const f = faceOf(u, v); return spec.paint(f.X, f.Y, f.front); },
    grid: { u: spacing.even(spec.detail.across), v: round }, sides: "one", outline: "hull",
  });
  return { thing, skin, world: (q) => add(g.o, mul(turned(q), spec.scale)), turned };
}

// ---- the eye ----

/** An eye's own axes (world, unit, at right angles): where it faces, its right as its owner sees it, its up. */
export type EyeAxes = { readonly front: P3; readonly side: P3; readonly up: P3 };

/**
 * Where the iris sits on the eye's front for a look along `look` (a unit world direction): across and up, as shares of
 * the eye's radius. While the look is within `reach` of the eye's own facing the iris is truly under it; past that it
 * is held at `reach`, on the side the look is on. So an eye that cannot turn in its socket rolls to its corner and
 * stops there, still showing iris and pupil, however far round its target goes.
 */
export function gazeOf(look: P3, axes: EyeAxes, reach: number): { readonly x: F; readonly y: F } {
  const x = dot(look, axes.side), y = dot(look, axes.up);
  const k = div(reach, max(length(vec2(x, y)), reach));
  return { x: mul(x, k), y: mul(y, k) };
}

export type EyeballSpec = {
  readonly name: string;
  readonly centre: P3; readonly axes: EyeAxes; readonly radius: number;
  /** Where the iris sits (`gazeOf`), its radius and the pupil's, as shares of the eye's radius. */
  readonly gaze: { readonly x: F; readonly y: F }; readonly iris: number; readonly pupil: S;
  readonly inks: { readonly white: Ink; readonly iris: Ink; readonly pupil: Ink; readonly back: Ink };
  readonly detail?: { readonly along: number; readonly around: number };
};

/** The ball: white on its front with a ringed iris, a pupil and a glint; `back` behind (it is a socket's lining there). */
export function eyeball(e: EyeballSpec): Strand {
  const R = e.radius, I = e.inks, pupil = lift<"f32">(e.pupil);
  return strand({
    name: e.name, spine: (m) => add(e.centre, mul(e.axes.front, mul(sub(m, 0.5), R * 2))), stations: 4, girth: R,
    tips: [{ round: 0.5 }, { round: 0.5 }], up: e.axes.up, detail: e.detail ?? { along: 18, around: 24 },
    paint: (m, v) => {
      // The front cap's own coordinates: across (toward `side`) and up, each -1 to 1.
      const z = sub(mul(m, 2), 1), r = sqrt(max(sub(1, mul(z, z)), 0));
      const x = mul(r, cos(mul(v, TAU))), y = mul(r, sin(mul(v, TAU)));
      const d = length(vec2(sub(x, e.gaze.x), sub(y, e.gaze.y))), onFront = crisp(m, 0.5);
      const iris = mul(crisp(sub(e.iris, d), 0), onFront), ring = mul(sub(1, crisp(abs(sub(d, e.iris)), 0.045)), onFront);
      const dark = mul(crisp(sub(pupil, d), 0), onFront);
      const glint = mul(crisp(sub(mul(pupil, 0.32), length(vec2(sub(x, sub(e.gaze.x, mul(pupil, 0.35))), sub(y, add(e.gaze.y, mul(pupil, 0.45)))))), 0), onFront);
      const white = mix(mix(mix(mix(vec3(...I.white), vec3(...I.iris), iris), vec3(...I.pupil), ring), vec3(...I.pupil), dark), vec3(...I.white), glint);
      return mix(vec3(...I.back), white, crisp(m, 0.36));
    },
  });
}

/** The hinge of a pair of lids: the eye's side and up tipped by `slant` radians (positive raises the side's own end). */
export function lidHinge(axes: EyeAxes, slant: S): { readonly side: P3; readonly up: P3 } {
  return { side: add(mul(axes.side, cos(slant)), mul(axes.up, sin(slant))), up: sub(mul(axes.up, cos(slant)), mul(axes.side, sin(slant))) };
}

/**
 * A lid: a spherical lune hinged on the eye's corners, from behind the eye's top (`from` 1) or bottom (-1) forward to
 * `angle` radians (pi / 2 is the eye's middle line). `paint` is given radians back from the lid's edge.
 */
export function lid(o: {
  readonly name: string; readonly centre: P3; readonly front: P3; readonly hinge: { readonly side: P3; readonly up: P3 };
  readonly radius: number; readonly angle: F; readonly from: 1 | -1; readonly paint: (edge: F) => P3;
}): Drawable {
  const BACK = -0.4;
  return draw.surface(o.name, surface((u, v) => {
    const a = mix(BACK, o.angle, u), b = mix(0.1, Math.PI - 0.1, v);
    const ringAt = add(mul(o.hinge.up, mul(cos(a), o.from)), mul(o.front, sin(a)));
    return add(o.centre, mul(add(mul(o.hinge.side, cos(b)), mul(ringAt, sin(b))), o.radius));
  }, { u: ["free", "free"], v: "free" }), {
    paint: (u) => o.paint(mul(sub(1, u), sub(o.angle, BACK))), grid: { u: spacing.even(10), v: spacing.even(14) }, sides: "two", outline: "border",
  });
}

// ---- the brow ----

/**
 * A point on the sphere of radius `radius` round an eye: `along` radians round toward the eye's side (negative the
 * other way), `over` radians from straight above the eye forward toward its front.
 */
export const overEye = (centre: P3, axes: EyeAxes, radius: S, along: S, over: S): P3 =>
  add(centre, mul(add(mul(add(mul(axes.up, cos(over)), mul(axes.front, sin(over))), cos(along)), mul(axes.side, sin(along))), radius));

export type HoodBrowSpec = {
  readonly name: string;
  readonly centre: P3; readonly axes: EyeAxes;
  /** The radius of the sphere the brow's middle line rides (the eye's, plus its lid, plus half the brow's own depth). */
  readonly radius: number;
  /** Radians round the eye to the brow's two ends: the first is its thick end (by the nose). */
  readonly span: readonly [number, number];
  /** Radians from above the eye forward, at the thick end, the middle and the thin end: 0 raised clear, pi / 2 across the eye's middle. */
  readonly over: readonly [F, F, F];
  /** Half-width of the bar (up and down the eye's face) at the thick and thin ends, and its depth as a share of that. */
  readonly girth: readonly [number, number]; readonly depth: number;
  readonly paint: (m: F, v: F) => P3;
};

/** A brow half that rides its eye: a thick bar whose middle line is on a sphere round the eye, lowered by turning it forward about the eye. */
export function hoodBrow(b: HoodBrowSpec): { readonly strand: Strand; readonly ends: readonly [P3, P3, P3] } {
  const mid = (b.span[0] + b.span[1]) / 2;
  const ends = [overEye(b.centre, b.axes, b.radius, b.span[0], b.over[0]), overEye(b.centre, b.axes, b.radius, mid, b.over[1]), overEye(b.centre, b.axes, b.radius, b.span[1], b.over[2])] as const;
  const s = strand({
    name: b.name, spine: (m) => through(m, [...ends]), stations: 8,
    girth: (m) => mix(b.girth[0], b.girth[1], m), section: { aspect: b.depth, squareness: 2.5 }, tips: [{ round: 0.14 }, { round: 0.2 }],
    // Its broad side faces the way the eye does, wherever on the sphere it rides: raised, it stands over the eye as a
    // bar seen whole from in front (riding the sphere's own slope it would show a viewer in front only its edge).
    up: b.axes.front, paint: b.paint, detail: { along: 20, around: 12 }, bulge: 1.2,
  });
  return { strand: s, ends };
}

// ---- the mouth ----

/**
 * A tusk is a flat plate: a `strand` on the straight line from `hinge` to `tip`, bowed 4 m (1 - m) `bow` along `face`,
 * section aspect `flat`, squareness 2.6 (a mandible, a tooth, a horn laid flat). `girth` its half-width along it, `flat`
 * its depth as a share, `face` the way its broad side looks.
 */
export function tusk(o: {
  readonly name: string; readonly hinge: P3; readonly tip: P3; readonly girth: (m: F) => F; readonly flat: number; readonly face: P3;
  /** How far its middle bows out along `face`, world units. */
  readonly bow?: S;
  readonly paint: (m: F, v: F) => P3;
}): Strand {
  const bow = lift<"f32">(o.bow ?? 0);
  return strand({
    name: o.name, spine: (m) => add(mix(o.hinge, o.tip, m), mul(o.face, mul(bow, mul(mul(m, sub(1, m)), 4)))), stations: 6,
    girth: o.girth, section: { aspect: o.flat, squareness: 2.6 }, tips: [{ round: 0.1 }, { round: 0.3 }], up: o.face,
    paint: o.paint, detail: { along: 12, around: 14 },
  });
}

/**
 * A handlebar is a `spiralTube` (curl 1.9, taper 0.3, out [0.25, -droop, side]) placed in `frame` turned by `lift`.
 *
 * Half a handlebar moustache: a curled horn from `root` out to one side (`side` 1 the frame's +z) that curls up at its
 * end. `frame` is where it is worn (x out of the face, y up it, z across); `lift` radians raise the half (a grin),
 * negative lets it droop.
 */
export function handlebar(o: {
  readonly name: string; readonly root: P3; readonly frame: { readonly x: P3; readonly y: P3; readonly z: P3 }; readonly side: 1 | -1;
  readonly lift: F; readonly length: number; readonly girth: number; readonly ink: Ink;
  /** How far it sags as it leaves the root, as a share of its way out (the dandy's is 0.1; 0.4 hangs under a pair of eyes). */
  readonly droop: number;
}): Strand {
  // About the frame's x, a positive turn takes +z toward -y: each side lifts by turning the other way.
  const y = rotateAbout(o.frame.y, o.frame.x, mul(o.lift, -o.side)), z = rotateAbout(o.frame.z, o.frame.x, mul(o.lift, -o.side));
  return place(spiralTube({
    name: o.name, length: o.length, curl: 1.9, taper: 0.3, girth: o.girth, out: [0.25, -o.droop, o.side], toward: [0, 1, 0],
    paint: () => vec3(...o.ink), detail: { along: 16, around: 6 },
  }), rigid({ o: o.root, x: o.frame.x, y, z }));
}

/** The dome's surface without its relief, in plain numbers: how far out of the face it stands at a face coordinate. */
export function shellOut(radii: { readonly across: number; readonly up: number; readonly down: number; readonly out: number }, power: number, X: number, Y: number): number {
  const ys = Y / (Y < 0 ? radii.down : radii.up);
  return radii.out * Math.max(1 - Math.abs(X / radii.across) ** power - Math.abs(ys) ** power, 0) ** (1 / power);
}

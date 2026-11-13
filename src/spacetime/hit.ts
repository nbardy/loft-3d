// The simulation's hit shapes on the water (DESIGN.md 8). The game's simulation owns gameplay: for each attack it
// supplies a shape in the sea's xz plane, and everything Loft draws or checks about the attack is derived from that one
// shape. Every field is an expression, so a game drives them through host inputs.
//
// Each kind has one handler per question: its signed distance (negative inside, the same expression the telegraph
// draws and the checks evaluate on the CPU), the patch of the plane it is drawn on, and its contour coordinate (where a
// point sits along the nearest edge, in teeth, for markers whose motif runs round the edge).
//
// The plane is (x, z), held in a vec2 as (x, y). Angles run from +x toward +z.

import {
  abs, add, atan2, clamp, cos, div, dot, floor, length, lift, max, min, mix, mul, normalize, round, select, sin, sub,
  TAU, vec2, lt, type Expr, type In,
} from "../expr.ts";
import { sdSegment } from "../lib/sdf2.ts";

type F = Expr<"f32">;
type V2 = Expr<"vec2">;

/** A capsule: the segment a to b, widened by `radius` (a lunge's lane). */
export type Capsule = { readonly kind: "capsule"; readonly a: V2; readonly b: V2; readonly radius: F };
/** A disc (a slam). */
export type Disc = { readonly kind: "disc"; readonly centre: V2; readonly radius: F };
/**
 * An annular sector (a sweep): radii `inner` to `outer` round `centre`, angles `from` to `to` (radians, from < to,
 * at most a half turn apart).
 */
export type Arc = { readonly kind: "arc"; readonly centre: V2; readonly inner: F; readonly outer: F; readonly from: F; readonly to: F };
export type Hit = Capsule | Disc | Arc;

/**
 * The hit shapes an attack is aimed by, made from the game's numbers: `hit.capsule({ a, b, radius })` (a lane),
 * `hit.disc({ centre, radius })` (a slam) and `hit.arc({ centre, inner, outer, from, to })` (a sweep), all on the
 * ground's (x, z) plane.
 *
 * The law: one shape per attack, and everything Loft draws or checks about the attack (the pose's landing, the
 * telegraph, `landsInside`) is derived from it by its signed distance (`hitSdf`), negative inside, the same expression
 * on the GPU and in the checks.
 *
 * Parameters: every field takes a number, an expression or a host input, so a game moves its shapes and the attack
 * follows. Angles run from +x toward +z; an arc's `from` is below its `to`, at most a half turn apart (not checked).
 *
 * What it cannot do, because of the law:
 * - any shape but these three: no box, no cone wider than a half turn, no full ring, no polygon.
 * - a union: one shape per attack (two lanes are two attacks).
 * - height or volume: a shape lies on the plane; what stands up is a `Target`, measured by checks, not a hit.
 *
 * Going past it: a new kind is a variant of `Hit` with its three handlers (signed distance, drawing patch, contour
 * coordinate) in src/spacetime/hit.ts. Relatives worth trying, each a signed distance in the plane:
 * - a box: the distance to a rotated rectangle, max(|x| - w, |z| - h) inside and the corner distance outside.
 * - a full ring (a shockwave all round): |length(p - c) - mid| - half.
 * - a cone from a point: an arc with `inner` 0 (already possible, up to a half turn).
 */
export const hit = {
  /** A lane: the segment `a` to `b` on the plane (x, z), widened by `radius`. A lunge lands at its far end. */
  capsule: (o: { readonly a: In<"vec2">; readonly b: In<"vec2">; readonly radius: In<"f32"> }): Capsule =>
    ({ kind: "capsule", a: lift<"vec2">(o.a), b: lift<"vec2">(o.b), radius: lift<"f32">(o.radius) }),
  /** A disc of `radius` round `centre` on the plane (x, z). A lunge lands at its centre; a ring aftermath leaves its edge. */
  disc: (o: { readonly centre: In<"vec2">; readonly radius: In<"f32"> }): Disc =>
    ({ kind: "disc", centre: lift<"vec2">(o.centre), radius: lift<"f32">(o.radius) }),
  /** An annular sector round `centre`: radii `inner` to `outer`, angles `from` to `to` (radians, +x toward +z, at most a half turn). */
  arc: (o: { readonly centre: In<"vec2">; readonly inner: In<"f32">; readonly outer: In<"f32">; readonly from: In<"f32">; readonly to: In<"f32"> }): Arc =>
    ({ kind: "arc", centre: lift<"vec2">(o.centre), inner: lift<"f32">(o.inner), outer: lift<"f32">(o.outer), from: lift<"f32">(o.from), to: lift<"f32">(o.to) }),
};

/** Where a point is relative to the nearest edge: signed distance, position along the edge in teeth, world length of one tooth. */
export type Contour = { readonly d: F; readonly phase: F; readonly pitch: F };

/** Unit vector at angle a in the plane. */
export const polar = (a: In<"f32">): V2 => vec2(cos(a), sin(a));
/** Teeth on an edge of this length, about `spacing` apart: a whole number, at least one, so pieces meet at tooth boundaries. */
const teethOn = (len: F, spacing: F): F => max(round(div(len, spacing)), 1);

// ---- capsule ------------------------------------------------------------------------------------------------------

type CapsuleFrame = { readonly axis: V2; readonly side: V2; readonly len: F; readonly x: F; readonly y: F };
function capsuleFrame(h: Capsule, p: V2): CapsuleFrame {
  const ab = sub(h.b, h.a), len = max(length(ab), 1e-6);
  const axis = div(ab, len), side = vec2(mul(axis.y, -1), axis.x);
  const q = sub(p, h.a);
  return { axis, side, len, x: dot(q, axis), y: dot(q, side) };
}
const capsule = {
  sdf: (h: Capsule, p: V2): F => sub(sdSegment(p, h.a, h.b), h.radius),
  patch: (h: Capsule, u: F, v: F, pad: F): V2 => {
    const f = capsuleFrame(h, h.a), r = add(h.radius, pad);
    return add(h.a, add(mul(f.axis, mix(mul(r, -1), add(f.len, r), u)), mul(f.side, mix(mul(r, -1), r, v))));
  },
  contour: (h: Capsule, p: V2, spacing: F): Contour => {
    const f = capsuleFrame(h, p);
    const nSide = teethOn(f.len, spacing), nCap = teethOn(mul(h.radius, Math.PI), spacing);
    // Along a side: x over the length. Round a cap: the angle from the side edge (the two caps mirror).
    const beyond = select(lt(f.x, 0), mul(f.x, -1), sub(f.x, f.len));
    const capAngle = add(atan2(f.y, beyond), Math.PI / 2);
    const onSide = lt(abs(sub(f.x, mul(f.len, 0.5))), mul(f.len, 0.5));
    return {
      d: capsule.sdf(h, p),
      phase: select(onSide, mul(div(f.x, f.len), nSide), mul(div(capAngle, Math.PI), nCap)),
      pitch: select(onSide, div(f.len, nSide), div(mul(h.radius, Math.PI), nCap)),
    };
  },
};

// ---- disc ---------------------------------------------------------------------------------------------------------

const disc = {
  sdf: (h: Disc, p: V2): F => sub(length(sub(p, h.centre)), h.radius),
  patch: (h: Disc, u: F, v: F, pad: F): V2 => {
    const r = add(h.radius, pad);
    return add(h.centre, vec2(mix(mul(r, -1), r, u), mix(mul(r, -1), r, v)));
  },
  contour: (h: Disc, p: V2, spacing: F): Contour => {
    const q = sub(p, h.centre), n = teethOn(mul(h.radius, TAU), spacing);
    return { d: disc.sdf(h, p), phase: mul(add(div(atan2(q.y, q.x), TAU), 0.5), n), pitch: div(mul(h.radius, TAU), n) };
  },
};

// ---- arc ----------------------------------------------------------------------------------------------------------

type ArcFrame = { readonly rho: F; readonly delta: F; readonly half: F; readonly toOuter: F; readonly toInner: F; readonly toEnd: F };
/** Polar coordinates about the centre with the angle measured from the sector's middle, and distances to each edge from inside. */
function arcFrame(h: Arc, p: V2): ArcFrame {
  const q = sub(p, h.centre), rho = length(q);
  const mid = mul(add(h.from, h.to), 0.5), half = mul(sub(h.to, h.from), 0.5);
  const raw = sub(atan2(q.y, q.x), mid);
  const delta = sub(raw, mul(floor(div(add(raw, Math.PI), TAU)), TAU));
  // From inside, the end edge (a radius at angle +-half) is rho sin(gap) away while the gap is under a quarter turn.
  const toEnd = mul(rho, sin(clamp(sub(half, abs(delta)), 0, Math.PI / 2)));
  return { rho, delta, half, toOuter: sub(h.outer, rho), toInner: sub(rho, h.inner), toEnd };
}
const arc = {
  sdf: (h: Arc, p: V2): F => {
    const f = arcFrame(h, p);
    const within = max(max(mul(f.toOuter, -1), mul(f.toInner, -1)), mul(f.toEnd, -1));
    // Past an end (by angle): the distance to that end's radial segment, exact for any sector up to a half turn.
    const folded = mul(polar(abs(f.delta)), f.rho);
    const end = sdSegment(folded, mul(polar(f.half), h.inner), mul(polar(f.half), h.outer));
    return select(lt(abs(f.delta), f.half), within, end);
  },
  patch: (h: Arc, u: F, v: F, pad: F): V2 => {
    // A polar patch: just the sector, padded, so a narrow sweep costs only its own pixels.
    const angularPad = min(div(pad, max(h.inner, 0.25)), Math.PI / 4);
    const a = mix(sub(h.from, angularPad), add(h.to, angularPad), u);
    const r = mix(max(sub(h.inner, pad), 0), add(h.outer, pad), v);
    return add(h.centre, mul(polar(a), r));
  },
  contour: (h: Arc, p: V2, spacing: F): Contour => {
    const f = arcFrame(h, p);
    const span = mul(f.half, 2), depth = sub(h.outer, h.inner);
    const nOuter = teethOn(mul(span, h.outer), spacing), nInner = teethOn(mul(span, h.inner), spacing), nEnd = teethOn(depth, spacing);
    const along = div(add(f.delta, f.half), span);
    const nearest = min(min(abs(f.toOuter), abs(f.toInner)), abs(f.toEnd));
    const onOuter = lt(abs(f.toOuter), add(nearest, 1e-6)), onInner = lt(abs(f.toInner), add(nearest, 1e-6));
    const endPhase = mul(div(sub(f.rho, h.inner), depth), nEnd);
    return {
      d: arc.sdf(h, p),
      phase: select(onOuter, mul(along, nOuter), select(onInner, mul(along, nInner), endPhase)),
      pitch: select(onOuter, div(mul(span, h.outer), nOuter), select(onInner, div(mul(span, h.inner), nInner), div(depth, nEnd))),
    };
  },
};

// ---- dispatch -----------------------------------------------------------------------------------------------------

/**
 * Signed distance to the hit shape in the plane: negative inside. The one expression the telegraph draws and the checks
 * evaluate, so a shader or paint of your own that reads it agrees with both.
 *
 * The law: for a capsule, the distance to its segment less its radius; for a disc, the distance to its centre less its
 * radius; for an arc, within its angles the largest of rho - outer, inner - rho and minus the distance to the nearer end
 * edge, and past an end the distance to that end's radial segment. Exact for all three, an arc up to a half turn.
 *
 * Parameters: `p` is any point of the plane (x, z) held as a vec2; the shape's fields are expressions.
 *
 * What it cannot do, because of the law:
 * - measure in three dimensions: it is the plane's distance, the same at every height.
 * - be exact for an arc over a half turn: nothing refuses one, so keep `to - from` at most pi yourself.
 *
 * Going past it: combine distances yourself, min(d1, d2) for a union and max(d1, -d2) for a cut, to draw or test shapes
 * no single hit is.
 * Relatives worth trying:
 * - a soft edge: smoothstep across d for a glow that fades out from the shape.
 * - a filling marker: inside where d < (k - 1) times the shape's inradius, k the warning's progress 0..1.
 */
export function hitSdf(h: Hit, p: V2): F {
  switch (h.kind) {
    case "capsule": return capsule.sdf(h, p);
    case "disc": return disc.sdf(h, p);
    case "arc": return arc.sdf(h, p);
  }
}

/**
 * The patch of the plane the shape is drawn on, (u, v) in [0, 1]^2, padded by `pad` all round: the ground a marker
 * covers, so drawing it costs about the shape's own pixels.
 *
 * The law: a capsule's patch is the rectangle along its lane from a - (radius + pad) to b + (radius + pad); a disc's
 * the square round it; an arc's a polar patch of its own sector (angles padded by pad / inner, at most an eighth turn).
 *
 * Parameters: u, v and pad are expressions; the shape's fields too, so the patch moves with it.
 *
 * What it cannot do, because of the law:
 * - fit the shape tightly: a disc's square spends its corners, a capsule's rectangle its caps' corners.
 * - follow the ground's height: it is a patch of the plane; lift it onto a sea or a plane yourself (the telegraph does).
 *
 * Going past it: a `surface` of your own over the patch, `point(u, v)` from this and the ground's height, carries any
 * look you like. Relatives worth trying:
 * - a patch with relief: lift the points by a function of `hitSdf` (a rim that stands up at the edge).
 */
export function hitPatch(h: Hit, u: F, v: F, pad: F): V2 {
  switch (h.kind) {
    case "capsule": return capsule.patch(h, u, v, pad);
    case "disc": return disc.patch(h, u, v, pad);
    case "arc": return arc.patch(h, u, v, pad);
  }
}

/** Signed distance and the position along the nearest edge, in teeth about `spacing` apart. */
export function hitContour(h: Hit, p: V2, spacing: In<"f32">): Contour {
  const s = lift<"f32">(spacing);
  switch (h.kind) {
    case "capsule": return capsule.contour(h, p, s);
    case "disc": return disc.contour(h, p, s);
    case "arc": return arc.contour(h, p, s);
  }
}

/** Half the shape's narrowest width: how deep inward teeth may reach before they meet. */
export function hitInradius(h: Hit): F {
  switch (h.kind) {
    case "capsule": return h.radius;
    case "disc": return h.radius;
    case "arc": return mul(sub(h.outer, h.inner), 0.5);
  }
}

/** Unit direction of a capsule's lane, a to b. */
export const laneOf = (h: Capsule): V2 => normalize(sub(h.b, h.a));

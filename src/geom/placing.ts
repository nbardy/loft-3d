// Who places a thing, and a thing's transform as a game gives it (docs/throw_and_shove.md, "The contract").
//
// A scene that shows an attack on a boat needs the boat somewhere when the monster does not hold it. Either Loft's
// stand-in places it (a closed form: afloat, a ballistic flight, a drift), so the scene plays on its own; or the host
// does: the game passes the boat's location and orientation every frame and Loft only draws it there. That choice is a
// sum type, `Placer`, classified once where the scene is assembled, and `placedBy` is its one dispatcher: every use
// gives one handler per variant and never asks the kind.

import { add, cos, cross, dot, lift, mix, mul, normalize, sin, sub, vec3, type Expr, type In } from "../expr.ts";
import type { Frame } from "../map/types.ts";

type F = Expr<"f32">;
type P3 = Expr<"vec3">;

/**
 * A thing's transform as a game states it: where its origin is (world), its heading (radians from +x toward +z), its
 * pitch (radians, front up) and its heel (radians, leaning toward its right, +z at heading 0). Each is an expression,
 * so a game drives them through host inputs.
 */
export type Pose = { readonly at: P3; readonly heading: F; readonly pitch: F; readonly heel: F };

/**
 * A pose from its four parts; none is defaulted (a level thing says pitch 0 and heel 0).
 *
 * What it assumes of the thing: a rigid thing with a front, an up and a right, in a world whose up is +y: a vehicle,
 * a crate, a creature's whole body. Something that bends or is made of parts has a pose for its root only.
 *
 * The law. Four numbers: a point and three angles applied in a fixed order, heading about world up, then pitch, then
 * heel (`poseFrame` turns them into a frame). Nothing about time: a pose is whatever its expressions are now.
 *
 * Parameters: all four take expressions (host inputs, a closed form of the clock, or numbers).
 *
 * What it cannot do, because of the law:
 * - say a turn that is not heading, then pitch, then heel: a thing pointing straight up has no well-defined heading
 *   (the angles lock), and a tumbling thing is better said as a frame.
 * - scale or bend: it is a rigid placement.
 * - say how fast it moves: velocity is the caller's, from the same expressions read at another time.
 *
 * Going past it: a pose is only a way to write a `Frame`, so a frame built any other way (`turnedAbout`, `blendFrames`,
 * an `afloatFrame`, a `carriedFrame`) places the thing the same. Relatives:
 * - a thing turned about any axis: `turnedAbout` a frame by an axis and an angle, with no order of angles to lock.
 * - a thing on its way between two owners: `blendFrames` of their frames.
 * - a thing riding a surface: `afloatFrame`, whose axes are the same as a pose's.
 */
export function pose(o: { readonly at: In<"vec3">; readonly heading: In<"f32">; readonly pitch: In<"f32">; readonly heel: In<"f32"> }): Pose {
  return { at: lift<"vec3">(o.at), heading: lift<"f32">(o.heading), pitch: lift<"f32">(o.pitch), heel: lift<"f32">(o.heel) };
}

/**
 * The frame a pose gives: x toward the front, y up through the thing, z to its right (= x cross y), origin at `at`. The
 * heading turns about world up, the pitch then lifts the front, the heel then leans the up axis to the right: the same
 * axes `afloatFrame` gives, so a thing drawn on a surface can be drawn by a pose instead.
 *
 * The law. With f = (cos h, 0, sin h), s = (-sin h, 0, cos h) and u = (0, 1, 0): x = f cos p + u sin p,
 * y0 = u cos p - f sin p, y = y0 cos e + s sin e, z = s cos e - y0 sin e (h heading, p pitch, e heel). Orthonormal
 * for any angles; each axis is continuous in the three angles.
 *
 * Parameters: the pose, whose four parts are expressions.
 *
 * What it cannot do, because of the law:
 * - turn in another order: heading, then pitch, then heel is fixed; at pitch +-pi/2 heading and heel turn about the
 *   same axis and one of them is lost.
 * - follow the heading sense of `course` frames: here heading turns from +x toward +z, there yaw turns from +x toward
 *   -z; convert by negating.
 *
 * Going past it: a frame is only an origin and three axes, so any other construction is a `Frame` literal. Relatives:
 * - a turn about any axis, with no order: `turnedAbout`.
 * - a frame between two others: `blendFrames`.
 * - a frame looking at a target: `lookAt`'s yaw and pitch put into this law with heel 0.
 */
export function poseFrame(p: Pose): Frame {
  const fwd = vec3(cos(p.heading), 0, sin(p.heading)), side = vec3(mul(sin(p.heading), -1), 0, cos(p.heading)), up = vec3(0, 1, 0);
  const x = add(mul(fwd, cos(p.pitch)), mul(up, sin(p.pitch))), y0 = sub(mul(up, cos(p.pitch)), mul(fwd, sin(p.pitch)));
  return { o: p.at, x, y: add(mul(y0, cos(p.heel)), mul(side, sin(p.heel))), z: sub(mul(side, cos(p.heel)), mul(y0, sin(p.heel))) };
}

/** Loft's stand-in places the thing: a closed form of the clock, so the scene plays with no game. */
export type StandIn = { readonly kind: "standIn" };
/** The host places the thing: it gives the pose every frame and Loft draws the thing there. */
export type Hosted = { readonly kind: "host"; readonly pose: Pose };
export type Placer = StandIn | Hosted;

/**
 * Loft places the thing itself, by whatever closed form the caller's `standIn` handler gives, so a scene plays with no
 * game attached. It carries nothing: it cannot say where (the handler does), and it cannot hand over to the host
 * part way through a scene (a `Placer` is chosen once).
 */
export const STAND_IN: StandIn = { kind: "standIn" };
/**
 * The host places the thing: it gives the pose every frame (through host inputs in the pose's expressions) and Loft
 * draws the thing there.
 *
 * What it assumes: the thing is rigid and a `Pose` says all of where it is (a point, a heading, a pitch, a heel).
 *
 * The law. A variant of `Placer` carrying the pose; `placedBy` hands that pose to the caller's `host` handler. The
 * pose's expressions are read when drawn, so the thing is wherever the host's inputs say, every frame, with no state.
 *
 * Parameters: the pose, whose parts take expressions (normally host inputs).
 *
 * What it cannot do, because of the law:
 * - move the thing on Loft's own clock as well: the host's pose is the whole of its place (add a closed form to the
 *   pose's expressions if the host wants a wobble on top).
 * - say anything but a rigid pose: no bend, no parts moving on their own.
 * - know the host's velocity: anything that needs one (a splash, a smear) takes it from the host as another input.
 *
 * Going past it: `Placer` is a sum type with one dispatcher, so another way to place a thing is another variant and
 * one more handler at each `placedBy`. Relatives:
 * - Loft placing it: `STAND_IN`, its handler a closed form (a flight, a drift).
 * - a thing taken from one placer to another over a moment: both handlers' frames through `blendFrames`.
 */
export const hosted = (p: Pose): Hosted => ({ kind: "host", pose: p });

/**
 * The one dispatcher on who places a thing: a handler per variant.
 *
 * What it assumes: something in the scene is placed either by Loft (a closed form of the clock, so the scene plays on
 * its own) or by a host game (a pose every frame), and the choice is made once where the scene is assembled.
 *
 * The law. `placedBy(p, { standIn, host })` calls `standIn()` for `STAND_IN` and `host(pose)` for `hosted(pose)`. It is
 * the only place a `Placer`'s kind is read, so every use writes one handler per variant and none asks the kind.
 *
 * Parameters: the placer (a value chosen at build time) and two handlers returning the same type, whatever the
 * caller needs: a position, a frame, a list of checks.
 *
 * What it cannot do, because of the law:
 * - switch at run time: the variant is chosen when the scene is built, so a scene that is sometimes placed by the host
 *   and sometimes by Loft blends the two handlers' results by a weight instead.
 * - default a handler: both must be given, so a new variant breaks every caller until each handles it.
 *
 * Going past it: the dispatcher is four lines over a sum type, so a placer of your own is a sum type of your own with
 * its dispatcher. Relatives:
 * - the same pattern for any choice made once at the boundary: a `Drive` of a `pendulum`, a `Layer` of a `score`.
 * - the hand-over between them: `blendFrames` of the stand-in's frame and the host's `poseFrame`.
 */
export function placedBy<T>(p: Placer, by: { readonly standIn: () => T; readonly host: (pose: Pose) => T }): T {
  switch (p.kind) {
    case "standIn": return by.standIn();
    case "host": return by.host(p.pose);
  }
}

/**
 * Frame a at w = 0, frame b at w = 1, between them for w between: the origin mixed, the axes mixed and made orthonormal
 * again (x kept, y made perpendicular to it). For handing a thing from one owner's frame to another's over a moment
 * (a thing lifted off a surface into a grip). It cannot blend frames a half turn apart (the mixed axes pass through
 * zero; keep them within a right angle of each other), and the turn between them is not at an even rate in w.
 */
export function blendFrames(a: Frame, b: Frame, w: In<"f32">): Frame {
  const x = normalize(mix(a.x, b.x, w)), z = normalize(cross(x, mix(a.y, b.y, w)));
  return { o: mix(a.o, b.o, w), x, y: cross(z, x), z };
}

/**
 * Frame g with its axes turned by `angle` (radians) about `axis` (unit, through g's origin, which stays): Rodrigues'
 * rotation. It cannot turn about an axis away from the origin (move the origin yourself), and an axis that is not
 * unit length gives axes that are not.
 */
export function turnedAbout(g: Frame, axis: In<"vec3">, angle: In<"f32">): Frame {
  const a = lift<"vec3">(axis), c = cos(angle), s = sin(angle);
  const turn = (v: P3): P3 => add(add(mul(v, c), mul(cross(a, v), s)), mul(a, mul(sub(1, c), dot(a, v))));
  return { o: g.o, x: turn(g.x), y: turn(g.y), z: turn(g.z) };
}

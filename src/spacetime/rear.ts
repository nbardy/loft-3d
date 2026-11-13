// A rear-and-slam: a stretch in the MIDDLE of a body (a long body's arch) stands up as a tall loop during the
// wind-up and topples over onto the lane, landing as a narrow loop lying flat along a capsule. `lunge` moves the
// m = 0 end and `sweep` the m = 1 end; neither can lift a stretch whose both ends stay where they are (added for the
// Maelstrom Wyrm's Coil Lash, examples/bosses/maelstrom_wyrm.ts, 2026-11-11).
//
// The loop is a stadium in the plane of `side` and d(q) = up cos(theta) + lane sin(theta), theta = mix(-lean, pi/2, q):
// two straight legs at +-w (w = radius - inset, half the loop's width) joined by a half circle of radius w whose top is
// l = |b - a| - inset from a (the capsule's start lifted to `height`). It is laid out by ARC LENGTH along the stretch
// (u = (m - from) / (to - from)): an ellipse parametrised by angle, x = w cos(pi u), y = l sin(pi u), bunched the
// stations at its top, and the strand's volume preservation (radius / sqrt(stretch)) blew the compressed top up into
// a ball three times the body's girth (2026-11-11, seen in the side view). At q = 0 the loop stands up, leaning `lean`
// back from the lane; at q = 1 it lies on the water with its top (u = 1/2) `inset` short of b: exactly there at the
// arming time, since q is exactly 1 then. The loop's two feet are
// a +- side w; the stretch blends into the rest posture over its outer fifth on each side, so the feet should sit near
// where the rest posture enters the water (choose a there). The motion leads from the top of the loop: each m reads the
// clock of its distance from u = 1/2.

import { abs, add, clamp, cos, div, dot, length, lift, max, mix, mul, sign, sin, smoothstep, sub, time, vec3, type Expr } from "../expr.ts";
import { laneOf, type Capsule } from "./hit.ts";
import type { Attack, Spine } from "./attack.ts";

type F = Expr<"f32">;
type P3 = Expr<"vec3">;

export type RearSpec = {
  readonly kind: "rear";
  readonly hit: Capsule;
  /** The stretch of spine that rears (m from `from` to `to`); its middle is the striking tip. */
  readonly from: number;
  readonly to: number;
  /** Height above the still water at which the stretch lies when it lands. */
  readonly height: number;
  /** World distance kept inside the capsule's edges at landing (about the body's radius). */
  readonly inset: number;
  /** Radians the reared loop leans back, away from the lane, at the top of the wind-up. */
  readonly lean: number;
};

type Loop = { readonly base: P3; readonly lane: P3; readonly side: P3; readonly half: F; readonly reach: F };

function loopOf(m: RearSpec): Loop {
  const h = m.hit, dir = laneOf(h);
  return {
    base: vec3(h.a.x, m.height, h.a.y),
    lane: vec3(dir.x, 0, dir.y),
    side: vec3(mul(dir.y, -1), 0, dir.x),
    half: sub(h.radius, m.inset),
    reach: sub(length(sub(h.b, h.a)), m.inset),
  };
}

/** The loop's point at stretch fraction u (by arc length round the stadium) and strike progress q. */
function loopPoint(m: RearSpec, l: Loop, u: F, q: F): P3 {
  const theta = mix(-m.lean, Math.PI / 2, q);
  const d = add(mul(vec3(0, 1, 0), cos(theta)), mul(l.lane, sin(theta)));
  const leg = max(sub(l.reach, l.half), 0);
  const s = mul(u, add(mul(leg, 2), mul(l.half, Math.PI)));
  // Up the first leg, round the top, down the second: each piece clamped, so their sum is the point at arc length s.
  const up = clamp(s, 0, leg);
  const phi = clamp(div(sub(s, leg), l.half), 0, Math.PI);
  const down = clamp(sub(s, add(leg, mul(l.half, Math.PI))), 0, leg);
  const across = mul(l.half, cos(phi));
  const along = add(sub(up, down), mul(l.half, sin(phi)));
  return add(add(l.base, mul(l.side, across)), mul(d, along));
}

export function rearSpine(a: Attack, m: RearSpec, rest: Spine): Spine {
  const found = loopOf(m), span = m.to - m.from;
  // The loop starts (u = 0) on the +side leg, so +side must point from the rest posture's `to` end toward its `from`
  // end; the other way the stretch crossed itself and landed as a figure of eight (2026-11-11).
  const ends = sub(rest(lift<"f32">(m.from)), rest(lift<"f32">(m.to)));
  const l: Loop = { ...found, side: mul(found.side, sign(dot(found.side, ends))) };
  return (s) => {
    const u = clamp(mul(sub(s, m.from), 1 / span), 0, 1);
    // The top leads; each point lags by its distance along the body from the top.
    const env = a.envelope(sub(time, mul(abs(sub(u, 0.5)), span / a.timing.travel)));
    const weight = mul(smoothstep(0, 0.2, u), sub(1, smoothstep(0.8, 1, u)));
    return mix(rest(s), loopPoint(m, l, u, env.q), mul(weight, env.p));
  };
}

/** Where the top of the loop lands at the arming time. */
export function rearLanding(m: RearSpec): P3 {
  const l = loopOf(m);
  return add(l.base, mul(l.lane, l.reach));
}

// The face: a grudging old giant.
//
// Temperament: grudging. It is older than the fort on its back, half asleep, chewing; it has outlived whatever took its
// left eye and does not care about you until you come into its water. Every feature serves that:
// - a heavy brow (the carapace's front edge) in a shallow V, low over the eyes: a scowl it wears even asleep;
// - eyes under heavy lids that sit across the top of a horizontal goat's pupil; the lids slant down toward the middle;
// - the left eye is the old injury: a short, healed stalk, a clouded eye with a scar through it, a lid that droops,
//   barnacles round its socket and more weed on that side. The two eyes never move together;
// - the mouth is layered plates (the third maxillipeds) that close like doors and work slowly, with a beard of weed;
// - in Claw Crush the good eye snaps wide with a pinpoint pupil, the stalks stand up toward the target, the plates
//   flare open on the black mouth; at the slam it screws the eye shut and clamps its mouth; then it stares, and
//   settles back into the heavy-lidded chew.
//
// `faceKit(rig)` holds the face's clocks and part builders (eyes, plates, brow, gullet, beard); another face composes
// them differently (face/mask.ts) or draws its own.

import {
  abs, add, cos, cross, div, draw, fract, spiralTube, length, lift, lookAt, max, min, mix, mul, place, points, rigid, sin, smoothstep, spacing, sqrt,
  strand, sub, surface, swing, through, time, unit, vec2, vec3, type F, type P3,
} from "../../../../src/index.ts";
import { cut, perFrame, TAU, type V3 } from "../ink.ts";
import type { Rig } from "../rig.ts";
import type { Carapace, FaceOption } from "../slots.ts";

export type Eye = {
  readonly tag: "L" | "R";
  /** The stalk's root and its tip, world. */
  readonly base: P3; readonly tip: P3;
  /** The eye's facing, a unit vector, world. */
  readonly look: P3;
  readonly radius: number;
  /** Where the upper lid's edge is, radians from straight up over the front (pi / 2 halves the eye; pi shuts it). */
  readonly lid: F;
  /** The lid edge's slant, radians: positive drops it toward the middle (a scowl), negative toward the outside (a droop). */
  readonly slant: F;
  /** The eyeball's paint over its front cap: x across, y up, both in [-1, 1]; and its back (m below 0.5). */
  readonly iris: (x: F, y: F) => P3;
  readonly stalkPaint: (m: F) => P3;
  readonly lidPaint: (edge: F) => P3;
};

export function faceKit(rig: Rig) {
  const { n, crush, crushAfter, body, local } = rig;
  const I = n.ink;
  /** Seconds from this cycle's slam (crush.arm), and the face's two attack envelopes, both 0 before and after a cycle. */
  const tA = sub(time, crush.arm);
  /** Roused: from the start of the wind-up, through the stare after the slam, settling back by 2.4 s. */
  const rouse = mul(smoothstep(-1.3, -0.95, tA), sub(1, smoothstep(0.9, 2.4, tA)));
  /** Braced: the eye screwed shut and the mouth clamped, at the slam. */
  const brace = mul(smoothstep(-0.14, 0, tA), sub(1, smoothstep(0.25, 0.8, tA)));
  /** A blink every `period` seconds: shut for an instant, opening over 0.13 s. None while roused. */
  const blink = (period: number, offset: number): F => {
    const k = abs(sub(mul(fract(mul(add(time, offset), 1 / period)), period), 0.3));
    return mul(sub(1, smoothstep(0.03, 0.16, k)), sub(1, rouse));
  };
  const tab = (name: string, e: P3) => perFrame(`titan_frame_${name}`, e);
  const tabF = (name: string, e: F): F => perFrame(`titan_face_${name}`, e);
  /** An offset in the crab's frame. */
  const inBody = (x: F | number, y: F | number, z: F | number): P3 => add(add(mul(body.x, x), mul(body.y, y)), mul(body.z, z));
  /** The stalks whip at the slam and swing on (follow-through), each at its own rate. */
  const stalkWhip = (amount: number, hz: number) => inBody(mul(swing(crushAfter, amount, hz, 0.28), 0.6), mul(swing(crushAfter, amount, hz, 0.28), -1), 0);

  /** The brow: one heavy ridge across the front of the carapace, a shallow V low over the eyes (outer left to outer right). */
  const brow = (line: readonly V3[]) => place(strand({
    name: "brow", spine: (m) => through(m, line), stations: 12,
    // Heaviest over the eyes, thinner at the V and at the ends.
    girth: (m) => mul(0.5, add(0.6, mul(abs(sin(mul(m, 2 * TAU))), 0.4))), section: { aspect: 0.5, squareness: 2.6 },
    tips: [{ round: 0.08 }, { round: 0.08 }], up: [0.7, 1, 0],
    // Plain dark brick (mottle made it texture, not a shape) with a cream underside: the line the face hangs from.
    paint: (m, v) => mix(vec3(...I.brickDark), vec3(...I.cream), cut(mul(sin(mul(v, TAU)), -1), 0.35)),
    detail: { along: 48, around: 12 },
  }), rigid(body));

  /** The ball, its stalk and its lid (a spherical lune hinged on the eye's side axis, swinging over the front). */
  function eyeParts(e: Eye) {
    const tip = tab(`eye_${e.tag}_tip`, e.tip), F0 = tab(`eye_${e.tag}_look`, e.look);
    const lid = tabF(`eye_${e.tag}_lid`, e.lid), slant = tabF(`eye_${e.tag}_slant`, e.slant);
    const side0 = unit(cross(F0, body.y)), up0 = cross(side0, F0);
    // The hinge axis tipped by the slant (outer pole raised for a scowl). `side` points right of the gaze, so the right
    // eye's outer pole is +side and the left eye's -side: the caller signs the slant.
    const side = add(mul(side0, cos(slant)), mul(up0, sin(slant))), up = sub(mul(up0, cos(slant)), mul(side0, sin(slant)));
    const mid = add(e.base, mul(sub(tip, e.base), 0.55));
    const stalk = strand({
      name: `stalk${e.tag}`, spine: (m) => mix(mix(e.base, add(mid, mul(body.y, 0.4)), m), mix(add(mid, mul(body.y, 0.4)), tip, m), m), stations: 6,
      girth: (m) => mix(0.24, 0.17, m), tips: ["open", "round"], paint: (m) => e.stalkPaint(m), detail: { along: 16, around: 10 },
    });
    const ball = strand({
      name: `eye${e.tag}`, spine: (m) => add(tip, mul(F0, mul(sub(m, 0.5), e.radius * 2))), stations: 4, girth: e.radius,
      tips: [{ round: 0.5 }, { round: 0.5 }], up: body.y,
      paint: (m, v) => {
        // The front cap's own coordinates: r from the axis, then across and up.
        const z = sub(mul(m, 2), 1), r = sqrt(max(sub(1, mul(z, z)), 0));
        // All cream, the pupil on the front. (A brick back made the eyes read as dark balls from every side but the front.)
        return mix(vec3(...I.cream), e.iris(mul(r, cos(mul(v, TAU))), mul(r, sin(mul(v, TAU)))), cut(m, 0.5));
      },
      detail: { along: 14, around: 18 },
    });
    // The lid hoods only the top front: from the high strategy camera a lid over the whole top hid the eye.
    const R = e.radius * 1.1, BACK = -0.4;
    const lidShape = surface((u, v) => {
      const a = mix(BACK, lid, u), b = mix(0.1, Math.PI - 0.1, v);
      const ring = add(mul(up, cos(a)), mul(F0, sin(a)));
      return add(tip, mul(add(mul(side, cos(b)), mul(ring, sin(b))), R));
    }, { u: ["free", "free"], v: "free" });
    const lidDraw = draw.surface(`lid${e.tag}`, lidShape, {
      // `edge` is radians back from the lid's edge.
      paint: (u) => e.lidPaint(mul(sub(1, u), sub(lid, BACK))),
      grid: { u: spacing.even(10), v: spacing.even(14) }, sides: "two", outline: "border",
    });
    return [stalk, ball, lidDraw];
  }

  /** The lid's paint: dark brick with a heavy black rim at its edge and one age crease behind it. (Barnacle specks on the
   * dead eye's lid made it read as a toadstool; more creases made a knitted cap.) */
  const lidInk = (edge: F): P3 => {
    const rim = sub(1, cut(edge, 0.2));
    const crease = sub(1, cut(abs(sub(edge, 0.55)), 0.035));
    const base = vec3(...I.brickDark);
    return mix(mix(base, vec3(...I.black), crease), vec3(...I.black), rim);
  };

  /** A mouth plate (s = 1 right, -1 left) that closes like a door, working slowly; flared in the wind-up, clamped at the slam.
   * A face with its own score gives `drive` (0 clamped .. 1 flared) and the plate follows that instead. */
  function plate(s: 1 | -1, drive?: F) {
    const chew = add(0.06, mul(max(sin(add(mul(time, 2.1), s * 1.3)), 0), 0.2));
    const open = tabF(`mouth_${s < 0 ? "L" : "R"}`, drive ?? mul(mix(chew, 1, rouse), sub(1, brace)));
    const hinge = local([4.75, -0.3, s * 0.48]);
    const tipNow = local(add(vec3(5.3, -1.15, s * 0.22), vec3(mul(open, 0.25), mul(open, 0.2), mul(open, s * 0.85))));
    return strand({
      name: `maxilliped${s < 0 ? "L" : "R"}`, spine: (m) => mix(hinge, tipNow, m), stations: 4,
      girth: (m) => mul(0.4, sub(1, mul(m, 0.3))), section: { aspect: 0.32, squareness: 3 }, up: body.x,
      tips: [{ round: 0.1 }, { round: 0.15 }],
      paint: (m, v) => {
        // Cream plates, brick at the hinge, a black joint line, a row of black bristles down the inner edge.
        const segs = mix(vec3(...I.brick), vec3(...I.cream), cut(m, 0.3));
        const joint = sub(1, cut(abs(sub(m, 0.33)), 0.025));
        const bristle = mul(cut(mul(cos(mul(v, TAU)), -s), 0.8), cut(sin(mul(m, 40)), 0.3));
        return mix(segs, vec3(...I.black), max(joint, bristle));
      },
      detail: { along: 10, around: 14 },
    });
  }
  /** The black of the mouth behind the plates: seen only when they open. */
  const gullet = () => place(strand({
    name: "gullet", spine: (m) => mix(vec3(4.7, -0.2, 0), vec3(4.85, -1.05, 0), m), stations: 4, girth: 0.6,
    section: { aspect: 0.35 }, up: [1, 0, 0], tips: [{ round: 0.2 }, { round: 0.3 }], paint: () => vec3(...I.black), detail: { along: 6, around: 10 },
  }), rigid(body));

  /** Weed hanging from the carapace at (m, v, size) stations of its surface. */
  const beard = (carapace: Carapace, at: readonly V3[]) => {
    const weed = spiralTube({
      name: "weed", length: 1.6, curl: 1.4, taper: 0.6, girth: 0.11, out: [0.4, 1, 0], toward: [1, 0, 0],
      paint: (m) => mix(vec3(...I.mossDeep), vec3(...I.moss), cut(sin(add(mul(m, 7), 1)), 0.6)),
    });
    return draw.points("beard", place(points(at.length, (i) => {
      const pick = (k: 0 | 1 | 2) => at.reduce((acc: F, t, j) => add(acc, mul(t[k], sub(1, min(abs(sub(i, j)), 1)))), lift<"f32">(0));
      return { at: vec3(pick(0), pick(1), 0.92), scale: add(pick(2), mul(sin(add(mul(time, 0.8), i)), 0.05)) };
    }), carapace.hull), weed);
  };

  return { rouse, brace, blink, inBody, stalkWhip, brow, eyeParts, lidInk, plate, gullet, beard };
}

/** The brow's line in crab coordinates, outer left to outer right; the middle is the V's low point. */
const BROW: readonly V3[] = [[3.2, 0.98, -3.05], [4.1, 1.06, -1.9], [4.6, 0.86, -0.85], [4.93, 0.5, 0], [4.6, 0.86, 0.85], [4.1, 1.06, 1.9], [3.2, 0.98, 3.05]];
/** The weed beard, on both sides of the mouth, heavier on the dead eye's side: (m, v, size) on the carapace. */
const BEARD: readonly V3[] = [
  [0.9, 0.53, 0.9], [0.93, 0.57, 1.2], [0.95, 0.61, 1.0], [0.91, 0.65, 0.8], [0.96, 0.66, 1.3], // left (v toward 0.5)
  [0.94, 0.88, 0.9], [0.92, 0.93, 0.7], // right
];

export const base: FaceOption = {
  about: "grudging old giant: heavy brow, one good goat eye, one dead, door plates, weed beard",
  draw: (rig, carapace) => {
    const { n, body, local, grab, grabEnv, grabBeat, shipNow } = rig;
    const I = n.ink;
    const k = faceKit(rig);
    const brow = k.brow(BROW);

    // The good right eye: wanders slowly; when roused it fixes on the target.
    const baseR = local([4.05, 0.98, 0.95]);
    // It gazes a little upward, over the horizon: from the high cameras that turns the pupil toward the viewer.
    const wander = local(vec3(14, add(mul(sin(mul(time, 0.29)), 2), 5), add(mul(sin(add(mul(time, 0.37), 1)), 8), 1)));
    // It also fixes on the ship through the grab, from the warning on.
    const grabEye = mul(smoothstep(0, 0.5, add(grabEnv.tau, grab.warn)), sub(1, smoothstep(0, 1, grabBeat.settle)));
    const lookR = lookAt({ from: { o: baseR, x: body.x, y: body.y, z: body.z }, target: mix(mix(wander, shipNow, grabEye), vec3(rig.crushCentre.x, 0, rig.crushCentre.y), k.rouse), yaw: 1.2, pitch: 0.7 }).dir;
    const goodEye: Eye = {
      tag: "R", base: baseR,
      // At rest the stalk leans out and forward, a little tired; roused it stands up and leans toward the target.
      tip: add(add(baseR, add(mix(k.inBody(0.75, 1.75, 0.65), k.inBody(0.5, 2.35, 0.2), max(k.rouse, mul(grabEye, 0.6))), mul(lookR, 0.35))), k.stalkWhip(0.45, 1.9)),
      look: lookR, radius: 0.64,
      lid: add(mix(mix(mix(1.15, 3.0, k.blink(5.3, 3.9)), 0.5, k.rouse), 2.55, k.brace), mul(sin(mul(time, 0.6)), 0.1)),
      slant: mix(0.38, 0.55, max(k.rouse, k.brace)),
      // A goat's bar pupil, wide and sleepy at rest; a pinpoint when roused.
      iris: (x, y) => {
        const w = mix(0.62, 0.16, k.rouse), h = mix(0.24, 0.16, k.rouse);
        const qx = div(x, w), qy = div(y, h);
        return mix(vec3(...I.cream), vec3(...I.black), cut(sub(1, add(mul(mul(qx, qx), mul(qx, qx)), mul(mul(qy, qy), mul(qy, qy)))), 0));
      },
      stalkPaint: (m) => mix(vec3(...I.brick), vec3(...I.black), cut(abs(sub(fract(mul(m, 4)), 0.5)), 0.47)),
      lidPaint: k.lidInk,
    };

    // The dead left eye: a short healed stalk splayed out, gazing at nothing; it only flinches.
    const baseL = local([4.05, 0.98, -0.95]);
    // It sags down and forward, so the clouded iris and the scar face the front cameras.
    const lookL = unit(k.inBody(0.85, add(-0.4, mul(sin(mul(time, 0.21)), 0.08)), add(-0.3, mul(sin(mul(time, 0.17)), 0.1))));
    const deadEye: Eye = {
      tag: "L", base: baseL,
      tip: add(add(baseL, add(k.inBody(0.55, 1.15, -0.75), mul(k.inBody(0, 0.2, 0), k.rouse))), k.stalkWhip(0.3, 2.4)),
      look: lookL, radius: 0.5,
      lid: add(mix(1.75, 2.6, k.brace), mul(sin(mul(time, 0.45)), 0.06)),
      // Drooping toward the outside: the left eye's outer pole is -side, so a positive slant drops it there.
      slant: lift<"f32">(0.32),
      // Clouded: an indigo blot for a pupil, and the black line of the scar across it.
      iris: (x, y) => {
        const blot = cut(sub(0.32, length(vec2(x, mul(y, 1.3)))), 0);
        const scar = sub(1, cut(abs(sub(y, mul(x, 0.8))), 0.06));
        return mix(mix(vec3(...I.cream), mix(vec3(...I.cream), vec3(...I.indigo), 0.55), blot), vec3(...I.black), scar);
      },
      // Barnacle specks on the old stalk.
      stalkPaint: (m) => mix(vec3(...I.brick), vec3(...I.cream), cut(mul(sin(mul(m, 31)), sin(add(mul(m, 13), 2))), 0.6)),
      lidPaint: k.lidInk,
    };

    return { things: [brow, ...k.eyeParts(goodEye), ...k.eyeParts(deadEye), k.plate(1), k.plate(-1), k.gullet(), k.beard(carapace, BEARD)], checks: [] };
  },
};

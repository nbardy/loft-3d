// A patient face: small, a little sad, on the bare front of the thorny ball. Temperament: slow, patient, eerie; it has
// stood in this water a long time and is sorry about what it is going to do.
// - two round cream eyes on long thin straw stalks, black round pupils, lids heavy and drooping toward the outside
//   (the sad slant); they blink slowly and out of step;
// - two sad brows: short black strokes whose inner ends rise;
// - two long rostral horns between the eyes, forward and up (the spider crab's beak), the face's own spikes;
// - a small mouth turned down at the corners;
// - in Claw Crush the eyes open wide and the stalks stand up toward the target; at the slam they screw shut; in the Grab
//   the eyes follow the ship, as if apologising to it.
// The eyes and lids are `faceKit`'s (face/base.ts); the rest is drawn here on the body frame.

import { add, spiralTube, length, lift, lookAt, max, mix, mul, place, rigid, sin, smoothstep, strand, sub, through, time, unit, vec2, vec3 } from "../../../../src/index.ts";
import { cut, type V3 } from "../ink.ts";
import type { FaceOption } from "../slots.ts";
import { faceKit, type Eye } from "./base.ts";

export const patient: FaceOption = {
  about: "small, patient and sad: round eyes on long stalks, drooping lids, two rostral horns, a down-turned mouth",
  draw: (rig) => {
    const { n, body, local, grab, grabEnv, grabBeat, shipNow } = rig;
    const I = n.ink;
    const k = faceKit(rig);
    // The face's mount: the front of the body (crab x = carapace.to), so the face follows the carapace's numbers.
    const F0 = n.carapace.to, H = n.carapace.height;
    const at = (x: number, y: number, z: number): V3 => [F0 + x, y * H, z];

    const grabEye = mul(smoothstep(0, 0.5, add(grabEnv.tau, grab.warn)), sub(1, smoothstep(0, 1, grabBeat.settle)));
    const crushAt = vec3(rig.crushCentre.x, 0, rig.crushCentre.y);
    const eye = (tag: "L" | "R", s: 1 | -1): Eye => {
      const base = local(at(-0.55, 0.36, s * 0.62));
      // At rest it looks ahead and a little up, over the horizon, wandering slowly (from the high cameras that turns the pupils
      // toward the viewer); then at the ship, or the target.
      const wander = local(vec3(add(10, mul(sin(add(mul(time, 0.21), s)), 2)), 2.5, add(mul(sin(add(mul(time, 0.27), 2 * s)), 3), s * 0.8)));
      const look = lookAt({ from: { o: base, x: body.x, y: body.y, z: body.z }, target: mix(mix(wander, shipNow, grabEye), crushAt, k.rouse), yaw: 1.0, pitch: 1.0 }).dir;
      return {
        tag, base,
        // Long stalks leaning out and forward; roused, they stand straight up.
        tip: add(add(base, mix(k.inBody(0.55, 1.25, s * 0.45), k.inBody(0.3, 1.6, s * 0.2), max(k.rouse, mul(grabEye, 0.5)))), k.stalkWhip(0.35, 1.6)),
        look, radius: 0.5,
        // Heavy lids, half down; a slow blink each, out of step; wide when roused, shut at the slam.
        lid: add(mix(mix(mix(1.0, 3.0, k.blink(s > 0 ? 6.1 : 6.4, s > 0 ? 1.1 : 3.7)), 0.55, k.rouse), 2.6, k.brace), mul(sin(add(mul(time, 0.4), s)), 0.08)),
        // Drooping toward the outside on both eyes: negative on the right, positive on the left (eyeParts' sign).
        slant: lift<"f32">(-s * 0.42),
        iris: (x, y) => mix(vec3(...I.cream), vec3(...I.black), cut(sub(0.5, length(vec2(x, y))), 0)),
        stalkPaint: (m) => mix(vec3(...I.straw), vec3(...I.black), cut(sin(mul(m, 19)), 0.92)),
        lidPaint: (edge) => mix(vec3(...I.thornDark), vec3(...I.black), sub(1, cut(edge, 0.22))),
      };
    };

    // Sad brows: inner ends high, outer ends low, on the front of the ball above the stalks.
    const brow = (s: 1 | -1) => place(strand({
      name: `brow${s < 0 ? "L" : "R"}`, spine: (m) => through(m, [at(-0.55, 0.58, s * 1.25), at(-0.3, 0.68, s * 0.75), at(-0.22, 0.8, s * 0.3)]), stations: 6,
      girth: (m) => mul(0.09, sub(1.2, mul(m, 0.5))), tips: ["round", "round"], paint: () => vec3(...I.black), detail: { along: 12, around: 8 },
    }), rigid(body));
    // A small mouth turned down at the corners, low on the front.
    const mouth = place(strand({
      name: "mouth", spine: (m) => through(m, [at(-0.28, -0.3, -0.5), at(-0.05, -0.2, 0), at(-0.28, -0.3, 0.5)]), stations: 6,
      girth: 0.07, tips: ["round", "round"], paint: () => vec3(...I.black), detail: { along: 12, around: 8 },
    }), rigid(body));
    // Two rostral horns from between the eyes, forward and up, diverging a little: the face's own spikes.
    const rostrum = (s: 1 | -1) => {
      const o: V3 = at(-0.12, 0.28, s * 0.16);
      return place(spiralTube({
        name: `rostrum${s < 0 ? "L" : "R"}`, length: 1.9, curl: 0.35, taper: 0.12, girth: 0.13, out: [0.75, 0.62, s * 0.18], toward: [0, 1, 0],
        paint: (m) => mix(vec3(...I.thornDark), vec3(...I.straw), cut(m, 0.45)),
        detail: { along: 12, around: 8 },
      }), rigid({ o: local(o), x: body.x, y: body.y, z: body.z }));
    };
    return { things: [...k.eyeParts(eye("R", 1)), ...k.eyeParts(eye("L", -1)), brow(1), brow(-1), mouth, rostrum(1), rostrum(-1)], checks: [] };
  },
};

// Periscopes: the fiddler's face. Temperament: vain, showy, a bully. No brow (the pebble is smooth); two very tall thin
// stalks, ringed like periscopes, with small cream eyes and big black pupils under barely-there lids.
//
// What the eyes look at says who it is: at rest it watches the game camera (it is posing for you); in the Grab it fixes
// on the ship; roused for Claw Crush it fixes on the disc. The stalks trail the body: they lean forward while it rears
// back in the wind-up, whip after the slam (follow-through, each at its own rate) and lag the walk's sway. The mouth is
// the base's door plates (faceKit), flaring in the wind-up.

import { add, cos, fract, length, lift, lookAt, mix, mul, smoothstep, sub, time, vec2, vec3, type F } from "../../../../src/index.ts";
import { cut, TAU } from "../ink.ts";
import type { FaceOption } from "../slots.ts";
import { faceKit, type Eye } from "./base.ts";

/** Where the game camera's eye is (reefback_titan.ts, CAMERAS.game): the vain crab watches its audience. */
const AUDIENCE = [23, 27, 21] as const;

export const periscope: FaceOption = {
  about: "two very tall ringed periscope stalks; it watches the camera, the ship, the disc",
  draw: (rig) => {
    const { n, body, local, crush, grab, grabEnv, grabBeat, shipNow } = rig;
    const I = n.ink, k = faceKit(rig);
    const env = crush.envelope(time);
    // Fixed on the ship from the grab's warning until it has looked away; on the disc while roused.
    const onShip = mul(smoothstep(0, 0.5, add(grabEnv.tau, grab.warn)), sub(1, smoothstep(0, 1, grabBeat.settle)));
    const target = mix(mix(rig.audience, shipNow, onShip), vec3(rig.crushCentre.x, 0, rig.crushCentre.y), k.rouse);
    const w = TAU / n.period;
    // The stalks lag: forward while the body rears back (the wind-up), and the walk's sway a beat late.
    const lag = (s: 1 | -1): F => mul(cos(sub(mul(time, w), 1.1 + 0.3 * s)), 0.3);
    const rearLag = mul(env.p, sub(1, smoothstep(0, 0.6, env.q)));

    const eye = (tag: "L" | "R", s: 1 | -1, height: number, whip: readonly [number, number]): Eye => {
      // Rooted low on the front rim, where a fiddler's eyes fold into their grooves: the stalks stand 1.7 times the dome's
      // height and the eyes stay inside the fixed `face` camera (from 1.35 up, a stalk over 2.7 left its frame).
      const base = local([4.35, 0.95, s * 0.7]);
      const look = lookAt({ from: { o: base, x: body.x, y: body.y, z: body.z }, target, yaw: 1.4, pitch: 0.9 }).dir;
      return {
        tag, base, look, radius: 0.46,
        tip: add(add(add(base, k.inBody(add(0.25, mul(rearLag, 1.1)), height, add(s * 0.5, lag(s)))), mul(look, 0.45)), k.stalkWhip(whip[0], whip[1])),
        // Lids barely there: raised high, shut for a blink, screwed shut at the slam.
        lid: mix(mix(0.55, 3.0, k.blink(4.1, s > 0 ? 0 : 0.12)), 2.7, k.brace),
        slant: lift<"f32">(s * -0.15),
        // A big black pupil, a cream glint at its top: wide when roused.
        iris: (x, y) => {
          const r = mix(0.62, 0.78, k.rouse);
          const pupil = cut(sub(r, length(vec2(x, mul(y, 0.85)))), 0);
          const glint = cut(sub(0.16, length(vec2(add(x, 0.18), sub(y, 0.3)))), 0);
          return mix(mix(vec3(...I.cream), vec3(...I.black), pupil), vec3(...I.cream), glint);
        },
        // Ringed like a periscope's tube: dark, a thin cream band every fifth of its length.
        stalkPaint: (m) => mix(vec3(...I.brickDark), vec3(...I.cream), cut(sub(0.5, fract(mul(m, 5))), 0.42)),
        lidPaint: k.lidInk,
      };
    };
    // Not twins: the left stalk a little shorter, whipping slower and further.
    return { things: [...k.eyeParts(eye("R", 1, 2.95, [0.6, 1.5])), ...k.eyeParts(eye("L", -1, 2.65, [0.75, 1.2])), k.plate(1), k.plate(-1), k.gullet()], checks: [] };
  },
};

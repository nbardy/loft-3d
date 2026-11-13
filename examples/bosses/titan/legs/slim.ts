// Slim legs: the base legs' three segments by inverse kinematics, two thirds as thick and smooth (no mottle): dark body
// ink on top, cream beneath, a cream band and a black ring at each joint, a dark point. The fiddler's legs are long and
// thin under a heavy claw.

import { abs, add, keys, lift, chain, min, mix, mul, sin, smoothstep, strand, sub, vec3, type F } from "../../../../src/index.ts";
import type { Reaching } from "../../../../src/check.ts";
import { cut, sides, TAU } from "../ink.ts";
import type { LegsOption } from "../slots.ts";

export const slim: LegsOption = {
  about: "thin smooth legs, dark over cream, ringed at the joints",
  draw: ({ n, walk, body, local }) => {
    const I = n.ink;
    const segs = keys([[0, 1], [0.4, 0.8], [0.8, 0.5], [1, 0.2]]);
    const limbs: Reaching[] = [];
    const things = sides.flatMap((s, si) => n.legRoots.map((x, i) => {
      const spec = { root: local([x, -0.1, s * n.carapace.width * 0.85]), target: walk.foot(si * 4 + i), lengths: n.legLengths, bend: add(body.y, mul(body.z, s * 0.4)), foot: mul(body.y, -1) };
      const leg = chain(spec);
      limbs.push({ name: `leg${s < 0 ? "L" : "R"}${i}`, limb: spec, outward: mul(body.z, s) });
      const nearKnot = (m: F): F => leg.knots.slice(1, 3).reduce((d: F, kn) => min(d, abs(sub(m, kn))), lift<"f32">(1));
      return strand({
        name: `leg${s < 0 ? "L" : "R"}${i}`, spine: leg.spine, stations: 24, tips: ["round", { point: 0.12 }], section: { aspect: 0.75 }, up: body.y,
        girth: (m) => mul(mul(segs(m).x, 0.34), sub(1, mul(smoothstep(0.05, 0, nearKnot(m)), 0.25))),
        paint: (m, v) => {
          const shell = mix(vec3(...I.cream), vec3(...I.brick), cut(sin(mul(v, TAU)), -0.3));
          const band = sub(1, cut(nearKnot(m), 0.03)), ring = sub(1, cut(nearKnot(m), 0.012));
          return mix(mix(mix(shell, vec3(...I.cream), band), vec3(...I.black), ring), vec3(...I.black), cut(m, 0.9));
        },
        detail: { along: 64, around: 10 },
      });
    }));
    return { things, limbs };
  },
};

// Armoured legs (the mask direction): each segment is sheathed in overlapping lacquered lames, like a samurai's
// sleeve armour, tied at every joint with a cream cord, ending in a red dactyl with a cream point.
//
// - A lame is one tooth of a sawtooth girth: narrow at its upper edge, flaring at its lower edge where it overlaps the
//   next. The silhouette steps, so the plating reads with paint off.
// - The lames slide over each other as the leg bends: their phase along the segment follows the knee's angle (the
//   dot of the first two segments' directions), so a folding leg telescopes its plates.
// - At each joint a cord binding: no lames, a pinch, cream with a twist line.

import { abs, add, dot, fract, keys, lift, chain, min, mix, mul, sin, smoothstep, strand, sub, unit, vec3, type F } from "../../../../src/index.ts";
import type { Reaching } from "../../../../src/check.ts";
import { cut, sides, TAU } from "../ink.ts";
import type { LegsOption } from "../slots.ts";

/** Lames per leg (along the whole length), and how far a full fold slides them (in lames). */
const LAMES = 13, SLIDE = 0.9;

export const armoured: LegsOption = {
  about: "lacquered lames edged in red, cord-bound joints, red dactyls",
  // The samurai holds its taunt's poses low, its knees locked (docs/stance.md).
  numbers: { stance: { dance: { crouch: 0.45 } } },
  draw: ({ n, walk, body, local }) => {
    const I = n.ink;
    const segs = keys([[0, 1], [0.4, 0.85], [0.8, 0.55], [1, 0.2]]);
    const limbs: Reaching[] = [];
    const things = sides.flatMap((s, si) => n.legRoots.map((x, i) => {
      const k = si * 4 + i;
      const root = local([x, -0.1, s * n.carapace.width * 0.85]);
      const spec = { root, target: walk.foot(k), lengths: n.legLengths, bend: add(body.y, mul(body.z, s * 0.4)), foot: mul(body.y, -1) };
      const leg = chain(spec);
      limbs.push({ name: `leg${s < 0 ? "L" : "R"}${i}`, limb: spec, outward: mul(body.z, s) });
      const [j0, j1, j2] = leg.joints;
      // The knee's bend: 1 straight, falling as it folds. The lames' phase moves with it.
      const bend = dot(unit(sub(j1!, j0!)), unit(sub(j2!, j1!)));
      const phase = (m: F): F => fract(add(mul(m, LAMES), mul(bend, SLIDE)));
      const nearKnot = (m: F): F => leg.knots.slice(1, 3).reduce((d: F, kn) => min(d, abs(sub(m, kn))), lift<"f32">(1));
      // Lames on the two armoured segments; the dactyl (beyond 0.84) is bare. Geometry, so smooth edges: `cut` is a
      // pixel-wide edge from screen derivatives and exists only in paint.
      const armoured = (m: F): F => mul(smoothstep(0.03, 0.04, nearKnot(m)), smoothstep(0.85, 0.83, m));
      const cordG = (m: F): F => smoothstep(0.035, 0.025, nearKnot(m));
      const cord = (m: F): F => sub(1, cut(nearKnot(m), 0.03));
      return strand({
        name: `leg${s < 0 ? "L" : "R"}${i}`, spine: leg.spine, stations: 40, tips: ["round", { point: 0.12 }],
        section: { aspect: 0.85 }, up: body.y,
        // A tooth per lame (girth grows down each lame by 26%; the legs a fifth thinner than the base's so the face leads), pinched under the cords.
        girth: (m) => mul(mul(segs(m).x, 0.4), add(add(0.9, mul(mul(phase(m), 0.26), armoured(m))), mul(cordG(m), -0.12))),
        paint: (m, v) => {
          const p = phase(m);
          // Lacquer, a red band at each lame's flared lower edge, a black line where the next lame starts over it.
          const lame = mix(mix(vec3(...I.lacquer), vec3(...I.brick), cut(p, 0.9)), vec3(...I.black), sub(1, cut(p, 0.05)));
          // The cord: cream with a twist (a diagonal line round it) and a black edge.
          const twist = sub(1, cut(abs(sin(add(mul(m, 260), mul(v, TAU * 2)))), 0.35));
          const rope = mix(vec3(...I.cream), vec3(...I.bark), mul(twist, 0.8));
          const bound = mix(lame, mix(rope, vec3(...I.black), sub(1, cut(nearKnot(m), 0.006))), cord(m));
          // The dactyl: red, then a cream point, the tip black.
          const dactyl = mix(mix(vec3(...I.brick), vec3(...I.cream), cut(m, 0.93)), vec3(...I.black), cut(m, 0.985));
          return mix(bound, dactyl, cut(m, 0.845));
        },
        detail: { along: 120, around: 12 },
      });
    }));
    return { things, limbs };
  },
};

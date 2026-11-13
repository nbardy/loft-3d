// Stilt legs (the spider crab, docs/art_direction/crab_round2/stilt_*.webp): eight bamboo poles that lift a small body
// high over the water. Each leg is three segments by inverse kinematics: a thigh climbing up and out from the body to a
// knee above it, a long shin falling out and down, and a near-vertical foot pole splayed a little outward into the sea.
// Swollen knuckles at the two joints, bamboo nodes (a ring and a slight bulge) along every segment, a rust point.
// Each foot stands in its own ring of cream foam, which swells at every plant and thins away while the foot is lifted.
//
// GEOMETRY (DERIVATION, scored in the variant's commit): body centre `ride` 6.8 above still water, roots 1.9 out at
// y -0.4, feet 11 out at y -1.0, the foot pole 4.5 long leaning 0.25 outward. The ankle is then 8.01 out and 3.03 below
// the root (8.56 away); with a thigh of 5.5 and a shin of 6.95 the knee stands 33 degrees up: 3.0 above the root
// (world 9.4, above the body's top at 8.9) and 4.6 out.

import {
  abs, add, draw, floor, fract, hit, length, lift, chain, max, min, mix, mul, saturate, sin, smoothstep, spacing, sqrt, strand, sub, time, unit,
  vec2, vec3, vec4, type Drawable, type F, type Sea,
} from "../../../../src/index.ts";
import { noise2 } from "../../../../src/lib/index.ts";
import { hitPatch } from "../../../../src/spacetime/index.ts";
import type { Expr } from "../../../../src/expr.ts";
import { edgeOf, rgb } from "../../../../src/style/shared.ts";
import { NO_SKELETON, type Surface } from "../../../../src/map/types.ts";
import type { Reaching } from "../../../../src/check.ts";
import { cut, sides } from "../ink.ts";
import type { Numbers } from "../numbers.ts";
import type { Rig } from "../rig.ts";
import type { LegsOption } from "../slots.ts";

/** The legs' own proportions (not numbers the rig reads): the root's radius as a share of the body's half-width, its height. */
const ROOT_OUT = 0.8, ROOT_Y = -0.4, SPLAY = 0.25;

/** Seconds since foot k last planted, and since it lifted (negative while planted): the stance's step clock
 * (docs/stance.md). A foot steps only to re-plant, stamp or walk, so a ring at a plant now means a real step. */
export function stepClock(rig: Rig, k: number): { readonly sincePlant: F; readonly sinceLift: F } {
  return rig.walk.since(k);
}

/** One foot's foam on the water: a clawed cream cloud while it stands, a ring running out at each plant. */
function footFoam(name: string, water: Sea, at: Expr<"vec2">, since: { readonly sincePlant: F; readonly sinceLift: F }, n: Numbers): Drawable {
  const I = n.ink;
  const reach = 3.8, cloud = 2.3, pad = 0.6;
  const area = hit.disc({ centre: at, radius: reach });
  const surface: Surface = {
    point: (u, v) => { const xz = hitPatch(area, u, v, lift<"f32">(pad)); return vec3(xz.x, water.height(xz), xz.y); },
    normal: () => vec3(0, 1, 0), anchor: (u, v) => vec3(u, v, 0),
    topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON,
  };
  // Standing: the cloud grows in over 0.5 s after the plant and stays; lifted, it thins over 0.9 s.
  const standing = mul(smoothstep(0, 0.5, since.sincePlant), sub(1, smoothstep(0, 0.9, since.sinceLift)));
  // The ring: from the plant, its front runs out to `reach` (fast, then slowing) and thins away by 1.6 s.
  const k = saturate(mul(since.sincePlant, 1 / 1.6));
  const front = mul(mix(0.4, 1, sqrt(k)), reach);
  return draw.glazed(name, surface, {
    colour: (fr) => {
      const p = vec2(fr.world.x, fr.world.z);
      // Lumpy, not a disc: the distance swells and shrinks with a slow noise, so the cloud has puffs.
      const d = mul(length(sub(p, at)), add(1, mul(noise2(mul(p, 0.55)), 0.28)));
      // The cloud shrinks as it comes and goes rather than fading: a faint falloff cut by the noise printed black
      // scribbles over the water while a lifted foot's cloud thinned (first version, 2026-11-11).
      const r = mul(cloud, max(standing, 0.02));
      const body = mul(sub(1, smoothstep(mul(r, 0.6), mul(r, 1.25), d)), smoothstep(0.02, 0.08, standing));
      const ring = mul(sub(1, smoothstep(0, mul(mix(0.5, 0.15, k), 1.4), abs(sub(d, front)))), mul(sub(1, smoothstep(0.55, 1, k)), step01(since.sincePlant)));
      const shape = max(body, ring);
      const fingers = abs(noise2(mul(p, 1.1)));
      const c = sub(sub(shape, 0.5), mul(fingers, 0.4));
      const foam = edgeOf(c, 0, 0.004);
      const line = mul(edgeOf(c, -0.07, 0.004), sub(1, foam));
      return vec4(mix(rgb(I.black), rgb(I.cream), foam), max(foam, mul(line, 0.9)));
    },
    grid: { u: spacing.even(20), v: spacing.even(20) }, phase: "on-water", sceneDepth: false,
  });
}
const step01 = (x: F): F => smoothstep(0, 0.02, x);

export const stilt: LegsOption = {
  about: "bamboo stilt legs with swollen knuckles, the body carried high, a foam ring at every foot",
  numbers: {
    ride: 6.8, floor: -1.0,
    // Feet in a star at 58, 88, 118 and 148 degrees from ahead, 11 out (the front ones clear of the crush disc and the ship).
    legFeet: [[5.83, 9.33], [0.38, 10.99], [-5.16, 9.71], [-9.33, 5.83]], legLengths: [5.5, 6.95, 4.5],
    // Slow and high-stepping: it picks its way. The body sways wider on the long legs.
    period: 4.2, duty: 0.72, lift: 2.6, sway: 0.42, bob: 0.12, roll: 0.045, yaw: 0.04,
    // The weight shifts wider on the long legs.
    stance: { idle: { side: 0.5, fore: 0.3 } },
  },
  draw: (rig: Rig) => {
    const { n, walk, body, local, world } = rig;
    const I = n.ink;
    const total = n.legLengths[0] + n.legLengths[1] + n.legLengths[2];
    const limbs: Reaching[] = [];
    const things = sides.flatMap((s, si) => n.legFeet.map(([fx, fz], i) => {
      const k = si * 4 + i;
      const angle = Math.atan2(fz, fx);
      const rootR = n.carapace.width * ROOT_OUT;
      const root = local([rootR * Math.cos(angle), ROOT_Y, s * rootR * Math.sin(angle)]);
      // The foot pole leans out along the leg's own bearing (world, horizontal).
      const out = vec3(Math.cos(angle), 0, s * Math.sin(angle));
      const spec = { root, target: walk.foot(k), lengths: n.legLengths, bend: body.y, foot: unit(add(vec3(0, -1, 0), mul(out, SPLAY))) };
      const leg = chain(spec);
      limbs.push({ name: `leg${s < 0 ? "L" : "R"}${i}`, limb: spec, outward: out });
      const knee1 = leg.knots[1]!, knee2 = leg.knots[2]!;
      const nearKnot = (m: F): F => min(abs(sub(m, knee1)), abs(sub(m, knee2)));
      // Bamboo nodes every 1.25 along the leg (world length), offset per leg so no two legs ring in step.
      const nodeAt = (m: F): F => abs(sub(fract(add(mul(m, total / 1.25), 0.37 * k)), 0.5));
      const knuckle = (m: F): F => smoothstep(0.045, 0, nearKnot(m));
      return [
        strand({
          name: `leg${s < 0 ? "L" : "R"}${i}`, spine: leg.spine, stations: 32, tips: ["round", { point: 0.08 }], section: { aspect: 1 }, up: body.y,
          girth: (m) => add(add(mul(sub(1, mul(m, 0.45)), 0.21), mul(knuckle(m), 0.2)), mul(smoothstep(0.47, 0.5, nodeAt(m)), 0.035)),
          paint: (m, v) => {
            // Straw with two thin dark grain lines, a black ring at each node, the knuckles dark straw banded in black.
            const grain = sub(1, cut(abs(sin(mul(v, Math.PI * 6))), 0.18));
            const pole = mix(vec3(...I.straw), vec3(...I.strawDark), mul(grain, 0.8));
            const node = sub(1, cut(sub(0.5, nodeAt(m)), 0.03));
            const knob = cut(knuckle(m), 0.35);
            const knobRing = sub(1, cut(abs(sub(nearKnot(m), 0.03)), 0.006));
            const tip = cut(m, 0.93);
            const legInk = mix(mix(pole, vec3(...I.strawDark), knob), vec3(...I.black), max(node, mul(knobRing, cut(nearKnot(m), 0.01))));
            return mix(legInk, vec3(...I.brickDark), tip);
          },
          detail: { along: 120, around: 10 },
        }),
        // The foam stands round the foot where it is (a re-plant moves it), not round its home.
        footFoam(`foam${s < 0 ? "L" : "R"}${i}`, world.sea, vec2(walk.foot(k).x, walk.foot(k).z), stepClock(rig, k), n),
      ];
    }).flat());
    return { things, limbs };
  },
};

// Tongs: the spider crab's long slender claws, in the same bamboo and straw as its legs. The base claw's mechanism
// (`clawsOf`: the rig places the ship and lands Claw Crush by this claw's own offer), drawn thin and long.
//
// REACH (DERIVATION; the checks measure it): the shoulders hang off the small body at crab (1.3, -0.1, +-1.32), 6.7
// above still water on the stilt legs.
// - Grab: the wrist closes 4.2 out and 6.45 down (7.70 away). Arms 5.0 + 4.8 = 9.8 (the cutter, size 1): 79% stretched.
//   The cutter's grip depth on the beam: palm 3.0, fingers 2.85: 4.97 beyond the wrist, so the ship sits 9.17 from the
//   shoulder.
// - Claw Crush: the crusher (1.15) has arms 1.0675 x (5.0, 4.8) = 10.46 and a palm 3.45, so it lands 1.73 short of the
//   disc's centre: 7.61 out, 5.6 to 6.0 down with the lean (9.4 to 9.7 away): at most 93% stretched.
// - The wind-up rises 6.0 (not the base's 7.8): 4.5 read as a coil across the body, not a lift (far camera, t = 3.0);
//   the tongs now stand above the shrine's roof before they fall.
// - Thin: clawFat 0.45 (the grip offer reads it: contact radius 0.056, hinges 0.166, depth 4.967).

import { abs, fract, mix, mul, sub, vec3, type F } from "../../../../src/index.ts";
import { cut } from "../ink.ts";
import type { Numbers } from "../numbers.ts";
import { clawsOf } from "./base.ts";

type Ink = Numbers["ink"];
/** Bamboo: straw with black node rings `per` to the unit of m, and a dark grain line down one side. */
const bamboo = (I: Ink, m: F, v: F, per: number): ReturnType<typeof vec3> => {
  const node = cut(abs(sub(fract(mul(m, per)), 0.5)), 0.47);
  const grain = sub(1, cut(abs(sub(fract(v), 0.6)), 0.04));
  return mix(mix(vec3(...I.straw), vec3(...I.strawDark), grain), vec3(...I.black), node);
};

export const tongs = clawsOf({
  about: "long slender bamboo tongs that reach the water from high up",
  numbers: { crusher: 1.15, cutter: 1.0, clawPalm: 3.0, clawFat: 0.45, armLengths: [5.0, 4.8], crushRise: 6.0, crushCoil: 2.4 },
  palm: (I, m, v) => bamboo(I, m, v, 3),
  arm: (I, m, v, elbow) => mix(bamboo(I, m, v, 6), vec3(...I.strawDark), cut(sub(0.035, abs(sub(m, elbow))), 0)),
  // At rest the tongs hang down in front, elbows raised like a mantis's, the fingers near the water: well forward and out,
  // so they frame the face instead of crossing it.
  // fold 0.55 is the base claw's: the tongs keep how far the palms fold in toward the face.
  rest: { wrist: (n, side) => [n.carapace.to + 2.2, -3.6, side * (n.carapace.width + 0.5)], fold: 0.55 },
  finger: (I, m) => mix(mix(vec3(...I.straw), vec3(...I.strawDark), cut(m, 0.55)), vec3(...I.brickDark), cut(m, 0.86)),
});

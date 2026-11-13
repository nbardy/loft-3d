// A pebble: the fiddler's carapace. Smooth, domed, wider at the front than the back (a fiddler's is a rounded
// trapezoid), in the darkest body ink. No mottle: its only pattern is two engraved growth lines running round the rim
// and one pale line where the dome meets the belly, so it reads as one dark stone from far away. Same strand
// coordinates as the base (m tail to front), so a face may still ride it.

import { abs, add, mix, mul, place, rigid, sin, strand, sub, through, vec3 } from "../../../../src/index.ts";
import { cut, TAU } from "../ink.ts";
import type { CarapaceOption } from "../slots.ts";

export const pebble: CarapaceOption = {
  about: "a smooth dark pebble, domed, wider in front, two growth lines round the rim",
  numbers: { carapace: { height: 1.7 } },
  draw: ({ n, body }) => {
    const C = n.carapace, I = n.ink;
    const hull = place(strand({
      name: "titan", spine: (m) => through(m, [[C.from, 0.05, 0], [(C.from + C.to) / 2, 0.2, 0], [C.to, 0.05, 0]]), stations: 10,
      girth: (m) => mul(C.width, add(0.86, mul(m, 0.14))), section: { aspect: C.height / C.width, squareness: 2.05 },
      tips: [{ round: 0.5 }, { round: 0.42 }], up: [0, 1, 0],
      paint: (m, v) => {
        // s: 1 on the crown, falling to -1 under the belly. The rim is where it crosses -0.1.
        const s = sin(mul(v, TAU));
        const dome = mix(vec3(...I.brickDark), vec3(...I.brick), sub(1, cut(abs(sub(s, 0.32)), 0.022)));
        const lined = mix(dome, vec3(...I.brick), sub(1, cut(abs(sub(s, 0.12)), 0.018)));
        const rim = sub(1, cut(abs(sub(s, -0.1)), 0.03));
        return mix(mix(vec3(...I.cream), lined, cut(s, -0.1)), vec3(...I.black), rim);
      },
      detail: { along: 44, around: 44 },
    }), rigid(body));
    return { hull, things: [hull] };
  },
};

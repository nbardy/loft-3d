// The carapace: a short fat strand in brick with dark mottling, a cream belly and a pale-then-black rim line. Its tail
// rises `carapace.rise` above the line (a hermit's climbs into its shell; 0 for a crab).

import { abs, mix, mul, place, rigid, sin, strand, sub, through, vec3 } from "../../../../src/index.ts";
import { cut, mottle } from "../ink.ts";
import type { CarapaceOption } from "../slots.ts";

export const base: CarapaceOption = {
  about: "brick shell, mottled, cream belly and a rim line",
  draw: ({ n, body }) => {
    const C = n.carapace, I = n.ink;
    const hull = place(strand({
      name: "titan", spine: (m) => through(m, [[C.from, -0.1 + C.rise, 0], [(C.from + C.to) / 2, 0.15, 0], [C.to, 0, 0]]), stations: 8,
      girth: C.width, section: { aspect: C.height / C.width, squareness: 2.3 }, tips: [{ round: 0.45 }, { round: 0.4 }],
      paint: (m, v) => {
        const rim = sub(1, cut(abs(sub(sin(mul(v, Math.PI * 2)), -0.15)), 0.035));
        const back = mix(vec3(...I.brick), vec3(...I.brickDark), mottle(m, v));
        const belly = vec3(...I.cream);
        return mix(mix(belly, back, cut(sin(mul(v, Math.PI * 2)), -0.2)), vec3(...I.black), rim);
      },
      detail: { along: 40, around: 40 }, up: [0, 1, 0],
    }), rigid(body));
    return { hull, things: [hull] };
  },
};

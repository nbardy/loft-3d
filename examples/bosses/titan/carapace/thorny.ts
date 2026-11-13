// A thorny ball: the spider crab's small round body. A strand whose round tips meet in the middle (a sphere, a little
// squat), dark olive hatched with short black strokes and pricked with straw knobs; then a field of thorns (one
// instanced horn, ~190 copies over the body's (m, v), spread evenly by the golden angle) that makes the outline spiky
// from every camera. The front cap is left bare: the face sits there. A few long spines stand up from the shoulders.
//
// It keeps the carapace contract: `hull` runs m from tail (0) to front (1).

import { add, draw, fract, spiralTube, mix, mul, pick, place, points, rigid, sin, smoothstep, strand, sub, vec3, type Drawable, type F } from "../../../../src/index.ts";
import { cut } from "../ink.ts";
import type { CarapaceOption } from "../slots.ts";

const THORNS = 190, GOLDEN = 0.6180339887;

/** A drawable that casts no shadow (`skeletons` empty is the Drawable contract's "none"). */
const castsNone = (d: Drawable): Drawable => ({ name: d.name, draws: (ctx) => d.draws(ctx), skeletons: [], surfaces: d.surfaces });

export const thorny: CarapaceOption = {
  about: "a small round body, dark olive, bristling with thorns",
  // A ball 4.8 across: from -2.4 to 2.4 along x, 2.4 half-width (the shoulders and the face hang off these), 2.1 half-height.
  numbers: { carapace: { from: -2.4, to: 2.4, width: 2.4, height: 2.1 } },
  draw: ({ n, body }) => {
    const C = n.carapace, I = n.ink;
    const hull = place(strand({
      name: "titan", spine: (m) => vec3(mix(C.from, C.to, m), 0, 0), stations: 12,
      // Round tips each half the length: the caps meet in the middle and make a ball.
      girth: C.width, section: { aspect: C.height / C.width }, tips: [{ round: 0.5 }, { round: 0.5 }],
      paint: (m, v) => {
        // Short hatching strokes (a slanted line field, broken into dashes) and scattered straw knobs.
        const hatch = mul(cut(sin(add(mul(m, 70), mul(v, 41))), 0.55), cut(sin(add(mul(m, 13), mul(v, 97))), -0.2));
        const knob = cut(mul(sin(mul(m, 37)), sin(add(mul(v, 53), 0.7))), 0.82);
        return mix(mix(vec3(...I.thorn), vec3(...I.thornDark), hatch), vec3(...I.strawDark), knob);
      },
      detail: { along: 40, around: 40 }, up: [0, 1, 0],
    }), rigid(body));

    // One thorn shape: leaves along the body's outward direction (y of the body's frame there), curling back toward the tail.
    const thorn = spiralTube({
      name: "thorn", length: 0.62, curl: 0.45, taper: 0.12, girth: 0.11, out: [0, 1, 0], toward: [-1, 0, 0],
      paint: (m) => mix(vec3(...I.thornDark), vec3(...I.straw), cut(m, 0.72)),
      detail: { along: 6, around: 6 },
    });
    // Spread evenly over the body (m uniform along a sphere's axis is uniform in area), not on the front cap.
    // They cast no shadow: from 7 above the water 190 thorn shadows are noise inside the body's own, and they were half the
    // frame's shadow capsules (2706 in all against the base's 460; profile, far camera, 2026-11-11).
    const thorns = castsNone(draw.points("thorns", place(points(THORNS, (i: F) => {
      const m = mix(0.03, 0.84, mul(add(i, 0.5), 1 / THORNS));
      const v = fract(mul(i, GOLDEN));
      // Bigger on the back and shoulders, smaller toward the face; each its own size.
      const big = mix(0.7, 1.35, fract(mul(i, 0.7548776662)));
      return { at: vec3(m, v, 0.92), scale: mul(big, sub(1, mul(smoothstep(0.62, 0.84, m), 0.45))) };
    }), hull), thorn));

    // Long spines: six standing up off the shoulders and the back (the far silhouette's spikes).
    const spine = spiralTube({
      name: "spine", length: 1.5, curl: 0.25, taper: 0.1, girth: 0.12, out: [0, 1, 0], toward: [-1, 0, 0],
      paint: (m) => mix(vec3(...I.thornDark), vec3(...I.straw), cut(m, 0.6)),
      detail: { along: 8, around: 6 },
    });
    const SPINES: readonly (readonly [number, number])[] = [[0.62, 0.2], [0.62, 0.3], [0.45, 0.12], [0.45, 0.38], [0.3, 0.06], [0.3, 0.44]];
    const spines = draw.points("spines", place(points(SPINES.length, (i: F) => ({ at: vec3(pick(i, SPINES.map((s) => s[0])), pick(i, SPINES.map((s) => s[1])), 0.9), scale: 1 })), hull), spine);
    return { hull, things: [hull, thorns, spines] };
  },
};

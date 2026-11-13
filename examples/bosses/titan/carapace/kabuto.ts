// The kabuto carapace (the mask direction): a tall dark-lacquer helmet bowl ribbed front to back (the suji-bachi's
// ribs as lighter lines), a red band low round it laced with cream, and on each flank a sode: a big lamellar shoulder
// guard hanging over the leg roots, rows of black scales stepped outward and laced with red cord.
//
// The strand keeps the carapace contract (m tail to front; v round the section, sin(2 pi v) its height), so the base face's beard still rides
// it. The bowl is taller than the base's (`numbers`): the mask's front needs the height, and it ends a little shorter
// so the mask (face/mask.ts) stands in front of it.
//
// Motion: the sode hang from their top edges and swing out late after Claw Crush's slam (follow-through), sway with
// the walk read 0.3 s late (drag), and keep a small moving hold of their own (uneven sides). Two cord tassels hang from
// the helmet's back and swing later and longer still.

import {
  abs, add, cos, draw, dragged, fract, framed, lift, max, mix, mul, place, rigid, sin, spacing, strand, sub, surface, swing, through, time, vec3,
  alive, smoothstep, type F,
} from "../../../../src/index.ts";
import { cut, perFrame, sides, TAU } from "../ink.ts";
import type { CarapaceOption } from "../slots.ts";

/** Rows of scales on a sode, and laces across it. */
const ROWS = 6, LACES = 9;

export const kabuto: CarapaceOption = {
  about: "tall ribbed lacquer helmet, red laced band, lamellar shoulder guards",
  numbers: { carapace: { from: -2.6, to: 4.3, width: 3.9, height: 2.5 } },
  draw: ({ n, body, crushAfter }) => {
    const C = n.carapace, I = n.ink;
    const hull = place(strand({
      name: "titan", spine: (m) => through(m, [[C.from, -0.1, 0], [(C.from + C.to) / 2, 0.25, 0], [C.to, 0.1, 0]]), stations: 10,
      girth: C.width, section: { aspect: C.height / C.width, squareness: 2.1 }, tips: [{ round: 0.5 }, { round: 0.45 }],
      paint: (m, v) => {
        // Height round the section: sin(2 pi v) is 1 on top and -1 underneath (the base carapace's convention; v = 0 is
        // a flank, not the top). The bowl is everything above the band; the band sits just below the equator.
        const up = sin(mul(v, TAU));
        const ribs = sub(1, cut(abs(sin(mul(v, TAU * 11))), 0.06));
        const bowl = mix(vec3(...I.lacquer), vec3(...I.brickDark), ribs);
        // The band's lacing: cream crosses along m.
        const lace = sub(1, cut(abs(sin(add(mul(m, 70), mul(v, TAU * 6)))), 0.18));
        const band = mix(vec3(...I.brick), vec3(...I.cream), mul(lace, 0.85));
        const lines = max(sub(1, cut(abs(sub(up, -0.15)), 0.012)), sub(1, cut(abs(sub(up, -0.5)), 0.012)));
        return mix(mix(mix(vec3(...I.brickDark), band, cut(up, -0.5)), bowl, cut(up, -0.15)), vec3(...I.black), lines);
      },
      detail: { along: 48, around: 64 }, up: [0, 1, 0],
    }), rigid(body));

    /** A sode on side s: hung from a top edge along the flank, swinging about it. */
    const sode = (s: 1 | -1) => {
      // The swing angle about the top edge: flared 0.42 out at rest; the walk's sway read late; flung out after the slam.
      const sway = mul(sin(mul(dragged(time, 1, 0.3), (2 * Math.PI) / n.period)), 0.06 * s);
      const angle = perFrame(`titan_sode_${s < 0 ? "L" : "R"}`, add(add(add(0.42, sway), swing(sub(crushAfter, 0.08), s > 0 ? 0.32 : 0.26, 1.1, 0.22)), alive(time, 0.03, 50 + s)));
      const L = 2.6, X0 = 3.1, X1 = -2.2, TOP = 1.8, ZT = 3.1;
      const point = (a: F, b: F) => {
        // a along the body (front to back), b down the panel. A row steps out at its lower edge (the scales overlap).
        const row = fract(mul(b, ROWS));
        const out = add(mul(row, 0.13), mul(sin(mul(a, Math.PI)), 0.35)); // stepped rows, and bowed out across
        const x = mix(X0, X1, a), d = mul(b, L);
        const y = sub(add(TOP, mul(sin(mul(a, Math.PI)), 0.12)), mul(cos(angle), d));
        const z = mul(s, add(add(ZT, mul(sin(angle), d)), mul(out, cos(angle))));
        return vec3(x, add(y, mul(out, sin(angle))), z);
      };
      const shape = framed(surface(point, { u: ["free", "free"], v: "free" }), { frame: body, scale: lift<"f32">(1) });
      return draw.surface(`sode${s < 0 ? "L" : "R"}`, shape, {
        paint: (a, b) => {
          const row = fract(mul(b, ROWS));
          const scale = fract(mul(a, LACES * 2)); // two scales per lace
          // Black-lacquer scales with a black seam between rows, a red lace down every other scale edge, cream knots
          // where a lace crosses a row's top.
          const scales = mix(vec3(...I.lacquer), vec3(...I.black), max(sub(1, cut(row, 0.08)), sub(1, cut(abs(sub(scale, 0.5)), 0.03))));
          const laceAt = abs(sub(fract(mul(a, LACES)), 0.5));
          const lace = sub(1, cut(laceAt, 0.05));
          const knot = mul(sub(1, cut(laceAt, 0.11)), sub(1, cut(abs(sub(row, 0.16)), 0.06)));
          const laced = mix(mix(scales, vec3(...I.brick), lace), vec3(...I.cream), knot);
          // The top row is a solid red-lacquer bar (the kanmuri-ita) with a cream edge.
          const crown = sub(1, cut(b, 0.1));
          return mix(laced, mix(vec3(...I.brick), vec3(...I.cream), cut(b, 0.085)), crown);
        },
        grid: { u: spacing.even(18), v: spacing.even(ROWS * 6) }, sides: "two", outline: "border",
      });
    };
    /**
     * An agemaki tassel on side s: a red cord from the helmet's back, a cream knot, a red tassel flaring at its end.
     * It hangs late: the walk's sway read 0.45 s behind the body, a fling backward after the slam that swings on longer
     * than the sode (lighter: a faster, less damped swing).
     */
    const tassel = (s: 1 | -1) => {
      const attach = vec3(C.from + 0.25, 1.35, s * 0.75);
      const sway = perFrame(`titan_tassel_sway_${s < 0 ? "L" : "R"}`, add(mul(sin(mul(dragged(time, 1, 0.45), (2 * Math.PI) / n.period)), 0.35), alive(time, 0.08, 60 + s, 0.5)));
      const fling = perFrame(`titan_tassel_fling_${s < 0 ? "L" : "R"}`, swing(sub(crushAfter, 0.15), -0.9, 1.6, 0.12));
      const spine = (m: F) => add(attach, vec3(add(mul(m, -0.55), mul(mul(m, m), fling)), mul(m, -2.1), add(mul(m, s * 0.3), mul(mul(m, m), sway))));
      return place(strand({
        name: `tassel${s < 0 ? "L" : "R"}`, spine, stations: 10, tips: ["round", "round"], up: [1, 0, 0],
        // The cord, a knot at 0.3, the tassel flaring from 0.6.
        girth: (m) => add(add(0.09, mul(sub(1, smoothstep(0, 0.07, abs(sub(m, 0.3)))), 0.16)), mul(smoothstep(0.55, 1, m), 0.2)),
        paint: (m, v) => {
          const knot = sub(1, cut(abs(sub(m, 0.3)), 0.06));
          const threads = mul(sub(1, cut(abs(sin(mul(v, TAU * 10))), 0.25)), cut(m, 0.62));
          return mix(mix(vec3(...I.brick), vec3(...I.cream), knot), vec3(...I.brickDark), threads);
        },
        detail: { along: 24, around: 10 },
      }), rigid(body));
    };
    return { hull, things: [hull, ...sides.map((s) => sode(s)), ...sides.map((s) => tassel(s))] };
  },
};


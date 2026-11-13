// The keep (the mask direction): on the helmet's crown a small earthen mound carrying a castle keep (a battered stone
// base, three tiers of white walls with black windows, each under a red roof whose sides sweep concave out to the
// eaves) flanked by two crooked pines leaning out, their flat pads of needles stacked like clouds.
//
// Everything rides the shell frame (the body's, read late, pitching on after the slam), so the keep and the pines
// lurch after Claw Crush.

import { abs, add, fract, lift, mix, mul, place, pow, rigid, sin, strand, sub, vec3, draw, type F } from "../../../../src/index.ts";
import type { Branch } from "../../../../src/lib/index.ts";
import { cut, type V3 } from "../ink.ts";
import type { BackOption } from "../slots.ts";

const cone = (a: V3, b: V3, ra: number, rb: number, salt: number): Branch => ({ a, b, ra, rb, level: 0, id: [1, salt, 0] });

/** The keep's scale, and where it stands on the crown (crab coordinates). */
const K = 1.0, AT: readonly [number, number] = [-0.7, 0];
/** Top of the mound (crab y). */
const MOUND_TOP = 3.0;

type Pad = readonly [number, number, number, number]; // x, y, z, radius
/** A pine: a crooked trunk through `path` (cones), a short limb from the nearest trunk point to each pad. The pads are
 * drawn as flattened strands (`padsOf`): a copies cone has round caps, so it cannot be a flat pad. */
function pine(path: readonly V3[], pads: readonly Pad[], salt: number): Branch[] {
  const trunk = path.slice(1).map((b, i) => cone(path[i]!, b, 0.22 * (1 - i * 0.2), 0.22 * (1 - (i + 1) * 0.2), salt + i));
  const limbs = pads.map(([x, y, z], i) => {
    const near = path.reduce((a, p) => (Math.hypot(p[0] - x, p[1] - y, p[2] - z) < Math.hypot(a[0] - x, a[1] - y, a[2] - z) ? p : a));
    return cone(near, [x, y - 0.05, z], 0.11, 0.07, salt + 30 + i);
  });
  return [...trunk, ...limbs];
}

export const keep: BackOption = {
  about: "a castle keep with three concave red roofs on a mound, two crooked pines",
  draw: ({ n, shell }) => {
    const I = n.ink;
    const [kx, kz] = AT;

    const mound = place(strand({
      name: "mound", spine: (m) => mix(vec3(kx - 1.8, MOUND_TOP - 0.55, kz), vec3(kx + 1.5, MOUND_TOP - 0.5, kz), m), stations: 6, girth: 2.1,
      section: { aspect: 0.27, squareness: 2.2 }, tips: [{ round: 0.5 }, { round: 0.5 }], up: [0, 1, 0],
      paint: (m, v) => mix(vec3(...I.moss), vec3(...I.mossDeep), cut(mul(sin(mul(m, 29)), sin(mul(v, 41))), 0.45)),
      detail: { along: 20, around: 28 },
    }), rigid(shell));

    /** One tier of the keep: a vertical strand from y0 to y1 (keep units over the mound), its girth over m. */
    const tier = (name: string, y0: number, y1: number, girth: (m: F) => F, paint: (m: F, v: F) => ReturnType<typeof vec3>, tipTop: "flat" | "point") => place(strand({
      name, spine: (m) => mix(vec3(kx, MOUND_TOP - 0.1 + y0 * K, kz), vec3(kx, MOUND_TOP - 0.1 + y1 * K, kz), m), stations: 6,
      girth: (m) => mul(girth(m), K), section: { squareness: 4 }, tips: [{ round: 0.03 }, tipTop === "point" ? { point: 0.2 } : { round: 0.03 }], up: [1, 0, 0],
      paint, detail: { along: 18, around: 24 },
    }), rigid(shell));

    // The battered stone base: girth flaring concave to its foot; stone courses and staggered joints.
    const stones = (m: F, v: F) => {
      const course = sub(1, cut(abs(sub(fract(mul(m, 3)), 0.5)), 0.04));
      const joint = sub(1, cut(abs(sub(fract(add(mul(v, 8), mul(fract(mul(m, 2.5)), 1))), 0.5)), 0.04));
      return mix(vec3(...I.stone), vec3(...I.bark), mul(add(course, joint), 0.8));
    };
    // White walls: a black board skirt at the foot, a row of black windows.
    const wall = (rows: number) => (m: F, v: F) => {
      const skirt = sub(1, cut(m, 0.28));
      const win = mul(sub(1, cut(abs(sub(fract(mul(v, rows)), 0.5)), 0.13)), mul(cut(m, 0.45), sub(1, cut(m, 0.75))));
      const top = cut(m, 0.92);
      return mix(mix(vec3(...I.cream), vec3(...I.black), add(skirt, win)), vec3(...I.black), top);
    };
    // Red tiled roofs: tile columns as black lines up the slope, a black eave edge, a cream ridge at the top.
    const roof = (m: F, v: F) => {
      const tiles = sub(1, cut(abs(sub(fract(mul(v, 48)), 0.5)), 0.12));
      const eave = sub(1, cut(m, 0.12));
      return mix(mix(vec3(...I.brick), vec3(...I.brickDark), mul(tiles, 0.9)), vec3(...I.black), eave);
    };
    /** A roof's girth: from the eave's overhang `eave`, concave, to `top` (the sweep of a Japanese roof). */
    const sweep = (eave: number, top: number, power: number) => (m: F): F => add(top, mul(pow(sub(1, m), power), eave - top));

    const keepParts = [
      tier("keepBase", 0, 0.7, (m) => add(1.1, mul(pow(sub(1, m), 2), 0.35)), stones, "flat"),
      tier("keepWall1", 0.65, 1.65, () => lift<"f32">(0.95), wall(8), "flat"),
      tier("keepRoof1", 1.55, 1.95, sweep(1.25, 0.66, 2.4), roof, "flat"),
      tier("keepWall2", 1.85, 2.6, () => lift<"f32">(0.72), wall(6), "flat"),
      tier("keepRoof2", 2.5, 2.85, sweep(0.98, 0.48, 2.4), roof, "flat"),
      tier("keepWall3", 2.75, 3.35, () => lift<"f32">(0.52), wall(4), "flat"),
      tier("keepRoof3", 3.25, 4.0, sweep(0.8, 0.03, 1.8), roof, "point"),
    ];

    // Two pines on the mound's flanks, leaning out over the sides, crooked, unequal (the right one taller).
    const y0 = MOUND_TOP - 0.2;
    const right: { path: V3[]; pads: Pad[] } = {
      path: [[kx - 0.6, y0, 1.6], [kx - 0.1, y0 + 1.2, 2.2], [kx - 0.8, y0 + 2.2, 3.0], [kx - 0.3, y0 + 3.1, 3.7], [kx - 0.6, y0 + 3.6, 4.4]],
      pads: [[kx - 0.4, y0 + 3.7, 4.5, 1.15], [kx - 1.5, y0 + 2.6, 3.7, 0.85], [kx + 0.5, y0 + 2.3, 2.6, 0.8], [kx - 0.9, y0 + 3.15, 2.9, 0.7]],
    };
    const left: { path: V3[]; pads: Pad[] } = {
      path: [[kx - 0.2, y0, -1.7], [kx + 0.3, y0 + 1.0, -2.3], [kx - 0.3, y0 + 1.9, -3.0], [kx + 0.1, y0 + 2.6, -3.7]],
      pads: [[kx + 0.2, y0 + 2.7, -3.85, 1.05], [kx - 0.9, y0 + 2.1, -3.4, 0.8], [kx + 0.8, y0 + 1.7, -2.3, 0.7]],
    };
    const trunks = draw.copies("pines", {
      kind: "cone", copies: [...pine(right.path, right.pads, 200), ...pine(left.path, left.pads, 300)], carry: shell,
      paint: ({ p }) => {
        // Bark with dark cracks.
        const crack = sub(1, cut(abs(sin(add(mul(p.y, 11), mul(sin(mul(p.x, 7)), 2)))), 0.25));
        return mix(vec3(...I.bark), vec3(...I.black), mul(crack, 0.7));
      },
      outline: "silhouette", minPixels: 1, keepLevels: 1, inkBack: 6,
    });
    // A pad: a flattened lozenge, longer across the tree than along it, needle strokes on top, a dark band beneath.
    const pads = [...right.pads, ...left.pads].map(([x, y, z, r], i) => place(strand({
      name: `pinePad${i}`, spine: (m) => mix(vec3(x - r * 0.25, y, z - r * 0.55 * Math.sign(z)), vec3(x + r * 0.25, y, z + r * 0.55 * Math.sign(z)), m), stations: 4,
      girth: r * 0.85, section: { aspect: 0.32, squareness: 2.4 }, tips: [{ round: 0.5 }, { round: 0.5 }], up: [0, 1, 0],
      paint: (m, v) => {
        const needles = sub(1, cut(abs(sin(add(mul(m, 34), mul(v, 17)))), 0.35));
        const under = cut(abs(sub(v, 0.5)), 0.22);
        return mix(mix(vec3(...I.moss), vec3(...I.mossDeep), mul(needles, 0.85)), vec3(...I.mossDeep), sub(1, under));
      },
      detail: { along: 10, around: 16 },
    }), rigid(shell)));
    const pineList = [trunks, ...pads];
    return [mound, ...keepParts, ...pineList];
  },
};

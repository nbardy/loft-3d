// Night Hunt (biolume). A glowing serpent swims along the surface after a small fleet whose lanterns are the only
// warm light on the sea. Its skin is real relief, overlapping scales whose free edges carry cold light, with a
// lateral line of magenta photophores down each flank; pearls of living light drift in the black water around it and
// its wake burns behind it. Everything bright is either the hunter (cyan, magenta) or the hunted (lantern amber).
import {
  abs, add, div, draw, flare, floor, fract, ge, impostors, lift, lt, mix, mod, mul, pow, saturate, scene, sea, select, sin,
  smoothstep, spacing, sub, through, time, TAU, vec2, vec3, biolume, wake,
  type Drawable, type Expr, type F, type P3,
} from "../../src/index.ts";
import { ship } from "../recipes/ship.ts";
import type { ReliefPoint, ReliefSite } from "../../src/draw/relief.ts";
import type { Warp } from "../../src/map/types.ts";
import { hash2, hash33 } from "../../src/lib/index.ts";
import { brig, sloop } from "./lib/fleet.ts";
import { wyrm } from "./lib/wyrm.ts";

// ---- named numbers ------------------------------------------------------------------------------------------------
const LOOP = 8, W = (2 * Math.PI) / LOOP;
const HUNTER = {
  length: 30, girth: 1.0, size: 1.55, headAt: 9, headHeight: 3.2, ride: -0.55,
  humps: 2.5, humpHeight: 1.1, sway: 1.4, waves: 1.3,
};
/** Scales: rows along the body and scales round it, the bow of a scale's free edge, its height. */
const SCALES = { along: 70, round: 16, bow: 0.32, height: 0.045 };
const HMAX = 0.06;
const SHIPS = [
  { name: "lugger", kind: "sloop", at: [16.5, 3], heading: 0.15, length: 4.4 },
  { name: "packet", kind: "brig", at: [21, -4], heading: 0.05, length: 5.6 },
  { name: "ketch", kind: "sloop", at: [24, 5.5], heading: 0.3, length: 4.0 },
] as const;
const WIND: readonly [number, number] = [1, 0.1];
const LANTERN: readonly [number, number, number] = [1.0, 0.62, 0.22];

const water = sea({
  swell: [
    { direction: [1, 0.25], length: 14, height: 0.3, speed: 1.1 },
    { direction: [-0.3, 1], length: 6, height: 0.1, speed: 0.8, phase: 1.3 },
  ],
  foam: 0.35,
});

// ---- the hunter's swim: head up and steady, humps travelling back, the body swaying more toward the tail ----------
const H = HUNTER, N = 20;
const spinePoints: P3[] = Array.from({ length: N }, (_, i) => {
  const s = i / (N - 1);
  const x = H.headAt - H.length * s;
  if (i < 3) {
    // The neck rises out of the water in a curve; the head nods a little on the loop.
    const q = 1 - i / 3;
    const nod = mul(sin(add(mul(time, 2 * W), i)), 0.15 * q);
    return vec3(x + 0.6 * q, add(H.ride + (H.headHeight - H.ride) * Math.sin((q * Math.PI) / 2), nod), mul(sin(mul(time, W)), 0.4 * q));
  }
  const p = (i - 3) / (N - 4);
  const hump = sin(mul(sub(H.humps * p, mul(time, H.humps / LOOP)), Math.PI));
  const y = add(H.ride, mul(mul(hump, hump), H.humpHeight * Math.min(1, p * 6) * (1 - 0.4 * p)));
  const sway = mul(sin(mul(sub(H.waves * p, mul(time, 1 / LOOP)), TAU)), H.sway * (0.2 + 0.8 * p));
  return vec3(x, y, sway);
});

const C = {
  back: [0.05, 0.05, 0.1], belly: [0.25, 0.3, 0.38], band: [0.1, 0.12, 0.22], membrane: [0.9, 0.2, 0.75],
  bone: [0.7, 0.95, 1.0], iris: [1.0, 1.0, 0.85], mouth: [0.95, 0.2, 0.7],
} as const;
const hunter = wyrm({
  name: "hunter", spine: (m) => through(m, spinePoints), stations: 64, girth: H.girth, size: H.size,
  gape: add(0.3, mul(sin(mul(time, W)), 0.1)), colours: C, along: 300, crest: { from: 0.05, to: 0.55, height: 1.0 }, bands: 0,
});

// ---- scales as relief (after examples/serpent_relief.ts), lit at their edges -----------------------------------------
const S = SCALES;
const edge = (y: F): F => add(0.5, mul(sub(1, mul(mul(y, y), 4)), S.bow));
/** Which scale lies on top at (m, v): its brick cell, or the one ahead when inside that scale's bowed free edge. */
const scaleFold: Warp<"vec2"> = (pp) => {
  const p = lift<"vec2">(pp);
  const g = vec2(mul(p.x, S.along), mul(p.y, S.round));
  const row = floor(add(g.x, 0.5));
  const y0 = add(g.y, mul(mod(row, 2), 0.5));
  const x = sub(g.x, row), y = sub(y0, floor(add(y0, 0.5)));
  const side = select(ge(y, 0), 0.5, -0.5);
  const xf = add(x, 1), yf = sub(y, side);
  const ahead = lt(xf, edge(yf));
  const local = select(ahead, vec2(xf, yf), vec2(x, y));
  const centre = sub(g, local);
  return { x: local, id: vec2(floor(add(centre.x, 0.5)), floor(add(mul(centre.y, 2), 0.5))), stretch: lift<"f32">(1 / S.along), toWorld: (d) => d };
};
/** 1 on back and flanks, 0 on the belly and at the closing tips. */
const scaleMask = (m: F, v: F): F => {
  const fromBelly = abs(sub(mod(add(v, 0.75), 1), 0.5));
  return mul(mul(smoothstep(0.08, 0.16, fromBelly), smoothstep(0.015, 0.05, m)), smoothstep(0.985, 0.95, m));
};
const scaleHeight = (q: Expr<"vec2">): F => {
  const e = edge(q.y);
  const s = saturate(div(add(q.x, 0.75), add(e, 0.75)));
  const rise = add(0.15, mul(pow(s, 1.6), 0.85));
  const lip = smoothstep(e, sub(e, 0.16), q.x);
  const seam = sub(1, mul(smoothstep(0.36, 0.5, abs(q.y)), 0.55));
  return mul(mul(mul(rise, lip), seam), S.height);
};
const height = (s: ReliefSite): F => mul(scaleHeight(s.cell.x), scaleMask(s.u, s.v));
/** A photophore line along each flank (0.2 of a turn from the dorsal line), dotted one light per few scale rows. */
const PHOTO = 0.2;
function paint(p: ReliefPoint): P3 {
  const m = p.u, v = p.v, q = p.cell.x;
  const dorsal = smoothstep(-0.3, -0.12, sin(mul(v, TAU)));
  const under = mix(vec3(...C.belly), vec3(...C.back), dorsal);
  const e = edge(q.y);
  const rim = mul(smoothstep(sub(e, 0.22), sub(e, 0.04), q.x), scaleMask(m, v));
  // The edge light flickers scale by scale, a slow wave running down the body.
  const pulse = add(0.55, mul(sin(sub(add(mul(m, 18), mul(hash2(p.cell.id), 2)), mul(time, 2 * W))), 0.45));
  const body = mix(under, vec3(0.1, 0.45, 0.6), mul(scaleMask(m, v), mul(smoothstep(-0.6, 0.4, q.x), 0.5)));
  const lit = mix(body, vec3(0.2, 0.9, 1.0), mul(rim, pulse));
  const flank = abs(sub(abs(sub(mod(add(sub(v, 0.25), 0.5), 1), 0.5)), PHOTO));
  const dots = mul(smoothstep(0.02, 0.008, flank), smoothstep(0.3, 0.1, abs(sub(fract(mul(m, 28)), 0.5))));
  return mix(lit, vec3(1.0, 0.25, 0.85), mul(dots, smoothstep(0.03, 0.08, m)));
}
const skin = draw.relief("hunterSkin", hunter.body, {
  height, hMax: HMAX, fold: scaleFold, paint, steps: 24, outline: "ink",
  grid: { u: spacing.ends(260), v: spacing.from(40, 0.25) },
});

// ---- the fleet and its lanterns -------------------------------------------------------------------------------------
const fleet = SHIPS.flatMap((s) => {
  const spec = s.kind === "brig" ? brig(s.name, s.length) : sloop(s.name, s.length);
  return ship(spec).afloat(water, { at: s.at, heading: s.heading, wind: WIND });
});
/** A stern lantern and a masthead light per ship, riding the swell with it. */
const lanterns = SHIPS.flatMap((s) => {
  const dx = Math.cos(s.heading), dz = Math.sin(s.heading);
  const at = (along: number, up: number): P3 => {
    const xz = vec2(s.at[0] + dx * along, s.at[1] + dz * along);
    return vec3(xz.x, add(water.height(xz), up), xz.y);
  };
  const flicker = add(0.85, mul(sin(add(mul(time, 7.3), s.at[0])), 0.15));
  return [
    flare(`${s.name}Stern`, at(-0.48 * s.length, 1.3), { size: 0.12, halo: 9, colour: LANTERN, core: [1, 0.95, 0.8], intensity: flicker, rays: 4, veil: { kind: "clear" } }),
    flare(`${s.name}Mast`, at(0.1 * s.length, 0.95 * s.length * (s.kind === "brig" ? 1.0 : 1.25)), { size: 0.07, halo: 7, colour: LANTERN, core: [1, 0.95, 0.8], intensity: mul(flicker, 0.7), rays: 0, veil: { kind: "clear" } }),
  ];
});

// ---- pearls of light drifting under the surface -----------------------------------------------------------------------
const CELL: [number, number, number] = [1.6, 1.2, 1.6];
const motes = impostors("motes", {
  cell: CELL, bounds: { min: [-30, -0.9, -16], max: [30, 0.3, 16] }, cells: 48, outline: "none",
  shape: (c) => {
    const h = c.hash;
    const radius = mix(0.06, 0.15, h.y);
    const room = sub(CELL[0] / 2, radius);
    const j = hash33(add(c.id, vec3(17, 31, 7)));
    const bob = mul(sin(add(mul(time, W), mul(h.x, 40))), 0.1);
    return {
      kind: "sphere",
      centre: vec3(mul(sub(j.x, 0.5), mul(room, 1.8)), bob, mul(sub(j.y, 0.5), mul(room, 1.8))),
      radius: select(lt(h.x, 0.16), radius, 0),
    };
  },
  // Vivid: biolume turns bright, saturated paint into light (cyan, or magenta for the reds and purples).
  paint: ({ cell }) => select(lt(cell.hash.z, 0.7), vec3(0.2, 0.95, 1.0), vec3(1.0, 0.3, 0.9)),
});

// ---- the scene ----------------------------------------------------------------------------------------------------
const drawnBody = new Set(["hunter"]);
const parts: Drawable[] = hunter.things.filter((t) => !drawnBody.has(t.name));

export default scene({
  ground: water,
  things: [skin, ...parts, wake(hunter.body, { over: 2.4, samples: 10 }), ...fleet, ...lanterns, motes],
  style: biolume(),
  sun: [-0.3, 0.8, 0.5],
  cameras: {
    game: { kind: "perspective", eye: [8, 29, 26], target: [5.5, 0, 1.5], fovY: 0.82 },
    hero: { kind: "perspective", eye: [0, 3.8, -10], target: [14, 2.6, 0.5], fovY: 0.8 },
    close: { kind: "perspective", eye: [16, 5.5, 8], target: [7, 2.4, 0], fovY: 0.6 },
  },
});

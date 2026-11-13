// Island Tide (toon, bright daylight). The islandback crab (examples/islandback.ts) wades sideways across a reef flat
// in clear turquoise shallows: a sand bed shows through the water, branching coral heads stand either side of its
// path and break the surface, barnacles crust its carapace, and two palms have taken root
// beside the shell, so the creature reads as an island that walks. Small sloops stand off at a respectful distance
// for scale.
import {
  abs, add, div, draw, f, fract, log, lt, max, min, mix, mod, mul, on, place, points, scene, sea, select, sin,
  smoothstep, spacing, step, strand, sub, surface, time, toon, vec2, vec3, type Drawable, type F, type P3, type Strand,
} from "../../src/index.ts";
import { ship } from "../recipes/ship.ts";
import { bound } from "../../src/draw/trace.ts";
import { fieldPixel } from "../../src/draw/field.ts";
import { grow, hash3, hsv, levels, rotate2, sdRoundCone, type Folded } from "../../src/lib/index.ts";
import { noise2 } from "../../src/lib/noise.ts";
import islandback from "../islandback.ts";
import { sloop } from "./lib/fleet.ts";

// ---- named numbers ------------------------------------------------------------------------------------------------
const BED = -1.05;                 // the sand along the crab's path, just under its planted feet (y = -1)
const BED_BAR = -0.45, BED_DEEP = -3.2; // tops of the sand bars, floors of the channels
const WIND: readonly [number, number] = [0.9, 0.4];
const BARNACLES = 64;
const CLAW_BARNACLES = 18;
/** Reef heads: where (x, z), how big (1 = a 4.5-unit tree), turned. Kept clear of the crab's legs (|x| < 5, z -8..16). */
const REEF_A = [
  { at: [-8.5, -3], size: 0.7, turn: 0 }, { at: [-10.5, 2.5], size: 0.6, turn: 2.1 }, { at: [-7.5, 7.5], size: 0.75, turn: 4.0 },
] as const;
const REEF_B = [
  { at: [9.5, -4], size: 0.62, turn: 1.0 }, { at: [11.5, 3], size: 0.75, turn: 3.0 }, { at: [8.5, 10.5], size: 0.58, turn: 5.0 },
] as const;
const SAND = [1.0, 0.95, 0.78] as const, WEED = [0.3, 0.5, 0.25] as const;

// ---- the water and the bed ------------------------------------------------------------------------------------------
const water = sea({
  swell: [{ direction: [1, 0.3], length: 12, height: 0.16, speed: 0.9 }, { direction: [-0.3, 1], length: 5.5, height: 0.05, speed: 0.7, phase: 1.3 }],
  foam: 0.3,
});
const BED_HALF = 90;
/**
 * The bed's height: sand bars just under the surface and channels between them (the light and dark of a lagoon seen
 * from above), levelled to the crab's footing along its path so its planted feet stand on the sand.
 */
const bedHeight = (x: F, z: F): F => {
  const bars = smoothstep(-0.2, 0.6, sin(add(add(mul(x, 0.16), mul(z, 0.05)), mul(sin(mul(z, 0.11)), 1.6))));
  const path = smoothstep(5, 8, abs(x));
  return mix(BED, add(BED_DEEP, mul(bars, BED_BAR - BED_DEEP)), path);
};
const bedMap = surface((u: F, v: F) => {
  const x = mul(sub(u, 0.5), 2 * BED_HALF), z = mul(sub(v, 0.5), 2 * BED_HALF);
  return vec3(x, bedHeight(x, z), z);
}, { u: ["free", "free"], v: "free" });
/** Sand with ripples across the swell and drifts of weed, by position on the bed. */
const bedPaint = (u: F, v: F): P3 => {
  const xz = vec2(mul(sub(u, 0.5), 2 * BED_HALF), mul(sub(v, 0.5), 2 * BED_HALF));
  const ripple = smoothstep(0.55, 0.9, sin(add(mul(add(xz.x, mul(xz.y, 0.3)), 2.2), mul(noise2(mul(xz, 0.4)), 3))));
  const weed = smoothstep(0.2, 0.5, noise2(mul(xz, 0.11)));
  return mix(mix(vec3(...SAND), mul(vec3(...SAND), 0.88), ripple), vec3(...WEED), mul(weed, 0.9));
};
// Two-sided: with u along x and v along z the map's front faces down, so a one-sided bed is culled from above.
const bed = draw.surface("bed", bedMap, { paint: bedPaint, grid: { u: spacing.even(160), v: spacing.even(160) }, sides: "two", outline: "none" });

// ---- coral heads: the fold of examples/coral.ts, three trees per reef ------------------------------------------------
const L = 1.5, R = 0.3, K = 0.76, TILT = 0.5, TURN = 2.4, MAX_LEVELS = 9;
const depth = levels(2, MAX_LEVELS, add(1, div(log(div(2 * R, max(fieldPixel, 1e-6))), Math.log(1 / K))));
const turnY = (q: P3, a: F): P3 => { const r = rotate2(vec2(q.x, q.z), a); return vec3(r.x, q.y, r.y); };
const tree = grow({
  count: depth,
  motif: (q) => sdRoundCone(q, [0, 0, 0], [0, L, 0], R, R * 0.8),
  step: (q): Folded<"vec3"> => {
    const tip = turnY(sub(q, vec3(0, L, 0)), f(TURN));
    const r = rotate2(vec2(abs(tip.x), tip.y), TILT);
    return { x: div(vec3(r.x, r.y, tip.z), K), id: vec3(step(0, tip.x), 0, 0), stretch: f(K), toWorld: (d) => mul(d, K) };
  },
});
function reef(name: string, heads: readonly { readonly at: readonly [number, number]; readonly size: number; readonly turn: number }[], hue: number) {
  const trees = (p: P3) => heads.map((t, k) => {
    const q = turnY(sub(p, vec3(t.at[0], BED - 0.1, t.at[1])), f(t.turn));
    const g = tree(div(q, t.size));
    return { d: mul(g.d, t.size), level: g.level, id: add(g.id, vec3(0, k, 0)) };
  }).reduce((a, b) => {
    const nearer = lt(b.d, a.d);
    return { d: min(a.d, b.d), level: select(nearer, b.level, a.level), id: select(nearer, b.id, a.id) };
  });
  const xs = heads.map((h) => h.at[0]), zs = heads.map((h) => h.at[1]), reach = 2.6;
  return draw.field(name, (p: P3) => trees(p).d, {
    bounds: bound.box([Math.min(...xs) - reach, BED - 0.3, Math.min(...zs) - reach], [Math.max(...xs) + reach, BED + 4.4, Math.max(...zs) + reach]),
    paint: ({ p }) => {
      const g = trees(p);
      const t = div(g.level, MAX_LEVELS);
      return hsv(add(mix(hue, hue + 0.2, t), mul(sub(hash3(g.id), 0.5), 0.06)), mix(0.85, 0.65, t), mix(0.85, 1.0, t));
    },
    steps: 96, outline: "silhouette", schedule: "auto",
  });
}
const reefs = [reef("reefA", REEF_A, 0.93), reef("reefB", REEF_B, 0.02)];

// ---- the crab, crusted --------------------------------------------------------------------------------------------
const derived = new Set(["sky", "sea", "shadows"]);
const crab: Drawable[] = islandback.things.filter((t) => !derived.has(t.name));
const carapace = crab.find((t) => t.name === "islandback") as unknown as Strand & Drawable;

/** A barnacle: a squat cone, open at the top, chalk outside and dark in the mouth. */
const barnacle = strand({
  name: "barnacle", spine: (m) => vec3(0, sub(mul(m, 0.4), 0.08), 0), stations: 4, girth: (m) => mix(0.3, 0.14, m),
  tips: ["open", { round: 0.25 }], up: [1, 0, 0],
  paint: (m) => mix(vec3(0.86, 0.85, 0.74), vec3(0.3, 0.28, 0.24), smoothstep(0.85, 0.97, m)), detail: { along: 4, around: 10 },
});
// The shell covers the top of the carapace, so the crust grows round its rim (v near 0 and 0.5, the sides) in
// irregular clumps, and over the back of the great claw, which is carried at the front where the camera sees it.
const crust = draw.points("crust", place(points(BARNACLES, (i: F) => {
  const m = add(0.08, mul(fract(mul(i, 0.618034)), 0.84));
  const side = select(lt(mod(i, 2), 1), 0.02, 0.48);
  const v = add(side, mul(sub(fract(mul(i, 0.3819)), 0.5), 0.16));
  return { at: vec3(m, v, 0.97), scale: add(0.5, mul(fract(mul(i, 0.7548)), 1.3)) };
}), carapace), barnacle);
const crusher = crab.find((t) => t.name === "crusherPalm") as unknown as Strand & Drawable;
const clawCrust = draw.points("clawCrust", place(points(CLAW_BARNACLES, (i: F) => ({
  at: vec3(add(0.15, mul(fract(mul(i, 0.618034)), 0.6)), add(0.25, mul(sub(fract(mul(i, 0.3819)), 0.5), 0.3)), 0.97),
  scale: add(0.45, mul(fract(mul(i, 0.7548)), 0.8)),
})), crusher), barnacle);

/** A palm: a leaning trunk and drooping fronds, rooted on the carapace's back beside the shell. */
function palm(name: string, m: number, v: number, height: number, lean: number): Drawable[] {
  const top = vec3(lean, height, lean * 0.3);
  const sway = mul(sin(mul(time, 0.8)), 0.08);
  const trunk = strand({
    name: `${name}Trunk`, spine: (s) => add(mul(vec3(add(lean, sway), height, lean * 0.3), s), vec3(mul(mul(s, sub(1, s)), -lean * 0.6), 0, 0)),
    stations: 6, girth: (s) => mix(0.2, 0.12, s), tips: ["open", "round"],
    paint: (s) => mix(vec3(0.55, 0.38, 0.22), vec3(0.45, 0.3, 0.18), step(0.5, fract(mul(s, 9)))), detail: { along: 24, around: 10 },
  });
  const fronds = Array.from({ length: 6 }, (_, j) => {
    const a = (j / 6) * Math.PI * 2 + 0.4;
    const d = [Math.cos(a), Math.sin(a)];
    return strand({
      name: `${name}Frond${j}`,
      spine: (s) => add(add(top, vec3(sway, 0, 0)), vec3(mul(s, 1.8 * d[0]), sub(mul(s, 0.7), mul(mul(s, s), 1.5)), mul(s, 1.8 * d[1]))),
      stations: 5, girth: (s) => mul(sin(mul(add(s, 0.08), Math.PI * 0.92)), 0.32), section: { aspect: 0.12 }, tips: ["open", { point: 0.2 }],
      up: [0, 1, 0], paint: (s) => mix(vec3(0.25, 0.62, 0.2), vec3(0.55, 0.8, 0.25), s), detail: { along: 16, around: 8 },
    });
  });
  const chart = on(carapace, [m, v, 0.95]);
  return [trunk, ...fronds].map((s) => place(s, chart));
}
const palms = [...palm("palmA", 0.7, 0.2, 2.6, 0.5), ...palm("palmB", 0.62, 0.32, 1.9, -0.4)];

// ---- boats keeping their distance ---------------------------------------------------------------------------------
const boats = [
  ...ship(sloop("skiffA", 4.2)).afloat(water, { at: [7, 15], heading: 2.4, wind: WIND }),
  ...ship(sloop("skiffB", 3.6, { cloth: [0.95, 0.55, 0.25], hull: [0.75, 0.3, 0.2] })).afloat(water, { at: [-6, 17], heading: -0.4, wind: WIND }),
];

// ---- the scene ----------------------------------------------------------------------------------------------------
export default scene({
  ground: water,
  things: [bed, ...reefs, ...crab, crust, clawCrust, ...palms, ...boats],
  style: toon({
    bands: 3, outline: 0.04,
    water: { shallow: [0.35, 0.9, 0.86], deep: [0.1, 0.66, 0.72], foam: [1, 1, 1], shade: [0.05, 0.4, 0.5] },
    sky: { zenith: [0.3, 0.62, 0.95], horizon: [0.85, 0.95, 0.98] },
    shadow: [0.5, 0.46, 0.8],
  }),
  sun: [-0.45, 0.8, 0.45],
  cameras: {
    game: { kind: "perspective", eye: [15, 28, 22], target: [-0.5, 0.5, 3], fovY: 0.62 },
    hero: { kind: "perspective", eye: [22, 5, 9], target: [0, 3, 3], fovY: 0.72 },
    close: { kind: "perspective", eye: [11, 9, 9], target: [1.5, 2, 1], fovY: 0.55 },
  },
});

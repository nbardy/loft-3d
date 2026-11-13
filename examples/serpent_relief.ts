// The serpent with its skin as real relief: overlapping scales, a row of barnacle clusters down each flank and three
// claw scars, all written in the body's own coordinates (m along, v round) and shell-traced per pixel (draw.relief),
// so they ride every coil and have real silhouettes against the sky and real depth against the sea.
//
// Scales: one motif in one cell of a fold. The fold is a brick lattice whose cell walls toward the tail are bowed
// back, so each point belongs to the scale lying on top of it there: a scale's free edge overlaps the root of the
// scale behind it. The motif rises from its root to that edge and rolls over it. Barnacles are a limited repeat along
// the flank with a polar repeat inside each cluster (one barnacle drawn twice per query, whatever the count); the
// scars are stamps (creases along paths in (m, v)).
import { abs, add, clamp, div, draw, floor, fract, ge, length, lift, lt, max, min, mix, mod, mul, pow, saturate, scene, select, sin, smoothstep, spacing, sub, TAU, vec2, vec3, type Drawable, type Expr, type F, type P3, type Strand } from "../src/index.ts";
import { fold2 } from "../src/lib/fold.ts";
import { hash2, hsv, rotate2 } from "../src/lib/index.ts";
import { crease, pathDistance, profile, smoothMax, sum, clampHeight, type Patch, type UV } from "../src/relief/index.ts";
import type { ReliefPoint, ReliefSite } from "../src/draw/relief.ts";
import type { Warp } from "../src/map/types.ts";
import serpent from "./serpent.ts";

const body = serpent.things.find((t) => t.name === "serpent") as unknown as Strand & Drawable;

/** The (m, v) square in world units: the spine is about 20 long, the body about 4.2 round at its widest. */
const PATCH: Patch = { size: [20, 4.2], wrap: "v" };
const HMAX = 0.06;

// ---- scales ---------------------------------------------------------------------------------------------------------

/** Scale rows along the body and scales round it (cells about 0.28 x 0.23 world units). ROUND is even, so the brick closes round the body. */
const ALONG = 72, ROUND = 18;
/** How far a scale's free edge bows back past its cell wall, at its centre line (cell units). */
const BOW = 0.32;
const SCALE_H = 0.032;

/** The free edge of a scale in its own cell coordinates: x (toward the tail) as a function of y (round). */
const edge = (y: F): F => add(0.5, mul(sub(1, mul(mul(y, y), 4)), BOW));

/**
 * Which scale lies on top at a point, and where in it: the brick cell, or the cell ahead of it (toward the head,
 * nearer in y) when the point is inside that scale's bowed free edge. id = (row, twice the cell's centre round).
 */
const scaleFold: Warp<"vec2"> = (pp) => {
  const p = lift<"vec2">(pp);
  const g = vec2(mul(p.x, ALONG), mul(p.y, ROUND));
  const row = floor(add(g.x, 0.5));
  const y0 = add(g.y, mul(mod(row, 2), 0.5));
  const x = sub(g.x, row), y = sub(y0, floor(add(y0, 0.5)));
  const side = select(ge(y, 0), 0.5, -0.5);
  const xf = add(x, 1), yf = sub(y, side);
  const ahead = lt(xf, edge(yf));
  const local = select(ahead, vec2(xf, yf), vec2(x, y));
  const centre = sub(g, local);
  return { x: local, id: vec2(floor(add(centre.x, 0.5)), floor(add(mul(centre.y, 2), 0.5))), stretch: lift<"f32">(1 / ALONG), toWorld: (d) => d };
};

/** 1 on the back and flanks, 0 on the belly (v = 0.75, plated smooth), 0 at the closing tips. */
function scaleMask(m: F, v: F): F {
  const fromBelly = abs(sub(mod(add(v, 0.75), 1), 0.5));
  return mul(mul(smoothstep(0.08, 0.16, fromBelly), smoothstep(0.015, 0.05, m)), smoothstep(0.985, 0.95, m));
}

/** One scale: rising from its root to its free edge, rolling over that edge, grooved a little where it meets its neighbours. */
function scale(q: Expr<"vec2">): F {
  const e = edge(q.y);
  const s = saturate(div(add(q.x, 0.75), add(e, 0.75)));
  const rise = add(0.15, mul(pow(s, 1.6), 0.85));
  const lip = smoothstep(e, sub(e, 0.16), q.x);
  const seam = sub(1, mul(smoothstep(0.36, 0.5, abs(q.y)), 0.55));
  return mul(mul(mul(rise, lip), seam), SCALE_H);
}

// ---- barnacles --------------------------------------------------------------------------------------------------------

/** Clusters down each flank (the flank line is 0.2 of a turn either side of the dorsal line v = 0.25), between these m. */
const CLUSTERS = 7, FROM = 0.3, TO = 0.78, FLANK = 0.19;
const PERIOD = ((TO - FROM) / (CLUSTERS - 1)) * PATCH.size[0];

/** The barnacle field: a cluster per cell of a limited repeat along the flank, one barnacle in the middle and five round it. */
function barnacles(m: F, v: F): F {
  // Mirror across the dorsal line (both flanks), then world units from the flank line and from the first cluster.
  const round = abs(sub(mod(add(sub(v, 0.25), 0.5), 1), 0.5));
  const p = vec2(mul(sub(m, FROM), PATCH.size[0]), mul(sub(round, FLANK), PATCH.size[1]));
  const k = clamp(floor(add(mul(p.x, 1 / PERIOD), 0.5)), 0, CLUSTERS - 1);
  const local = vec2(sub(p.x, mul(k, PERIOD)), p.y);
  // Each cluster turned and sized by its own hash: one motif, seven different-looking clusters.
  const id = vec2(k, select(lt(sub(v, 0.25), 0), -1, 1));
  const turn = mul(hash2(id), 6.283), size = add(0.8, mul(hash2(add(id, vec2(7, 3))), 0.5));
  const q = rotate2(local, turn);
  const centre = mul(profile("crater", mul(length(q), 1 / 0.12)), 0.044);
  const ring = fold2.repeatPolar(5)(q).x;
  const ringOne = mul(profile("crater", mul(length(sub(ring, vec2(mul(size, 0.24), 0))), 1 / 0.085)), 0.033);
  return mul(max(centre, ringOne), size);
}

// ---- scars --------------------------------------------------------------------------------------------------------------

/** Three parallel claw marks across the back, behind the crest. */
const SCARS: readonly (readonly UV[])[] = [0, 1, 2].map((i) => [[0.62 + i * 0.012, 0.14], [0.632 + i * 0.012, 0.24], [0.648 + i * 0.012, 0.36]] as const);
const scars = SCARS.map((path) => crease(PATCH, path, { width: 0.07, depth: 0.025, sharpness: 2 }));

// ---- the relief ---------------------------------------------------------------------------------------------------------

const height = (s: ReliefSite): F => {
  const skin = mul(scale(s.cell.x), scaleMask(s.u, s.v));
  const raised = smoothMax(0.012, () => skin, barnacles)(s.u, s.v);
  return clampHeight(sum(() => raised, ...scars), 0, HMAX)(s.u, s.v);
};

const BACK = vec3(0.34, 0.17, 0.62), BELLY = vec3(1.0, 0.88, 0.6), BAND = vec3(0.6, 0.48, 1.0);

function paint(p: ReliefPoint): P3 {
  const m = p.u, v = p.v, q = p.cell.x;
  // Under-colour: the serpent's countershading and saddle bands.
  const dorsal = smoothstep(-0.3, -0.12, sin(mul(v, TAU)));
  const bands = mul(sub(1, smoothstep(0.35, 0.5, abs(sub(fract(mul(sub(m, 0.07), 9 / 0.9)), 0.5)))), dorsal);
  const under = mix(mix(BELLY, BACK, dorsal), BAND, mul(bands, 0.8));
  // Each scale its own shade (by cell identity), darker where it dives under the one ahead, a pale free edge.
  const jitter = add(0.88, mul(hash2(p.cell.id), 0.24));
  const e = edge(q.y);
  const depthIn = smoothstep(-0.5, 0.35, q.x);
  const rim = smoothstep(sub(e, 0.2), sub(e, 0.05), q.x);
  const scaled = mul(under, mul(jitter, add(0.62, mul(depthIn, 0.45))));
  const skin = mix(under, mix(scaled, mix(under, vec3(1, 0.95, 0.85), 0.35), mul(rim, 0.6)), scaleMask(m, v));
  // Barnacles: chalky, darker in their pits; scars: pink and raw.
  const b = barnacles(m, v);
  const onBarnacle = smoothstep(0.004, 0.012, sub(b, mul(scale(q), scaleMask(m, v))));
  const pit = smoothstep(0.018, 0.036, b);
  const shell = mix(vec3(0.42, 0.4, 0.36), vec3(0.93, 0.9, 0.8), pit);
  const scar = smoothstep(0.08, 0.03, SCARS.map((path) => pathDistance(PATCH, m, v, path)).reduce((a, c) => min(a, c)));
  return mix(mix(skin, shell, onBarnacle), vec3(0.95, 0.42, 0.5), scar);
}

const relief = draw.relief("serpentRelief", body, {
  height, hMax: HMAX, fold: scaleFold, paint, steps: 32, outline: "ink",
  // As the strand's own grid: rings crowded toward the tips, a vertex on the dorsal line, the seam interpolating.
  grid: { u: spacing.ends(200), v: spacing.from(40, 0.25) },
});

export default scene({
  ground: serpent.ground,
  things: [relief, ...serpent.things.filter((t) => !["sky", "sea", "shadows", "serpent"].includes(t.name))],
  style: serpent.style,
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    ...serpent.cameras,
    close: { kind: "perspective", eye: [-1.5, 3.2, 5.5], target: [-1.5, 0.6, 0], fovY: 0.45 },
    graze: { kind: "perspective", eye: [-7, 1.2, 1.2], target: [0, 0.9, -0.5], fovY: 0.35 },
  },
});

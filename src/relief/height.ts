// Height functions of a surface's own coordinates (DESIGN.md 8): the layers of form finer than the curves. A height is
// a function of (u, v), so it rides the surface through any animation, and the same function serves `displace` (in
// the vertex stage), `draw.relief` (traced per pixel) and the baker. Stamps are the analytic counterpart of sculpt
// brushes; they compose by addition and by smooth maximum, and a sculpt layer (sculpt.ts) is one more height.
//
// Distances in (u, v) are measured in a `Patch`: the world size of the unit square and which of its directions are
// closed (a body is closed round, `wrap: "v"`). A stamp near the seam of a closed direction sees across it, because
// every difference in a closed direction is taken to the nearest copy (`fract(d + 1/2) - 1/2`).

import { abs, add, clamp, fract, lift, max, min, mix, mul, pow, saturate, smoothstep, sqrt, sub, vec2, dot, type Expr } from "../expr.ts";
import { smax } from "../lib/util.ts";
import type { F } from "../map/types.ts";

/** Height above a surface at (u, v), world units. */
export type Height = (u: F, v: F) => F;

/** Which directions of the (u, v) square are closed (glued to the opposite edge). */
export type Wrap = "none" | "u" | "v" | "uv";

/** The world size of the (u, v) square (lengths along u and along v) and its closed directions. */
export type Patch = { readonly size: readonly [number, number]; readonly wrap: Wrap };

export type UV = readonly [number, number];

/** A difference of coordinates in a closed direction, taken to the nearest copy. */
const nearest = (d: F): F => sub(fract(add(d, 0.5)), 0.5);
const open = (d: F): F => d;

/** The difference functions of each direction, by wrap. */
const DIFFS: Readonly<Record<Wrap, readonly [(d: F) => F, (d: F) => F]>> = {
  none: [open, open],
  u: [nearest, open],
  v: [open, nearest],
  uv: [nearest, nearest],
};

/** The offset from `a` to (u, v) in world units on the patch (through the seam where the patch is closed). */
export function offset(patch: Patch, u: F, v: F, a: readonly [F | number, F | number]): Expr<"vec2"> {
  const [du, dv] = DIFFS[patch.wrap];
  return vec2(mul(du(sub(u, a[0])), patch.size[0]), mul(dv(sub(v, a[1])), patch.size[1]));
}

/** The world distance on the patch from (u, v) to the segment a-b (both in (u, v); measured from a's copy nearest (u, v)). */
export function segmentDistance(patch: Patch, u: F, v: F, a: UV, b: UV): F {
  const p = offset(patch, u, v, a);
  // b relative to a, in world units, through the seam the short way (numbers: the path is known when the scene is built).
  const [du, dv] = NUMERIC_DIFFS[patch.wrap];
  const ab = [du(b[0] - a[0]) * patch.size[0], dv(b[1] - a[1]) * patch.size[1]] as const;
  const t = saturate(mul(dot(p, ab), 1 / Math.max(ab[0] * ab[0] + ab[1] * ab[1], 1e-12)));
  return lengthOf(sub(p, mul(lift<"vec2">(ab), t)));
}
const nearestNum = (d: number): number => d - Math.floor(d + 0.5);
const NUMERIC_DIFFS: Readonly<Record<Wrap, readonly [(d: number) => number, (d: number) => number]>> = {
  none: [(d) => d, (d) => d],
  u: [nearestNum, (d) => d],
  v: [(d) => d, nearestNum],
  uv: [nearestNum, nearestNum],
};
const lengthOf = (p: Expr<"vec2">): F => sqrt(max(dot(p, p), 1e-20));

/** The distance from (u, v) to a polyline in (u, v), world units on the patch. */
export function pathDistance(patch: Patch, u: F, v: F, path: readonly UV[]): F {
  if (path.length < 2) throw new Error(`path: need at least two points, got ${path.length}`);
  let d: F | undefined;
  for (let i = 0; i + 1 < path.length; i++) {
    const s = segmentDistance(patch, u, v, path[i], path[i + 1]);
    d = d === undefined ? s : min(d, s);
  }
  return d as F;
}

// ---- profiles: how a stamp falls off from its centre (r = 0) to its edge (r = 1) ---------------------------------

/**
 * A stamp's falloff, 1 at r = 0 and 0 from r = 1 on.
 * - `smooth`: (1 - r^2)^2, a bell with zero slope at the centre and the edge (C1 everywhere).
 * - `dome`: sqrt(1 - r^2), a hemisphere when height = radius (infinite slope at the rim).
 * - `cone`: 1 - r, a straight spike.
 * - `spike`: (1 - r)^3, a thorn: thin, with a concave flank.
 * - `crater`: a ring raised at r = 0.6 with a pit inside, as a barnacle or a sucker.
 * - `plateau`: flat to r = 0.6, then a smooth shoulder to the edge.
 */
export type Profile = "smooth" | "dome" | "cone" | "spike" | "crater" | "plateau";

const PROFILES: Readonly<Record<Profile, (r: F) => F>> = {
  smooth: (r) => { const q = saturate(sub(1, mul(r, r))); return mul(q, q); },
  dome: (r) => sqrt(saturate(sub(1, mul(r, r)))),
  cone: (r) => saturate(sub(1, r)),
  spike: (r) => { const q = saturate(sub(1, r)); return mul(mul(q, q), q); },
  crater: (r) => {
    // A ring of bell profile at r = 0.6 (half-width 0.4), and a bowl falling to 0.35 inside it.
    const x = saturate(sub(1, mul(abs(sub(r, 0.6)), 2.5)));
    const ring = mul(x, mul(x, sub(3, mul(x, 2))));
    return max(ring, mul(smoothstep(0.62, 0.0, r), 0.35));
  },
  plateau: (r) => smoothstep(1.0, 0.6, r),
};

/**
 * The falloff curve named by `p` at r in [0, 1], as an expression: 1 at the centre, 0 from r = 1 on (`bump` stamps use
 * it).
 */
export function profile(p: Profile, r: F): F {
  return PROFILES[p](r);
}

// ---- stamps -------------------------------------------------------------------------------------------------------

export type BumpSpec = { readonly at: UV; readonly radius: number; readonly height: number; readonly profile: Profile };

/** A round stamp centred at `at` (in (u, v)), `radius` and `height` in world units. */
export function bump(patch: Patch, s: BumpSpec): Height {
  return (u, v) => mul(profile(s.profile, mul(lengthOf(offset(patch, u, v, s.at)), 1 / s.radius)), s.height);
}

export type RidgeSpec = { readonly width: number; readonly height: number; readonly profile: Profile };

/** A raised line along a polyline in (u, v): `width` the half-width, world units. */
export function ridge(patch: Patch, path: readonly UV[], s: RidgeSpec): Height {
  return (u, v) => mul(profile(s.profile, mul(pathDistance(patch, u, v, path), 1 / s.width)), s.height);
}

export type CreaseSpec = { readonly width: number; readonly depth: number; readonly sharpness: number };

/**
 * A cut along a polyline: a negative height `depth (1 - r)^sharpness` within half-width `width` (sharpness 1 a V
 * groove; higher, a narrower cut with a soft shoulder). Add it to a height that has room to go down into.
 */
export function crease(patch: Patch, path: readonly UV[], s: CreaseSpec): Height {
  if (!(s.sharpness >= 1)) throw new Error(`crease: sharpness must be >= 1 (1 is a V groove), got ${s.sharpness}`);
  return (u, v) => mul(pow(max(sub(1, mul(pathDistance(patch, u, v, path), 1 / s.width)), 0), s.sharpness), -s.depth);
}

// ---- regions and the operators that act over one ------------------------------------------------------------------

/** Where an operator acts: inside a disc or near a path (world units), falling off to nothing over `falloff`. */
export type Region =
  | { readonly kind: "disc"; readonly at: UV; readonly radius: number; readonly falloff: number }
  | { readonly kind: "band"; readonly path: readonly UV[]; readonly width: number; readonly falloff: number };

/** 1 inside the region, 0 beyond its falloff, smooth between. */
export function weight(patch: Patch, r: Region, u: F, v: F): F {
  switch (r.kind) {
    case "disc": return smoothstep(r.radius + r.falloff, r.radius, lengthOf(offset(patch, u, v, r.at)));
    case "band": return smoothstep(r.width + r.falloff, r.width, pathDistance(patch, u, v, r.path));
  }
}

/** Pull `h` toward the level `level` inside the region (a flatten brush). */
export function flatten(patch: Patch, h: Height, region: Region, level: number): Height {
  return (u, v) => mix(h(u, v), lift<"f32">(level), weight(patch, region, u, v));
}

/** Push `h` out by `amount` inside the region, falling off at its edge (an inflate brush; negative deflates). */
export function inflate(patch: Patch, h: Height, region: Region, amount: number): Height {
  return (u, v) => add(h(u, v), mul(weight(patch, region, u, v), amount));
}

// ---- composition --------------------------------------------------------------------------------------------------

/** A constant height. */
export const level = (h: number): Height => () => lift<"f32">(h);

/** Heights added: layers of a sculpt stacked. */
export function sum(...hs: readonly Height[]): Height {
  if (hs.length === 0) throw new Error("sum: need at least one height");
  return (u, v) => hs.slice(1).reduce((s: F, h) => add(s, h(u, v)), hs[0](u, v));
}

/** The smooth maximum of heights, blended over `k` world units: one form grows out of another without a crease. */
export function smoothMax(k: number, ...hs: readonly Height[]): Height {
  if (hs.length === 0) throw new Error("smoothMax: need at least one height");
  if (!(k > 0)) throw new Error(`smoothMax: k must be > 0 (use a plain max for a hard join), got ${k}`);
  return (u, v) => hs.slice(1).reduce((s: F, h) => smax(s, h(u, v), k), hs[0](u, v));
}

/** `h` clamped to [lo, hi]: what a shell of thickness hi can hold. */
export function clampHeight(h: Height, lo: number, hi: number): Height {
  return (u, v) => clamp(h(u, v), lo, hi);
}

/** `h` times a function of (u, v): fade a layer out toward a tip, scale it with a growing shell. */
export function scaled(h: Height, by: (u: F, v: F) => F): Height {
  return (u, v) => mul(h(u, v), by(u, v));
}

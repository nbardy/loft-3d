// What a traced solid casts its shadow on the water with (`draw.field`): a soft blob, as a short chain of capsules (the
// shadows drawable's currency, src/draw/shadows.ts). The solid is found by sampling its field once, at time 0 and every
// input and param at its default, on a grid in its bound: the inside points' horizontal principal axis is the chain's
// direction, their extent along it its length, their spread across it the radius, their mean height its height (of the
// points above the still water, when there are any). A field
// the CPU cannot evaluate (a GPU-only function in it) casts from its bound instead: a capsule along the bound's longer
// horizontal side, at its middle height. Either way the blob does not follow a field that moves with time.

import { compileJs, f, libsOf, lift, substitute, variable, vec3, type Expr, type V } from "../expr.ts";
import type { Field, P3, Skeleton } from "../map/types.ts";
import { aabbOf, type TraceBound } from "./trace.ts";

type V3 = readonly [number, number, number];
/** Grid cells per axis sampled in the bound. */
const GRID = 22;
/** Joints along the blob. */
const JOINTS = 4;

/** Why a field's shadow is shaped as it is: from samples of its inside, or from its bound alone. */
export type FieldShadow =
  | { readonly kind: "sampled"; readonly inside: number; readonly chain: readonly { readonly p: V3; readonly r: number }[] }
  | { readonly kind: "bound"; readonly reason: string; readonly chain: readonly { readonly p: V3; readonly r: number }[] };

/** A capsule chain from `a` to `b` of radius r, JOINTS joints. */
const chainOf = (a: V3, b: V3, r: number) => Array.from({ length: JOINTS }, (_, k) => {
  const s = k / (JOINTS - 1);
  return { p: [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s] as V3, r };
});

function fromBound(b: TraceBound, reason: string): FieldShadow {
  const { min, max } = aabbOf(b);
  const c: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const hx = (max[0] - min[0]) / 2, hz = (max[2] - min[2]) / 2;
  const r = 0.7 * Math.min(hx, hz), long = Math.max(hx, hz) - r;
  const ax: V3 = hx >= hz ? [long, 0, 0] : [0, 0, long];
  return { kind: "bound", reason, chain: chainOf([c[0] - ax[0], c[1], c[2] - ax[2]], [c[0] + ax[0], c[1], c[2] + ax[2]], r) };
}

/** Sample the field in its bound and fit the blob (see the header). `px` is the field-pixel variable, bound to 0. */
export function fieldShadow(field: Field, b: TraceBound, px: Expr<"f32">): FieldShadow {
  const P = variable("fs_p", "vec3");
  const d = substitute([field(P)], px, f(0))[0]!;
  const gpuOnly = libsOf([d]).find((l) => l.js === "gpu-only");
  if (gpuOnly) return fromBound(b, `the field calls the GPU-only function "${gpuOnly.name}"`);
  const run = compileJs([d]);
  const { min, max } = aabbOf(b);
  const all: V3[] = [];
  const vars = { fs_p: [0, 0, 0] };
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) for (let k = 0; k < GRID; k++) {
    const p: V3 = [min[0] + ((i + 0.5) / GRID) * (max[0] - min[0]), min[1] + ((j + 0.5) / GRID) * (max[1] - min[1]), min[2] + ((k + 0.5) / GRID) * (max[2] - min[2])];
    vars.fs_p = [...p];
    if ((run({ vars, inputs: {}, params: {} })[0] as V as number) < 0) all.push(p);
  }
  // Only what stands above the still water casts on it (a reef's trunks below the surface would pull the blob under
  // the sea, where it casts nothing); a solid wholly under water keeps all its points.
  const above = all.filter((p) => p[1] > 0);
  const pts = above.length >= 2 ? above : all;
  if (pts.length < 2) return fromBound(b, `only ${pts.length} of ${GRID ** 3} samples fell inside the solid`);
  const cell = Math.max((max[0] - min[0]) / GRID, (max[2] - min[2]) / GRID);
  return { kind: "sampled", inside: pts.length, chain: fitBlob(pts.map((q) => ({ p: q, w: 1 })), cell / 2) };
}

/**
 * The blob of weighted points, as a capsule chain: along the horizontal principal axis of the points, as long as their
 * extent along it, as wide as 1.5 times their spread across it (at least `minRadius`), at their mean height. Needs two
 * points or more. Shared by every drawable whose solid is known as points: a field's inside samples, a list's copies.
 */
export function fitBlob(pts: readonly { readonly p: V3; readonly w: number }[], minRadius: number): readonly { readonly p: V3; readonly r: number }[] {
  if (pts.length < 2) throw new Error(`fitBlob: ${pts.length} points; a blob needs at least two`);
  const n = pts.reduce((s, q) => s + q.w, 0), mean = [0, 1, 2].map((a) => pts.reduce((s, q) => s + q.w * q.p[a]!, 0) / n) as unknown as V3;
  // The horizontal covariance's principal axis (closed form for a 2x2 symmetric matrix).
  let sxx = 0, szz = 0, sxz = 0;
  for (const { p, w } of pts) { const x = p[0] - mean[0], z = p[2] - mean[2]; sxx += w * x * x; szz += w * z * z; sxz += w * x * z; }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz), ax = Math.cos(angle), az = Math.sin(angle);
  let lo = Infinity, hi = -Infinity, across = 0;
  for (const { p, w } of pts) {
    const x = p[0] - mean[0], z = p[2] - mean[2], s = x * ax + z * az, t = -x * az + z * ax;
    lo = Math.min(lo, s); hi = Math.max(hi, s); across += w * t * t;
  }
  const r = Math.max(1.5 * Math.sqrt(across / n), minRadius);
  const a = Math.min(lo + r, (lo + hi) / 2), e = Math.max(hi - r, (lo + hi) / 2);
  return chainOf([mean[0] + ax * a, mean[1], mean[2] + az * a], [mean[0] + ax * e, mean[1], mean[2] + az * e], r);
}

/** The blob as a skeleton (constant joints). */
export function shadowSkeleton(s: FieldShadow): Skeleton {
  return { joints: s.chain.length, joint: (k) => { const j = s.chain[k]!; return { p: vec3(j.p[0], j.p[1], j.p[2]) as P3, r: lift<"f32">(j.r) }; } };
}

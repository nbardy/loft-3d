// The signed distance to a closed skin, on the CPU, in the skin's own coordinates: what an attack's checks measure
// contact with (`Target` "skin", src/check.ts). The solid is a surface lofted through sections (u along, v round each
// section from one edge of its opening to the other), closed by the straight chord across each section's opening and by
// a flat fan over both end sections. Measuring a body by its skeleton instead (capsules as wide as the body) reads
// "contact" as a gap of half the body's width.
//
// The skin is sampled once (it does not move in its own frame) on a grid of sections along u and points round each
// section, and the distance is to that triangle mesh: strips between neighbouring sections are tested nearest first and
// the search stops once a strip's bounding box is farther than the best distance found (Ericson, Real-Time Collision
// Detection 5.1.5, for the point-triangle distance). Inside or outside is the parity of a ray's crossings of the closed
// mesh (straight up, tilted off the grid's lines). A point-in-section test in the nearest section along u misses points
// inside a section that leans along u (a raked end), which the ray does not.

import { compileJs, variable, type V } from "../expr.ts";
import type { Surface } from "../map/types.ts";

export type V3 = readonly [number, number, number];
/** The skin's box (its own coordinates) and its signed distance there: negative inside. */
export type SkinDistance = { readonly lo: V3; readonly hi: V3; distance(q: V3): number };

/** Sections along u and points round each (odd, so the line v = 1/2 is sampled: on a 12-unit lofted body, between samples the chord cut 3 cm off the bottom). */
const ALONG = 64, AROUND = 65;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len2 = (a: V3): number => dot(a, a);

/** Squared distance from p to triangle abc (Ericson 5.1.5, by Voronoi regions). */
function triangle2(p: V3, a: V3, b: V3, c: V3): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return len2(ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return len2(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return len2(sub(ap, [ab[0] * v, ab[1] * v, ab[2] * v])); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return len2(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return len2(sub(ap, [ac[0] * w, ac[1] * w, ac[2] * w])); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return len2(sub(bp, [(c[0] - b[0]) * w, (c[1] - b[1]) * w, (c[2] - b[2]) * w]));
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return len2(sub(ap, [ab[0] * v + ac[0] * w, ab[1] * v + ac[1] * w, ab[2] * v + ac[2] * w]));
}

/** The parity ray: up, tilted so it does not run along the mesh's section or constant-v edges. */
const RAY: V3 = (() => { const r: V3 = [0.0123, 1, 0.0071]; const l = Math.sqrt(dot(r, r)); return [r[0] / l, r[1] / l, r[2] / l]; })();

/** Whether the ray from p along RAY crosses triangle abc (Moller and Trumbore). */
function crosses(p: V3, a: V3, b: V3, c: V3): boolean {
  const e1 = sub(b, a), e2 = sub(c, a);
  const h: V3 = [RAY[1] * e2[2] - RAY[2] * e2[1], RAY[2] * e2[0] - RAY[0] * e2[2], RAY[0] * e2[1] - RAY[1] * e2[0]];
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-14) return false;
  const s = sub(p, a), u = dot(s, h) / det;
  if (u < 0 || u > 1) return false;
  const q: V3 = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = dot(RAY, q) / det;
  if (v < 0 || u + v > 1) return false;
  return dot(e2, q) / det > 0;
}

const boxDist2 = (p: V3, lo: V3, hi: V3): number => {
  let s = 0;
  for (let a = 0; a < 3; a++) { const d = Math.max(lo[a]! - p[a]!, 0, p[a]! - hi[a]!); s += d * d; }
  return s;
};

const made = new WeakMap<Surface, SkinDistance>();

/** The signed distance function of the solid `skin` closes (built once per surface object). */
export function skinDistance(skin: Surface): SkinDistance {
  const seen = made.get(skin);
  if (seen) return seen;
  const U = variable("hd_u", "f32"), Vv = variable("hd_v", "f32");
  const at = compileJs([skin.point(U, Vv)]);
  const vars = { hd_u: 0, hd_v: 0 };
  // Rings: section i from one edge of the opening (v = 0) round to the other (v = 1); the polygon closes across the
  // opening.
  const rings: V3[][] = Array.from({ length: ALONG }, (_, i) => Array.from({ length: AROUND }, (_, j) => {
    vars.hd_u = i / (ALONG - 1); vars.hd_v = j / (AROUND - 1);
    return at({ vars, inputs: {}, params: {} })[0] as V as unknown as V3;
  }));
  // Each strip between neighbouring sections, with its bounding box; the end sections as fans from their centres.
  type Tri = readonly [V3, V3, V3];
  type Strip = { readonly tris: Tri[]; readonly lo: V3; readonly hi: V3 };
  const strip = (tris: Tri[]): Strip => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (const p of t) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, p[a]!); hi[a] = Math.max(hi[a]!, p[a]!); }
    return { tris, lo: lo as unknown as V3, hi: hi as unknown as V3 };
  };
  const strips: Strip[] = [];
  for (let i = 0; i + 1 < ALONG; i++) {
    const a = rings[i]!, b = rings[i + 1]!, tris: Tri[] = [];
    for (let j = 0; j < AROUND; j++) {
      const k = (j + 1) % AROUND;
      tris.push([a[j]!, b[j]!, b[k]!], [a[j]!, b[k]!, a[k]!]);
    }
    strips.push(strip(tris));
  }
  for (const ring of [rings[0]!, rings[ALONG - 1]!]) {
    const c: V3 = [0, 1, 2].map((ax) => ring.reduce((s, p) => s + p[ax]!, 0) / ring.length) as unknown as V3;
    strips.push(strip(ring.map((p, j) => [c, p, ring[(j + 1) % AROUND]!] as Tri)));
  }
  const top = Math.max(...strips.map((st) => st.hi[1]));
  const lo = [0, 1, 2].map((a) => Math.min(...strips.map((st) => st.lo[a]!))) as unknown as V3;
  const hi = [0, 1, 2].map((a) => Math.max(...strips.map((st) => st.hi[a]!))) as unknown as V3;

  const distance = (q: V3): number => {
    const order = strips.map((s) => ({ s, d: boxDist2(q, s.lo, s.hi) })).sort((x, y) => x.d - y.d);
    let best = Infinity;
    for (const { s, d } of order) {
      if (d >= best) break;
      for (const t of s.tris) best = Math.min(best, triangle2(q, t[0], t[1], t[2]));
    }
    const dist = Math.sqrt(best);
    if (boxDist2(q, lo, hi) > 0) return dist; // outside the box is outside the solid
    // Crossings of the ray up to the top of the mesh: only strips whose box its footprint can meet.
    const reach = Math.max(top - q[1], 0) / RAY[1];
    const x0 = q[0], x1 = q[0] + RAY[0] * reach, z0 = q[2], z1 = q[2] + RAY[2] * reach;
    let n = 0;
    for (const st of strips) {
      if (st.hi[1] < q[1] || st.lo[0] > Math.max(x0, x1) || st.hi[0] < Math.min(x0, x1) || st.lo[2] > Math.max(z0, z1) || st.hi[2] < Math.min(z0, z1)) continue;
      for (const t of st.tris) if (crosses(q, t[0], t[1], t[2])) n++;
    }
    return n % 2 === 1 ? -dist : dist;
  };
  const fn: SkinDistance = { lo, hi, distance };
  made.set(skin, fn);
  return fn;
}

/** Distance from a point to the skin's box: a lower bound of its distance to the solid, for skipping queries. */
export function skinBoxDistance(h: SkinDistance, q: V3): number {
  return Math.sqrt(boxDist2(q, h.lo, h.hi));
}

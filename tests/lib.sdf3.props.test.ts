// Properties that would catch a wrong distance formula or a wrong fold stretch.
import { expect, test } from "bun:test";
import { compileJs, sub, variable, type Expr } from "../src/expr.ts";
import {
  compose, elongate, extrude, fieldOf, fold2, fold3, lipschitz, nearest, revolve, sdBox, sdBox3, sdCapsule3, sdCircle, sdCylinder, sdEllipsoid, sdPlane,
  sdRoundBox, sdRoundCone, sdSphere, sdTorus, shell, smoothIntersect, smoothSubtract, smoothUnion, subtract, union, intersect, round,
  type Field,
} from "../src/lib/index.ts";
import { rng } from "./lib.harness.ts";

type F3 = Field<"vec3">;
const p = variable("p", "vec3");
const BOX = { min: [-3, -3, -3], max: [3, 3, 3] };
const cpu = (field: F3): ((q: number[]) => number) => {
  const run = compileJs([field(p)]);
  return (q) => run({ vars: { p: q }, inputs: {}, params: {} })[0] as number;
};
const L = (field: Field<"vec3">, bounds = BOX, samples = 30000, seed = 5) => lipschitz(field, { samples, bounds, seed });

/** A point inside, and the shape's field. Exact shapes must be 1-Lipschitz and unit-gradient on the surface. */
const EXACT: { name: string; inside: number[]; field: F3 }[] = [
  { name: "sphere", inside: [0, 0, 0], field: (q) => sdSphere(q, 1.2) },
  { name: "box", inside: [0, 0, 0], field: (q) => sdBox3(q, [1, 0.5, 0.8]) },
  { name: "roundBox", inside: [0, 0, 0], field: (q) => sdRoundBox(q, [1, 0.5, 0.8], 0.2) },
  { name: "capsule", inside: [0.5, 0.75, 0.75], field: (q) => sdCapsule3(q, [-1, 0.5, 0], [2, 1, 1.5], 0.3) },
  { name: "roundCone", inside: [0, 0, 0], field: (q) => sdRoundCone(q, [0, 0, 0], [0.5, 0.2, 2], 0.8, 0.3) },
  { name: "roundCone reversed", inside: [0.5, 0.2, 2], field: (q) => sdRoundCone(q, [0, 0, 0], [0.5, 0.2, 2], 0.2, 0.9) },
  { name: "torus", inside: [1.5, 0, 0], field: (q) => sdTorus(q, 1.5, 0.4) },
  { name: "cylinder", inside: [0, 0, 0], field: (q) => sdCylinder(q, 0.7, 1.1) },
  { name: "plane", inside: [0, 0, -1], field: (q) => sdPlane(q, [1, 2, -2], 0.3) },
  { name: "revolve", inside: [1.4, 0, 0], field: revolve((q) => sdBox(q, [0.3, 0.5]), 1.4) },
  { name: "extrude", inside: [0, 0, 0], field: extrude((q) => sdCircle(q, 0.9), 0.7) },
  { name: "elongate", inside: [0, 0, 0], field: elongate((q) => sdSphere(q, 0.5), [1, 0.3, 0.6]) },
];

test("exact 3D primitives have Lipschitz constant 1: never above 1 + 1e-3, and close to 1", () => {
  for (const s of EXACT) {
    const v = L(s.field);
    console.log(`lipschitz ${s.name}: ${v.toFixed(5)}`);
    expect(v).toBeLessThanOrEqual(1 + 1e-3);
    expect(v).toBeGreaterThan(0.99); // a field that is merely small would pass the bound trivially
  }
});

test("stepping along the outward normal from the surface changes the distance by the step length", () => {
  const r = rng(77);
  for (const s of EXACT) {
    if (s.name === "plane") continue; // no inside point to march from
    const d = cpu(s.field);
    let checked = 0;
    for (let i = 0; i < 200 && checked < 20; i++) {
      // Bisect along a ray from an inside point to find a surface point.
      const dir = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
      const n = Math.hypot(...dir);
      const at = (t: number) => s.inside.map((v, k) => v + (dir[k] / n) * t);
      let lo = 0, hi = 8;
      if (d(at(hi)) <= 0) continue;
      for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (d(at(mid)) < 0) lo = mid; else hi = mid; }
      const q = at(lo);
      // Numerical gradient (central differences, small step) = outward unit normal for an exact distance.
      const h = 1e-5;
      const g = [0, 1, 2].map((k) => { const a = [...q], b = [...q]; a[k] += h; b[k] -= h; return (d(a) - d(b)) / (2 * h); });
      const gl = Math.hypot(...g);
      if (gl < 0.5) continue; // landed on a crease where the gradient is not defined
      expect(gl).toBeCloseTo(1, 3);
      for (const step of [0.05, 0.3]) {
        const moved = q.map((v, k) => v + (g[k] / gl) * step);
        // Along the normal the distance grows by exactly the step (up to the surface point's bisection error).
        expect(Math.abs(d(moved) - step)).toBeLessThan(2e-3);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  }
});

test("known values", () => {
  const e = (f: F3, q: number[]) => cpu(f)(q);
  expect(e((x) => sdSphere(x, 2), [3, 4, 0])).toBeCloseTo(3, 12);
  expect(e((x) => sdBox3(x, [1, 2, 3]), [4, 0, 0])).toBeCloseTo(3, 12);
  expect(e((x) => sdBox3(x, [1, 1, 1]), [2, 2, 2])).toBeCloseTo(Math.sqrt(3), 12);
  expect(e((x) => sdBox3(x, [1, 2, 3]), [0, 0, 0])).toBeCloseTo(-1, 12);
  expect(e((x) => sdRoundBox(x, [1, 1, 1], 0.25), [2, 2, 2])).toBeCloseTo(Math.hypot(1.25, 1.25, 1.25) - 0.25, 12);
  expect(e((x) => sdTorus(x, 2, 0.5), [2, 0, 0])).toBeCloseTo(-0.5, 12);
  expect(e((x) => sdTorus(x, 2, 0.5), [0, 0, 0])).toBeCloseTo(1.5, 12);
  expect(e((x) => sdTorus(x, 2, 0.5), [0, 3.5, 1])).toBeCloseTo(Math.hypot(1.5, 1) - 0.5, 12);
  expect(e((x) => sdCylinder(x, 1, 2), [3, 0, 0])).toBeCloseTo(2, 12);
  expect(e((x) => sdCylinder(x, 1, 2), [0, 0, 5])).toBeCloseTo(3, 12);
  expect(e((x) => sdCylinder(x, 1, 2), [2, 0, 3])).toBeCloseTo(Math.SQRT2, 12);
  expect(e((x) => sdPlane(x, [0, 0, 2], 1), [5, 5, 4])).toBeCloseTo(3, 12);
  expect(e((x) => sdCapsule3(x, [0, 0, 0], [0, 0, 4], 1), [3, 0, 2])).toBeCloseTo(2, 12);
  expect(e((x) => sdCapsule3(x, [0, 0, 0], [0, 0, 4], 1), [0, 0, 6])).toBeCloseTo(1, 12);
  // A rounded cone with equal radii is a capsule; with a point sphere at one end it reaches the sphere of the other.
  const q = [0.7, -1.1, 2.3];
  expect(e((x) => sdRoundCone(x, [0, 0, 0], [1, 0, 3], 0.4, 0.4), q)).toBeCloseTo(e((x) => sdCapsule3(x, [0, 0, 0], [1, 0, 3], 0.4), q), 9);
  expect(e((x) => sdRoundCone(x, [0, 0, 0], [0, 0, 3], 1, 0.5), [0, 0, -2])).toBeCloseTo(1, 12); // beyond the big end
  expect(e((x) => sdRoundCone(x, [0, 0, 0], [0, 0, 3], 1, 0.5), [0, 0, 5])).toBeCloseTo(1.5, 12); // beyond the small end
  // Ellipsoid: zero on the surface at each axis, sign correct, a bound close to the distance on the long axis.
  const ell = (x: Expr<"vec3">) => sdEllipsoid(x, [1, 2, 3]);
  for (const s of [[1, 0, 0], [0, 2, 0], [0, 0, -3]]) expect(e(ell, s)).toBeCloseTo(0, 12);
  expect(e(ell, [0.2, 0.2, 0.2])).toBeLessThan(0);
  expect(e(ell, [0, 0, 3.5])).toBeGreaterThan(0);
  expect(e(ell, [0, 0, 3.5])).toBeLessThanOrEqual(0.5 + 1e-12); // never above the true distance on an axis
});

test("operators: union, subtract, intersect, smooth forms, round, shell, elongate, revolve, extrude", () => {
  const A = (x: Expr<"vec3">) => sdSphere(x, 1), B = (x: Expr<"vec3">) => sdSphere(sub(x, [1, 0, 0]), 1);
  const at = (f: F3, q: number[]) => cpu(f)(q);
  const q = [0.4, 0.3, -0.2];
  const a = at(A, q), b = at(B, q);
  expect(at((x) => union(A(x), B(x)), q)).toBe(Math.min(a, b));
  expect(at((x) => intersect(A(x), B(x)), q)).toBe(Math.max(a, b));
  expect(at((x) => subtract(A(x), B(x)), q)).toBe(Math.max(a, -b));
  // Smooth forms never beat the hard ones by more than k / 4 and equal them once the operands are k apart.
  const k = 0.5;
  expect(at((x) => smoothUnion(A(x), B(x), k), q)).toBeLessThanOrEqual(Math.min(a, b));
  expect(at((x) => smoothUnion(A(x), B(x), k), q)).toBeGreaterThan(Math.min(a, b) - k / 4 - 1e-12);
  expect(at((x) => smoothIntersect(A(x), B(x), k), q)).toBeGreaterThanOrEqual(Math.max(a, b));
  expect(at((x) => smoothSubtract(A(x), B(x), k), q)).toBeGreaterThanOrEqual(Math.max(a, -b));
  expect(at((x) => smoothUnion(A(x), B(x), k), [-5, 0, 0])).toBeCloseTo(at(A, [-5, 0, 0]), 12);
  expect(at((x) => round(sdBox3(x, [1, 1, 1]), 0.3), [2, 0, 0])).toBeCloseTo(0.7, 12);
  expect(at((x) => shell(A(x), 0.2), [1, 0, 0])).toBeCloseTo(-0.1, 12);
  expect(at((x) => shell(A(x), 0.2), [1.1, 0, 0])).toBeCloseTo(0, 12);
  expect(at((x) => shell(A(x), 0.2), [0, 0, 0])).toBeCloseTo(0.9, 12);
  // Lifted shapes equal the shapes they must be.
  const t = [0.6, -1.7, 0.4];
  expect(at(revolve((x) => sdCircle(x, 0.4), 1.5), t)).toBeCloseTo(at((x) => sdTorus(x, 1.5, 0.4), t), 12);
  expect(at(extrude((x) => sdBox(x, [0.5, 0.8]), 0.6), t)).toBeCloseTo(at((x) => sdBox3(x, [0.5, 0.8, 0.6]), t), 12);
  expect(at(extrude((x) => sdCircle(x, 0.9), 0.6), t)).toBeCloseTo(at((x) => sdCylinder(x, 0.9, 0.6), t), 12);
  // Elongating a sphere along x by h is the capsule from -h to +h, inside and out.
  for (const pt of [[2, 0.3, 0.2], [0.2, 0.1, 0.05], [-1.4, 0.4, -0.6], [0, 1, 0]]) {
    expect(at(elongate((x) => sdSphere(x, 0.5), [1, 0, 0]), pt)).toBeCloseTo(at((x) => sdCapsule3(x, [-1, 0, 0], [1, 0, 0], 0.5), pt), 12);
  }
});

test("lipschitz is deterministic for a seed, and sees a field that is too steep", () => {
  const f: F3 = (q) => sdSphere(q, 1);
  expect(L(f, BOX, 2000, 9)).toBe(L(f, BOX, 2000, 9));
  expect(L(f, BOX, 2000, 9)).not.toBe(L(f, BOX, 2000, 10));
  expect(L((q) => sdSphere(q, 1).mul(2))).toBeGreaterThan(1.9);
  // A non-finite value is an error naming the point, not a silently skipped sample.
  expect(() => L((q) => sdSphere(q, 1).div(sdSphere(q, 1).sub(sdSphere(q, 1))))).toThrow("the field is");
  expect(lipschitz<"vec2">((q) => sdCircle(q, 1), { samples: 3000, bounds: { min: [-3, -3], max: [3, 3] }, seed: 1 })).toBeLessThanOrEqual(1 + 1e-3);
});

// ---- fields seen through folds -------------------------------------------------------------------------------------

test("fieldOf with a conformal fold is Lipschitz 1; dropping the stretch makes the same test fail", () => {
  const dropStretch = <V extends "vec2" | "vec3">(fold: (q: Expr<V>) => { x: Expr<V> }, sdf: Field<V>): Field<V> => (q) => sdf(fold(q).x);

  // Recursion toward a point: nested spheres of radii 2^k. inner = rho (1 + s) / (2 s) puts the shell walls where the
  // nearest sphere changes, so the field is continuous there (the default log-symmetric walls are not: see the last test).
  const s = 2;
  const nest = fold3.repeatScale(s, (1 + s) / (2 * s));
  const motif: F3 = (q) => shell(sdSphere(q, 1), 0);
  const withStretch = L(fieldOf(nest, motif), { min: [-6, -6, -6], max: [6, 6, 6] });
  const without = L(dropStretch(nest, motif), { min: [-6, -6, -6], max: [6, 6, 6] });
  console.log(`lipschitz repeatScale nest: ${withStretch.toFixed(5)} with stretch, ${without.toFixed(1)} without`);
  expect(withStretch).toBeLessThanOrEqual(1 + 1e-3);
  expect(without).toBeGreaterThan(5);

  // Kaleidoscopic iterated fold of a box: a uniform scaling, so stretch scale^-N restores the bound.
  const kf = fold3.scaleFold({ iterations: 5, fold: compose(fold3.mirror(0), fold3.mirror(1)), scale: 1.8, offset: [1, 0.5, 0.3] });
  const box: F3 = (q) => sdBox3(q, [0.3, 0.3, 0.3]);
  const kb = { min: [-3, -3, -3], max: [3, 3, 3] };
  const kWith = L(fieldOf(kf, box), kb), kWithout = L(dropStretch(kf, box), kb);
  console.log(`lipschitz scaleFold box: ${kWith.toFixed(5)} with stretch, ${kWithout.toFixed(1)} without`);
  expect(kWith).toBeLessThanOrEqual(1 + 1e-3);
  expect(kWithout).toBeGreaterThan(5);
  const k2 = fold2.scaleFold({ iterations: 4, fold: fold2.mirror(0), scale: 1.6, offset: [0.5, 0.2] });
  const k2b = { min: [-3, -3], max: [3, 3] };
  const disc: Field<"vec2"> = (q) => sdCircle(q, 0.2);
  expect(lipschitz(fieldOf(k2, disc), { samples: 20000, bounds: k2b, seed: 3 })).toBeLessThanOrEqual(1 + 1e-3);
  expect(lipschitz(dropStretch<"vec2">(k2, disc), { samples: 20000, bounds: k2b, seed: 3 })).toBeGreaterThan(3);

  // Inversion: toWorld is the lower bound |d| rho^2 / (R^2 + |d| rho), Lipschitz 1. The plain d * stretch is not.
  const inv = fold3.inversion(1.5);
  const sph: F3 = (q) => sdSphere(sub(q, [2, 0, 0]), 0.5);
  const ib = { min: [-4, -4, -4], max: [4, 4, 4] };
  const iWith = L(fieldOf(inv, sph), ib), iPlain = L((q) => sph(inv(q).x).mul(inv(q).stretch), ib);
  console.log(`lipschitz inversion: ${iWith.toFixed(5)} (toWorld), ${iPlain.toFixed(1)} (d * stretch), ${L(dropStretch(inv, sph), ib).toFixed(1)} (no stretch)`);
  expect(iWith).toBeLessThanOrEqual(1 + 1e-3);
  expect(iPlain).toBeGreaterThan(3);
  expect(L(dropStretch(inv, sph), ib)).toBeGreaterThan(3);
});

test("inversion's field never exceeds the true distance to the inverted shape", () => {
  // The inverted surface of the sphere centre (2,0,0) radius 0.5 in the sphere of radius 1.5, as 40000 sampled points.
  const R = 1.5, pts: number[][] = [];
  const N = 40000, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const z = 1 - (2 * (i + 0.5)) / N, rr = Math.sqrt(1 - z * z), a = i * golden;
    const sPt = [2 + 0.5 * rr * Math.cos(a), 0.5 * rr * Math.sin(a), 0.5 * z];
    const k = (R * R) / (sPt[0] ** 2 + sPt[1] ** 2 + sPt[2] ** 2);
    pts.push(sPt.map((v) => v * k));
  }
  const field = cpu(fieldOf(fold3.inversion(R), (q) => sdSphere(sub(q, [2, 0, 0]), 0.5)));
  const r = rng(5);
  let tight = 0;
  for (let i = 0; i < 300; i++) {
    const q = [(r() * 2 - 1) * 4, (r() * 2 - 1) * 4, (r() * 2 - 1) * 4];
    const truth = Math.min(...pts.map((s) => Math.hypot(s[0] - q[0], s[1] - q[1], s[2] - q[2])));
    const d = Math.abs(field(q));
    expect(d).toBeLessThanOrEqual(truth + 0.02); // sampling error of the reference surface
    if (d > 0.5 * truth) tight++;
  }
  expect(tight).toBeGreaterThan(100); // the bound is not vacuous
});

test("twist and bend: the stated bound keeps the field Lipschitz <= 1, and without it the field is too steep", () => {
  const slab: F3 = (q) => sdBox3(q, [2, 0.5, 2]);
  const region = { min: [-2.9, -2.9, -4], max: [2.9, 2.9, 4] }; // within the radius 3 the bound is declared for
  for (const [name, fold] of [["twist", fold3.twist(0.8, 3)], ["bend", fold3.bend(0.3, 3)]] as const) {
    const with_ = L(fieldOf(fold, slab), region), without = L((q) => slab(fold(q).x), region);
    console.log(`lipschitz ${name}: ${with_.toFixed(5)} with the bound, ${without.toFixed(3)} without`);
    expect(with_).toBeLessThanOrEqual(1);
    expect(without).toBeGreaterThan(1.2);
  }
});

test("repeat, mirror and polar repeat of a seam-symmetric motif stay Lipschitz 1; walls in the wrong place do not", () => {
  const bigBox = { min: [-4, -4, -4], max: [4, 4, 4] };
  expect(L(fieldOf(fold3.repeat([1, 1, 1]), (q) => sdSphere(q, 0.3)), bigBox)).toBeLessThanOrEqual(1 + 1e-3);
  expect(L(fieldOf(fold3.mirror(0), (q) => sdSphere(sub(q, [1, 0.5, 0]), 0.4)), bigBox)).toBeLessThanOrEqual(1 + 1e-3);
  // Eight teeth about z: a sphere on the +x axis is symmetric about its sector's centre line, so the walls agree.
  expect(L(fieldOf(fold3.repeatPolar(8), (q) => sdSphere(sub(q, [1.5, 0, 0]), 0.3)), bigBox)).toBeLessThanOrEqual(1 + 1e-3);
  // Regression guard for the documented seam rule: repeatScale's default (log-symmetric) walls are not where nested
  // spheres change nearest neighbour, so the field jumps there. If someone "fixes" the doc by changing the default,
  // this should change with it.
  const jumpy = L(fieldOf(fold3.repeatScale(2), (q) => shell(sdSphere(q, 1), 0)), { min: [-6, -6, -6], max: [6, 6, 6] });
  expect(jumpy).toBeGreaterThan(10);
});

test("screw: the plain field jumps at sector walls; the minimum over adjacent sectors is a distance", () => {
  const pitch = 2, count = 8, w = (2 * Math.PI) / count, rise = pitch / count;
  const rope: F3 = (q) => sdCapsule3(q, [0.8, -0.3, 0], [0.8, 0.3, 0], 0.15);
  const sc = fold3.screw(pitch, count);
  // Away from the axis (the sectors there are narrower than the motif, so more than the adjacent ones matter).
  const region = { min: [0.7, -0.4, -4], max: [2, 0.4, 4] };
  const plain = L(fieldOf(sc, rope), region);
  const adjacent = L(nearest([sc, compose(sc, fold3.helix(w, rise, pitch)), compose(sc, fold3.helix(-w, -rise, pitch))], rope), region);
  console.log(`lipschitz screw rope: ${plain.toFixed(1)} single sector, ${adjacent.toFixed(5)} with adjacent sectors`);
  expect(plain).toBeGreaterThan(10);
  expect(adjacent).toBeLessThanOrEqual(1 + 1e-3);
});

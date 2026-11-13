// Properties a wrong formula would break: points related by a fold's symmetry fold to the same place. Everything runs
// on the CPU in f64, so the tolerances are tight; points are random reals, which are off every seam with probability 1.
import { expect, test } from "bun:test";
import { compileJs, variable, type Expr } from "../src/expr.ts";
import { compose, fold2, fold3, type Fold, type Vec } from "../src/lib/index.ts";
import { rng } from "./lib.harness.ts";

type Out = { x: number[]; id: number[]; stretch: number };
function run<V extends Vec>(fold: Fold<V>, dim: 2 | 3): (p: number[]) => Out {
  const p = variable("p", dim === 2 ? "vec2" : "vec3") as unknown as Expr<V>;
  const g = fold(p);
  const fn = compileJs([g.x, g.id, g.stretch]);
  return (q) => {
    const [x, id, stretch] = fn({ vars: { p: q }, inputs: {}, params: {} }) as [number[], number[], number];
    return { x, id, stretch };
  };
}
const near = (a: number[], b: number[], tol = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol * Math.max(1, Math.abs(v))));
const points = (dim: number, n: number, seed: number, range = 5) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => Array.from({ length: dim }, () => (r() * 2 - 1) * range));
};
const rot = (q: number[], plane: [number, number], a: number): number[] => {
  const out = [...q], [i, j] = plane, c = Math.cos(a), s = Math.sin(a);
  out[i] = c * q[i] - s * q[j]; out[j] = s * q[i] + c * q[j];
  return out;
};

test("mirror and mirrorPlane send mirror images to the same point and are idempotent", () => {
  for (const [dim, fold] of [[2, fold2.mirror(1)], [3, fold3.mirror(0)]] as const) {
    const f = run(fold as Fold<Vec>, dim);
    const axis = dim === 2 ? 1 : 0;
    for (const q of points(dim, 40, 1)) {
      const m = [...q]; m[axis] = -m[axis];
      near(f(q).x, f(m).x);
      near(f(f(q).x).x, f(q).x);
      expect(f(q).x[axis]).toBeGreaterThanOrEqual(0);
    }
  }
  const n = [1, 2, -2], len = 3, off = 0.4;
  const f3 = run(fold3.mirrorPlane(n, off), 3);
  for (const q of points(3, 60, 2)) {
    const d = (q[0] * n[0] + q[1] * n[1] + q[2] * n[2]) / len - off;
    const image = q.map((v, i) => v - 2 * d * (n[i] / len));
    near(f3(q).x, f3(image).x);
    near(f3(f3(q).x).x, f3(q).x);
  }
});

test("repeat and repeatLimited: points one cell apart fold to the same point; the limit stops the copies", () => {
  const cell = [0.7, 1.3, 0.9];
  const f = run(fold3.repeat(cell), 3), fl = run(fold3.repeatLimited(cell, [2, 1, 3]), 3);
  for (const q of points(3, 60, 3)) {
    const shifted = q.map((v, i) => v + cell[i] * [3, -2, 5][i]);
    near(f(q).x, f(shifted).x);
    near(f(f(q).x).x, f(q).x); // idempotent
    near(f(q).id.map((v, i) => v + [3, -2, 5][i]), f(shifted).id);
    expect(f(q).x.every((v, i) => Math.abs(v) <= cell[i] / 2 + 1e-12)).toBe(true);
  }
  // Inside the limit (|index| <= 2, 1, 3) it repeats; one cell beyond the last copy it does not.
  near(fl([0.1, 0.2, 0.1]).x, fl([0.1 + cell[0] * 2, 0.2, 0.1]).x);
  near(fl([0.1 + cell[0] * 2, 0.2, 0.1]).id, [2, 0, 0]);
  const beyond = fl([0.1 + cell[0] * 3, 0.2, 0.1]);
  expect(beyond.x[0]).toBeGreaterThan(cell[0] / 2); // the third neighbour sees the last copy from outside its cell
  const f2 = run(fold2.repeat([0.5, 2]), 2);
  near(f2([0.1, 0.3]).x, f2([0.1 + 1.5, 0.3 - 4]).x);
});

test("repeatPolar: points one sector apart fold to the same point, in 2D and about each axis in 3D", () => {
  const N = 7, w = (2 * Math.PI) / N;
  const f2 = run(fold2.repeatPolar(N), 2);
  for (const q of points(2, 60, 4)) {
    near(f2(q).x, f2(rot(q, [0, 1], w)).x);
    near(f2(q).x, f2(rot(q, [0, 1], -3 * w)).x);
    near(f2(f2(q).x).x, f2(q).x);
    expect(Math.abs(Math.atan2(f2(q).x[1], f2(q).x[0]))).toBeLessThanOrEqual(w / 2 + 1e-12);
  }
  for (const axis of [0, 1, 2]) {
    const f3 = run(fold3.repeatPolar(N, axis), 3);
    const plane: [number, number] = [(axis + 1) % 3, (axis + 2) % 3];
    for (const q of points(3, 40, 5 + axis)) {
      near(f3(q).x, f3(rot(q, plane, 2 * w)).x);
      expect(f3(q).x[axis]).toBeCloseTo(q[axis], 12); // the axis coordinate is untouched
    }
  }
});

test("screw: points related by the screw motion fold to the same point", () => {
  const pitch = 2.4, count = 6, w = (2 * Math.PI) / count;
  for (const axis of [2, 1]) {
    const f = run(fold3.screw(pitch, count, axis), 3);
    const plane: [number, number] = [(axis + 1) % 3, (axis + 2) % 3];
    for (const q of points(3, 80, 6)) {
      for (const m of [1, 2, -3, 6]) {
        const moved = rot(q, plane, m * w);
        moved[axis] += (m * pitch) / count;
        near(f(q).x, f(moved).x, 1e-8);
      }
      near(f(f(q).x).x, f(q).x, 1e-8);
      expect(Math.abs(f(q).x[axis])).toBeLessThanOrEqual(pitch / 2 + 1e-9);
    }
  }
});

test("repeatScale: a point and the same point scaled by the ratio fold to the same place; stretch is the scale", () => {
  const ratio = 2.5;
  for (const [dim, fold] of [[2, fold2.repeatScale(ratio, 0.6)], [3, fold3.repeatScale(ratio, 0.6)]] as const) {
    const f = run(fold as Fold<Vec>, dim);
    for (const q of points(dim, 60, 7, 8)) {
      const a = f(q), b = f(q.map((v) => v * ratio)), c = f(q.map((v) => v / ratio ** 3));
      near(a.x, b.x); near(a.x, c.x);
      expect(b.stretch / a.stretch).toBeCloseTo(ratio, 9);
      expect(b.id[0] - a.id[0]).toBe(1);
      const r = Math.hypot(...a.x);
      expect(r).toBeGreaterThanOrEqual(0.6 - 1e-12);
      expect(r).toBeLessThanOrEqual(0.6 * ratio + 1e-12);
      expect(Math.hypot(...q)).toBeCloseTo(r * a.stretch, 9);
      near(f(a.x).x, a.x); // idempotent
    }
  }
});

test("scaleFold equals the iteration written out by hand, with stretch scale^-N", () => {
  const N = 4, s = 1.7, o = [0.5, 0.3, 0.2];
  const mirror = fold3.mirror(0);
  const f = run(fold3.scaleFold({ iterations: N, fold: compose(mirror, fold3.mirror(2)), scale: s, offset: o }), 3);
  for (const q of points(3, 40, 8, 3)) {
    let x = [...q];
    for (let i = 0; i < N; i++) {
      x = [Math.abs(x[0]), x[1], Math.abs(x[2])];
      x = x.map((v, k) => v * s - o[k] * (s - 1));
    }
    const got = f(q);
    near(got.x, x);
    expect(got.stretch).toBeCloseTo(s ** -N, 12);
  }
});

test("inversion is an involution whose stretches multiply to 1; logPolar and spiral have their symmetries", () => {
  const R = 1.5;
  const fi = run(fold3.inversion(R), 3);
  for (const q of points(3, 40, 9)) {
    const a = fi(q), b = fi(a.x);
    near(b.x, q);
    expect(a.stretch * b.stretch).toBeCloseTo(1, 12);
    expect(Math.hypot(...a.x) * Math.hypot(...q)).toBeCloseTo(R * R, 9);
  }
  const fl = run(fold2.logPolar(), 2);
  near(fl([3, 4]).x, [Math.log(5), Math.atan2(4, 3)]);
  expect(fl([3, 4]).stretch).toBeCloseTo(5, 12);

  // Spiral lattice vectors in (cells around, cells outward): (0, 1) is a scaling by exp(2 pi / cells); (1, 0) is a
  // rotation by 2 pi / cells together with a scaling by exp(-2 pi arms / cells^2).
  const arms = 3, cells = 14, fs = run(fold2.spiral({ arms, cells }), 2);
  for (const q of points(2, 60, 10)) {
    const out = fs(q);
    near(out.x, fs(q.map((v) => v * Math.exp((2 * Math.PI) / cells))).x);
    const turned = rot(q, [0, 1], (2 * Math.PI) / cells).map((v) => v * Math.exp((-2 * Math.PI * arms) / (cells * cells)));
    near(out.x, fs(turned).x, 1e-8);
    expect(out.x.every((v) => v >= -0.5 - 1e-12 && v <= 0.5 + 1e-12)).toBe(true);
  }
});

test("twist rotates each z slice rigidly; bend rotates by rate * x", () => {
  const ft = run(fold3.twist(0.8, 3), 3);
  for (const q of points(3, 30, 11)) {
    const g = ft(q);
    near(g.x, [...rot(q, [0, 1], 0.8 * q[2]).slice(0, 2), q[2]]);
    expect(Math.hypot(g.x[0], g.x[1])).toBeCloseTo(Math.hypot(q[0], q[1]), 12);
  }
  const fb = run(fold3.bend(0.3, 3), 3);
  const g = fb([2, 1, 0.5]);
  near(g.x, [...rot([2, 1], [0, 1], 0.6), 0.5]);
});

test("compose applies the first fold, then the second, multiplying stretches", () => {
  const f = run(compose(fold3.repeatScale(2, 0.7), fold3.mirror(0)), 3);
  const g = run(fold3.repeatScale(2, 0.7), 3), h = run(fold3.mirror(0), 3);
  for (const q of points(3, 30, 12, 6)) {
    const a = g(q), b = h(a.x), c = f(q);
    near(c.x, b.x);
    expect(c.stretch).toBeCloseTo(a.stretch * b.stretch, 12);
  }
});

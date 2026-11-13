import { expect, test } from "bun:test";
import { compileJs, evaluate, variable, type LibFn } from "../src/expr.ts";
import { cartesian, fresnel, hsv, luminance, polar, remap, remapClamped, rotate2, smax, smin, wgslFn } from "../src/lib/index.ts";
import { compare, coord, rng, runGpu } from "./lib.harness.ts";

const x = variable("x", "f32"), y = variable("y", "f32"), k = variable("k", "f32");
const p = variable("p", "vec2"), n = variable("n", "vec3"), v = variable("v", "vec3");

test("util: CPU and GPU agree", async () => {
  const r = rng(11);
  const samples = Array.from({ length: 150 }, (_, i) => {
    // Angles of p are kept off the atan2 branch cut (negative x axis, where +0 and -0 differ) by a nonzero y, and p off the origin.
    const big = i % 2 === 0 ? 300 : 3;
    const px = coord(r, big), py = coord(r, big) || 0.25;
    return {
      x: coord(r, big), y: coord(r, big), k: 0.1 + r() * 2, p: [px, Math.abs(py) < 1e-3 ? 0.25 : py],
      n: [coord(r, 2), coord(r, 2), coord(r, 2) + 3], v: [coord(r, 2), coord(r, 2), coord(r, 2) + 3],
    };
  });
  const exprs = [
    remap(x, -3, 5, 10, -10), remapClamped(x, -3, 5, 10, -10), polar(p), cartesian(p), rotate2(p, y), fresnel(n, v, 3),
    smin(x, y, k), smax(x, y, k), luminance(n), hsv(x, 0.8, 0.9), hsv(x, y, k),
  ];
  const c = await compare(exprs, samples, "util");
  console.log("lib.util worst relative error per function [remap, remapClamped, polar, cartesian, rotate2, fresnel, smin, smax, luminance, hsv, hsv]:", c.worstBy);
  expect(c.worst).toBeLessThan(1e-4);
});

const cpu1 = (e: Parameters<typeof compileJs>[0][number], vars: Record<string, number | number[]>) =>
  evaluate(e, { vars });

test("remap and remapClamped hit the endpoints and clamp", () => {
  expect(cpu1(remap(x, 2, 6, 10, 20), { x: 4 })).toBeCloseTo(15, 12);
  expect(cpu1(remap(x, 2, 6, 10, 20), { x: 10 })).toBeCloseTo(30, 12); // unclamped extrapolates
  expect(cpu1(remapClamped(x, 2, 6, 10, 20), { x: 10 })).toBe(20);
  expect(cpu1(remapClamped(x, 2, 6, 10, 20), { x: -10 })).toBe(10);
  expect(cpu1(remapClamped(x, 2, 6, 20, 10), { x: 2 })).toBe(20); // reversed output range
});

test("polar then cartesian round-trips, and the angle lies in [-pi, pi]", () => {
  const r = rng(12);
  for (let i = 0; i < 500; i++) {
    const q = [coord(r, 50), coord(r, 50)];
    if (Math.hypot(q[0], q[1]) < 1e-3) continue;
    const pr = cpu1(polar(p), { p: q }) as number[];
    expect(pr[0]).toBeGreaterThanOrEqual(0);
    expect(Math.abs(pr[1])).toBeLessThanOrEqual(Math.PI);
    const back = cpu1(cartesian(variable("pr", "vec2")), { pr }) as number[];
    expect(back[0]).toBeCloseTo(q[0], 9);
    expect(back[1]).toBeCloseTo(q[1], 9);
  }
  expect((cpu1(polar(p), { p: [0, 2] }) as number[])[1]).toBeCloseTo(Math.PI / 2, 12);
});

test("rotate2 turns counter-clockwise and keeps length", () => {
  const q = cpu1(rotate2(p, y), { p: [1, 0], y: Math.PI / 2 }) as number[];
  expect(q[0]).toBeCloseTo(0, 12);
  expect(q[1]).toBeCloseTo(1, 12);
  const w = cpu1(rotate2(p, y), { p: [3, -4], y: 1.234 }) as number[];
  expect(Math.hypot(w[0], w[1])).toBeCloseTo(5, 12);
});

test("fresnel is 0 facing the surface and 1 at grazing, from either side", () => {
  const f = (nn: number[], vv: number[], pw: number) => cpu1(fresnel(n, v, pw), { n: nn, v: vv }) as number;
  expect(f([0, 0, 1], [0, 0, 1], 5)).toBe(0);
  expect(f([0, 0, 1], [0, 0, 5], 5)).toBe(0); // inputs need not be unit length
  expect(f([0, 0, 1], [0, 0, -1], 5)).toBe(0); // viewed from behind
  expect(f([0, 0, 1], [1, 0, 0], 5)).toBe(1);
  expect(f([0, 0, 1], [1, 0, 1], 1)).toBeCloseTo(1 - Math.SQRT1_2, 12);
  expect(f([0, 0, 1], [1, 0, 1], 2)).toBeCloseTo((1 - Math.SQRT1_2) ** 2, 12);
});

test("smin lies at or below min and within k / 4 of it; smax mirrors it", () => {
  const r = rng(13);
  const a = variable("a", "f32"), b = variable("b", "f32");
  const lo = compileJs([smin(a, b, k), smax(a, b, k)]);
  let touched = 0;
  for (let i = 0; i < 2000; i++) {
    const av = coord(r, 3), bv = coord(r, 3), kv = 0.05 + r() * 2;
    const [s, m] = lo({ vars: { a: av, b: bv, k: kv }, inputs: {}, params: {} }) as number[];
    expect(s).toBeLessThanOrEqual(Math.min(av, bv) + 1e-12);
    expect(s).toBeGreaterThanOrEqual(Math.min(av, bv) - kv / 4 - 1e-12);
    expect(m).toBeGreaterThanOrEqual(Math.max(av, bv) - 1e-12);
    expect(m).toBeLessThanOrEqual(Math.max(av, bv) + kv / 4 + 1e-12);
    if (Math.abs(av - bv) >= kv) expect(s).toBeCloseTo(Math.min(av, bv), 12); // far apart: exactly min
    else touched++;
  }
  expect(touched).toBeGreaterThan(100);
  // Equal inputs are the worst case: the full k / 4 dip.
  expect(cpu1(smin(a, b, k), { a: 1, b: 1, k: 0.8 })).toBeCloseTo(1 - 0.2, 12);
});

test("hsv gives the primary colours and greys; luminance weights green most", () => {
  const h = variable("h", "f32");
  const col = (hh: number, s: number, vv: number) => cpu1(hsv(h, s, vv), { h: hh }) as number[];
  const near = (got: number[], want: number[]) => want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 12));
  near(col(0, 1, 1), [1, 0, 0]);
  near(col(1, 1, 1), [1, 0, 0]);
  near(col(1 / 3, 1, 1), [0, 1, 0]);
  near(col(2 / 3, 1, 1), [0, 0, 1]);
  near(col(0.5, 0, 0.7), [0.7, 0.7, 0.7]);
  near(col(1 / 6, 1, 0.5), [0.5, 0.5, 0]);
  near(col(-1 / 3, 1, 1), [0, 0, 1]); // wraps below 0
  expect(cpu1(luminance(n), { n: [1, 1, 1] })).toBeCloseTo(1, 12);
  expect(cpu1(luminance(n), { n: [0, 1, 0] })).toBeGreaterThan(cpu1(luminance(n), { n: [1, 0, 0] }) as number);
});

test("wgslFn: runs on the GPU (including through a dependency), refuses the CPU, and checks its own name", async () => {
  const twiceDef: LibFn = { name: "test_twice", ret: "f32", js: "gpu-only", wgsl: "fn test_twice(x: f32) -> f32 { return x * 2.0; }" };
  const twice = wgslFn({ name: "test_twice", ret: "f32", wgsl: twiceDef.wgsl });
  const plusOne = wgslFn({ name: "test_twice_plus_one", ret: "vec2", deps: [twiceDef], wgsl: "fn test_twice_plus_one(p: vec2<f32>) -> vec2<f32> { return vec2<f32>(test_twice(p.x) + 1.0, p.y); }" });
  // Separate modules: `twice` and the dependency `twiceDef` are two definitions of one name, which one module may not hold.
  expect((await runGpu([twice(x)], [{ x: 1.5 }]))[0][0]).toEqual([3]);
  expect((await runGpu([plusOne(p)], [{ p: [2, 7] }]))[0][0]).toEqual([5, 7]);
  expect(() => compileJs([twice(x)])).toThrow(/GPU-only/);
  expect(() => wgslFn({ name: "wrong_name", ret: "f32", wgsl: "fn other(x: f32) -> f32 { return x; }" })).toThrow(/wrong_name/);
});

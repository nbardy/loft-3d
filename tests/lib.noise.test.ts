import { expect, test } from "bun:test";
import { compileJs, evaluate, variable } from "../src/expr.ts";
import { cellular2, cellular3, fbm2, fbm3, hash2, hash22, hash3, hash33, noise2, noise3 } from "../src/lib/index.ts";
import { compare, coord, rng } from "./lib.harness.ts";

const p2 = variable("p", "vec2"), p3 = variable("q", "vec3");

// Spread: negative and positive, fractional and exactly integer (the shared f32 input makes floor agree on both sides),
// small and large (hundreds).
function samples2(): { p: number[] }[] {
  const r = rng(1);
  const fixed = [[0.3, 0.7], [-0.3, -0.7], [3, -2], [-1, -1], [0.999, -0.001], [-7.25, 4.5], [250.5, -310.25], [-399.875, 399.125]];
  const out = fixed.map((p) => ({ p }));
  for (let i = 0; i < 120; i++) out.push({ p: [coord(r, 400), coord(r, 400)] });
  for (let i = 0; i < 60; i++) out.push({ p: [coord(r, 8), coord(r, 8)] });
  return out;
}
function samples3(): { q: number[] }[] {
  const r = rng(2);
  const fixed = [[0.3, 0.7, 0.1], [-0.3, -0.7, -5.5], [3, -2, 7], [-1, -1, -1], [250.5, -310.25, 12.75], [-399.875, 399.125, -0.5]];
  const out = fixed.map((q) => ({ q }));
  for (let i = 0; i < 100; i++) out.push({ q: [coord(r, 400), coord(r, 400), coord(r, 400)] });
  for (let i = 0; i < 50; i++) out.push({ q: [coord(r, 8), coord(r, 8), coord(r, 8)] });
  return out;
}

test("2D hash and noise: CPU and GPU agree", async () => {
  const exprs = [hash2(p2), hash22(p2), noise2(p2), fbm2(p2, { octaves: 5, lacunarity: 2, gain: 0.5 }), cellular2(p2)];
  const c = await compare(exprs, samples2(), "2d");
  console.log("lib.noise 2D worst relative error per function [hash2, hash22, noise2, fbm2, cellular2]:", c.worstBy);
  expect(c.worstBy[0]).toBe(0); // integer hash converted to a float exactly: no rounding at all
  expect(c.worstBy[1]).toBe(0);
  expect(c.worst).toBeLessThan(1e-4);
});

test("3D hash and noise: CPU and GPU agree", async () => {
  const exprs = [hash3(p3), hash33(p3), noise3(p3), fbm3(p3, { octaves: 5, lacunarity: 2, gain: 0.5 }), cellular3(p3)];
  const c = await compare(exprs, samples3(), "3d");
  console.log("lib.noise 3D worst relative error per function [hash3, hash33, noise3, fbm3, cellular3]:", c.worstBy);
  expect(c.worstBy[0]).toBe(0);
  expect(c.worstBy[1]).toBe(0);
  expect(c.worst).toBeLessThan(1e-4);
});

test("fbm with a non-integer lacunarity and gain agrees (small coordinates: p * 1.9 is not exact in f32)", async () => {
  const r = rng(3);
  const samples = Array.from({ length: 80 }, () => ({ p: [coord(r, 6), coord(r, 6)], q: [coord(r, 6), coord(r, 6), coord(r, 6)] }));
  const c = await compare([fbm2(p2, { octaves: 3, lacunarity: 1.9, gain: 0.55 }), fbm3(p3, { octaves: 3, lacunarity: 1.9, gain: 0.55 })], samples, "fbm1.9");
  console.log("lib.noise fbm lacunarity 1.9 worst relative error:", c.worstBy);
  expect(c.worst).toBeLessThan(1e-4);
});

const cpu = (e: Parameters<typeof compileJs>[0][number], name: string) => {
  const run = compileJs([e]);
  return (v: number[]): number | number[] => run({ vars: { [name]: v }, inputs: {}, params: {} })[0] as number | number[];
};

test("noise is 0 on lattice points, bounded by 1 and centred on 0", () => {
  const n2 = cpu(noise2(p2), "p"), n3 = cpu(noise3(p3), "q");
  for (const [x, y] of [[0, 0], [3, -2], [-5, -9], [100, 250]]) expect(Math.abs(n2([x, y]) as number)).toBeLessThan(1e-12);
  for (const [x, y, z] of [[0, 0, 0], [3, -2, 1], [-5, -9, -4]]) expect(Math.abs(n3([x, y, z]) as number)).toBeLessThan(1e-12);
  const r = rng(4);
  let sum2 = 0, sum3 = 0, max2 = 0, max3 = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const a = n2([coord(r, 60), coord(r, 60)]) as number, b = n3([coord(r, 60), coord(r, 60), coord(r, 60)]) as number;
    sum2 += a; sum3 += b; max2 = Math.max(max2, Math.abs(a)); max3 = Math.max(max3, Math.abs(b));
  }
  // The bound is exact by construction (scaled unit gradients); a mean far from 0 would mean a biased gradient set,
  // and a maximum well below 1 a wrong scale.
  expect(max2).toBeLessThanOrEqual(1 + 1e-9);
  expect(max3).toBeLessThanOrEqual(1 + 1e-9);
  expect(max2).toBeGreaterThan(0.7);
  expect(max3).toBeGreaterThan(0.6);
  expect(Math.abs(sum2 / N)).toBeLessThan(0.02);
  expect(Math.abs(sum3 / N)).toBeLessThan(0.02);
});

test("noise is continuous across cell boundaries, including negative ones", () => {
  // A floor/cast bug on negative coordinates would put a jump exactly at the cell edges.
  const n2 = cpu(noise2(p2), "p"), n3 = cpu(noise3(p3), "q");
  for (const edge of [-3, -1, 0, 1, 4]) {
    expect(Math.abs((n2([edge - 1e-7, 0.37]) as number) - (n2([edge + 1e-7, 0.37]) as number))).toBeLessThan(1e-5);
    expect(Math.abs((n2([0.37, edge - 1e-7]) as number) - (n2([0.37, edge + 1e-7]) as number))).toBeLessThan(1e-5);
    expect(Math.abs((n3([edge - 1e-7, 0.37, 0.61]) as number) - (n3([edge + 1e-7, 0.37, 0.61]) as number))).toBeLessThan(1e-5);
    expect(Math.abs((n3([0.37, 0.61, edge - 1e-7]) as number) - (n3([0.37, 0.61, edge + 1e-7]) as number))).toBeLessThan(1e-5);
  }
});

test("hashes are in [0, 1), constant in a cell, and uniform enough", () => {
  const h2 = cpu(hash2(p2), "p"), h3 = cpu(hash3(p3), "q");
  expect(h2([2.1, -3.9])).toBe(h2([2.9, -3.1]));
  expect(h2([2.1, -3.9])).not.toBe(h2([3.1, -3.9]));
  expect(h3([2.1, -3.9, 0.5])).toBe(h3([2.9, -3.1, 0.99]));
  const r = rng(5);
  let s = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const a = h2([coord(r, 300), coord(r, 300)]) as number, b = h3([coord(r, 300), coord(r, 300), coord(r, 300)]) as number;
    expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThan(1);
    expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(1);
    s += a + b;
  }
  expect(Math.abs(s / (2 * N) - 0.5)).toBeLessThan(0.01);
});

test("cellular: nearest <= second nearest, both non-negative and bounded", () => {
  const c2 = cpu(cellular2(p2), "p"), c3 = cpu(cellular3(p3), "q");
  const r = rng(6);
  let sum = 0;
  for (let i = 0; i < 5000; i++) {
    for (const d of [c2([coord(r, 50), coord(r, 50)]) as number[], c3([coord(r, 50), coord(r, 50), coord(r, 50)]) as number[]]) {
      expect(d[0]).toBeGreaterThanOrEqual(0);
      expect(d[0]).toBeLessThanOrEqual(d[1]);
      expect(d[1]).toBeLessThan(2.5);
      sum += d[0];
    }
  }
  // One point per cell: the mean nearest distance is about 0.5 (2D) and 0.55 (3D). A degenerate hash (all points on a
  // lattice) would give a very different mean.
  expect(sum / 10000).toBeGreaterThan(0.35);
  expect(sum / 10000).toBeLessThan(0.7);
});

test("fbm rejects a non-positive octave count", () => {
  expect(() => fbm2(p2, { octaves: 0, lacunarity: 2, gain: 0.5 })).toThrow(/octaves/);
  expect(evaluate(fbm2([0.3, 0.4], { octaves: 1, lacunarity: 2, gain: 0.5 }))).toBe(evaluate(noise2([0.3, 0.4])));
});

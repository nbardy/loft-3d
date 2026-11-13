// `eq`, `ne` and `pick` (added 2026-11-11 for scenes that wrote `abs(a - b) < 0.5` to compare a copy's index): the CPU
// and the GPU must agree exactly on whole numbers, or a paint that picks per copy would pick differently in the pose
// pass (CPU) and on screen (GPU). The bug this catches: an operator emitted with the wrong spelling or the wrong select
// order in one backend (WGSL's select is (false, true, condition)), or a JS comparison of the wrong kind.
import { expect, test } from "bun:test";
import { add, clamp, eq, f, floor, mul, ne, pick, select, variable } from "../src/expr.ts";
import { compare } from "./lib.harness.ts";

test("eq, ne and pick agree exactly between CPU and GPU on whole numbers", async () => {
  const x = variable("x", "f32");
  const k = floor(x); // whole numbers, -0 included (floor(-0.25) is -1; floor(-0) is -0)
  const index = clamp(add(k, 5), 0, 9);
  const exprs = [
    select(eq(k, 2), 1, 0),
    select(ne(k, -3), 1, 0),
    select(eq(mul(x, 0), f(0)), 1, 0), // -0 == 0 in both
    pick(index, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]),
  ];
  const samples = Array.from({ length: 81 }, (_, i) => ({ x: -10 + i * 0.25 }));
  const cmp = await compare(exprs, samples, "eq");
  expect(cmp.worst).toBe(0);
  // And the values are the ones meant, not merely the same wrong ones on both sides.
  samples.forEach((s, i) => {
    const kk = Math.floor(s.x);
    expect(cmp.gpu[i]![0]![0]).toBe(kk === 2 ? 1 : 0);
    expect(cmp.gpu[i]![1]![0]).toBe(kk !== -3 ? 1 : 0);
    expect(cmp.gpu[i]![2]![0]).toBe(1);
    expect(cmp.gpu[i]![3]![0]).toBe(10 + Math.min(9, Math.max(0, kk + 5)));
  });
});

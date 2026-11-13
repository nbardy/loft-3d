import { expect, test } from "bun:test";
import { compileJs, variable, type Expr } from "../src/expr.ts";
import { compose, fold2, fold3, type Fold, type Vec } from "../src/lib/index.ts";
import { compare, coord, rng } from "./lib.harness.ts";

type Case<V extends Vec> = { name: string; fold: Fold<V>; range: number };

/** Every output lane of a fold as separate expressions: x, id, stretch. */
function outputs<V extends Vec>(fold: Fold<V>, p: Expr<V>): Expr[] {
  const g = fold(p);
  return [g.x, g.id, g.stretch];
}

/**
 * Samples that are not near a seam. f32 and f64 round `p / c`, `atan2` and `log` differently, so a point within a few
 * ulps of a cell wall, a sector wall or the atan2 cut lands on opposite sides in the two backends and the comparison
 * would fail through no fault of the fold. A sample is moved (skipped, and another drawn) when nudging it by 1e-4
 * (relative to its size) in each coordinate changes the CPU result in `id`, or jumps `x` by more than 0.5.
 */
function offSeam<V extends Vec>(dim: 2 | 3, fold: Fold<V>, r: () => number, range: number, count: number): number[][] {
  const p = variable("p", dim === 2 ? "vec2" : "vec3") as unknown as Expr<V>;
  const run = compileJs(outputs(fold, p));
  const out: number[][] = [];
  while (out.length < count) {
    const big = out.length % 2 === 0 ? range : range / 50; // large and small coordinates alternate
    const q = Array.from({ length: dim }, () => coord(r, big));
    const base = run({ vars: { p: q }, inputs: {}, params: {} }) as (number | number[])[];
    const flat = (v: number | number[]) => (typeof v === "number" ? [v] : v);
    let seam = false;
    for (let a = 0; a < dim && !seam; a++) for (const sgn of [-1, 1]) {
      const n = q.map((v, i) => (i === a ? v + sgn * 1e-4 * (1 + Math.abs(v)) : v));
      const other = run({ vars: { p: n }, inputs: {}, params: {} }) as (number | number[])[];
      const idA = flat(base[1]), idB = flat(other[1]), xA = flat(base[0]), xB = flat(other[0]);
      if (idA.some((v, i) => v !== idB[i]) || xA.some((v, i) => Math.abs(v - xB[i]) > 0.5)) seam = true;
    }
    if (!seam && Math.hypot(...q) > 0.1) out.push(q);
  }
  return out;
}

async function check<V extends Vec>(dim: 2 | 3, cases: Case<V>[], label: string): Promise<void> {
  const p = variable("p", dim === 2 ? "vec2" : "vec3") as unknown as Expr<V>;
  const worst: Record<string, number> = {};
  for (const c of cases) {
    const samples = offSeam(dim, c.fold, rng(31 + c.name.length), c.range, 120).map((q) => ({ p: q }));
    const cmp = await compare(outputs(c.fold, p), samples, `${label}/${c.name}`);
    worst[c.name] = cmp.worst;
    expect(cmp.worst).toBeLessThan(1e-4);
  }
  console.log(`lib.fold ${label} worst relative CPU/GPU error per fold:`, worst);
}

test("fold2: CPU and GPU agree", async () => {
  const cases: Case<"vec2">[] = [
    { name: "identity", fold: fold2.identity, range: 300 },
    { name: "mirror", fold: fold2.mirror(1), range: 300 },
    { name: "mirrorPlane", fold: fold2.mirrorPlane([0.6, 0.8], 0.3), range: 300 },
    { name: "repeat", fold: fold2.repeat([0.7, 1.3]), range: 300 },
    { name: "repeatLimited", fold: fold2.repeatLimited([0.7, 1.3], [3, 2]), range: 300 },
    { name: "repeatPolar", fold: fold2.repeatPolar(7), range: 300 },
    { name: "scaleFold", fold: fold2.scaleFold({ iterations: 5, fold: compose(fold2.mirror(0), fold2.mirrorPlane([0.8, 0.6])), scale: 1.6, offset: [0.5, 0.2] }), range: 4 },
    { name: "logPolar", fold: fold2.logPolar(), range: 300 },
    { name: "repeatScale", fold: fold2.repeatScale(2.5, 0.6), range: 300 },
    { name: "spiral", fold: fold2.spiral({ arms: 3, cells: 14 }), range: 300 },
    { name: "inversion", fold: fold2.inversion(1.5), range: 300 },
    { name: "compose", fold: compose(fold2.repeatPolar(5), fold2.repeat([0.5, 0.5])), range: 100 },
  ];
  await check(2, cases, "fold2");
});

test("fold3: CPU and GPU agree", async () => {
  const cases: Case<"vec3">[] = [
    { name: "identity", fold: fold3.identity, range: 300 },
    { name: "mirror", fold: fold3.mirror(2), range: 300 },
    { name: "mirrorPlane", fold: fold3.mirrorPlane([1, 2, -2], 0.4), range: 300 },
    { name: "repeat", fold: fold3.repeat([0.7, 1.3, 0.9]), range: 300 },
    { name: "repeatLimited", fold: fold3.repeatLimited([0.7, 1.3, 0.9], [3, 2, 4]), range: 300 },
    { name: "repeatPolar z", fold: fold3.repeatPolar(7), range: 300 },
    { name: "repeatPolar x", fold: fold3.repeatPolar(5, 0), range: 300 },
    { name: "screw", fold: fold3.screw(2.4, 6), range: 300 },
    { name: "screw y", fold: fold3.screw(1.7, 3, 1), range: 300 },
    { name: "scaleFold", fold: fold3.scaleFold({ iterations: 5, fold: compose(fold3.mirror(0), fold3.mirrorPlane([1, 1, 0])), scale: 1.7, offset: [0.5, 0.3, 0.2] }), range: 4 },
    { name: "logSphere", fold: fold3.logSphere(), range: 300 },
    { name: "repeatScale", fold: fold3.repeatScale(2.5, 0.6), range: 300 },
    { name: "inversion", fold: fold3.inversion(1.5), range: 300 },
    { name: "twist", fold: fold3.twist(0.8, 3), range: 100 },
    { name: "bend", fold: fold3.bend(0.3, 3), range: 100 },
  ];
  await check(3, cases, "fold3");
});

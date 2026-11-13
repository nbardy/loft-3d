// A distance function has a unit-length gradient wherever it is differentiable (away from its medial axis and its
// corners). Every rule on the path (length, abs, max/min selection, select, the |v| floor at zero inside a box, the
// fold's mod) has to be right for that to hold, so a wrong rule shows up as |grad d| != 1.
import { expect, test } from "bun:test";
import { compileJs, length, sub, variable, type Expr } from "../src/expr.ts";
import { gradient } from "../src/grad.ts";
import { repeatAngle, sdBox, sdCapsule, sdCircle, sdRing, sdSegment, sdTriangleIsosceles, stroke } from "../src/lib/sdf2.ts";
import { compare, coord, rng, toF32 } from "./lib.harness.ts";

const p = variable("p", "vec2");
const fields: Record<string, Expr<"f32">> = {
  circle: sdCircle(p, 0.8),
  box: sdBox(p, [0.9, 0.5]),
  segment: sdSegment(p, [-0.7, -0.2], [0.6, 0.5]),
  capsule: sdCapsule(p, [-0.7, -0.2], [0.6, 0.5], 0.3),
  ring: sdRing(p, 0.9, 0.15),
  triangle: sdTriangleIsosceles(p, 0.8, 1.2),
  "stroke of a box": stroke(sdBox(p, [0.9, 0.5]), 0.1),
  "box in a polar fold": sdBox(sub(repeatAngle(p, 5), [1.1, 0]), [0.3, 0.15]),
};

test("gradients of the sdf2 distance functions have unit length off the medial axis", async () => {
  const r = rng(7);
  for (const [name, d] of Object.entries(fields)) {
    const grad = gradient(d, p);
    const run = compileJs([d, grad]);
    const at = (x: number, y: number): number => run({ vars: { p: [x, y] }, inputs: {}, params: {} })[0] as number;
    // Off the medial axis and the corners the field is smooth, so finite-difference gradients at two step sizes
    // agree; near them they do not. That is the filter: it uses only the field, never the symbolic gradient.
    const fdGrad = (x: number, y: number, h: number): number[] => [(at(x + h, y) - at(x - h, y)) / (2 * h), (at(x, y + h) - at(x, y - h)) / (2 * h)];
    const kept: { p: number[] }[] = [];
    const total = 400;
    for (let i = 0; i < total; i++) {
      const [x, y] = toF32({ p: [coord(r, 2), coord(r, 2)] }).p as number[];
      const a = fdGrad(x, y, 1e-4), b = fdGrad(x, y, 2e-4);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6 && Math.hypot(x, y) > 1e-3) kept.push({ p: [x, y] });
    }
    // The filter must leave most of the plane: a gradient that is NaN or wrong everywhere would not be hidden by it.
    expect(kept.length).toBeGreaterThan(0.85 * total);
    let worstCpu = 0;
    for (const s of kept) {
      const gv = run({ vars: s, inputs: {}, params: {} })[1] as number[];
      worstCpu = Math.max(worstCpu, Math.abs(Math.hypot(gv[0], gv[1]) - 1));
    }
    const c = await compare([grad, length(grad)], kept, `grad.sdf ${name}`);
    const worstGpuNorm = Math.max(...c.gpu.map((o) => Math.abs(o[1][0] - 1)));
    console.log(`grad.sdf ${name}: kept ${kept.length}/${total}, worst | |grad| - 1 | cpu ${worstCpu.toExponential(2)} gpu ${worstGpuNorm.toExponential(2)}, cpu-gpu ${c.worst.toExponential(2)}`);
    expect(worstCpu).toBeLessThan(1e-9);
    expect(worstGpuNorm).toBeLessThan(1e-4);
    expect(c.worst).toBeLessThan(1e-4);
  }
});

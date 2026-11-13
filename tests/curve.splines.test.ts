// Curves (src/curve.ts): splines, keyed tables and the closed-form motion operators.
import { expect, test } from "bun:test";
import { CURVE_N, evaluate, lift, variable, vec3, mul, time, type Expr } from "../src/expr.ts";
import { keys, response, through } from "../src/curve.ts";

const pts: Expr<"vec3">[] = [vec3(0, 0, 0), vec3(1, 2, 0), vec3(3, 1, mul(time, 2)), vec3(4, -1, 1), vec3(6, 0, 0.5)];
const env = { inputs: { time: 0.7 } };

// Catches: a kernel that does not interpolate (wrong Catmull-Rom coefficients) or mishandled phantom end points.
test("through passes through every control point", () => {
  const want = [[0, 0, 0], [1, 2, 0], [3, 1, 1.4], [4, -1, 1], [6, 0, 0.5]];
  want.forEach((w, j) => {
    const got = evaluate(through(variable("m", "f32"), pts), { ...env, vars: { m: j / (pts.length - 1) } }) as number[];
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - w[i])).toBeLessThan(1e-12);
  });
});

// Catches: constant folding in the JavaScript backend (every pose station is a spline at a constant m, folded to its
// four nonzero terms) changing the value the general expression gives with m bound at run time.
test("through at a constant m equals the general form", () => {
  for (const m of [0, 0.03, 0.2, 0.25, 0.49, 0.5, 0.77, 0.999, 1]) {
    const fast = evaluate(through(lift(m), pts), env) as number[];
    const general = evaluate(through(variable("m", "f32"), pts), { ...env, vars: { m } }) as number[];
    for (let i = 0; i < 3; i++) expect(Math.abs(fast[i] - general[i])).toBeLessThan(1e-12);
  }
});

// Catches: tangents that are not limited (plain Catmull-Rom on a profile overshoots: a taper bulges past its keys).
test("keyed curves never overshoot their keys", () => {
  const k = [[0, 0.1], [0.2, 1], [0.25, 1], [0.6, 0.2], [1, 0.19]] as const;
  const row = keys(k);
  // At the table's own samples, where the interpolant (not the table's linear lookup) decides the value.
  for (let s = 0; s < CURVE_N; s++) {
    const x = s / (CURVE_N - 1);
    const y = (evaluate(row(x)) as number[])[0];
    let i = 0;
    while (i < k.length - 2 && x > k[i + 1][0]) i++;
    const lo = Math.min(k[i][1], k[i + 1][1]), hi = Math.max(k[i][1], k[i + 1][1]);
    expect(y).toBeGreaterThanOrEqual(lo - 1e-6);
    expect(y).toBeLessThanOrEqual(hi + 1e-6);
  }
});

// Catches: a wrong closed form for the second-order step response. Its peak for r = 0 is the textbook
// 1 + exp(-pi zeta / sqrt(1 - zeta^2)) at t = 1 / (2 f sqrt(1 - zeta^2)); it settles at 1; it is 0 before the step.
test("response matches the second-order step response", () => {
  for (const zeta of [0.2, 0.5, 0.8]) {
    const f = 1.5, peakT = 1 / (2 * f * Math.sqrt(1 - zeta * zeta));
    const at = (t: number) => evaluate(response(t, { f, zeta })) as number;
    expect(at(peakT)).toBeCloseTo(1 + Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)), 6);
    expect(at(40)).toBeCloseTo(1, 6);
    expect(at(-3)).toBe(0);
  }
  // Overdamped: no overshoot at all.
  for (let t = 0; t < 5; t += 0.05) expect(evaluate(response(t, { f: 1, zeta: 1.6 })) as number).toBeLessThanOrEqual(1 + 1e-9);
  // Anticipation: r < 0 moves the wrong way first.
  expect(evaluate(response(0.02, { f: 2, zeta: 0.6, r: -1 })) as number).toBeLessThan(0);
});

// The geometric uses of differentiation: normals of parametric surfaces, the stretch of maps, pixel footprints through
// folds, and the size of what differentiation builds.
import { expect, test } from "bun:test";
import {
  abs, add, atan2, compileJs, cos, dot, evaluate, fract, length, log, mod, mul, sin, sub, topo, variable, vec2, vec3,
  type Env, type Expr,
} from "../src/expr.ts";
import { DerivativeError, derivative, derivativeAlong, footprint, gradient, normalOf, stretchOf } from "../src/grad.ts";
import { cellular2, fbm2, noise2 } from "../src/lib/noise.ts";
import { repeatAngle, sdBox, sdCircle, sdSegment, sdTriangleIsosceles } from "../src/lib/sdf2.ts";
import { rotate2, smin } from "../src/lib/util.ts";
import { compare } from "./lib.harness.ts";

const u = variable("u", "f32"), v = variable("v", "f32"), p = variable("p", "vec2"), q = variable("q", "vec3");
const env = (vars: Env["vars"]): Env => ({ vars, inputs: {}, params: {} });
const num = (e: Expr, vars: Env["vars"]): number => evaluate(e, env(vars)) as number;
const vecv = (e: Expr, vars: Env["vars"]): number[] => evaluate(e, env(vars)) as number[];

test("normalOf points along the analytic normal of a sphere and a torus", async () => {
  // Sphere with u the polar angle and v the azimuth: d/du x d/dv points outward. Poles (sin u = 0) excluded.
  const R = 1.7, Rt = 2, rt = 0.6;
  const sphere = mul(R, vec3(mul(sin(u), cos(v)), mul(sin(u), sin(v)), cos(u)));
  const torus = vec3(mul(add(Rt, mul(rt, cos(v))), cos(u)), mul(add(Rt, mul(rt, cos(v))), sin(u)), mul(rt, sin(v)));
  const nS = normalOf(sphere, u, v), nT = normalOf(torus, u, v);
  const samples: { u: number; v: number }[] = [];
  for (let i = 0; i < 40; i++) samples.push({ u: 0.2 + (i * 0.618034 % 1) * 2.7, v: (i * 0.414214 % 1) * 6.28 - 3.14 });
  let worst = 0;
  for (const s of samples) {
    const ns = vecv(nS, s), nt = vecv(nT, s);
    const radial = [Math.sin(s.u) * Math.cos(s.v), Math.sin(s.u) * Math.sin(s.v), Math.cos(s.u)];
    const tube = [Math.cos(s.v) * Math.cos(s.u), Math.cos(s.v) * Math.sin(s.u), Math.sin(s.v)];
    worst = Math.max(worst, 1 - (ns[0] * radial[0] + ns[1] * radial[1] + ns[2] * radial[2]), 1 - (nt[0] * tube[0] + nt[1] * tube[1] + nt[2] * tube[2]));
  }
  console.log("grad.geom normalOf worst 1 - n . n_analytic:", worst);
  expect(worst).toBeLessThan(1e-12);
  const c = await compare([nS, nT], samples, "normalOf");
  console.log("grad.geom normalOf cpu-gpu:", c.worst);
  expect(c.worst).toBeLessThan(1e-4);
});

/** The largest singular value of a 2x2 matrix with columns a, b (closed form), for checking the bound. */
const sigmaMax = (a: number[], b: number[]): number => {
  const fro = a[0] ** 2 + a[1] ** 2 + b[0] ** 2 + b[1] ** 2, det = a[0] * b[1] - a[1] * b[0];
  return Math.sqrt((fro + Math.sqrt(Math.max(0, fro * fro - 4 * det * det))) / 2);
};

test("stretchOf: exact factors for conformal maps, an upper bound for the rest", () => {
  const pts = [[0.7, 0.2], [-1.3, 0.4], [0.25, -2.1], [3.2, 1.7]];
  const s3 = [0.3, -0.8, 1.1];
  // A 3D rotation as three orthonormal rows (Rodrigues about (1, 2, 2)/3 by 0.9 rad, computed here in double).
  const k = [1 / 3, 2 / 3, 2 / 3], c = Math.cos(0.9), sn = Math.sin(0.9);
  const rows = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? c : 0) + (1 - c) * k[i] * k[j] + sn * [[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]][i][j]));
  const rot3 = vec3(dot(rows[0], q), dot(rows[1], q), dot(rows[2], q));
  const exact: [string, Expr, (x: number[]) => number][] = [
    ["uniform scale", stretchOf(mul(p, 2.5), p), () => 2.5],
    ["rotation", stretchOf(rotate2(p, 0.7), p), () => 1],
    ["log-polar", stretchOf(vec2(log(length(p)), atan2(p.y, p.x)), p), (x) => 1 / Math.hypot(x[0], x[1])],
    ["axis-aligned anisotropic scale", stretchOf(vec2(mul(p.x, 3), mul(p.y, 0.5)), p), () => 3],
  ];
  for (const [name, e, want] of exact) for (const x of pts) expect(Math.abs(num(e, { p: x }) - want(x)) / want(x)).toBeLessThan(1e-12);
  expect(Math.abs(num(stretchOf(mul(q, 0.4), q), { q: s3 }) - 0.4)).toBeLessThan(1e-12);
  expect(Math.abs(num(stretchOf(rot3, q), { q: s3 }) - 1)).toBeLessThan(1e-12);

  // Not conformal: a shear and a noise warp. The bound must hold (>= the true largest singular value, computed here
  // from finite-difference Jacobians) and stay within sqrt(2) of it.
  const warps: [string, Expr<"vec2">][] = [
    ["shear", vec2(add(p.x, mul(p.y, 1.4)), p.y)],
    ["noise warp", add(p, mul(vec2(noise2(mul(p, 2)), noise2(add(mul(p, 2), [5.25, 1.5]))), 0.4))],
  ];
  let ratioLo = Infinity, ratioHi = 0;
  for (const [, w] of warps) {
    const s = stretchOf(w, p);
    for (const x of pts) {
      const h = 1e-6;
      const col = (i: number): number[] => {
        const a = [...x], b = [...x]; a[i] += h; b[i] -= h;
        const fa = vecv(w, { p: a }), fb = vecv(w, { p: b });
        return [(fa[0] - fb[0]) / (2 * h), (fa[1] - fb[1]) / (2 * h)];
      };
      const ratio = num(s, { p: x }) / sigmaMax(col(0), col(1));
      ratioLo = Math.min(ratioLo, ratio); ratioHi = Math.max(ratioHi, ratio);
    }
  }
  console.log(`grad.geom stretchOf bound / true stretch on non-conformal maps: [${ratioLo}, ${ratioHi}]`);
  expect(ratioLo).toBeGreaterThan(1 - 1e-6);
  expect(ratioHi).toBeLessThan(Math.SQRT2 + 1e-6);
});

test("footprint has no spike at fold seams, where a difference of the folded coordinate does", () => {
  const du = 1e-3, dv = 5e-4;
  const px = [{ of: u, dx: du, dy: dv }];
  // Seams: fract(5u) at u = 0.2, mod(3u, 0.7) at u = 0.7 / 3, abs(u - 0.5) at 0.5. Samples straddle each one.
  const folds: [string, Expr<"f32">, number, number][] = [
    ["fract", fract(mul(u, 5)), 0.2, 5],
    ["mod", mod(mul(u, 3), 0.7), 0.7 / 3, 3],
    ["abs", mul(abs(sub(u, 0.5)), 4), 0.5, 4],
  ];
  for (const [name, coord, seam, rate] of folds) {
    const fp = footprint(coord, px);
    const run = compileJs([fp.width, coord]);
    let worst = 0, naive = 0;
    for (let i = -10; i <= 10; i++) {
      const at = seam + i * 3e-4 + 1e-5;
      const [w, c0] = run(env({ u: at })) as number[];
      const c1 = run(env({ u: at + du }))[1] as number, c2 = run(env({ u: at + dv }))[1] as number;
      worst = Math.max(worst, Math.abs(w - rate * (du + dv)) / (rate * (du + dv)));
      naive = Math.max(naive, Math.abs(c1 - c0) + Math.abs(c2 - c0));
    }
    console.log(`grad.geom footprint ${name}: worst relative deviation ${worst}, naive pixel difference peaks at ${naive} (rate ${rate * (du + dv)})`);
    expect(worst).toBeLessThan(1e-9);
    // The trap is real: the difference of the folded coordinate is ~100x the true rate somewhere near the seam.
    if (name !== "abs") expect(naive).toBeGreaterThan(100 * rate * (du + dv));
  }

  // A 2D polar fold: across a sector seam the folded point jumps by a rotation of the sector angle. Its footprint stays
  // bounded by the unfolded rate (the fold is an isometry), while the naive difference spikes.
  const fold = repeatAngle(p, 6);
  const dp = { of: p, dx: [1e-3, 0], dy: [0, 1e-3] };
  const fp = footprint(fold, [dp]);
  const run = compileJs([fp.width, fold]);
  let widest = 0, naive = 0;
  for (let i = -10; i <= 10; i++) {
    const a = Math.PI / 6 + i * 2e-4 + 1e-5, x = [Math.cos(a), Math.sin(a)];
    const [w, f0] = run(env({ p: x })) as number[][];
    const f1 = run(env({ p: [x[0] + 1e-3, x[1]] }))[1] as number[];
    widest = Math.max(widest, ...w);
    naive = Math.max(naive, Math.hypot(f1[0] - f0[0], f1[1] - f0[1]));
  }
  console.log(`grad.geom footprint polar fold: widest ${widest}, naive pixel difference peaks at ${naive}`);
  expect(widest).toBeLessThanOrEqual(2e-3 * (1 + 1e-12));
  expect(naive).toBeGreaterThan(0.1);
});

/** Nodes reachable from the roots, loop bodies included. */
const count = (roots: readonly Expr[]): number => {
  const seen = new Set<number>();
  const walk = (list: readonly Expr[]): void => {
    for (const e of topo(list)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.node.op === "iterate") walk(e.node.loop.next);
    }
  };
  walk(roots);
  return seen.size;
};

test("derivatives stay a small multiple of the expression's size", () => {
  // Measured 2026-11-10: gradient / original = 2.00 for fbm through a polar fold, 2.41 for an 8-shape smin scene with
  // fbm. The bound is 3x: an operator rule that rebuilt its operands instead of reusing the value nodes (or lost
  // sharing through the memo) would multiply this by the depth of the expression.
  const noise = fbm2(mul(repeatAngle(p, 6), 3), { octaves: 5, lacunarity: 2, gain: 0.5 });
  let d: Expr<"f32"> = sdCircle(p, 0.3);
  for (let i = 0; i < 8; i++) {
    const at = rotate2(sub(p, [Math.cos(i) * 0.7, Math.sin(i) * 0.7]), i * 0.4);
    d = smin(d, i % 3 === 0 ? sdBox(at, [0.2, 0.1]) : i % 3 === 1 ? sdSegment(at, [-0.2, 0], [0.2, 0.1]) : sdTriangleIsosceles(at, 0.2, 0.3), 0.1);
  }
  const scene = add(d, mul(noise, 0.05));
  for (const [name, e] of [["fbm through a fold", noise], ["smin scene with fbm", scene]] as const) {
    const ratio = count([gradient(e, p)]) / count([e]);
    console.log(`grad.geom size ${name}: ${count([e])} nodes, gradient ${ratio.toFixed(2)}x`);
    expect(ratio).toBeLessThan(3);
  }
  // A long chain: each link's derivative reuses the link's value, so the derivative grows linearly with the chain.
  let chain: Expr<"f32"> = u;
  for (let i = 0; i < 200; i++) chain = sin(add(mul(chain, 1.1), cos(chain)));
  const r = count([derivative(chain, u)]) / count([chain]);
  console.log(`grad.geom size 200-link chain: ${count([chain])} nodes, derivative ${r.toFixed(2)}x`);
  expect(r).toBeLessThan(3);
});

test("a library function without a derivative raises a named error instead of a silent zero", () => {
  // cellular2 has no registered rule: treating it as constant would make every normal of a cellular field wrong.
  const run = (): unknown => gradient(cellular2(p).x, p);
  expect(run).toThrow(DerivativeError);
  expect(run).toThrow(/loft_cellular2/);
  // With an argument that does not move, no rule is needed: the derivative is zero.
  expect(evaluate(derivativeAlong(cellular2(vec2(0.3, 0.4)).x, p, [1, 0]))).toBe(0);
});

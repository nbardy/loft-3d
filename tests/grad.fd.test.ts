// `derivative` against a centred finite difference of the original expression, evaluated on the CPU in double
// precision; then the derivative expressions themselves, CPU against GPU. Every operator in expr.ts appears at least
// once, alone and nested, scalar and vector, with curve rows, library functions (noise, hashes, the sdf2/util
// compositions) and loops.
import { expect, test } from "bun:test";
import { setupGlobals } from "bun-webgpu";
import {
  abs, add, atan2, clamp, compileJs, cos, cross, CURVE_N, distance, div, dot, emitWgsl, exp, f, floor, fract, input,
  iterate, leaves, length, log, lt, max, min, mix, mod, mul, neg, normalize, param, pow, Row, row, saturate, select,
  sign, sin, smoothstep, sqrt, step, sub, substitute, tan, variable, vec2, vec3, vec4, type Bind, type Env, type Expr,
  type NumTy,
} from "../src/expr.ts";
import { derivative, derivativeAlong } from "../src/grad.ts";
import { fbm2, hash2, noise2, noise3 } from "../src/lib/noise.ts";
import { sdBox, sdCircle } from "../src/lib/sdf2.ts";
import { hsv, polar, rotate2, smin } from "../src/lib/util.ts";
import { compare, toF32, type Sample } from "./lib.harness.ts";

const u = variable("u", "f32"), p = variable("p", "vec2"), q = variable("q", "vec3");
const g = param("grad.test.g", 1.7), tin = input("grad.test.t", "f32", [0.4]);
// A smooth curve sampled into a row: its interpolant is piecewise linear, with kinks at x = i / (CURVE_N - 1).
const ramp = new Row(Float32Array.from({ length: CURVE_N * 4 }, (_, i) => Math.sin(i * 0.37) * 2 + (i % 4)), "grad ramp");

type Case = { readonly name: string; readonly e: Expr<NumTy>; readonly wrt: Expr<NumTy>; readonly dir: number | number[] };
const along = (name: string, e: Expr<NumTy>, wrt: Expr<NumTy>, dir: number | number[] = 1): Case => ({ name, e, wrt, dir });

const v4 = vec4(p, mul(u, u), q.z);
const [foldZ, foldS] = iterate(4, [p, f(1)], ([z, s]) => [sub(mul(abs(z), 1.5), vec2(0.4, 0.3)), mul(s, 1.5)]);
const [series] = iterate(3, [f(0.2)], ([x]) => [add(mul(x, sin(u)), u)]);
const arith = div(sub(mul(u, g), neg(mul(u, u))), add(u, 2));
const modded = add(fract(mul(u, 7)), mod(mul(u, 5), g));
const powVar = pow(add(u, 0.5), g);

const cases: Case[] = [
  along("arithmetic", arith, u),
  along("arithmetic wrt a param", arith, g),
  along("min/max", max(min(sin(mul(u, 5)), cos(mul(u, 3))), mul(u, 0.3)), u),
  along("vector min/max", max(min(mul(p, u), [0.3, 0.2]), sub(p, 1)), u),
  along("clamp, saturate", add(clamp(vec3(sub(mul(u, 3), 1), u, neg(u)), -0.5, vec3(0.8, 0.9, 1)), saturate(sub(mul(u, 2), 0.3))), u),
  along("clamp with moving bounds", clamp(f(0.5), mul(u, 0.8), add(u, 0.3)), u),
  along("select", select(lt(u, 0.5), mul(u, u), sqrt(u)), u),
  along("step, floor, sign", mul(add(add(step(0.4, u), floor(mul(u, 3))), sign(sub(u, 0.6))), sin(u)), u),
  along("fract, mod", modded, u),
  along("mod wrt its divisor", modded, g),
  along("abs", abs(sin(mul(u, 9))), u),
  along("pow, constant exponents", add(add(pow(add(u, 0.5), 2.5), pow(add(u, 0.2), 2)), pow(vec2(u, 1.5), 3).x), u),
  along("pow, varying exponent", powVar, u),
  along("pow wrt its exponent", powVar, g),
  along("tan, exp, log, sqrt", add(add(mul(tan(u), exp(neg(u))), log(add(u, 1))), sqrt(add(u, 0.1))), u),
  along("atan2", atan2(sin(mul(u, 3)), add(cos(mul(u, 2)), 0.5)), u),
  along("mix, scalar t", mix(vec3(u, 1, 2), vec3(2, mul(u, u), 0.5), u), u),
  along("mix, vector t", mix(vec2(1, 2), mul(p, u), vec2(u, mul(u, u))), u),
  along("smoothstep", add(smoothstep(0.2, 0.8, u), smoothstep(mul(u, 0.2), add(u, 0.5), 0.4)), u),
  along("smoothstep, vector", smoothstep(0.1, 0.9, vec2(u, mul(u, u))), u),
  along("dot, cross, normalize, length, distance", add(mul(dot(normalize(cross(q, vec3(u, 1, 0.3))), q), length(q)), distance(p, vec2(u, 0.2))), q, [0.3, -0.5, 0.8]),
  along("the same, wrt u", add(mul(dot(normalize(cross(q, vec3(u, 1, 0.3))), q), length(q)), distance(p, vec2(u, 0.2))), u),
  along("swizzles and constructors", add(add(v4.xz, mul(q.xy, v4.y)), vec2(v4.w, mul(v4.xyz.z, vec3(u).y))), u),
  along("row", mul(row(ramp, u).xyz, 1.3), u),
  along("row of a function", row(ramp, mul(u, u)).w, u),
  along("row, partly clamped", row(ramp, sub(mul(u, 3), 1)), u),
  along("noise2", noise2(add(mul(p, 3), u)), p, [0.6, -0.8]),
  along("fbm2", fbm2(p, { octaves: 3, lacunarity: 2, gain: 0.5 }), p, [0.6, -0.8]),
  along("noise3", noise3(mul(q, 2)), q, [0.3, -0.5, 0.8]),
  along("hash (piecewise constant)", mul(hash2(mul(p, 4)), sin(u)), u),
  along("sdf2 and smin", smin(sdCircle(p, 0.7), sdBox(sub(p, [0.3, 0.1]), [0.4, 0.2]), 0.3), p, [0.6, -0.8]),
  along("hsv", hsv(u, 0.6, 0.9), u),
  along("polar, rotate2", add(polar(p), rotate2(p, u)), p, [0.6, -0.8]),
  along("rotate2 wrt its angle", rotate2(p, u), u),
  along("an input", sin(mul(tin, add(u, 1))), tin),
  along("iterate: a fold loop", div(length(foldZ), foldS), p, [0.6, -0.8]),
  along("iterate: a body reading u", series, u),
  // Twice: the derivative of a noise gradient is its Hessian times the direction (see defineHessian in grad.ts).
  along("second derivative of noise2", derivativeAlong(noise2(mul(p, 3)), p, [0.6, -0.8]), p, [0.28, 0.96]),
  along("second derivative of noise3", derivativeAlong(noise3(mul(q, 2)), q, [0.3, -0.5, 0.8]), q, [0.8, 0.6, 0]),
  along("second derivative of a row (zero: piecewise linear)", derivative(row(ramp, mul(u, u)).w, u), u),
];

// Sample points chosen off every jump and kink of the cases above (fract(7u), mod(5u, g), floor(3u), step at 0.4,
// sign at 0.6, select at 0.5, the zeros of sin(9u), the row's knots, the noise lattice, the box's edges): at a jump
// the finite difference measures the jump, not a derivative. The instrument check below (two step sizes agree)
// fails loudly if a point lands within a step of one.
const samples: { u: number; p: number[]; q: number[]; g: number; t: number }[] = [
  { u: 0.123, p: [0.3125, -0.4375], q: [0.25, 0.6, -0.35], g: 1.3, t: 0.4 },
  { u: 0.371, p: [-0.6, 0.27], q: [-0.45, 0.15, 0.7], g: 1.7, t: 1.1 },
  { u: 0.618, p: [0.81, 0.55], q: [0.33, -0.72, 0.21], g: 2.1, t: -0.7 },
  { u: 0.8765, p: [-0.2, -0.9], q: [0.9, 0.4, 0.5], g: 0.9, t: 2.3 },
].map((s) => ({ ...s, ...toF32({ u: s.u, p: s.p, q: s.q, g: s.g, t: s.t }) }) as { u: number; p: number[]; q: number[]; g: number; t: number });

const envOf = (s: (typeof samples)[number]): Env => ({ vars: { u: s.u, p: s.p, q: s.q }, params: { "grad.test.g": s.g }, inputs: { "grad.test.t": s.t } });
const arr = (v: unknown): number[] => (typeof v === "number" ? [v] : (v as number[]));

/** The environment with leaf `wrt` moved by h * dir. */
function shifted(env: Env, wrt: Expr, dir: number[], h: number): Env {
  const n = wrt.node;
  const move = (v: number | number[]): number | number[] => (typeof v === "number" ? v + h * dir[0] : v.map((x, i) => x + h * dir[i]));
  switch (n.op) {
    case "var": return { ...env, vars: { ...env.vars, [n.name]: move(env.vars[n.name] as number | number[]) } };
    case "param": return { ...env, params: { ...env.params, [n.spec.name]: move(env.params[n.spec.name]) as number } };
    case "input": return { ...env, inputs: { ...env.inputs, [n.spec.name]: move(env.inputs[n.spec.name]) } };
    default: throw new Error(`not a leaf: ${n.op}`);
  }
}

const derivs = cases.map((c) => derivativeAlong(c.e, c.wrt, c.dir as never));

test("derivative agrees with a centred finite difference (CPU, double precision)", () => {
  const H = 1e-5;
  const worst: Record<string, number> = {};
  for (const [ci, c] of cases.entries()) {
    const fn = compileJs([c.e]), dfn = compileJs([derivs[ci]]);
    const dir = arr(c.dir);
    worst[c.name] = 0;
    for (const s of samples) {
      const env = envOf(s);
      const fd = (h: number): number[] => {
        const hi = arr(fn(shifted(env, c.wrt, dir, h))[0]), lo = arr(fn(shifted(env, c.wrt, dir, -h))[0]);
        return hi.map((x, i) => (x - lo[i]) / (2 * h));
      };
      const a = fd(H), b = fd(2 * H), sym = arr(dfn(env)[0]);
      expect(sym.length).toBe(a.length);
      a.forEach((want, i) => {
        // The instrument: two step sizes agree only if no jump lies within 2H of the point (truncation error is ~H^2).
        expect(Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(want))).toBeLessThan(1e-6);
        const err = Math.abs(sym[i] - want) / Math.max(1, Math.abs(want));
        if (err > 1e-5) console.log(`${c.name} at ${JSON.stringify(s)} component ${i}: symbolic ${sym[i]} finite difference ${want}`);
        worst[c.name] = Math.max(worst[c.name], err);
      });
    }
  }
  console.log("grad.fd worst relative error vs finite difference:", worst);
  expect(Math.max(...Object.values(worst))).toBeLessThan(1e-5);
});

/** The GPU harness binds free variables only: turn the param and the input into variables. */
const gv = variable("g", "f32"), tv = variable("t", "f32");
const asVars = (es: readonly Expr[]): Expr[] => substitute(substitute(es, g, gv), tin, tv);
const gpuSamples: Sample[] = samples.map((s) => ({ u: s.u, p: s.p, q: s.q, g: s.g, t: s.t }));
const usesRows = (e: Expr): boolean => leaves([e]).rows.length > 0;

test("derivative expressions agree between CPU and GPU", async () => {
  const plain = derivs.map((d, i) => ({ d, i })).filter(({ d }) => !usesRows(d));
  const exprs = asVars(plain.map(({ d }) => d));
  const c = await compare(exprs, gpuSamples, "grad");
  console.log("grad.gpu worst relative error per case:", Object.fromEntries(plain.map(({ i }, k) => [cases[i].name, c.worstBy[k]])));
  expect(c.worst).toBeLessThan(1e-4);
});

// The shared harness does not bind curve rows, so the row cases run in a pipeline of their own with the ramp in a
// storage buffer, looked up exactly as the compiler's curve table is (clamp, scale, mix of neighbours).
test("row derivatives agree between CPU and GPU", async () => {
  const rowCases = derivs.filter(usesRows);
  expect(rowCases.length).toBeGreaterThan(0);
  await setupGlobals();
  const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
  const bind: Bind = {
    variable: (name) => name,
    input: (spec) => { throw new Error(`input ${spec.name} not bound`); },
    param: (spec) => { throw new Error(`param ${spec.name} not bound`); },
    row: (_r, x) => `curve(${x})`,
    table: (t) => { throw new Error(`table ${t.name} not bound`); },
  };
  const wide = rowCases.map((e) => vec4(e.ty === "vec4" ? e : e.ty === "vec3" ? vec4(e as Expr<"vec3">, 0) : vec4(e as Expr<"f32">, 0, 0, 0)));
  const { lines, out } = emitWgsl(wide, bind);
  const us = samples.map((s) => s.u);
  const code = `
    @group(0) @binding(0) var<storage, read> rows: array<vec4<f32>>;
    @group(0) @binding(1) var<storage, read_write> result: array<vec4<f32>>;
    fn curve(x: f32) -> vec4<f32> {
      let s = clamp(x, 0.0, 1.0) * f32(${CURVE_N - 1});
      let i = min(u32(floor(s)), ${CURVE_N - 2}u);
      return mix(rows[i], rows[i + 1u], s - f32(i));
    }
    @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let u = array<f32, ${us.length}>(${us.join(", ")})[gid.x];
      ${lines.join("\n      ")}
      ${out.map((o, i) => `result[gid.x * ${wide.length}u + ${i}u] = ${o};`).join("\n      ")}
    }`;
  device.pushErrorScope("validation");
  const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } });
  expect((await device.popErrorScope())?.message ?? null).toBeNull();
  const rows = device.createBuffer({ size: ramp.samples.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  // A copy is ArrayBuffer-backed: tsgo's parallel checker resolves GPUAllowSharedBufferSource from @webgpu/types or
  // the DOM lib nondeterministically, and the former rejects Float32Array<ArrayBufferLike> (an intermittent TS2345).
  device.queue.writeBuffer(rows, 0, new Float32Array(ramp.samples));
  const bytes = us.length * wide.length * 16;
  const result = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [rows, result].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(us.length); pass.end();
  encoder.copyBufferToBuffer(result, 0, read, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const gpu = new Float32Array(read.getMappedRange().slice(0));
  const run = compileJs(wide);
  let worst = 0;
  us.forEach((uv, k) => run({ vars: { u: uv }, inputs: {}, params: {} }).forEach((v, i) => arr(v).forEach((want, c) => {
    worst = Math.max(worst, Math.abs(gpu[(k * wide.length + i) * 4 + c] - want) / Math.max(1, Math.abs(want)));
  })));
  console.log("grad.gpu worst relative error, row cases:", worst);
  expect(worst).toBeLessThan(1e-4);
});

// The two backends must agree: the same expression evaluated in JavaScript and on the GPU gives the same numbers.
// If they drift, a creature posed on the CPU and drawn on the GPU would disagree with itself.
import { expect, test } from "bun:test";
import { setupGlobals } from "bun-webgpu";
import {
  abs, add, atan2, clamp, compileJs, cos, cross, CURVE_N, emitWgsl, f, fetch, floor, iterate, length, lt, mix, mod, mul, normalize,
  param, pow, round, row, Row, select, sin, smoothstep, step, sub, time, variable, vec2, vec3, type Bind, type Expr, type TableSource,
} from "../src/expr.ts";

const u = variable("u", "f32");
const ramp = new Row(Float32Array.from({ length: CURVE_N * 4 }, (_, i) => Math.sin(i * 0.37) * 2), "test ramp");
const girth = param("test.girth", 1.3);
const cases: Expr[] = [
  add(mul(sin(mul(u, 7)), girth), cos(time)),
  mix(vec3(1, 2, 3), vec3(u, mul(u, u), 0.5), smoothstep(0.2, 0.8, u)),
  normalize(cross(vec3(u, 1, 0.3), vec3(0.2, u, 1))).mul(length(vec3(u, 2, 3))),
  mod(sub(mul(u, 10), 3.7), 1.3),
  select(lt(u, 0.5), pow(u, 2.2), atan2(u, 0.3)),
  row(ramp, u).xyz.mul(step(0.25, u)),
  clamp(vec3(u, -1, 4), 0, vec3(0.6, 0.6, 2)),
  // One scalar branch and one vector branch: the scalar must be widened in the emitted WGSL.
  mix(u, vec3(1, 2, 3), 0.3),
  select(lt(u, 0.4), u, vec3(1, 2, 3)),
  round(mul(vec3(u, 2.5, -1.5), 3)),
];

test("JS and WGSL backends agree", async () => {
  await setupGlobals();
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  // 0.52, not 0.5: at 0.5 the `mod` case sits exactly on its discontinuity, where f32 and f64 legitimately land on opposite sides.
  const us = [0.03, 0.31, 0.52, 0.77, 0.98], t = 1.7;
  const bind: Bind = {
    variable: (name) => name,
    input: (spec) => (spec.name === "time" ? "cfg.x" : (() => { throw new Error(spec.name); })()),
    param: () => "cfg.y",
    row: (_r, x) => `curve(${x})`,
    table: () => { throw new Error("no tables here"); },
  };
  const { lines, out } = emitWgsl(cases.map((c) => (c.ty === "vec3" ? c : vec3(c as Expr<"f32">, 0, 0))), bind);
  const code = `
    @group(0) @binding(0) var<storage, read> rows: array<vec4<f32>>;
    @group(0) @binding(1) var<storage, read_write> result: array<vec4<f32>>;
    @group(0) @binding(2) var<uniform> cfg: vec4<f32>;
    fn curve(x: f32) -> vec4<f32> {
      let s = clamp(x, 0.0, 1.0) * f32(${CURVE_N - 1});
      let i = min(u32(floor(s)), ${CURVE_N - 2}u);
      return mix(rows[i], rows[i + 1u], s - f32(i));
    }
    @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let u = array<f32, ${us.length}>(${us.join(", ")})[gid.x];
      ${lines.join("\n      ")}
      ${out.map((o, i) => `result[gid.x * ${cases.length}u + ${i}u] = vec4<f32>(${o}, 0.0);`).join("\n      ")}
    }`;
  device.pushErrorScope("validation");
  const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } });
  const error = await device.popErrorScope();
  expect(error?.message ?? null).toBeNull();

  const rows = device.createBuffer({ size: ramp.samples.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  // A copy is ArrayBuffer-backed: tsgo's parallel checker resolves GPUAllowSharedBufferSource from @webgpu/types or
  // the DOM lib nondeterministically, and the former rejects Float32Array<ArrayBufferLike> (an intermittent TS2345).
  device.queue.writeBuffer(rows, 0, new Float32Array(ramp.samples));
  const bytes = us.length * cases.length * 16;
  const result = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const cfg = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(cfg, 0, new Float32Array([t, 1.3, 0, 0]));
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [rows, result, cfg].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(us.length); pass.end();
  encoder.copyBufferToBuffer(result, 0, read, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const gpu = new Float32Array(read.getMappedRange().slice(0));

  const run = compileJs(cases);
  let worst = 0;
  us.forEach((uv, k) => {
    const cpu = run({ vars: { u: uv }, inputs: { time: t }, params: {} });
    cases.forEach((c, i) => {
      const want = typeof cpu[i] === "number" ? [cpu[i] as number, 0, 0] : (cpu[i] as number[]);
      for (let j = 0; j < 3; j++) {
        const got = gpu[(k * cases.length + i) * 4 + j];
        const err = Math.abs(got - want[j]) / Math.max(1, Math.abs(want[j]));
        if (err > 1e-4) console.log(`case ${i} u=${uv} comp ${j}: gpu ${got} cpu ${want[j]}`);
        worst = Math.max(worst, err);
      }
    });
  });
  // f32 on the GPU against f64 on the CPU: 1e-4 relative is the floor for single precision through sin/pow/atan2.
  expect(worst).toBeLessThan(1e-4);
});

/** Run expressions of the free variable `u` (f32) on the GPU, with one per-frame table bound; return vec3 per (u, case). */
async function onGpu(exprs: readonly Expr[], us: readonly number[], table: TableSource, data: Float32Array): Promise<Float32Array> {
  await setupGlobals();
  const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
  const bind: Bind = {
    variable: (name) => name,
    input: () => { throw new Error("no inputs here"); },
    param: () => { throw new Error("no params here"); },
    row: () => { throw new Error("no rows here"); },
    table: (t, i, lane) => `tbl[u32(${i}) * ${t.lanes}u + ${lane}u]`,
  };
  const { lines, out } = emitWgsl(exprs.map((c) => (c.ty === "vec3" ? c : vec3(c as Expr<"f32">, 0, 0))), bind);
  const code = `
    @group(0) @binding(0) var<storage, read> tbl: array<vec4<f32>>;
    @group(0) @binding(1) var<storage, read_write> result: array<vec4<f32>>;
    @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let u = array<f32, ${us.length}>(${us.join(", ")})[gid.x];
      ${lines.join("\n      ")}
      ${out.map((o, i) => `result[gid.x * ${exprs.length}u + ${i}u] = vec4<f32>(${o}, 0.0);`).join("\n      ")}
    }`;
  device.pushErrorScope("validation");
  const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } });
  const error = await device.popErrorScope();
  if (error) throw new Error(`${error.message}\n${code}`);
  const tb = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(tb, 0, data as Float32Array<ArrayBuffer>);
  const bytes = us.length * exprs.length * 16;
  const result = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [tb, result].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(us.length); pass.end();
  encoder.copyBufferToBuffer(result, 0, read, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  return new Float32Array(read.getMappedRange().slice(0));
}

// Catches: `fetch` reading a different entry or lane on the two backends (row-major against lane-major, the index not
// truncated the same way, an offset applied on one side only), and `iterate` diverging: the body run a different number
// of times, state assigned in sequence so a swap overwrites itself, an outer value recomputed inside the loop from the
// wrong scope, a count that is an expression, a nested loop, and a loop whose body reads the table.
test("fetch and iterate agree between JS and WGSL", async () => {
  const lanes = 3, entries = 7;
  const data = Float32Array.from({ length: entries * lanes * 4 }, (_, i) => Math.cos(i * 0.71) * 3 + i * 0.01);
  const table: TableSource = { name: "probe", lanes, entries, role: "data", prepare: () => () => {} };
  const k = floor(mul(u, entries - 0.01));
  // A kaleidoscopic fold, six times: abs, shift, rotate, scale; the scale accumulates in the second component.
  const [q, scale] = iterate(6, [vec2(u, mul(u, 0.3)), f(1)], ([p, s]) => {
    const f = sub(abs(p), vec2(0.42, 0.18));
    const c = cos(0.62), sn = sin(0.62);
    return [vec2(sub(mul(f.x, c), mul(f.y, sn)), add(mul(f.x, sn), mul(f.y, c))).mul(1.55), mul(s, 1.55)];
  });
  // The state swaps every step: after an odd count the components are exchanged.
  const [a, b] = iterate(5, [u, add(u, 10)], ([x, y]) => [y, x]);
  // A count that depends on u, a body that reads the table at the iteration index, and a loop nested in another.
  const [acc] = iterate(add(floor(mul(u, 5)), 1), [f(0)], ([s], i) => [add(s, fetch(table, i, 1).y)]);
  const [nest] = iterate(3, [f(0)], ([s], i) => {
    const [inner] = iterate(add(i, 2), [s], ([t], j) => [add(mul(t, 0.5), add(j, i))]);
    return [add(inner, u)];
  });
  const cases: Expr[] = [
    fetch(table, k, 0).xyz, fetch(table, add(k, 0.999), 2).xyz.mul(u), mix(fetch(table, 2, 1).xyz, fetch(table, 6, 0).xyz, u),
    vec3(q.x, q.y, scale), vec3(a, b, 0), acc, nest,
  ];
  const us = [0.03, 0.31, 0.52, 0.77, 0.98];
  const gpu = await onGpu(cases, us, table, data);
  const run = compileJs(cases);
  let worst = 0;
  us.forEach((uv, j) => {
    const cpu = run({ vars: { u: uv }, inputs: {}, params: {}, tables: () => data });
    cases.forEach((_, i) => {
      const want = typeof cpu[i] === "number" ? [cpu[i] as number, 0, 0] : (cpu[i] as number[]);
      for (let c = 0; c < 3; c++) {
        const got = gpu[(j * cases.length + i) * 4 + c];
        const err = Math.abs(got - want[c]) / Math.max(1, Math.abs(want[c]));
        if (err > 1e-4) console.log(`case ${i} u=${uv} comp ${c}: gpu ${got} cpu ${want[c]}`);
        worst = Math.max(worst, err);
      }
    });
    // The loops did what they say, not merely the same wrong thing on both sides.
    expect(cpu[4]).toEqual([uv + 10, uv, 0]);
    expect((cpu[3] as number[])[2]).toBeCloseTo(1.55 ** 6, 6);
    const n = Math.floor(uv * 5) + 1;
    expect(cpu[5] as number).toBeCloseTo(Array.from({ length: n }, (_, i) => data[(i * lanes + 1) * 4 + 1]).reduce((x, y) => x + y, 0), 6);
  });
  expect(worst).toBeLessThan(1e-4);
});



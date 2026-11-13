// Shared by the lib.*.test.ts files: run expressions on the GPU (emitted WGSL in a compute shader) and on the CPU
// (compileJs) over the same sample points, and report the worst relative disagreement per expression.
import { setupGlobals } from "bun-webgpu";
import { compileJs, emitWgsl, leaves, type Bind, type Expr, type Ty } from "../src/expr.ts";

export type Sample = Record<string, number | number[]>;
export type Out = number[];

const WIDTH: Record<Ty, number> = { f32: 1, vec2: 2, vec3: 3, vec4: 4, bool: 1 };
const WGSL_TY: Record<Ty, string> = { f32: "f32", vec2: "vec2<f32>", vec3: "vec3<f32>", vec4: "vec4<f32>", bool: "bool" };
const SWIZZLE = ["", ".x", ".xy", ".xyz", ".xyzw"];

let device: Promise<GPUDevice> | undefined;
async function gpuDevice(): Promise<GPUDevice> {
  device ??= (async () => {
    await setupGlobals();
    const adapter = await navigator.gpu.requestAdapter();
    return adapter!.requestDevice();
  })();
  return device;
}

const asArray = (v: number | number[]): number[] => (typeof v === "number" ? [v] : v);

/** Samples rounded to f32, so the CPU and the GPU evaluate exactly the same inputs. */
export const toF32 = (s: Sample): Sample => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === "number" ? Math.fround(v) : v.map(Math.fround)]));

/** Run `exprs` on the GPU for each sample. Result is [sample][expr] -> components. */
export async function runGpu(exprs: readonly Expr[], samples: readonly Sample[]): Promise<Out[][]> {
  const dev = await gpuDevice();
  const vars = [...leaves(exprs).vars.entries()];
  if (vars.length === 0) throw new Error("runGpu needs at least one free variable");
  const bind: Bind = {
    variable: (name) => name,
    input: (spec) => { throw new Error(`input ${spec.name} not bound in the test harness`); },
    param: (spec) => { throw new Error(`param ${spec.name} not bound in the test harness`); },
    row: () => { throw new Error("rows not bound in the test harness"); },
    table: (t) => { throw new Error(`table ${t.name} not bound in the test harness`); },
  };
  const { lines, out, libs } = emitWgsl(exprs, bind);
  const pack = (o: string, ty: Ty): string => {
    const n = WIDTH[ty];
    return n === 1 ? `vec4<f32>(${o}, 0.0, 0.0, 0.0)` : n === 2 ? `vec4<f32>(${o}, 0.0, 0.0)` : n === 3 ? `vec4<f32>(${o}, 0.0)` : o;
  };
  const code = `
    @group(0) @binding(0) var<storage, read> samples: array<vec4<f32>>;
    @group(0) @binding(1) var<storage, read_write> result: array<vec4<f32>>;
    ${libs.map((l) => l.wgsl).join("\n")}
    @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      ${vars.map(([name, ty], k) => `let ${name}: ${WGSL_TY[ty]} = samples[gid.x * ${vars.length}u + ${k}u]${SWIZZLE[WIDTH[ty]]};`).join("\n      ")}
      ${lines.join("\n      ")}
      ${out.map((o, i) => `result[gid.x * ${exprs.length}u + ${i}u] = ${pack(o, exprs[i].ty)};`).join("\n      ")}
    }`;
  dev.pushErrorScope("validation");
  const pipeline = await dev.createComputePipelineAsync({ layout: "auto", compute: { module: dev.createShaderModule({ code }), entryPoint: "main" } });
  const error = await dev.popErrorScope();
  if (error) throw new Error(`WGSL validation failed: ${error.message}\n${code}`);

  const input = new Float32Array(samples.length * vars.length * 4);
  samples.forEach((s, si) => vars.forEach(([name], k) => input.set(asArray(s[name]), (si * vars.length + k) * 4)));
  const bytes = samples.length * exprs.length * 16;
  const inBuf = dev.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  dev.queue.writeBuffer(inBuf, 0, input);
  const result = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const group = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [inBuf, result].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const encoder = dev.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(samples.length); pass.end();
  encoder.copyBufferToBuffer(result, 0, read, 0, bytes);
  dev.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const flat = new Float32Array(read.getMappedRange().slice(0));
  return samples.map((_, si) => exprs.map((e, i) => Array.from(flat.subarray((si * exprs.length + i) * 4, (si * exprs.length + i) * 4 + WIDTH[e.ty]))));
}

export type Comparison = { readonly worst: number; readonly worstBy: number[]; readonly cpu: Out[][]; readonly gpu: Out[][] };

/** CPU against GPU. Error is |gpu - cpu| / max(1, |cpu|), the floor f32 allows through trig and pow. */
export async function compare(exprs: readonly Expr[], raw: readonly Sample[], label = ""): Promise<Comparison> {
  const samples = raw.map(toF32);
  const gpu = await runGpu(exprs, samples);
  const run = compileJs(exprs);
  const cpu = samples.map((s) => run({ vars: s, inputs: {}, params: {} }).map((v) => asArray(v as number | number[])));
  const worstBy = exprs.map(() => 0);
  samples.forEach((s, si) => exprs.forEach((_, i) => {
    cpu[si][i].forEach((want, c) => {
      const err = Math.abs(gpu[si][i][c] - want) / Math.max(1, Math.abs(want));
      if (err > 1e-4) console.log(`${label} expr ${i} sample ${JSON.stringify(s)} component ${c}: gpu ${gpu[si][i][c]} cpu ${want}`);
      worstBy[i] = Math.max(worstBy[i], err);
    });
  }));
  return { worst: Math.max(...worstBy), worstBy, cpu, gpu };
}

/** Deterministic pseudo-random numbers in [0, 1) (a 32-bit LCG), so failures reproduce. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * A coordinate in [-range, range] rounded to a multiple of 1/1024. Such values, and their products with small powers of
 * two plus dyadic offsets, are exact in f32, so a CPU/GPU difference cannot come from the input or from fbm's
 * frequency doubling rounding differently; it can only come from the function under test.
 */
export const coord = (r: () => number, range: number): number => Math.round((r() * 2 - 1) * range * 1024) / 1024;

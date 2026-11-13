// Shared by the compile.* tests: a device, frame states, and a compute probe that runs WGSL against an artefact's own
// bindings (the host contract's explicit layouts), so a test can call any function in `sceneWgsl` or in a shader.
import { setupGlobals } from "bun-webgpu";
import { DETAIL_SLOTS, PRELUDE_WGSL, type Artefact, type FrameState } from "../src/artefact.ts";

let device: Promise<GPUDevice> | undefined;
export async function gpu(): Promise<GPUDevice> {
  device ??= (async () => {
    await setupGlobals();
    return (await (await navigator.gpu.requestAdapter())!.requestDevice());
  })();
  return device;
}

export const VERTEX = 0x1, FRAGMENT = 0x2, COMPUTE = 0x4;

/** Groups 0 and 1 as the host builds them (artefact.ts header): every binding visible everywhere. */
export function layouts(dev: GPUDevice, a: Artefact, visibility: number): [GPUBindGroupLayout, GPUBindGroupLayout] {
  const storage = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility, buffer: { type: "read-only-storage" } });
  return [
    dev.createBindGroupLayout({ entries: [{ binding: 0, visibility, buffer: { type: "uniform" } }, storage(1), storage(2), storage(3), { binding: 4, visibility, buffer: { type: "uniform" } }] }),
    dev.createBindGroupLayout({ entries: [...a.dynamic, ...(a.statics ?? [])].map((d) => storage(d.binding)) }),
  ];
}

/** A frame state at time t with every input and param at its default (overrides by name). */
export function stateAt(a: Artefact, t: number, set: { inputs?: Record<string, number>; params?: Record<string, number>; curves?: Float32Array } = {}): FrameState {
  const inputs = new Float32Array(Math.max(1, a.inputFloats));
  for (const s of a.inputs) inputs.set(s.name === "time" ? [t] : [set.inputs?.[s.name] ?? s.def[0], ...s.def.slice(1)], s.slot);
  return { time: t, inputs, params: Float32Array.from(a.params.map((p) => set.params?.[p.name] ?? p.def)), curves: set.curves ?? a.curves };
}

/**
 * Run `fn probe(i: u32, x: vec4<f32>) -> vec4<f32>` (defined in `code`, after sceneWgsl and `module`) once per input
 * vec4, with the artefact's tables posed at `state`. Returns one vec4 per input.
 */
export async function probe(a: Artefact, state: FrameState, module: string, code: string, xs: readonly (readonly number[])[]): Promise<number[][]> {
  const dev = await gpu();
  const src = PRELUDE_WGSL + a.sceneWgsl + module + code + /* wgsl */ `
@group(2) @binding(0) var<storage, read_write> probe_out: array<vec4<f32>>;
@group(2) @binding(1) var<storage, read> probe_in: array<vec4<f32>>;
@compute @workgroup_size(1) fn probe_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  probe_out[gid.x] = probe(gid.x, probe_in[gid.x]);
}`;
  const [g0, g1] = layouts(dev, a, COMPUTE);
  const g2 = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: COMPUTE, buffer: { type: "storage" } }, { binding: 1, visibility: COMPUTE, buffer: { type: "read-only-storage" } }] });
  dev.pushErrorScope("validation");
  const pipeline = await dev.createComputePipelineAsync({
    layout: dev.createPipelineLayout({ bindGroupLayouts: [g0, g1, g2] }),
    compute: { module: dev.createShaderModule({ code: src }), entryPoint: "probe_main" },
  });
  const err = await dev.popErrorScope();
  if (err) throw new Error(`probe WGSL: ${err.message}`);
  const buffer = (data: Float32Array) => {
    const b = dev.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    if (data.byteLength) dev.queue.writeBuffer(b, 0, data as Float32Array<ArrayBuffer>);
    return b;
  };
  const tables = a.pose(state);
  const bytes = xs.length * 16;
  const out = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const frame = dev.createBuffer({ size: 48 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const group = (layout: GPUBindGroupLayout, bs: GPUBuffer[]) => dev.createBindGroup({ layout, entries: bs.map((b, binding) => ({ binding, resource: { buffer: b } })) });
  const encoder = dev.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  const detail = dev.createBuffer({ size: DETAIL_SLOTS * 16, usage: GPUBufferUsage.UNIFORM });
  pass.setBindGroup(0, group(g0, [frame, buffer(state.inputs), buffer(state.params), buffer(state.curves), detail]));
  // Statics follow the dynamic buffers in binding order (compile/tables.ts), so the array index is the binding.
  pass.setBindGroup(1, group(g1, [...a.dynamic.map((d) => buffer(tables[d.name])), ...(a.statics ?? []).map((d) => buffer(d.data))]));
  pass.setBindGroup(2, group(g2, [out, buffer(Float32Array.from(xs.flatMap((x) => [...x, 0, 0, 0, 0].slice(0, 4))))]));
  pass.dispatchWorkgroups(xs.length);
  pass.end();
  encoder.copyBufferToBuffer(out, 0, read, 0, bytes);
  dev.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const flat = new Float32Array(read.getMappedRange().slice(0));
  read.unmap();
  return xs.map((_, i) => Array.from(flat.subarray(i * 4, i * 4 + 4)));
}

/** |a - b| / max(1, |b|), worst over components. */
export function relErr(a: readonly number[], b: readonly number[]): number {
  return Math.max(...b.map((w, i) => Math.abs(a[i] - w) / Math.max(1, Math.abs(w))));
}

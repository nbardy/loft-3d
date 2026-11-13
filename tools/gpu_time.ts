// GPU time of chosen draws of an artefact, measured with timestamp queries around a render pass that holds only them
// (the host's targets: 4x MSAA colour and depth, cleared). Wall-clock frame times on this shared machine move by
// milliseconds with the load; the GPU's own clock around the pass does not see the CPU at all, so the best of a few
// dozen passes is what the draws cost. Used by tools/tracer_bench.ts.
import { DETAIL_SLOTS, PRELUDE_WGSL, type Artefact, type Camera } from "../src/artefact.ts";
import { cameraMatrices } from "../src/host/camera.ts";
import { COLOR_FORMAT, DEPTH_FORMAT, SAMPLES, viewState } from "../src/host/index.ts";

const VIS = 0x1 | 0x2;

export type GpuTimer = { time(camera: Camera, frames: number): Promise<number>; destroy(): void };

/**
 * Best-of times for several timers, interleaved round-robin one pass at a time, so that each sees the same quiet
 * moments of the shared GPU (a pass's elapsed GPU time includes time the GPU spent on other processes).
 */
export async function interleaved(timers: readonly GpuTimer[], camera: Camera, rounds: number): Promise<number[]> {
  const best = timers.map(() => Infinity);
  for (let r = 0; r < rounds; r++) for (const [k, t] of timers.entries()) best[k] = Math.min(best[k]!, await t.time(camera, 1));
  return best;
}

/** A timer for the draws of `a` whose labels satisfy `keep`, at width x height. Needs the "timestamp-query" feature. */
export async function gpuTimer(device: GPUDevice, a: Artefact, keep: (label: string) => boolean, width: number, height: number): Promise<GpuTimer> {
  const storage = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: VIS, buffer: { type: "read-only-storage" } });
  // Binding 4 is the level-of-detail table (artefact.ts). The traced draws timed here are of fixed detail, so it stays zero.
  const g0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VIS, buffer: { type: "uniform" } }, storage(1), storage(2), storage(3), { binding: 4, visibility: VIS, buffer: { type: "uniform" } }] });
  const group1 = [...a.dynamic.map((d) => ({ binding: d.binding, bytes: d.vec4s * 16 })), ...(a.statics ?? []).map((d) => ({ binding: d.binding, bytes: d.data.byteLength }))];
  const g1 = device.createBindGroupLayout({ entries: group1.map((d) => storage(d.binding)) });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [g0, g1] });
  const buf = (bytes: number, usage: number) => device.createBuffer({ size: Math.max(16, bytes), usage });
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const frame = buf(48 * 4, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const inputs = buf(a.inputFloats * 4, S), params = buf(a.params.length * 4, S), curves = buf(a.curves.byteLength, S);
  if (a.curves.length > 0) device.queue.writeBuffer(curves, 0, a.curves as Float32Array<ArrayBuffer>);
  const tables = group1.map((d) => buf(d.bytes, S));
  (a.statics ?? []).forEach((d, k) => device.queue.writeBuffer(tables[a.dynamic.length + k]!, 0, d.data as Float32Array<ArrayBuffer>));
  const detail = buf(DETAIL_SLOTS * 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const bind0 = device.createBindGroup({ layout: g0, entries: [frame, inputs, params, curves, detail].map((b, binding) => ({ binding, resource: { buffer: b } })) });
  const bind1 = device.createBindGroup({ layout: g1, entries: group1.map((d, k) => ({ binding: d.binding, resource: { buffer: tables[k]! } })) });
  const draws = a.draws.filter((d) => keep(d.label));
  if (draws.length === 0) throw new Error("gpuTimer: no draw kept");
  const levelled = draws.find((d) => d.detail.kind !== "fixed");
  if (levelled) throw new Error(`gpuTimer: draw "${levelled.label}" has ${levelled.detail.kind} detail; this timer draws fixed-detail draws only (use \`loft profile\`)`);
  const pipelines: GPURenderPipeline[] = [];
  for (const d of draws) {
    const module = device.createShaderModule({ code: PRELUDE_WGSL + a.sceneWgsl + a.shaders[d.shader] });
    pipelines.push(await device.createRenderPipelineAsync({
      layout,
      vertex: { module, entryPoint: "vs", constants: d.constants },
      fragment: { module, entryPoint: "fs", constants: d.constants, targets: [{ format: COLOR_FORMAT }] },
      primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: d.cull },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: d.depthWrite, depthCompare: "less" },
      multisample: { count: SAMPLES },
    }));
  }
  const size = { width, height };
  const colour = device.createTexture({ size, format: COLOR_FORMAT, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const depth = device.createTexture({ size, format: DEPTH_FORMAT, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const query = device.createQuerySet({ type: "timestamp", count: 2 });
  const resolved = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  const time = async (camera: Camera, frames: number): Promise<number> => {
    const view = { camera, width, height, time: 0 };
    const state = viewState(a, view);
    const m = cameraMatrices(camera, width / height);
    const u = new Float32Array(48);
    u.set(m.viewProj, 0); u.set(m.invViewProj, 16); u.set([...m.eye, m.perspective], 32); u.set([...m.forward, 0], 36);
    u.set([width, height, 1 / width, 1 / height], 40);
    device.queue.writeBuffer(frame, 0, u);
    if (state.inputs.length > 0) device.queue.writeBuffer(inputs, 0, state.inputs as Float32Array<ArrayBuffer>);
    if (state.params.length > 0) device.queue.writeBuffer(params, 0, state.params as Float32Array<ArrayBuffer>);
    const posed = a.pose(state);
    a.dynamic.forEach((d, k) => device.queue.writeBuffer(tables[k]!, 0, posed[d.name]! as Float32Array<ArrayBuffer>));
    let best = Infinity;
    for (let i = 0; i < frames; i++) {
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: colour.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
        timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
      });
      pass.setBindGroup(0, bind0);
      pass.setBindGroup(1, bind1);
      draws.forEach((d, k) => { pass.setPipeline(pipelines[k]!); pass.draw(d.vertices, d.instances); });
      pass.end();
      enc.resolveQuerySet(query, 0, 2, resolved, 0);
      enc.copyBufferToBuffer(resolved, 0, read, 0, 16);
      device.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const ts = new BigUint64Array(read.getMappedRange().slice(0));
      read.unmap();
      best = Math.min(best, Number(ts[1]! - ts[0]!) / 1e6);
    }
    return best;
  };
  const destroy = () => { for (const b of [frame, inputs, params, curves, detail, ...tables, resolved, read]) b.destroy(); colour.destroy(); depth.destroy(); query.destroy(); };
  return { time, destroy };
}

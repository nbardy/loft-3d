// The WebGPU host: an executor of a lowered artefact (src/host/manifest.ts, docs/artefact_format.md). It creates the
// objects the manifest lists and, per frame, runs its recipe: the frame writes, the `cpu` tables (in memory only), the
// pose pass, the level-of-detail bounds read and plan, the render passes. It decides nothing about the scene: the
// decisions were made by `lower` (src/host/lower.ts), from a compile or, earlier, by `loft build`.
//
// Two ways in, one executor: `createHost(device).load(artefact)` lowers a compiled artefact in memory;
// `loadBundle(device, bundle, { kind: "none" })` runs one read from files (src/host/files.ts), without the compiler.
//
// Frames: `frame` waits for this frame's bounds and renders into its own texture and reads it back; `draw` renders into
// the caller's texture (a canvas's current texture) with the last bounds read, never waiting on the GPU.
//
// Queue order: every `writeBuffer` of a frame is issued before the submit of the pose pass that reads it, and the
// level-of-detail slots are written before the submit of the draws (writes are ordered with submits, not with passes
// inside one encoder: a write between two passes of one encoder would land before both).
//
// This file imports no bun-only module, so a browser bundle of src/host (minus headless.ts and files.ts) stays clean.

import { EnvironmentError } from "../errors.ts";
import type { Artefact, CpuUpload, FrameState, FrameStats, Host, Loaded, View } from "../artefact.ts";
import { cameraMatrices } from "./camera.ts";
import { planFrame, type Bounds, type Memory, type Plan } from "./detail.ts";
import { FRAME_FLOATS, lower } from "./lower.ts";
import { COLOR_FORMAT, type Bundle, type Dispatch, type FrameWrite, type Manifest, type RenderPassDesc, type Target } from "./manifest.ts";
import { profileFrames, type Profile } from "./profile.ts";
export type { Profile, ProfileDraw, ProfileStage } from "./profile.ts";
export { COLOR_FORMAT, DEPTH_FORMAT, SAMPLES, SCENE_DEPTH_FORMAT } from "./manifest.ts";

export type FrameTimings = {
  /** CPU: frame state, the `cpu` tables, uploads, the pose pass's submit and the level-of-detail plan. */
  readonly pose: number;
  /** CPU: buffer uploads, command encoding and submit. */
  readonly encode: number;
  /** GPU execution plus the wait for the mapped readback and repacking rows. */
  readonly readback: number;
};

export interface GpuLoaded extends Loaded {
  /** `frame`, with milliseconds per stage and what was drawn. */
  frameTimed(view: View): Promise<{ readonly pixels: Uint8Array; readonly ms: FrameTimings; readonly drawn: FrameStats }>;
  /**
   * Browser path: draw the same frame into `target` (for example `context.getCurrentTexture()`), which must be
   * `COLOR_FORMAT` and exactly `view.width` x `view.height`. Resolves once validation of the submit is known.
   */
  draw(view: View, target: GPUTexture): Promise<FrameStats>;
  /**
   * GPU time per draw and per fixed stage, the minimum over `frames` frames of the same view (src/host/profile.ts).
   * Needs a device created with the "timestamp-query" feature; throws without it.
   */
  profile(view: View, frames: number): Promise<Profile>;
  /**
   * GPU milliseconds of the pose stages alone for this view: `repeats` runs of every stage in one timed compute pass,
   * divided by `repeats` (so the timestamp quantum and the pass's own cost divide out), the least of `rounds` rounds.
   */
  poseTime(view: View, repeats: number, rounds: number): Promise<{ readonly total: number; readonly stages: readonly number[] }>;
  /**
   * GPU milliseconds of a normal frame (the one `frame` runs, unmodified), least of `frames`: its two submits, the pose
   * pass (timestamps at its start and end) and the render passes (at the start of the first, the end of the last), the
   * two spans summed. The gap between the
   * submits (the CPU waiting for the level-of-detail bounds and planning) is not GPU time and is not counted. `tick`:
   * the greatest common divisor of the timestamp differences seen: the timer's resolution as observed.
   */
  frameGpu(view: View, frames: number): Promise<{ readonly ms: number; readonly pose: number; readonly draws: number; readonly tick: number }>;
  /** Every dynamic buffer as the pose stages (and `cpu` uploads) left it for this view, by name: for checks against `pose`. */
  readTables(view: View): Promise<Readonly<Record<string, Float32Array>>>;
}
/** Timestamp indices a timed frame writes at the start and end of a submit's passes (frame timing). */
type Stamps = { readonly querySet: GPUQuerySet; readonly begin: number; readonly end: number };

export interface GpuHost extends Host {
  load(artefact: Artefact): Promise<GpuLoaded>;
}

/**
 * The `cpu` tables' fills, which are JavaScript and so never in a file: `none` (from files; the bundle must then have
 * no `cpu` table), or the compiled artefact's `cpuPose` (in memory).
 */
export type CpuTables = { readonly kind: "none" } | { readonly kind: "js"; readonly uploads: (state: FrameState) => readonly CpuUpload[] };

/** A bundle names a `cpu` table but nothing can fill it: a file artefact cannot hold JavaScript. */
export class NotDataError extends Error {
  override readonly name = "NotDataError";
}

export function createHost(device: GPUDevice): GpuHost {
  // async: an artefact that fails lower's checks rejects the returned promise, as every load error does, never throws.
  return { load: async (artefact) => loadBundle(device, lower(artefact), { kind: "js", uploads: (state) => artefact.cpuPose(state) }) };
}

// ---- per-frame state -------------------------------------------------------------------------------------------

const FLOATS = { f32: 1, vec2: 2, vec3: 3, vec4: 4 } as const;
type StateSpec = Pick<Manifest, "inputs" | "inputFloats" | "params" | "paramFloats">;

function asFloats(name: string, value: number | readonly number[], floats: number): readonly number[] {
  const v = typeof value === "number" ? [value] : value;
  if (v.length !== floats) throw new Error(`view input "${name}": expected ${floats} floats, got ${v.length}`);
  return v;
}

/** Defaults, overridden by the view; the view's time fills the `time` input. Unknown names throw: a typo must not silently do nothing. */
function frameState(s: StateSpec, curves: Float32Array, view: View): FrameState {
  const inputs = new Float32Array(s.inputFloats);
  for (const i of s.inputs) inputs.set(i.def, i.slot);
  for (const [name, value] of Object.entries(view.inputs ?? {})) {
    if (name === "time") throw new Error(`view input "time": set View.time instead`);
    const i = s.inputs.find((x) => x.name === name);
    if (!i) throw new Error(`view input "${name}": the artefact declares no such input`);
    inputs.set(asFloats(name, value, FLOATS[i.ty]), i.slot);
  }
  const time = s.inputs.find((x) => x.name === "time");
  if (time) inputs[time.slot] = view.time;
  const params = new Float32Array(s.paramFloats);
  for (const p of s.params) params[p.slot] = p.def;
  for (const [name, value] of Object.entries(view.params ?? {})) {
    const p = s.params.find((x) => x.name === name);
    if (!p) throw new Error(`view param "${name}": the artefact declares no such param`);
    params[p.slot] = value;
  }
  return { time: view.time, inputs, params, curves };
}

/** The `FrameState` a host hands the pose pass for a view: the same mapping `frame` and `draw` use. */
export function viewState(a: Pick<Artefact, "inputs" | "inputFloats" | "params" | "curves">, view: View, curves: Float32Array = a.curves): FrameState {
  return frameState({ ...a, paramFloats: a.params.reduce((n, p) => Math.max(n, p.slot + 1), 0) }, curves, view);
}

export function frameUniform(view: View): Float32Array<ArrayBuffer> {
  const m = cameraMatrices(view.camera, view.width / view.height);
  const u = new Float32Array(FRAME_FLOATS);
  u.set(m.viewProj, 0);
  u.set(m.invViewProj, 16);
  u.set([...m.eye, m.perspective], 32);
  u.set([...m.forward, 0], 36);
  u.set([view.width, view.height, 1 / view.width, 1 / view.height], 40);
  u.set([view.time, 0, 0, 0], 44);
  return u;
}

/** One frame write's contents (FrameWrite: the closed list of per-frame CPU blocks). */
function writeData(w: FrameWrite, view: View, state: FrameState): Float32Array<ArrayBuffer> {
  switch (w.kind) {
    case "frame": return frameUniform(view);
    case "inputs": return state.inputs as Float32Array<ArrayBuffer>;
    case "params": return state.params as Float32Array<ArrayBuffer>;
  }
}

// ---- objects ---------------------------------------------------------------------------------------------------

const BUFFER_USAGE = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 } as const;
const TEXTURE_USAGE = { COPY_SRC: 0x1, TEXTURE_BINDING: 0x4, RENDER_ATTACHMENT: 0x10 } as const;
const STAGE = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 } as const;
const bits = <K extends string>(table: Record<K, number>, names: readonly K[]): number => names.reduce((n, k) => n | table[k], 0);

/** Runs `create` inside a validation scope; `what` names the object in the error. */
async function scoped<T>(device: GPUDevice, what: string, create: () => Promise<T>): Promise<T> {
  device.pushErrorScope("validation");
  const result = await create().then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
  const error = await device.popErrorScope();
  // The WGSL and descriptors are the compiler's, already accepted from the scene: a refusal here is the GPU stack's
  // (or a compiler bug), never the scene's, and a fresh device may pass (src/cli/main.ts retries).
  if (!result.ok) throw new EnvironmentError(`${what}:\n${result.message}`, true);
  if (error) throw new EnvironmentError(`${what}:\n${error.message}`, true);
  return result.v;
}

/** The objects a manifest describes, created; textures and the bind groups that name them come per view size (`sized`). */
export type Objects = {
  readonly manifest: Manifest;
  readonly buffers: readonly GPUBuffer[];
  readonly computePipelines: readonly GPUComputePipeline[];
  readonly renderPipelines: readonly GPURenderPipeline[];
  /** Bind groups naming no texture; undefined at the others' ids. */
  readonly fixedGroups: readonly (GPUBindGroup | undefined)[];
  /** The view-sized textures and every bind group, for one size. */
  sized(size: { width: number; height: number }): Sized;
};
export type Sized = {
  readonly width: number;
  readonly height: number;
  readonly textures: readonly GPUTexture[];
  readonly views: readonly GPUTextureView[];
  readonly groups: readonly GPUBindGroup[];
};

async function createObjects(device: GPUDevice, b: Bundle): Promise<Objects> {
  const m = b.manifest;
  const buffers = m.buffers.map((d) => device.createBuffer({ label: d.label, size: d.size, usage: bits(BUFFER_USAGE, d.usage) }));
  m.buffers.forEach((d, k) => {
    if (d.init === undefined) return;
    const bytes = b.blobs.get(d.init);
    if (bytes === undefined) throw new Error(`artefact: buffer "${d.label}" starts from blob "${d.init}", which the bundle lacks`);
    if (bytes.byteLength > 0) device.queue.writeBuffer(buffers[k]!, 0, bytes as Uint8Array<ArrayBuffer>); // Dawn warns on empty writes
  });
  const samplers = m.samplers.map((s) => device.createSampler(s));
  const layouts = m.bindGroupLayouts.map((l) => device.createBindGroupLayout({
    label: l.label,
    entries: l.entries.map((e): GPUBindGroupLayoutEntry => ({ ...e, visibility: bits(STAGE, e.visibility) })),
  }));
  const pipelineLayouts = m.pipelineLayouts.map((p) => device.createPipelineLayout({ label: p.label, bindGroupLayouts: p.bindGroupLayouts.map((i) => layouts[i]!) }));
  const modules: GPUShaderModule[] = [];
  for (const mod of m.modules) {
    const code = mod.chunks.map((c) => {
      const text = b.chunks.get(m.chunks[c]!);
      if (text === undefined) throw new Error(`artefact: module ${mod.label} names chunk ${m.chunks[c]}, which the bundle lacks`);
      return text;
    }).join("");
    modules.push(await scoped(device, `${mod.label} failed to compile`, async () => device.createShaderModule({ label: mod.label, code })));
  }
  // Pipelines are built eagerly, so every error surfaces at load and a frame never stalls on compilation.
  const computePipelines: GPUComputePipeline[] = [];
  for (const p of m.computePipelines) {
    computePipelines.push(await scoped(device, `pose stage "${p.label}": pipeline creation failed`, () => device.createComputePipelineAsync({
      label: p.label, layout: pipelineLayouts[p.layout]!, compute: { module: modules[p.module]!, entryPoint: p.entryPoint },
    })));
  }
  const renderPipelines: GPURenderPipeline[] = [];
  for (const p of m.renderPipelines) {
    renderPipelines.push(await scoped(device, `${p.label}: pipeline creation failed`, () => device.createRenderPipelineAsync({
      label: p.label,
      layout: pipelineLayouts[p.layout]!,
      vertex: { module: modules[p.vertex.module]!, entryPoint: p.vertex.entryPoint, constants: p.vertex.constants },
      fragment: { module: modules[p.fragment.module]!, entryPoint: p.fragment.entryPoint, constants: p.fragment.constants, targets: p.fragment.targets.map((t) => ({ ...t })) },
      primitive: p.primitive,
      ...(p.depthStencil === undefined ? {} : { depthStencil: p.depthStencil }),
      multisample: p.multisample,
    })));
  }
  const named = (g: Manifest["bindGroups"][number]) => g.entries.some((e) => "texture" in e);
  const group = (k: number, views: readonly GPUTextureView[]): GPUBindGroup => {
    const g = m.bindGroups[k]!;
    return device.createBindGroup({
      label: g.label, layout: layouts[g.layout]!,
      entries: g.entries.map((e): GPUBindGroupEntry => {
        if ("buffer" in e) return { binding: e.binding, resource: { buffer: buffers[e.buffer]! } };
        if ("texture" in e) return { binding: e.binding, resource: views[e.texture]! };
        return { binding: e.binding, resource: samplers[e.sampler]! };
      }),
    });
  };
  const fixedGroups = m.bindGroups.map((g, k) => (named(g) ? undefined : group(k, [])));
  return {
    manifest: m, buffers, computePipelines, renderPipelines, fixedGroups,
    sized: (size) => {
      const textures = m.textures.map((t) => device.createTexture({ label: t.label, size, format: t.format, sampleCount: t.sampleCount, usage: bits(TEXTURE_USAGE, t.usage) }));
      const views = textures.map((t) => t.createView());
      const groups = m.bindGroups.map((g, k) => fixedGroups[k] ?? group(k, views));
      return { ...size, textures, views, groups };
    },
  };
}

// ---- recording -------------------------------------------------------------------------------------------------

/** The pose pass's dispatches, into an open compute pass. */
export function dispatchAll(pass: GPUComputePassEncoder, o: Objects, list: readonly Dispatch[]): void {
  for (const d of list) {
    pass.setPipeline(o.computePipelines[d.pipeline]!);
    d.bindGroups.forEach((g, i) => pass.setBindGroup(i, o.fixedGroups[g]!));
    pass.dispatchWorkgroups(d.workgroups);
  }
}

/** Draw calls for one command (a planned draw with no run issues nothing). */
export function command(pass: GPURenderPassEncoder, o: Objects, c: RenderPassDesc["commands"][number], plan: Plan): void {
  switch (c.kind) {
    case "fixed":
      pass.setPipeline(o.renderPipelines[c.pipeline]!);
      pass.draw(c.vertices, c.instances);
      return;
    case "planned": {
      const runs = plan[c.draw]!;
      if (runs.length === 0) return;
      pass.setPipeline(o.renderPipelines[c.pipeline]!);
      for (const r of runs) pass.draw(r.vertices, r.instances, 0, r.first);
      return;
    }
  }
}

export const targetView = (s: Sized, t: Target, out: GPUTextureView): GPUTextureView => {
  switch (t.kind) {
    case "texture": return s.views[t.texture]!;
    case "output": return out;
  }
};

const colour = (c: readonly [number, number, number, number] | undefined): GPUColor | undefined => (c === undefined ? undefined : { r: c[0], g: c[1], b: c[2], a: c[3] });

/** A render pass's descriptor, resolved against the objects of one size. */
export function passDescriptor(p: RenderPassDesc, s: Sized, out: GPUTextureView): GPURenderPassDescriptor {
  const c = p.color, d = p.depth;
  return {
    label: p.label,
    colorAttachments: [{
      view: targetView(s, c.view, out),
      ...(c.resolveTarget === undefined ? {} : { resolveTarget: targetView(s, c.resolveTarget, out) }),
      loadOp: c.loadOp, storeOp: c.storeOp,
      ...(c.clearValue === undefined ? {} : { clearValue: colour(c.clearValue) }),
    }],
    ...(d === undefined ? {} : {
      depthStencilAttachment: {
        view: s.views[d.view]!, depthLoadOp: d.depthLoadOp, depthStoreOp: d.depthStoreOp,
        ...(d.depthClearValue === undefined ? {} : { depthClearValue: d.depthClearValue }),
      },
    }),
  };
}

/**
 * The frame's render passes. `stamps` (frame timing): timestamp `begin` at the start of the first pass and `end` at the
 * end of the last (on the real passes: Dawn on Metal writes no timestamps for an empty pass).
 */
function recordPasses(encoder: GPUCommandEncoder, o: Objects, s: Sized, out: GPUTextureView, plan: Plan, stamps?: { readonly querySet: GPUQuerySet; readonly begin: number; readonly end: number }): void {
  const passes = o.manifest.frame.passes;
  for (const [k, p] of passes.entries()) {
    const writes = stamps === undefined ? undefined : {
      querySet: stamps.querySet,
      ...(k === 0 ? { beginningOfPassWriteIndex: stamps.begin } : {}),
      ...(k === passes.length - 1 ? { endOfPassWriteIndex: stamps.end } : {}),
    };
    const pass = encoder.beginRenderPass({ ...passDescriptor(p, s, out), ...(writes !== undefined && (k === 0 || k === passes.length - 1) ? { timestampWrites: writes } : {}) });
    p.bindGroups.forEach((g, i) => pass.setBindGroup(i, s.groups[g]!));
    for (const c of p.commands) command(pass, o, c, plan);
    pass.end();
  }
}

/** What a plan draws (FrameStats): scene triangles, and the draw calls issued. */
function statsOf(plan: Plan): FrameStats {
  let triangles = 0, draws = 0;
  for (const runs of plan) for (const r of runs) { triangles += (r.vertices / 3) * r.instances; draws++; }
  return { triangles: Math.round(triangles), draws };
}

const sameSize = (t: { width: number; height: number }, v: View) => t.width === v.width && t.height === v.height;
/** The headless output texture and its readback buffer. */
type Readback = { readonly width: number; readonly height: number; readonly texture: GPUTexture; readonly buffer: GPUBuffer; readonly bytesPerRow: number };

// ---- the executor ----------------------------------------------------------------------------------------------

/** Load a lowered artefact: create its objects, and return the frame functions. */
export async function loadBundle(device: GPUDevice, b: Bundle, cpu: CpuTables): Promise<GpuLoaded> {
  const m = b.manifest;
  // The `cpu` tables, by place: each frame's uploads must be exactly these, each its table's size.
  const cpuTables = new Map(m.tables.filter((t) => t.fill.kind === "cpu").map((t) => [`${m.buffers[t.buffer]!.label}@${t.offset}`, t]));
  if (cpu.kind === "none" && cpuTables.size > 0) {
    throw new NotDataError(`artefact: ${cpuTables.size} table(s) are filled by JavaScript, which a file cannot hold:${[...cpuTables.values()].map((t) => ` "${t.name}"`).join(",")}`);
  }
  const o = await createObjects(device, b);
  const detail = new Float32Array(m.frame.detail.floats);
  // Each grid's level last frame, for hysteresis (src/host/detail.ts): the host's only memory between frames.
  const memory: Memory = new Map();
  const bounds = m.frame.bounds;

  let sized: Sized | undefined;
  let readback: Readback | undefined;
  let reading = false;
  const sizedFor = (view: View): Sized => {
    if (sized && sameSize(sized, view)) return sized;
    for (const t of sized?.textures ?? []) t.destroy();
    sized = o.sized({ width: view.width, height: view.height });
    return sized;
  };
  const readbackFor = (view: View): Readback => {
    if (readback && sameSize(readback, view)) return readback;
    readback?.texture.destroy(); readback?.buffer.destroy();
    // Buffer copies of a texture need rows aligned to 256 bytes; `frame` repacks them tightly.
    const bytesPerRow = Math.ceil((view.width * 4) / 256) * 256;
    readback = {
      width: view.width, height: view.height, bytesPerRow,
      texture: device.createTexture({ label: "loft output", size: { width: view.width, height: view.height }, format: COLOR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }),
      buffer: device.createBuffer({ label: "loft readback", size: bytesPerRow * view.height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
    };
    return readback;
  };

  /** The read of the bounds buffer in flight (interactive frames do not wait for it). */
  let boundsPending: Promise<Bounds> | undefined;
  /** What interactive frames plan with: the last bounds read. */
  let lastBounds: Bounds = { kind: "none" };
  const readBounds = async (): Promise<Bounds> => {
    switch (bounds.kind) {
      case "none": return { kind: "none" };
      case "read": {
        const buf = o.buffers[bounds.buffer]!;
        await buf.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(buf.getMappedRange().slice(0));
        buf.unmap();
        const at = new Map(bounds.grids.map((g) => [g.slot, g.at]));
        return { kind: "read", at: (slot) => data.subarray(at.get(slot)! * 4) };
      }
    }
  };

  // The curve data the GPU holds, so the CPU fills read the same curves (FrameState.curves).
  const curveBlob = m.buffers[m.curves.buffer]!.init;
  let curves = curveBlob === undefined ? new Float32Array(0) : new Float32Array(b.blobs.get(curveBlob)!.slice().buffer);
  const cpuUploads = (state: FrameState): readonly CpuUpload[] => {
    switch (cpu.kind) {
      case "none": return [];
      case "js": return cpu.uploads(state);
    }
  };
  const bufferNamed = new Map(m.dynamic.map((k) => [m.buffers[k]!.label, o.buffers[k]!]));

  /** Write the frame's state and `cpu` tables, then submit the pose pass (and, when `copyBounds`, the copy of the bounds). */
  const pose = (view: View, copyBounds: boolean, stamps?: Stamps): number => {
    const t0 = performance.now();
    const state = frameState(m, curves, view);
    const uploads = cpuUploads(state);
    for (const u of uploads) {
      const t = cpuTables.get(`${u.buffer}@${u.offset}`);
      if (t === undefined) throw new Error(`cpuPose returned data for "${u.buffer}" at vec4 ${u.offset}, where no cpu table lives`);
      if (u.data.length !== t.vec4s * 4) throw new Error(`cpuPose returned table "${t.name}" with ${u.data.length} floats; expected ${t.vec4s * 4} (${t.vec4s} vec4s)`);
      device.queue.writeBuffer(bufferNamed.get(u.buffer)!, u.offset * 16, u.data as Float32Array<ArrayBuffer>);
    }
    if (uploads.length !== cpuTables.size) {
      const given = new Set(uploads.map((u) => `${u.buffer}@${u.offset}`));
      throw new Error(`cpuPose did not return cpu table${[...cpuTables].filter(([k]) => !given.has(k)).map(([, t]) => ` "${t.name}"`).join(",")}`);
    }
    for (const w of m.frame.writes) {
      const data = writeData(w, view, state);
      if (data.length > 0) device.queue.writeBuffer(o.buffers[w.buffer]!, 0, data);
    }
    const encoder = device.createCommandEncoder({ label: "loft pose" });
    if (m.frame.pose.length > 0) {
      const pass = encoder.beginComputePass({ label: "loft pose", ...(stamps === undefined ? {} : { timestampWrites: { querySet: stamps.querySet, beginningOfPassWriteIndex: stamps.begin, endOfPassWriteIndex: stamps.end } }) });
      dispatchAll(pass, o, m.frame.pose);
      pass.end();
    }
    if (copyBounds && bounds.kind === "read") {
      for (const g of bounds.grids) encoder.copyBufferToBuffer(o.buffers[g.from]!, g.fromOffset, o.buffers[bounds.buffer]!, g.at * 16, g.instances * 16);
    }
    device.queue.submit([encoder.finish()]);
    return performance.now() - t0;
  };
  /** This frame's plan from these bounds, its level-of-detail slots written (before the draws' submit). */
  const plan = (view: View, read: Bounds): Plan => {
    const p = planFrame(m.plan, view, read, memory, detail);
    device.queue.writeBuffer(o.buffers[m.frame.detail.buffer]!, 0, detail);
    return p;
  };
  /** A frame that waits for its own bounds (headless frames, profiling): pose, read the bounds, plan. */
  const posedPlan = async (view: View, stamps?: Stamps): Promise<{ readonly plan: Plan; readonly poseMs: number }> => {
    if (boundsPending) await boundsPending;
    const copy = bounds.kind === "read";
    const poseMs = await validated("pose", () => pose(view, copy, stamps));
    const read = copy ? await readBounds() : lastBounds;
    const t0 = performance.now();
    const p = plan(view, read);
    return { plan: p, poseMs: poseMs + performance.now() - t0 };
  };

  const checkView = (view: View): void => {
    if (!(Number.isInteger(view.width) && Number.isInteger(view.height) && view.width > 0 && view.height > 0)) {
      throw new Error(`view: size must be positive integers, got ${view.width} x ${view.height}`);
    }
  };

  /** Runs `body` inside a validation scope and throws the first validation error it raised. */
  const validated = async <T>(what: string, body: () => T): Promise<T> => {
    device.pushErrorScope("validation");
    let out: T;
    try { out = body(); } catch (e) { await device.popErrorScope(); throw e; }
    const error = await device.popErrorScope();
    if (error) throw new Error(`${what}: WebGPU validation error:\n${error.message}`);
    return out;
  };

  const frameTimed = async (view: View) => {
    // One readback buffer serves every frame; a second frame would remap or resize it under the first one's pending
    // mapAsync. So overlapping calls are rejected, and the rejected call leaves the pending one untouched.
    if (reading) throw new Error("frame: called again before the previous frame() resolved (its readback buffer is still being mapped); await each frame before starting the next");
    checkView(view);
    reading = true;
    try {
      const posed = await posedPlan(view);
      const t1 = performance.now();
      const rb = await validated("frame", () => {
        const rb = readbackFor(view);
        const encoder = device.createCommandEncoder({ label: "loft frame" });
        recordPasses(encoder, o, sizedFor(view), rb.texture.createView(), posed.plan);
        encoder.copyTextureToBuffer({ texture: rb.texture }, { buffer: rb.buffer, bytesPerRow: rb.bytesPerRow, rowsPerImage: view.height }, { width: view.width, height: view.height });
        device.queue.submit([encoder.finish()]);
        return rb;
      });
      const t2 = performance.now();
      await rb.buffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(rb.buffer.getMappedRange());
      const row = view.width * 4;
      const pixels = new Uint8Array(row * view.height);
      for (let y = 0; y < view.height; y++) pixels.set(mapped.subarray(y * rb.bytesPerRow, y * rb.bytesPerRow + row), y * row);
      rb.buffer.unmap();
      const t3 = performance.now();
      return { pixels, ms: { pose: posed.poseMs, encode: t2 - t1, readback: t3 - t2 }, drawn: statsOf(posed.plan) };
    } finally {
      reading = false;
    }
  };

  return {
    frameTimed,
    frame: async (view) => (await frameTimed(view)).pixels,
    draw: async (view, target) => {
      checkView(view);
      if (target.format !== COLOR_FORMAT) throw new Error(`draw: target format is ${target.format}; configure the canvas with ${COLOR_FORMAT}`);
      if (target.width !== view.width || target.height !== view.height) {
        throw new Error(`draw: target is ${target.width} x ${target.height} but the view is ${view.width} x ${view.height}`);
      }
      // Never waits on the GPU: plans with the last bounds read, and starts reading this frame's when none is in flight.
      const copy = bounds.kind === "read" && boundsPending === undefined;
      const stats = await validated("draw", () => {
        pose(view, copy);
        const p = plan(view, lastBounds);
        const encoder = device.createCommandEncoder({ label: "loft draw" });
        recordPasses(encoder, o, sizedFor(view), target.createView(), p);
        device.queue.submit([encoder.finish()]);
        return statsOf(p);
      });
      if (copy) boundsPending = readBounds().then((r) => { lastBounds = r; boundsPending = undefined; return r; });
      return stats;
    },
    profile: async (view, frames) => {
      checkView(view);
      if (!(Number.isInteger(frames) && frames >= 1)) throw new Error(`profile: frames must be a positive integer, got ${frames}`);
      return profileFrames({ device, objects: o, size: { width: view.width, height: view.height }, frames, upload: () => posedPlan(view) });
    },
    poseTime: async (view, repeats, rounds) => {
      checkView(view);
      if (!device.features.has("timestamp-query")) throw new Error("poseTime: the device was created without the \"timestamp-query\" feature");
      await posedPlan(view);
      const query = device.createQuerySet({ type: "timestamp", count: 2 });
      const resolve = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      /** Least over the rounds of the per-repeat time of these dispatches, run in order `repeats` times in one pass. */
      const time = async (list: readonly Dispatch[]): Promise<number> => {
        let best = Infinity;
        for (let r = 0; r < rounds; r++) {
          const encoder = device.createCommandEncoder({ label: "loft pose time" });
          const pass = encoder.beginComputePass({ label: "pose x repeats", timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } });
          for (let k = 0; k < repeats; k++) dispatchAll(pass, o, list);
          pass.end();
          encoder.resolveQuerySet(query, 0, 2, resolve, 0);
          encoder.copyBufferToBuffer(resolve, 0, read, 0, 16);
          device.queue.submit([encoder.finish()]);
          await read.mapAsync(GPUMapMode.READ);
          const ts = new BigUint64Array(read.getMappedRange().slice(0));
          read.unmap();
          best = Math.min(best, Number(ts[1]! - ts[0]!) / 1e6 / repeats);
        }
        return best;
      };
      // Warm up: an idle Apple GPU runs a short burst at a low clock (the same scene read 0.10 to 0.27 ms cold).
      for (let w = 0; w < 4; w++) await time(m.frame.pose);
      const total = await time(m.frame.pose);
      const stages: number[] = [];
      for (const d of m.frame.pose) stages.push(await time([d]));
      query.destroy(); resolve.destroy(); read.destroy();
      return { total, stages };
    },
    frameGpu: async (view, frames) => {
      checkView(view);
      if (!device.features.has("timestamp-query")) throw new Error("frameGpu: the device was created without the \"timestamp-query\" feature");
      const query = device.createQuerySet({ type: "timestamp", count: 4 });
      const resolve = device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      // Timestamps come in whole ticks (0.065536 ms on the Apple GPUs measured): their differences' common divisor.
      const gcd = (a: number, b: number): number => (a === 0 ? b : gcd(b % a, a));
      let best = { ms: Infinity, pose: 0, draws: 0 }, tick = 0;
      for (let f = 0; f < frames + 2; f++) {
        const posed = await posedPlan(view, { querySet: query, begin: 0, end: 1 });
        const rb = readbackFor(view);
        const encoder = device.createCommandEncoder({ label: "loft frame (timed)" });
        recordPasses(encoder, o, sizedFor(view), rb.texture.createView(), posed.plan, { querySet: query, begin: 2, end: 3 });
        encoder.resolveQuerySet(query, 0, 4, resolve, 0);
        encoder.copyBufferToBuffer(resolve, 0, read, 0, 32);
        device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        const ts = [...new BigUint64Array(read.getMappedRange().slice(0))].map(Number);
        read.unmap();
        for (const d of [ts[1]! - ts[0]!, ts[3]! - ts[2]!, ts[2]! - ts[1]!]) if (d > 0) tick = gcd(tick, d);
        const p = (ts[1]! - ts[0]!) / 1e6, dr = (ts[3]! - ts[2]!) / 1e6;
        // The first two frames warm the clocks (an idle Apple GPU starts a burst at a low clock).
        if (f >= 2 && p + dr < best.ms) best = { ms: p + dr, pose: p, draws: dr };
      }
      query.destroy(); resolve.destroy(); read.destroy();
      return { ...best, tick: tick / 1e6 };
    },
    readTables: async (view) => {
      checkView(view);
      if (boundsPending) await boundsPending;
      await validated("readTables", () => pose(view, false));
      const dynamic = m.dynamic;
      const staging = dynamic.map((k) => device.createBuffer({ label: `read ${m.buffers[k]!.label}`, size: m.buffers[k]!.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
      const encoder = device.createCommandEncoder({ label: "loft read tables" });
      dynamic.forEach((k, i) => encoder.copyBufferToBuffer(o.buffers[k]!, 0, staging[i]!, 0, m.buffers[k]!.size));
      device.queue.submit([encoder.finish()]);
      const out: Record<string, Float32Array> = {};
      for (const [i, k] of dynamic.entries()) {
        await staging[i]!.mapAsync(GPUMapMode.READ);
        out[m.buffers[k]!.label] = new Float32Array(staging[i]!.getMappedRange().slice(0));
        staging[i]!.destroy();
      }
      return out;
    },
    setCurves: (next) => {
      if (next.length !== m.curves.floats) throw new Error(`setCurves: got ${next.length} floats; the artefact has ${m.curves.floats}`);
      if (next.length > 0) device.queue.writeBuffer(o.buffers[m.curves.buffer]!, 0, next as Float32Array<ArrayBuffer>);
      // A copy: the caller may keep editing its array, and the pose must see what the GPU was given.
      curves = next.slice();
    },
    destroy: () => {
      for (const buf of o.buffers) buf.destroy();
      for (const t of sized?.textures ?? []) t.destroy();
      readback?.texture.destroy(); readback?.buffer.destroy();
      sized = undefined; readback = undefined;
    },
  };
}

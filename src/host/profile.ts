// GPU time per draw and per fixed stage, from timestamp queries (`GpuLoaded.profile`).
//
// Timestamps are written per pass, so the profiling frame splits the frame's passes (the manifest's, src/host/manifest.ts)
// into a pass per stage: a pass that draws planned draws becomes its start (its own loads and clears, stored), one pass
// per draw that loads and stores its attachments, and, when it resolves, a resolve pass; a pass of fixed draws only (the
// depth resolve, a post pass) is timed whole; then the readback copy. It is slower than a real frame and is only for
// measuring.
//
// Two facts about Dawn on Metal (Apple's tile GPUs), measured while writing this, shape the arithmetic:
// - Passes overlap: a pass's begin can precede the previous pass's end (the next vertex work runs while the previous
//   fragment work drains). So a stage's cost is its COMPLETION DELTA, end(k) - end(k - 1): the time it added to the
//   frame. The deltas sum to the frame's GPU time.
// - A pass with no draw is coalesced (its timestamps repeat the previous pass's), so the resolve passes and the
//   brackets round the readback copy each issue one draw whose triangle lies outside the clip volume.
// - Timestamps are quantised to 2^16 ns (65.5 us; Dawn's "timestamp_quantization", which bun-webgpu cannot turn
//   off), so one frame's delta for a small draw is 0 or 65.5 us. A minimum over frames would report 0. Since a pass's
//   boundaries fall at varying phases of that grid, the MEAN of the deltas is unbiased; the machine's load only ever
//   adds time. So frames are taken in blocks, each block's deltas averaged, and the best (least) block mean reported.
// A pass of its own costs loading and storing the 4x attachments; that cost is measured as its own stage ("pass
// overhead": a loaded and stored pass with the empty draw) and `net` subtracts it from each draw.

import type { Plan } from "./detail.ts";
import { command, dispatchAll, passDescriptor, type Objects } from "./host.ts";
import { COLOR_FORMAT, type RenderPassDesc } from "./manifest.ts";

/** The profile's label for every pose stage run in one pass. */
export const POSE_ONE_PASS = "pose stages, one pass";

export type ProfileDraw = {
  readonly label: string;
  /** Completion delta of its pass, best frame. */
  readonly ms: number;
  /** `ms` less the pass overhead (never below 0). */
  readonly net: number;
  /** Triangles it drew and draw calls it issued (what the plan chose). */
  readonly triangles: number;
  readonly instances: number;
  readonly calls: number;
};
export type ProfileStage = { readonly label: string; readonly ms: number };
export type Profile = {
  readonly draws: readonly ProfileDraw[];
  /** Each scene pass's start (its clears), resolve passes, post passes, and the readback copy. */
  readonly stages: readonly ProfileStage[];
  /** The pose stages: each in a pass of its own, in order, then all of them in one pass (as a frame runs them, labelled POSE_ONE_PASS). */
  readonly poseStages: readonly ProfileStage[];
  /** A pass that loads and stores the 4x attachments and draws nothing visible. */
  readonly passOverhead: number;
  /** CPU: frame state, `cpu` tables, uploads and the pose stages' submit, and the level-of-detail plan; best frame. */
  readonly pose: number;
  /** Sum of every stage's delta, best block. */
  readonly total: number;
  readonly frames: number;
};

const NOOP_WGSL = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> { return vec4<f32>(2.0, 2.0, f32(vi), 1.0); }
@fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(0.0); }`;

/** A draw whose triangle lies outside the clip volume, for passes of a given colour format, samples and depth format. */
function noops(device: GPUDevice): (format: GPUTextureFormat, samples: number, depth: GPUTextureFormat | undefined) => GPURenderPipeline {
  const module = device.createShaderModule({ label: "loft profile noop", code: NOOP_WGSL });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
  const made = new Map<string, GPURenderPipeline>();
  return (format, count, depth) => {
    const key = `${format}|${count}|${depth}`;
    const known = made.get(key);
    if (known) return known;
    const p = device.createRenderPipeline({
      label: "loft profile noop", layout,
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format, writeMask: 0 }] },
      primitive: { topology: "triangle-list" },
      ...(depth === undefined ? {} : { depthStencil: { format: depth, depthWriteEnabled: false, depthCompare: "always" as const } }),
      multisample: { count },
    });
    made.set(key, p);
    return p;
  };
}

/** One timed pass. `kind` says which list its delta goes to; `draw` is a planned draw's index. */
type Stage = { readonly label: string; readonly kind: "pose" | "draw" | "stage" | "overhead" | "bracket"; readonly index: number; readonly draw?: number };

export type ProfileInput = {
  readonly device: GPUDevice;
  readonly objects: Objects;
  readonly size: { readonly width: number; readonly height: number };
  /** Pose a frame (its own submit, waiting for its level-of-detail bounds) and return its plan and CPU milliseconds. */
  readonly upload: () => Promise<{ readonly plan: Plan; readonly poseMs: number }>;
  readonly frames: number;
};

export async function profileFrames(p: ProfileInput): Promise<Profile> {
  const { device, objects: o, size } = p;
  const m = o.manifest;
  if (!device.features.has("timestamp-query")) throw new Error("profile: the device was created without the \"timestamp-query\" feature");
  const noop = noops(device);
  const s = o.sized(size);
  const RA = GPUTextureUsage.RENDER_ATTACHMENT;
  const out = device.createTexture({ label: "profile output", size, format: COLOR_FORMAT, usage: RA | GPUTextureUsage.COPY_SRC });
  const outView = out.createView();
  const tiny = device.createTexture({ label: "profile bracket", size: { width: 1, height: 1 }, format: COLOR_FORMAT, usage: RA });
  const bytesPerRow = Math.ceil((size.width * 4) / 256) * 256;
  const readback = device.createBuffer({ label: "profile readback", size: bytesPerRow * size.height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  /** A pass's colour format and samples, and its depth format: what a noop draw in it must match. */
  const shapeOf = (q: RenderPassDesc) => {
    const t = q.color.view;
    const tex = t.kind === "texture" ? m.textures[t.texture]! : { format: COLOR_FORMAT, sampleCount: 1 };
    return { format: tex.format, samples: tex.sampleCount, depth: q.depth === undefined ? undefined : m.textures[q.depth.view]!.format };
  };

  const maxStages = 6 + 2 * m.frame.pose.length + m.frame.passes.reduce((n, q) => n + 3 + q.commands.length, 0);
  const querySet = device.createQuerySet({ type: "timestamp", count: 2 * maxStages });
  const resolveBuf = device.createBuffer({ size: 16 * maxStages, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const readTs = device.createBuffer({ size: 16 * maxStages, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  const block = Math.max(1, Math.floor(p.frames / 6));
  const sums = new Map<string, number>(), best = new Map<string, number>();
  let bestPose = Infinity, bestTotal = Infinity, sumTotal = 0;
  let shape: { readonly stages: readonly Stage[]; readonly plan: Plan } | undefined;
  for (let f = 0; f < p.frames; f++) {
    const { plan, poseMs } = await p.upload();
    bestPose = Math.min(bestPose, poseMs);
    const stages: Stage[] = [];
    const encoder = device.createCommandEncoder({ label: "loft profile" });
    const timed = (label: string, kind: Stage["kind"], draw?: number): GPURenderPassTimestampWrites => {
      const index = stages.length;
      stages.push({ label, kind, index, ...(draw === undefined ? {} : { draw }) });
      return { querySet, beginningOfPassWriteIndex: 2 * index, endOfPassWriteIndex: 2 * index + 1 };
    };
    const end = (pass: GPURenderPassEncoder, pipeline: GPURenderPipeline) => { pass.setPipeline(pipeline); pass.draw(3); pass.end(); };

    // The pose stages again (the upload ran them untimed to read the bounds; the same inputs give the same tables):
    // a pass per stage for the breakdown, then every stage in one pass, as a frame runs them. A compute pass may
    // overlap the render passes after it, so a pose pass's time is its own duration, not a completion delta.
    if (m.frame.pose.length > 0) {
      for (const d of m.frame.pose) {
        const pass = encoder.beginComputePass({ label: d.label, timestampWrites: timed(d.label, "pose") });
        dispatchAll(pass, o, [d]);
        pass.end();
      }
      const pass = encoder.beginComputePass({ label: POSE_ONE_PASS, timestampWrites: timed(POSE_ONE_PASS, "pose") });
      dispatchAll(pass, o, m.frame.pose);
      pass.end();
    }

    let overhead = false;
    for (const q of m.frame.passes) {
      const d = passDescriptor(q, s, outView);
      const groups = (pass: GPURenderPassEncoder) => q.bindGroups.forEach((g, i) => pass.setBindGroup(i, s.groups[g]!));
      if (!q.commands.some((c) => c.kind === "planned")) {
        const pass = encoder.beginRenderPass({ ...d, timestampWrites: timed(q.label, "stage") });
        groups(pass);
        for (const c of q.commands) command(pass, o, c, plan);
        pass.end();
        continue;
      }
      const sh = shapeOf(q), x = noop(sh.format, sh.samples, sh.depth);
      const colour = (d.colorAttachments as GPURenderPassColorAttachment[])[0]!;
      /** The pass's attachments with every load as given and every store kept, no resolve. */
      const kept = (load: boolean): GPURenderPassDescriptor => ({
        colorAttachments: [{ view: colour.view, loadOp: load ? "load" : colour.loadOp, storeOp: "store", ...(colour.clearValue === undefined ? {} : { clearValue: colour.clearValue }) }],
        ...(d.depthStencilAttachment === undefined ? {} : {
          depthStencilAttachment: { ...d.depthStencilAttachment, depthLoadOp: load ? "load" : d.depthStencilAttachment.depthLoadOp, depthStoreOp: "store" },
        }),
      });
      end(encoder.beginRenderPass({ ...kept(false), label: `${q.label}: start`, timestampWrites: timed(`${q.label}: start`, "stage") }), x);
      if (!overhead) {
        // A pass of its own costs loading and storing the attachments: measured once, on the first scene pass.
        end(encoder.beginRenderPass({ ...kept(true), label: "pass overhead", timestampWrites: timed("pass overhead", "overhead") }), x);
        overhead = true;
      }
      for (const c of q.commands) {
        const label = c.kind === "planned" ? m.plan[c.draw]!.label : q.label;
        const pass = encoder.beginRenderPass({ ...kept(true), label, timestampWrites: c.kind === "planned" ? timed(label, "draw", c.draw) : timed(label, "stage") });
        groups(pass);
        command(pass, o, c, plan);
        // A plan may issue nothing for a draw; the pass still needs a draw to be timed.
        end(pass, x);
      }
      if (colour.resolveTarget !== undefined) {
        end(encoder.beginRenderPass({
          label: `${q.label}: resolve`, timestampWrites: timed(`${q.label}: multisample resolve`, "stage"),
          colorAttachments: [{ view: colour.view, resolveTarget: colour.resolveTarget, loadOp: "load", storeOp: colour.storeOp }],
        }), noop(sh.format, sh.samples, undefined));
      }
    }
    const bracket = (label: string, kind: Stage["kind"]) => end(encoder.beginRenderPass({
      label, timestampWrites: timed(label, kind), colorAttachments: [{ view: tiny.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
    }), noop(COLOR_FORMAT, 1, undefined));
    bracket("readback start", "bracket");
    encoder.copyTextureToBuffer({ texture: out }, { buffer: readback, bytesPerRow, rowsPerImage: size.height }, size);
    bracket("readback copy", "stage");
    encoder.resolveQuerySet(querySet, 0, 2 * stages.length, resolveBuf, 0);
    encoder.copyBufferToBuffer(resolveBuf, 0, readTs, 0, 16 * stages.length);
    device.queue.submit([encoder.finish()]);
    await readTs.mapAsync(GPUMapMode.READ);
    const ts = new BigUint64Array(readTs.getMappedRange().slice(0));
    readTs.unmap();
    await readback.mapAsync(GPUMapMode.READ); readback.unmap();
    const ms = (a: bigint, b: bigint) => Number(b - a) / 1e6;
    let total = 0;
    let previous = -1;
    stages.forEach((st, k) => {
      // A render pass's time is its completion delta from the render pass before it; a pose pass's its own duration.
      const delta = st.kind === "pose" || previous < 0 ? ms(ts[2 * k]!, ts[2 * k + 1]!) : ms(ts[2 * previous + 1]!, ts[2 * k + 1]!);
      if (st.kind !== "pose") previous = k;
      total += delta;
      // Labels can repeat (two draws of one shader); keyed by position, which is the same every frame.
      const key = `${k}|${st.label}`;
      sums.set(key, (sums.get(key) ?? 0) + delta);
    });
    sumTotal += total;
    if ((f + 1) % block === 0) {
      for (const [key, v] of sums) best.set(key, Math.min(best.get(key) ?? Infinity, v / block));
      bestTotal = Math.min(bestTotal, sumTotal / block);
      sums.clear(); sumTotal = 0;
    }
    shape = { stages, plan };
  }
  for (const t of [...s.textures, out, tiny]) t.destroy();
  for (const b of [readback, resolveBuf, readTs]) b.destroy();
  querySet.destroy();

  const sh = shape!;
  const at = (st: Stage) => best.get(`${st.index}|${st.label}`)!;
  const over = sh.stages.find((st) => st.kind === "overhead");
  const overhead = over === undefined ? 0 : at(over);
  const draws = sh.stages.filter((st) => st.kind === "draw").map((st): ProfileDraw => {
    const runs = sh.plan[st.draw!]!;
    const triangles = runs.reduce((t, r) => t + (r.vertices / 3) * r.instances, 0);
    const instances = runs.reduce((t, r) => t + r.instances, 0);
    return { label: st.label, ms: at(st), net: Math.max(0, at(st) - overhead), triangles: Math.round(triangles), instances, calls: runs.length };
  });
  const stages = sh.stages.filter((st) => st.kind === "stage").map((st) => ({ label: st.label, ms: at(st) }));
  const poseStages = sh.stages.filter((st) => st.kind === "pose").map((st) => ({ label: st.label, ms: at(st) }));
  return { draws, stages, poseStages, passOverhead: overhead, pose: bestPose, total: bestTotal, frames: p.frames };
}

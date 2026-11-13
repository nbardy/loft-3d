// The artefact as files (docs/artefact_format.md, docs/gpu_native.md phase 2): the host, lowered. Every WebGPU object a
// loader creates is one entry in a list below, described with WebGPU's own field names, and every reference between them
// is an index into its list. The frame is a recipe over those objects. A loader executes it; it decides nothing.
//
// This file is types and constants only, and imports nothing that evaluates: the file loader's import closure must not
// reach the compiler (tools/check_loader_closure.ts).

import type { Camera, Detail, InputSlot, ParamSlot, TableFillKind } from "../artefact.ts";

export const FORMAT = "loft-artefact";
export const FORMAT_VERSION = 1;

/** Index into the list of its kind (`Manifest.buffers`, `Manifest.textures`, ...). */
export type Id = number;

/** GPUBufferUsage / GPUTextureUsage flag names; the value is their bitwise or. */
export type BufferUsage = "MAP_READ" | "COPY_SRC" | "COPY_DST" | "UNIFORM" | "STORAGE";
export type TextureUsage = "COPY_SRC" | "RENDER_ATTACHMENT" | "TEXTURE_BINDING";
export type Stage = "VERTEX" | "FRAGMENT" | "COMPUTE";

/** `init`: a blob uploaded once at load, at offset 0 (a blob of 0 bytes is not written). */
export type BufferDesc = { readonly label: string; readonly size: number; readonly usage: readonly BufferUsage[]; readonly init?: string };
/** Sized to the view: created at the first frame and again whenever the view's width or height changes. */
export type TextureDesc = { readonly label: string; readonly format: GPUTextureFormat; readonly sampleCount: number; readonly usage: readonly TextureUsage[] };
export type SamplerDesc = {
  readonly label: string; readonly magFilter: GPUFilterMode; readonly minFilter: GPUFilterMode;
  readonly addressModeU: GPUAddressMode; readonly addressModeV: GPUAddressMode;
};

export type LayoutEntry =
  | { readonly binding: number; readonly visibility: readonly Stage[]; readonly buffer: { readonly type: GPUBufferBindingType } }
  | { readonly binding: number; readonly visibility: readonly Stage[]; readonly texture: { readonly sampleType: GPUTextureSampleType; readonly viewDimension: "2d"; readonly multisampled: boolean } }
  | { readonly binding: number; readonly visibility: readonly Stage[]; readonly sampler: { readonly type: GPUSamplerBindingType } };
export type BindGroupLayoutDesc = { readonly label: string; readonly entries: readonly LayoutEntry[] };
export type PipelineLayoutDesc = { readonly label: string; readonly bindGroupLayouts: readonly Id[] };

/** A shader module's code: its chunks' texts concatenated in order, nothing between them. `chunks` index `Manifest.chunks`. */
export type ModuleDesc = { readonly label: string; readonly chunks: readonly Id[] };

export type ComputePipelineDesc = { readonly label: string; readonly layout: Id; readonly module: Id; readonly entryPoint: string };
export type ShaderStageDesc = { readonly module: Id; readonly entryPoint: string; readonly constants: Readonly<Record<string, number>> };
export type RenderPipelineDesc = {
  readonly label: string;
  readonly layout: Id;
  readonly vertex: ShaderStageDesc;
  readonly fragment: ShaderStageDesc & { readonly targets: readonly { readonly format: GPUTextureFormat; readonly blend?: GPUBlendState }[] };
  readonly primitive: { readonly topology: "triangle-list"; readonly frontFace: GPUFrontFace; readonly cullMode: GPUCullMode };
  readonly depthStencil?: { readonly format: GPUTextureFormat; readonly depthWriteEnabled: boolean; readonly depthCompare: GPUCompareFunction };
  readonly multisample: { readonly count: number };
};

/** A texture is bound through its default view. A bind group that names a texture is re-created with the textures. */
export type BindGroupEntry =
  | { readonly binding: number; readonly buffer: Id }
  | { readonly binding: number; readonly texture: Id }
  | { readonly binding: number; readonly sampler: Id };
export type BindGroupDesc = { readonly label: string; readonly layout: Id; readonly entries: readonly BindGroupEntry[] };

/**
 * The per-frame CPU work, all of it (docs/artefact_format.md says how each block is computed). Written with
 * `queue.writeBuffer` at offset 0, before the frame's compute pass is submitted.
 */
export type FrameWrite =
  /** 48 floats: view-projection, its inverse, eye, forward, viewport, time (PRELUDE_WGSL `struct Frame`). */
  | { readonly kind: "frame"; readonly buffer: Id }
  /** `Manifest.inputFloats` floats: every input's default at its slot, the view's values over them, the view's time in `time`. */
  | { readonly kind: "inputs"; readonly buffer: Id }
  /** `Manifest.paramFloats` floats: every param's default at its slot, the view's values over them. */
  | { readonly kind: "params"; readonly buffer: Id };

/** A dispatch of the pose pass: x workgroups of POSE_WORKGROUP invocations, bind groups set at 0, 1, ... */
export type Dispatch = { readonly label: string; readonly pipeline: Id; readonly bindGroups: readonly Id[]; readonly workgroups: number };

/** Where the level-of-detail bounds come from: none (no grid draws), or copies into a buffer mapped after the pose. */
export type BoundsRead =
  | { readonly kind: "none" }
  | {
    readonly kind: "read";
    /** MAP_READ | COPY_DST. Grid after grid, one vec4 per instance. */
    readonly buffer: Id;
    /** Each grid slot's bounds: `instances` vec4s copied from `from` at byte `fromOffset` to byte `at * 16` of `buffer`. */
    readonly grids: readonly { readonly slot: number; readonly from: Id; readonly fromOffset: number; readonly at: number; readonly instances: number }[];
  };

/** An attachment: a view-sized texture of the manifest, or the frame's output (the caller's texture, COLOR_FORMAT). */
export type Target = { readonly kind: "texture"; readonly texture: Id } | { readonly kind: "output" };

export type ColorAttachment = {
  readonly view: Target; readonly resolveTarget?: Target;
  readonly loadOp: GPULoadOp; readonly storeOp: GPUStoreOp; readonly clearValue?: readonly [number, number, number, number];
};
export type DepthAttachment = { readonly view: Id; readonly depthLoadOp: GPULoadOp; readonly depthStoreOp: GPUStoreOp; readonly depthClearValue?: number };

/** A draw in a render pass: fixed counts, or the counts the level-of-detail plan chose for `Manifest.plan[draw]`. */
export type DrawCommand =
  | { readonly kind: "fixed"; readonly pipeline: Id; readonly vertices: number; readonly instances: number }
  /** For each run of the plan for that draw: draw(run.vertices, run.instances, 0, run.first). No run: nothing, not even setPipeline. */
  | { readonly kind: "planned"; readonly pipeline: Id; readonly draw: number };

export type RenderPassDesc = {
  readonly label: string;
  readonly color: ColorAttachment;
  readonly depth?: DepthAttachment;
  /** Set at group 0, 1, ... once, before the commands. */
  readonly bindGroups: readonly Id[];
  readonly commands: readonly DrawCommand[];
};

/** What a level-of-detail plan reads of a draw (`Detail` is src/artefact.ts's, measured at build). */
export type PlanDraw = { readonly label: string; readonly layer: "scene" | "construction"; readonly vertices: number; readonly instances: number; readonly detail: Detail };

/** A per-frame table, for tools that read the tables back: its bytes in a dynamic buffer, and how it is filled. */
export type TableEntry = { readonly name: string; readonly buffer: Id; readonly offset: number; readonly vec4s: number; readonly lanes: number; readonly fill: TableFillKind };

export type Manifest = {
  readonly format: typeof FORMAT;
  readonly version: typeof FORMAT_VERSION;
  /** Chunk names (a hash of the text); a file loader reads `wgsl/<name>.wgsl`. */
  readonly chunks: readonly string[];
  /** Blob names; a file loader reads `bin/<name>.bin` (little-endian f32). */
  readonly blobs: readonly { readonly name: string; readonly bytes: number }[];

  readonly inputs: readonly InputSlot[];
  readonly inputFloats: number;
  readonly params: readonly ParamSlot[];
  readonly paramFloats: number;
  readonly cameras: Readonly<Record<string, Camera>>;
  /** The curve rows' buffer and its float count (a host may replace its contents: `setCurves`). */
  readonly curves: { readonly buffer: Id; readonly floats: number };

  readonly buffers: readonly BufferDesc[];
  readonly textures: readonly TextureDesc[];
  readonly samplers: readonly SamplerDesc[];
  readonly bindGroupLayouts: readonly BindGroupLayoutDesc[];
  readonly pipelineLayouts: readonly PipelineLayoutDesc[];
  readonly modules: readonly ModuleDesc[];
  readonly computePipelines: readonly ComputePipelineDesc[];
  readonly renderPipelines: readonly RenderPipelineDesc[];
  readonly bindGroups: readonly BindGroupDesc[];

  readonly frame: {
    readonly writes: readonly FrameWrite[];
    /** One compute pass, in order; empty: no pass. */
    readonly pose: readonly Dispatch[];
    readonly bounds: BoundsRead;
    /** `loft_detail`: the plan's slots, `floats` of them written after the plan. */
    readonly detail: { readonly buffer: Id; readonly floats: number };
    readonly passes: readonly RenderPassDesc[];
  };
  /** One entry per planned draw (`DrawCommand` "planned" indexes it). */
  readonly plan: readonly PlanDraw[];
  /** The buffers the per-frame tables live in (bind group 1's dynamic buffers), in binding order; buffer labels are their names. */
  readonly dynamic: readonly Id[];
  /** Every per-frame table. A file holds no `cpu` table (`loft build` refuses them by name). */
  readonly tables: readonly TableEntry[];
  readonly stats: { readonly maxTriangles: number; readonly draws: number; readonly curveRows: number; readonly stations: number };
};

/** A manifest with the texts and bytes it names: what `loft build` writes and a loader reads back. */
export type Bundle = {
  readonly manifest: Manifest;
  readonly chunks: ReadonlyMap<string, string>;
  readonly blobs: ReadonlyMap<string, Uint8Array>;
};

/** The output's format: a canvas drawn through `draw`, and the readback of `frame`, use it. */
export const COLOR_FORMAT: GPUTextureFormat = "rgba8unorm";
/** Formats and the sample count `lower` chooses (a loader reads them from the descriptors, not from here). */
export const DEPTH_FORMAT: GPUTextureFormat = "depth32float";
export const SCENE_DEPTH_FORMAT: GPUTextureFormat = "r32float";
export const SAMPLES = 4;

// `lower(artefact)`: the host's load-time decisions, made once and written down as WebGPU descriptors (src/host/manifest.ts,
// docs/artefact_format.md). Both the in-memory path (`createHost(device).load(artefact)`) and `loft build` go through
// here, and the executor (src/host/host.ts) runs the result; so a compiled scene and its files draw with the same
// objects. Every structural check on an artefact happens here, once; the executor trusts what passes.
//
// The passes, decided here from the artefact:
//   plain   no draw reads scene depth and there is no post: ONE multisampled pass, opaque then transparent, resolved
//           into the output.
//   split   some transparent draw sets `sceneDepth`, or there are post passes:
//             1. opaque pass: 4x colour and 4x depth, both stored, no resolve
//             2. depth resolve: a full-screen pass reads the 4x depth as texture_depth_multisampled_2d and writes the
//                nearest of each pixel's samples to a single-sampled r32float texture (SCENE_DEPTH_WGSL, group 2)
//          2a-2c. the clearance map (SCENE_CLEARANCE_WGSL): three passes drawing one fragment per 4 x 4 or 8 x 8 pixels
//                into the top left of view-sized textures: whether a cell holds an opaque pixel, then along each row
//                and down each column the distance to the nearest tile that does (docs/gpu_native.md "The sea")
//             3. transparent pass: loads the stored colour and depth (so transparent draws still depth-test, and may
//                still write depth), binds the resolved depth as group 2, resolves colour into the output, or into
//                the first intermediate when there are post passes
//             4. post passes, ping-ponging between two single-sampled intermediates; the last writes the output.
// Why a resolve into a separate texture rather than sampling the depth attachment itself during the transparent
// pass: sampling an attachment needs it read-only, which would forbid transparent draws that write depth; a
// multisampled depth binding would make every reader pick or average samples itself; and post passes need a
// single-sampled depth after the scene pass has ended anyway.
//
// Imports no bun-only module (the browser host uses it).

import { CLEARANCE_MAX, CLEARANCE_SCALE, CLEARANCE_TILE, CURVE_N, DETAIL_SLOTS, POSE_WORKGROUP, POST_WGSL, PRELUDE_WGSL, SCENE_CLEARANCE_WGSL, SCENE_DEPTH_WGSL, type Artefact, type Draw } from "../artefact.ts";
import { gridBounds, slotsUsed } from "./detail.ts";
import {
  COLOR_FORMAT, DEPTH_FORMAT, FORMAT, FORMAT_VERSION, SAMPLES, SCENE_DEPTH_FORMAT,
  type BindGroupDesc, type BindGroupLayoutDesc, type BufferDesc, type Bundle, type ComputePipelineDesc, type DrawCommand, type Id, type LayoutEntry,
  type Manifest, type ModuleDesc, type PipelineLayoutDesc, type RenderPassDesc, type RenderPipelineDesc, type SamplerDesc, type Stage, type TextureDesc,
} from "./manifest.ts";

const FLOATS = { f32: 1, vec2: 2, vec3: 3, vec4: 4 } as const;
/** Frame uniform: two mat4 then four vec4 (PRELUDE_WGSL `struct Frame`). */
export const FRAME_FLOATS = 16 + 16 + 4 * 4;
/** WebGPU rejects zero-sized bindings; an artefact with no inputs or params still binds a buffer of one vec4. */
const MIN_BUFFER_BYTES = 16;
const DRAWN: readonly Stage[] = ["VERTEX", "FRAGMENT"];
const ALL: readonly Stage[] = ["VERTEX", "FRAGMENT", "COMPUTE"];

// The nearest of each pixel's samples (SCENE_DEPTH_WGSL's comment says why the minimum and not the mean).
const DEPTH_RESOLVE_WGSL = /* wgsl */ `
@group(0) @binding(0) var depth_x4: texture_depth_multisampled_2d;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let uv = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let c = vec2<i32>(floor(p.xy));
  var d = textureLoad(depth_x4, c, 0);
  for (var i = 1; i < ${SAMPLES}; i++) { d = min(d, textureLoad(depth_x4, c, i)); }
  return vec4<f32>(d, 0.0, 0.0, 1.0);
}
`;

/**
 * The clearance map's passes (SCENE_CLEARANCE_WGSL), one module with entry points per pass. Each draws a rectangle
 * at the top left of its view-sized target (two triangles, sized from the input texture, which is view-sized too), one
 * fragment per cell of the pass's grid:
 *   quads: per 4 x 4 pixels, 1 where any of the 16 depths is an opaque surface (r8unorm)
 *   rows:  per 8 x 8 tile, along its row, the offset in tiles to the nearest tile holding an opaque pixel within 7, 8
 *          for none (r8unorm, k / 255; one gather of a tile's four quads per tile looked at)
 *   clear: down the column, min over offsets dy within 7 of sqrt(gap(k)^2 + gap(dy)^2), gap(d) = max(0, 8 |d| - 7) the
 *          gap between two tiles' nearest pixel centres d tiles apart, capped at CLEARANCE_MAX, stored divided by
 *          CLEARANCE_SCALE (r8unorm). The minimum over a column of row minima is the 2D minimum: the Euclidean
 *          distance transform is separable (Felzenszwalb and Huttenlocher), 30 reads per tile instead of 225.
 * A tile beyond 7 has a gap of at least 8 * 8 - 7 = 57, over the cap, so the bound holds without looking farther.
 * Reads are branch-free and independent, so they issue together, and clamped (a cell at the image's edge reads its own
 * last texels again; a tile read through a clamped index is counted at the offset asked for, never nearer than its
 * own, and is read at its own offset too). Measured: with one fragment per 8 x 8 tile reading 64 depths the first pass
 * was the largest (16,000 fragments too few to hide the reads' latency); per 4 x 4, four times as many fragments.
 */
const CLEARANCE_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var near: sampler;
const TILE: i32 = ${CLEARANCE_TILE};
const QUAD: i32 = ${CLEARANCE_TILE / 2};
const REACH: i32 = 7;
fn view() -> vec2<i32> { return vec2<i32>(textureDimensions(src)); }
fn cells(side: i32) -> vec2<i32> { return (view() + side - 1) / side; }
fn tiles() -> vec2<i32> { return cells(TILE); }
fn gap(d: i32) -> f32 { return max(0.0, f32(TILE * abs(d) - (TILE - 1))); }
fn cover(vi: u32, n: vec2<i32>) -> vec4<f32> {
  let c = vec2<f32>(select(0.0, 1.0, vi == 1u || vi == 2u || vi == 4u), select(0.0, 1.0, vi == 2u || vi == 4u || vi == 5u));
  let px = c * vec2<f32>(n) / vec2<f32>(view());
  return vec4<f32>(px.x * 2.0 - 1.0, 1.0 - px.y * 2.0, 0.0, 1.0);
}
@vertex fn quads_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> { return cover(vi, cells(QUAD)); }
@vertex fn tiles_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> { return cover(vi, tiles()); }
@fragment fn quads_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  // Four gathers of 2 x 2 depths, at the corners between them; clamp-to-edge repeats the image's last texels.
  let o = floor(p.xy) * f32(QUAD);
  let size = vec2<f32>(view());
  let m = min(min(textureGather(0, src, near, (o + vec2<f32>(1.0, 1.0)) / size), textureGather(0, src, near, (o + vec2<f32>(3.0, 1.0)) / size)),
              min(textureGather(0, src, near, (o + vec2<f32>(1.0, 3.0)) / size), textureGather(0, src, near, (o + vec2<f32>(3.0, 3.0)) / size)));
  return vec4<f32>(select(0.0, 1.0, min(min(m.x, m.y), min(m.z, m.w)) < 1.0), 0.0, 0.0, 1.0);
}
@fragment fn rows_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let t = vec2<i32>(floor(p.xy));
  let last = tiles() - 1;
  let size = vec2<f32>(view());
  var k = REACH + 1;
  for (var dx = -REACH; dx <= REACH; dx++) {
    // Tile s's four quads (quads past the image's edge were never drawn and read 0).
    let s = clamp(t + vec2<i32>(dx, 0), vec2<i32>(0), last);
    let q = textureGather(0, src, near, (vec2<f32>(s * 2) + 1.0) / size);
    let opaque = max(max(q.x, q.y), max(q.z, q.w)) > 0.5;
    k = min(k, select(REACH + 1, abs(dx), opaque));
  }
  // The tile offset, an integer, exact in 8 bits.
  return vec4<f32>(f32(k) / 255.0, 0.0, 0.0, 1.0);
}
@fragment fn clear_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
  let t = vec2<i32>(floor(p.xy));
  let last = tiles() - 1;
  var d2 = 1e8;
  for (var dy = -REACH; dy <= REACH; dy++) {
    let k = i32(round(textureLoad(src, clamp(t + vec2<i32>(0, dy), vec2<i32>(0), last), 0).x * 255.0));
    let gx = gap(k);
    d2 = min(d2, select(1e8, gx * gx + gap(dy) * gap(dy), k <= REACH));
  }
  return vec4<f32>(min(sqrt(d2), ${CLEARANCE_MAX}.0) / ${CLEARANCE_SCALE}.0, 0.0, 0.0, 1.0);
}
`;

const BLEND: Record<Draw["blend"], GPUBlendState | undefined> = {
  none: undefined,
  // Straight alpha over.
  alpha: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } },
  // Additive, scaled by the fragment's alpha (straight alpha, like `alpha`); the target's alpha is left as it is.
  add: { color: { srcFactor: "src-alpha", dstFactor: "one" }, alpha: { srcFactor: "zero", dstFactor: "one" } },
  // A shadow block's tone, lowered: colour untouched, alpha the lesser (WebGPU wants both factors "one" with min).
  "alpha-min": { color: { srcFactor: "zero", dstFactor: "one" }, alpha: { operation: "min", srcFactor: "one", dstFactor: "one" } },
  // The block printed: the target's alpha is how much of its colour stays; alpha is then the fragment's.
  "alpha-pull": { color: { srcFactor: "one-minus-dst-alpha", dstFactor: "dst-alpha" }, alpha: { srcFactor: "one", dstFactor: "zero" } },
};

/** Which host WGSL a shader module is compiled with. A shader used in two ways is compiled once per way. */
type Variant = "draw" | "sceneDepth" | "post";
const VARIANT: Record<Variant, { readonly wgsl: string; readonly named: string }> = {
  draw: { wgsl: "", named: "" },
  sceneDepth: { wgsl: SCENE_DEPTH_WGSL + SCENE_CLEARANCE_WGSL, named: " (with SCENE_DEPTH_WGSL and SCENE_CLEARANCE_WGSL)" },
  post: { wgsl: POST_WGSL, named: " (as a post pass, with POST_WGSL)" },
};
const drawVariant = (d: Draw): Variant => (d.sceneDepth === true ? "sceneDepth" : "draw");

/** Every structural check on an artefact; returns the params' float count. */
export function checkArtefact(a: Artefact): { paramFloats: number } {
  const fail = (msg: string): never => { throw new Error(`artefact: ${msg}`); };
  if (a.version !== 1) fail(`unsupported version ${a.version}`);
  for (const s of a.inputs) {
    if (s.def.length !== FLOATS[s.ty]) fail(`input "${s.name}" is ${s.ty} but its default has ${s.def.length} floats`);
    if (s.slot < 0 || s.slot + FLOATS[s.ty] > a.inputFloats) fail(`input "${s.name}" at slot ${s.slot} overruns inputFloats = ${a.inputFloats}`);
  }
  const paramFloats = a.params.reduce((n, p) => Math.max(n, p.slot + 1), 0);
  const seen = new Set<number>();
  for (const p of a.params) {
    if (seen.has(p.slot)) fail(`param "${p.name}" reuses slot ${p.slot}`);
    seen.add(p.slot);
  }
  if (a.curves.length % (CURVE_N * 4) !== 0) fail(`curves has ${a.curves.length} floats, not a multiple of CURVE_N * 4 = ${CURVE_N * 4}`);
  const names = new Set<string>(), bindings = new Set<number>();
  for (const d of a.dynamic) {
    if (names.has(d.name)) fail(`dynamic buffer "${d.name}" declared twice`);
    if (bindings.has(d.binding)) fail(`dynamic buffer "${d.name}" reuses binding ${d.binding}`);
    if (!(d.vec4s > 0)) fail(`dynamic buffer "${d.name}" has ${d.vec4s} vec4s`);
    names.add(d.name); bindings.add(d.binding);
  }
  for (const d of a.statics ?? []) {
    if (names.has(d.name)) fail(`static buffer "${d.name}" declared twice`);
    if (bindings.has(d.binding)) fail(`static buffer "${d.name}" reuses binding ${d.binding}`);
    if (!(d.data.length > 0 && d.data.length % 4 === 0)) fail(`static buffer "${d.name}" has ${d.data.length} floats (a positive multiple of 4)`);
    names.add(d.name); bindings.add(d.binding);
  }
  for (const d of a.draws) {
    if (!(d.shader in a.shaders)) fail(`draw "${d.label}" names unknown shader "${d.shader}"`);
    // Opaque draws are what scene depth is made of; one cannot read it while it is being written.
    if (d.sceneDepth === true && d.pass === "opaque") fail(`draw "${d.label}" sets sceneDepth but is opaque; only transparent draws can read the opaque scene's depth`);
  }
  const bySlot = new Map<number, string>();
  for (const d of a.draws) {
    const detail = d.detail;
    switch (detail.kind) {
      case "fixed": break;
      case "grid": {
        const buf = a.dynamic.find((b) => b.name === detail.bound.buffer);
        if (!buf) fail(`draw "${d.label}" reads its bounds from "${detail.bound.buffer}", which is not a dynamic buffer`);
        if (detail.bound.offset + d.instances > buf!.vec4s) fail(`draw "${d.label}": its bounds overrun "${detail.bound.buffer}"`);
        if (detail.levels.length === 0 || detail.levels[0]!.vertices !== d.vertices) fail(`draw "${d.label}": its finest level must have the draw's ${d.vertices} vertices`);
        if (detail.slot + d.instances > DETAIL_SLOTS) fail(`draw "${d.label}": slots ${detail.slot}..${detail.slot + d.instances} exceed ${DETAIL_SLOTS}`);
        break;
      }
      case "projected":
        if (detail.slot + 2 > DETAIL_SLOTS) fail(`draw "${d.label}": slot ${detail.slot} exceeds ${DETAIL_SLOTS}`);
        break;
    }
    // A slot is one choice: draws sharing it (a surface and its ink) must describe the same detail.
    if (detail.kind !== "fixed") {
      const key = JSON.stringify(detail), seen = bySlot.get(detail.slot);
      if (seen !== undefined && seen !== key) fail(`draw "${d.label}" shares level-of-detail slot ${detail.slot} with a draw whose detail differs`);
      bySlot.set(detail.slot, key);
    }
  }
  for (const p of a.post ?? []) if (!(p.shader in a.shaders)) fail(`post pass "${p.label}" names unknown shader "${p.shader}"`);
  for (const st of a.stages) if (!(Number.isInteger(st.invocations) && st.invocations >= 1)) fail(`pose stage "${st.label}" has ${st.invocations} invocations`);
  const sizes = new Map(a.dynamic.map((d) => [d.name, d.vec4s]));
  for (const t of a.tables) {
    const size = sizes.get(t.buffer);
    if (size === undefined) fail(`table "${t.name}" lives in "${t.buffer}", which is not a dynamic buffer`);
    if (t.offset < 0 || t.offset + t.vec4s > size!) fail(`table "${t.name}" overruns "${t.buffer}"`);
  }
  return { paramFloats };
}

/**
 * A chunk's name: 64 bits of two FNV-1a hashes of its UTF-16 code units, hex. Only names within one artefact must
 * differ, and `lower` checks that two different texts never share a name. Pure JavaScript (the browser host uses it).
 */
function chunkName(text: string): string {
  let a = 0x811c9dc5, b = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** A list that hands out ids. */
class List<T> {
  readonly items: T[] = [];
  add(x: T): Id { return this.items.push(x) - 1; }
}

export function lower(a: Artefact): Bundle {
  const { paramFloats } = checkArtefact(a);
  const post = a.post ?? []; // absent means none (artefact.ts)
  const statics = a.statics ?? [];

  const chunkNames: string[] = [], chunkIds = new Map<string, Id>(), chunkText = new Map<string, string>();
  const chunk = (text: string): Id => {
    const name = chunkName(text);
    const known = chunkIds.get(name);
    if (known !== undefined) {
      if (chunkText.get(name) !== text) throw new Error(`lower: two different WGSL texts hash to chunk ${name}`);
      return known;
    }
    chunkText.set(name, text);
    chunkIds.set(name, chunkNames.length);
    return chunkNames.push(name) - 1;
  };
  const blobs = new Map<string, Uint8Array>();
  const blob = (name: string, data: Float32Array): string => {
    blobs.set(name, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return name;
  };

  const buffers = new List<BufferDesc>(), textures = new List<TextureDesc>(), samplers = new List<SamplerDesc>();
  const bgls = new List<BindGroupLayoutDesc>(), pls = new List<PipelineLayoutDesc>(), modules = new List<ModuleDesc>();
  const computes = new List<ComputePipelineDesc>(), renders = new List<RenderPipelineDesc>(), groups = new List<BindGroupDesc>();
  const buffer = (label: string, bytes: number, usage: BufferDesc["usage"], init?: string): Id =>
    buffers.add({ label, size: Math.max(MIN_BUFFER_BYTES, bytes), usage, ...(init === undefined ? {} : { init }) });

  // ---- buffers --------------------------------------------------------------------------------------------------
  const STORAGE = ["STORAGE", "COPY_DST"] as const;
  const frameBuf = buffer("frame", FRAME_FLOATS * 4, ["UNIFORM", "COPY_DST"]);
  const inputBuf = buffer("inputs", a.inputFloats * 4, STORAGE);
  const paramBuf = buffer("params", paramFloats * 4, STORAGE);
  const curveBuf = buffer("curves", a.curves.byteLength, STORAGE, a.curves.length > 0 ? blob("curves", a.curves) : undefined);
  const detailBuf = buffer("loft_detail", DETAIL_SLOTS * 16, ["UNIFORM", "COPY_DST"]);
  // Dynamic buffers are also copied from: the level-of-detail bounds and `readTables` read them back.
  const dynamic = a.dynamic.map((d) => ({ binding: d.binding, name: d.name, id: buffer(d.name, d.vec4s * 16, ["STORAGE", "COPY_DST", "COPY_SRC"]) }));
  const staticBufs = statics.map((d) => ({ binding: d.binding, id: buffer(d.name, d.data.byteLength, STORAGE, blob(d.name, d.data)) }));
  const group1Buffers = [...dynamic, ...staticBufs];
  const bufferOf = new Map(dynamic.map((d) => [d.name, d.id]));

  // ---- layouts ----------------------------------------------------------------------------------------------------
  // Explicit layouts, every binding visible to both stages (artefact.ts header): a shader may use any subset, and
  // `layout: "auto"` would drop the bindings a particular shader never reads. Group 0 is also bound to the pose stages.
  const storage = (binding: number, visibility: readonly Stage[]): LayoutEntry => ({ binding, visibility, buffer: { type: "read-only-storage" } });
  const layout0 = bgls.add({
    label: "loft prelude",
    entries: [{ binding: 0, visibility: ALL, buffer: { type: "uniform" } }, storage(1, ALL), storage(2, ALL), storage(3, ALL), { binding: 4, visibility: ALL, buffer: { type: "uniform" } }],
  });
  const layout1 = bgls.add({ label: "loft scene tables", entries: group1Buffers.map((d) => storage(d.binding, DRAWN)) });
  // The pose stages' group 1: the dynamic buffers writable, the static ones read-only (PoseStage).
  const poseLayout1 = bgls.add({
    label: "loft pose tables",
    entries: [...dynamic.map((d): LayoutEntry => ({ binding: d.binding, visibility: ["COMPUTE"], buffer: { type: "storage" } })), ...staticBufs.map((d) => storage(d.binding, ["COMPUTE"]))],
  });
  const group0 = groups.add({ label: "loft prelude", layout: layout0, entries: [frameBuf, inputBuf, paramBuf, curveBuf, detailBuf].map((b, binding) => ({ binding, buffer: b })) });
  const group1 = groups.add({ label: "loft scene tables", layout: layout1, entries: group1Buffers.map((d) => ({ binding: d.binding, buffer: d.id })) });
  const poseGroup1 = groups.add({ label: "loft pose tables", layout: poseLayout1, entries: group1Buffers.map((d) => ({ binding: d.binding, buffer: d.id })) });

  const split = post.length > 0 || a.draws.some((d) => d.sceneDepth === true);
  // Group 2 layouts: exactly the ones documented on SCENE_DEPTH_WGSL and POST_WGSL; only a split frame has them.
  const sceneDepthEntry: LayoutEntry = { binding: 0, visibility: DRAWN, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } };
  const clearanceEntry: LayoutEntry = { binding: 1, visibility: DRAWN, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } };
  const depthLayout = split ? bgls.add({ label: "loft scene depth", entries: [sceneDepthEntry, clearanceEntry] }) : -1;
  const postLayout = split ? bgls.add({
    label: "loft post",
    entries: [
      sceneDepthEntry,
      { binding: 1, visibility: DRAWN, texture: { sampleType: "float", viewDimension: "2d", multisampled: false } },
      { binding: 2, visibility: DRAWN, sampler: { type: "filtering" } },
    ],
  }) : -1;
  const pipelineLayout = new Map<Variant, Id>();
  const layoutOf = (v: Variant): Id => {
    const known = pipelineLayout.get(v);
    if (known !== undefined) return known;
    const third: Record<Variant, Id[]> = { draw: [], sceneDepth: [depthLayout], post: [postLayout] };
    const id = pls.add({ label: `loft ${v}`, bindGroupLayouts: [layout0, layout1, ...third[v]] });
    pipelineLayout.set(v, id);
    return id;
  };

  // ---- the pose stages ---------------------------------------------------------------------------------------------
  const preludeChunk = chunk(PRELUDE_WGSL);
  const poseLayout = a.stages.length > 0 ? pls.add({ label: "loft pose", bindGroupLayouts: [layout0, poseLayout1] }) : -1;
  const pose = a.stages.map((st) => {
    const module = modules.add({ label: `pose stage "${st.label}"`, chunks: [preludeChunk, chunk(st.wgsl)] });
    const pipeline = computes.add({ label: st.label, layout: poseLayout, module, entryPoint: "pose_main" });
    return { label: st.label, pipeline, bindGroups: [group0, poseGroup1], workgroups: Math.ceil(st.invocations / POSE_WORKGROUP) };
  });

  // ---- modules and render pipelines ---------------------------------------------------------------------------------
  // One module per (shader, way it is used). A shader nothing uses is not written: which host WGSL it expects depends on
  // its use (a post shader does not compile as a draw), so there is nothing sound to check it against.
  const sceneChunk = chunk(a.sceneWgsl);
  const moduleIds = new Map<string, Id>();
  const moduleOf = (shader: string, v: Variant): Id => {
    const key = `${shader}|${v}`;
    const known = moduleIds.get(key);
    if (known !== undefined) return known;
    const variant = VARIANT[v].wgsl === "" ? [] : [chunk(VARIANT[v].wgsl)];
    const id = modules.add({ label: `shader "${shader}"${VARIANT[v].named}`, chunks: [preludeChunk, ...variant, sceneChunk, chunk(a.shaders[shader]!)] });
    moduleIds.set(key, id);
    return id;
  };
  // Equal descriptors are one pipeline.
  const pipelineIds = new Map<string, Id>();
  const drawPipeline = (d: Draw): Id => {
    const v = drawVariant(d);
    const module = moduleOf(d.shader, v);
    const blend = BLEND[d.blend];
    const desc: RenderPipelineDesc = {
      label: `${d.shader} (${d.label})`,
      layout: layoutOf(v),
      vertex: { module, entryPoint: "vs", constants: { ...d.constants } },
      fragment: { module, entryPoint: "fs", constants: { ...d.constants }, targets: [blend ? { format: COLOR_FORMAT, blend } : { format: COLOR_FORMAT }] },
      primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: d.cull },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: d.depthWrite, depthCompare: "less" },
      multisample: { count: SAMPLES },
    };
    const constants = Object.keys(d.constants).sort().map((k) => `${k}=${d.constants[k]}`).join(",");
    const key = `${d.shader}|${v}|${d.cull}|${d.blend}|${d.depthWrite}|${constants}`;
    const known = pipelineIds.get(key);
    if (known !== undefined) return known;
    const id = renders.add(desc);
    pipelineIds.set(key, id);
    return id;
  };
  const planned = (pass: Draw["pass"]): DrawCommand[] =>
    a.draws.flatMap((d, draw) => (d.pass === pass ? [{ kind: "planned" as const, pipeline: drawPipeline(d), draw }] : []));
  const opaque = planned("opaque"), transparent = planned("transparent");
  const clearValue = [a.clear[0], a.clear[1], a.clear[2], 1] as const;

  // ---- the passes ---------------------------------------------------------------------------------------------------
  const RA = "RENDER_ATTACHMENT", TB = "TEXTURE_BINDING";
  const colour = textures.add({ label: "loft colour x4", format: COLOR_FORMAT, sampleCount: SAMPLES, usage: [RA] });
  const passes: RenderPassDesc[] = [];
  if (!split) {
    const depth = textures.add({ label: "loft depth x4", format: DEPTH_FORMAT, sampleCount: SAMPLES, usage: [RA] });
    passes.push({
      label: "loft scene",
      color: { view: { kind: "texture", texture: colour }, resolveTarget: { kind: "output" }, loadOp: "clear", storeOp: "discard", clearValue },
      depth: { view: depth, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
      bindGroups: [group0, group1],
      commands: [...opaque, ...transparent],
    });
  } else {
    const depth = textures.add({ label: "loft depth x4", format: DEPTH_FORMAT, sampleCount: SAMPLES, usage: [RA, TB] });
    const sceneDepth = textures.add({ label: "loft scene depth", format: SCENE_DEPTH_FORMAT, sampleCount: 1, usage: [RA, TB] });
    const resolveLayout = bgls.add({
      label: "loft depth resolve",
      entries: [{ binding: 0, visibility: ["FRAGMENT"], texture: { sampleType: "depth", viewDimension: "2d", multisampled: true } }],
    });
    const resolveModule = modules.add({ label: "loft depth resolve", chunks: [chunk(DEPTH_RESOLVE_WGSL)] });
    const fullScreen = (label: string, layout: Id, module: Id, vs: string, format: GPUTextureFormat, fs = "fs"): Id => renders.add({
      label, layout,
      vertex: { module, entryPoint: vs, constants: {} },
      fragment: { module, entryPoint: fs, constants: {}, targets: [{ format }] },
      primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "none" },
      multisample: { count: 1 },
    });
    const resolve = fullScreen("loft depth resolve", pls.add({ label: "loft depth resolve", bindGroupLayouts: [resolveLayout] }), resolveModule, "vs", SCENE_DEPTH_FORMAT);
    const postPipelines = post.map((p) => fullScreen(`${p.shader} (${p.label})`, layoutOf("post"), moduleOf(p.shader, "post"), "post_vs", COLOR_FORMAT));
    const sampler = samplers.add({ label: "loft post", magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    const resolveGroup = groups.add({ label: "loft depth resolve", layout: resolveLayout, entries: [{ binding: 0, texture: depth }] });
    // The clearance map: three passes, each reading the previous one's texture (CLEARANCE_WGSL).
    const clearanceInput = bgls.add({
      label: "loft clearance input",
      entries: [{ binding: 0, visibility: DRAWN, texture: { sampleType: "unfilterable-float", viewDimension: "2d", multisampled: false } }, { binding: 1, visibility: DRAWN, sampler: { type: "non-filtering" } }],
    });
    const nearest = samplers.add({ label: "loft clearance", magFilter: "nearest", minFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    const clearanceLayout = pls.add({ label: "loft clearance", bindGroupLayouts: [clearanceInput] });
    const clearanceModule = modules.add({ label: "loft clearance", chunks: [chunk(CLEARANCE_WGSL)] });
    const clearanceSteps = ([["quads", "quads_vs"], ["rows", "tiles_vs"], ["clear", "tiles_vs"]] as const).map(([step, vs]) => ({
      step,
      texture: textures.add({ label: `loft clearance ${step}`, format: "r8unorm", sampleCount: 1, usage: [RA, TB] }),
      pipeline: fullScreen(`loft clearance ${step}`, clearanceLayout, clearanceModule, vs, "r8unorm", `${step}_fs`),
    }));
    const clearance = clearanceSteps[2]!.texture;
    const depthGroup = groups.add({ label: "loft scene depth", layout: depthLayout, entries: [{ binding: 0, texture: sceneDepth }, { binding: 1, texture: clearance }] });
    // Ping-pong: pass k reads intermediate (k - 1) % 2 and writes k % 2; one post pass needs one intermediate.
    const n = post.length;
    const intermediates = Array.from({ length: Math.min(n, 2) }, (_, i) => {
      const texture = textures.add({ label: `loft post ${i}`, format: COLOR_FORMAT, sampleCount: 1, usage: [RA, TB] });
      const group = groups.add({ label: `loft post input ${i}`, layout: postLayout, entries: [{ binding: 0, texture: sceneDepth }, { binding: 1, texture }, { binding: 2, sampler }] });
      return { texture, group };
    });
    /** Stage 0 is the scene; stage k >= 1 is post pass k - 1. The last stage writes the output. */
    const outputOf = (k: number) => (k === n ? { kind: "output" as const } : { kind: "texture" as const, texture: intermediates[k % 2]!.texture });
    passes.push({
      label: "loft scene opaque",
      color: { view: { kind: "texture", texture: colour }, loadOp: "clear", storeOp: "store", clearValue },
      depth: { view: depth, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
      bindGroups: [group0, group1],
      commands: opaque,
    }, {
      label: "loft depth resolve",
      color: { view: { kind: "texture", texture: sceneDepth }, loadOp: "clear", storeOp: "store", clearValue: [1, 0, 0, 1] },
      bindGroups: [resolveGroup],
      commands: [{ kind: "fixed", pipeline: resolve, vertices: 3, instances: 1 }],
    }, ...clearanceSteps.map((s, i): RenderPassDesc => ({
      label: `loft clearance ${s.step}`,
      color: { view: { kind: "texture", texture: s.texture }, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] },
      bindGroups: [groups.add({ label: `loft clearance ${s.step} input`, layout: clearanceInput, entries: [{ binding: 0, texture: i === 0 ? sceneDepth : clearanceSteps[i - 1]!.texture }, { binding: 1, sampler: nearest }] })],
      commands: [{ kind: "fixed", pipeline: s.pipeline, vertices: 6, instances: 1 }],
    })), {
      label: "loft scene transparent",
      color: { view: { kind: "texture", texture: colour }, resolveTarget: outputOf(0), loadOp: "load", storeOp: "discard" },
      depth: { view: depth, depthLoadOp: "load", depthStoreOp: "discard" },
      // Group 2 is ignored by pipelines whose layout stops at group 1.
      bindGroups: [group0, group1, depthGroup],
      commands: transparent,
    }, ...postPipelines.map((pipeline, i): RenderPassDesc => {
      const k = i + 1;
      return {
        label: `loft post ${i}`,
        color: { view: outputOf(k), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] },
        bindGroups: [group0, group1, intermediates[(k - 1) % 2]!.group],
        commands: [{ kind: "fixed", pipeline, vertices: 3, instances: 1 }],
      };
    }));
  }

  // ---- level-of-detail bounds ---------------------------------------------------------------------------------------
  const grids = gridBounds(a.draws);
  let at = 0;
  const copies = grids.map((g) => {
    const c = { slot: g.slot, from: bufferOf.get(g.buffer)!, fromOffset: g.offset * 16, at, instances: g.instances };
    at += g.instances;
    return c;
  });
  const bounds: Manifest["frame"]["bounds"] = grids.length === 0
    ? { kind: "none" }
    : { kind: "read", buffer: buffer("loft bounds", at * 16, ["MAP_READ", "COPY_DST"]), grids: copies };

  const manifest: Manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    chunks: chunkNames,
    blobs: [...blobs].map(([name, b]) => ({ name, bytes: b.byteLength })),
    inputs: a.inputs,
    inputFloats: a.inputFloats,
    params: a.params,
    paramFloats,
    cameras: a.cameras,
    curves: { buffer: curveBuf, floats: a.curves.length },
    buffers: buffers.items,
    textures: textures.items,
    samplers: samplers.items,
    bindGroupLayouts: bgls.items,
    pipelineLayouts: pls.items,
    modules: modules.items,
    computePipelines: computes.items,
    renderPipelines: renders.items,
    bindGroups: groups.items,
    frame: {
      writes: [{ kind: "frame", buffer: frameBuf }, { kind: "inputs", buffer: inputBuf }, { kind: "params", buffer: paramBuf }],
      pose,
      bounds,
      // Only the slots the artefact uses are written each frame (the rest of the 64 KiB array is never read).
      detail: { buffer: detailBuf, floats: Math.max(4, slotsUsed(a.draws) * 4) },
      passes,
    },
    dynamic: dynamic.map((d) => d.id),
    plan: a.draws.map((d) => ({ label: d.label, layer: d.layer, vertices: d.vertices, instances: d.instances, detail: d.detail })),
    tables: a.tables.map((t) => ({ name: t.name, buffer: bufferOf.get(t.buffer)!, offset: t.offset, vec4s: t.vec4s, lanes: t.lanes, fill: t.fill })),
    stats: a.stats,
  };
  return { manifest, chunks: new Map(chunkNames.map((name) => [name, chunkText.get(name)!])), blobs };
}

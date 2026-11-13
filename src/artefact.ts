// The contract between the compiler and a host.
//
// The compiler turns a scene description into an `Artefact`: shader source, tables of numbers, a draw list and a pose
// function. A host draws an Artefact and knows nothing about creatures, curves or charts. Today the host is
// TypeScript on WebGPU (browser, and bun headless); the same contract is what a Rust/wgpu host inside a game would
// implement. Anything a host must know is in this file.
//
// Conventions a host can rely on, and a compiler must follow:
// - World: y is up, the sea is near y = 0, units are arbitrary (a small ship is about 5 long).
// - Clip space is WebGPU's: depth 0 near, 1 far. Front faces wind counter-clockwise.
// - Colour: shaders write display-referred sRGB values to an `rgba8unorm` target. No automatic conversion anywhere.
// - Every draw is "V vertices x I instances" with no vertex buffers. The vertex shader derives everything from
//   `@builtin(vertex_index)` and `@builtin(instance_index)` and the bound tables.
// - Bind group 0 is the same for every artefact (PRELUDE_WGSL below). Bind group 1 is declared by the artefact
//   (`sceneWgsl`) and holds its per-frame tables. Hosts build EXPLICIT bind group layouts for both groups, with
//   every binding visible to vertex and fragment stages, because a shader may use any subset.

import type { NumTy } from "./expr.ts";

/** Samples per table-backed curve row. Each sample is a vec4. */
export const CURVE_N = 64;

/**
 * Slots in the level-of-detail table (`loft_detail`, group 0 binding 4): a uniform array of vec4, 64 KiB, the default
 * `maxUniformBufferBindingSize`. A uniform, not a storage buffer, so the per-stage storage budget stays the tables'.
 */
export const DETAIL_SLOTS = 4096;

/** Prepended by the host to every shader module, before `Artefact.sceneWgsl` and the shader itself. */
export const PRELUDE_WGSL = /* wgsl */ `
struct Frame {
  view_proj: mat4x4<f32>,
  inv_view_proj: mat4x4<f32>,
  eye: vec4<f32>,       // xyz: eye position in world space. w: 1 perspective, 0 orthographic
  forward: vec4<f32>,   // xyz: unit view direction (the ray direction for an orthographic camera)
  viewport: vec4<f32>,  // width, height, 1 / width, 1 / height, in pixels
  time: vec4<f32>,      // x: seconds
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> inputs: array<f32>;        // host inputs, by slot
@group(0) @binding(2) var<storage, read> params: array<f32>;        // tunable numbers, by slot
@group(0) @binding(3) var<storage, read> curves: array<vec4<f32>>;  // rows of CURVE_N samples
@group(0) @binding(4) var<uniform> loft_detail: array<vec4<f32>, ${DETAIL_SLOTS}>;  // per-frame level of detail (Draw.detail)

const CURVE_N: u32 = ${CURVE_N}u;
/// Sample curve row \`r\` at x in [0, 1]: linear interpolation, clamped at the ends.
fn curve(r: u32, x: f32) -> vec4<f32> {
  let s = clamp(x, 0.0, 1.0) * f32(CURVE_N - 1u);
  let i = min(u32(floor(s)), CURVE_N - 2u);
  return mix(curves[r * CURVE_N + i], curves[r * CURVE_N + i + 1u], s - f32(i));
}
/// Unit direction from the eye toward a world point (the camera's forward direction when orthographic).
fn view_dir(world: vec3<f32>) -> vec3<f32> {
  return normalize(mix(frame.forward.xyz, world - frame.eye.xyz, frame.eye.w));
}
`;

/**
 * Prepended by the host to the shader of a draw with `sceneDepth` set, right after PRELUDE_WGSL (it reads `frame`)
 * and before `Artefact.sceneWgsl`.
 *
 * Binding layout (a second host must match it exactly):
 *   @group(2) @binding(0)  texture_2d<f32>, format r32float, sample type unfilterable-float, single-sampled,
 *                          view size = view size, visible to vertex and fragment stages.
 * Contents: the opaque scene's depth, resolved after the opaque draws and before the transparent ones. The scene is
 * drawn 4x multisampled; each texel holds the MINIMUM (nearest) of the pixel's four depth samples, so a pixel that
 * any opaque surface touches reports a depth that really exists on that surface. (An average would invent depths
 * between a silhouette and what lies behind it: false foam and doubled ink lines along every edge.) The price is up to
 * half a pixel of offset on a sloped surface. Pixels no opaque draw covers hold 1 (the cleared depth).
 * Transparent draws with depth writes do not change it: it is the OPAQUE scene only.
 *
 * `px` is in pixels as in `@builtin(position).xy` (pixel centres at +0.5, y down). It is clamped to the image, so a
 * neighbour lookup at the border repeats the edge pixel instead of reading out of bounds.
 * `scene_position` reconstructs with `frame.inv_view_proj`; where scene_depth is 1 it returns a point on the far plane.
 */
export const SCENE_DEPTH_WGSL = /* wgsl */ `
@group(2) @binding(0) var loft_scene_depth: texture_2d<f32>;

/// Opaque scene depth at pixel px: 0 near to 1 far; 1 where no opaque surface is.
fn scene_depth(px: vec2<f32>) -> f32 {
  let size = vec2<i32>(textureDimensions(loft_scene_depth));
  return textureLoad(loft_scene_depth, clamp(vec2<i32>(floor(px)), vec2<i32>(0), size - 1), 0).x;
}
/// World position of the opaque surface seen at pixel px (on the far plane where there is none).
fn scene_position(px: vec2<f32>) -> vec3<f32> {
  let ndc = vec2<f32>(px.x * frame.viewport.z * 2.0 - 1.0, 1.0 - px.y * frame.viewport.w * 2.0);
  let h = frame.inv_view_proj * vec4<f32>(ndc, scene_depth(px), 1.0);
  return h.xyz / h.w;
}
`;

/** Side of the clearance map's tiles, pixels (SCENE_CLEARANCE_WGSL). */
export const CLEARANCE_TILE = 8;
/** The clearance map's largest value: what it reports where no opaque tile lies within 7 tiles (8 * 8 - 7 = 57 > 49). */
export const CLEARANCE_MAX = 49;
/** The clearance map stores clearance / CLEARANCE_SCALE in r8unorm: steps of 0.25 pixel, rounded to the nearest. */
export const CLEARANCE_SCALE = 64;

/**
 * Prepended by the host to the shader of a draw with `sceneDepth` set, after SCENE_DEPTH_WGSL (not to post passes).
 *
 * Binding layout (a second host must match it exactly):
 *   @group(2) @binding(1)  texture_2d<f32>, format r8unorm, sample type unfilterable-float, single-sampled, view
 *                          size, visible to vertex and fragment stages; only its top-left ceil(w / 8) x ceil(h / 8)
 *                          texels are meaningful.
 * Contents: texel (i, j) is the clearance of the 8 x 8 tile of pixels it stands for: a lower bound on the distance, in
 * pixels, from the centre of any pixel of the tile to the centre of any pixel where scene_depth < 1, exact on the tile
 * grid (min over such tiles of sqrt(gx^2 + gy^2), gx = max(0, 8 |di| - 7) the gap between the two tiles' nearest pixel
 * centres), capped at CLEARANCE_MAX, stored as clearance / CLEARANCE_SCALE. `scene_clearance` takes off the half step
 * the 8-bit store may have rounded up. Written from the resolved depth by two passes after the depth resolve
 * (src/host/lower.ts). A reader that looks at scene depth only within distance d of px may skip the looking where
 * scene_clearance(px) > d: nothing opaque is there (the sea's contact band, src/geom/sea.ts).
 */
export const SCENE_CLEARANCE_WGSL = /* wgsl */ `
@group(2) @binding(1) var loft_scene_clearance: texture_2d<f32>;

/// Lower bound on the distance in pixels from pixel px to any opaque pixel (at most ${CLEARANCE_MAX}.0).
fn scene_clearance(px: vec2<f32>) -> f32 {
  let size = vec2<i32>(textureDimensions(loft_scene_depth));
  let c = textureLoad(loft_scene_clearance, clamp(vec2<i32>(floor(px)), vec2<i32>(0), size - 1) / ${CLEARANCE_TILE}, 0).x;
  return c * ${CLEARANCE_SCALE}.0 - ${(0.5 / 255) * CLEARANCE_SCALE + 0.005};
}
`;

/**
 * Prepended by the host to the shader of every post pass, right after PRELUDE_WGSL and before `Artefact.sceneWgsl`.
 * It includes SCENE_DEPTH_WGSL (same group 2 binding 0, same contents), so a post shader has `scene_depth` and
 * `scene_position` too, and it supplies the vertex stage. The artefact's module defines only
 *   @fragment fn fs(in: PostIn) -> @location(0) vec4<f32>
 * where `in.px` is `@builtin(position)` and `in.uv` the matching uv (0..1, v down).
 *
 * Binding layout (a second host must match it exactly), all visible to vertex and fragment stages:
 *   @group(2) @binding(0)  texture_2d<f32>, r32float, unfilterable-float: the opaque scene depth (see SCENE_DEPTH_WGSL)
 *   @group(2) @binding(1)  texture_2d<f32>, rgba8unorm, filterable float, single-sampled: the picture so far (the
 *                          resolved scene for the first pass, the previous pass's output after that)
 *   @group(2) @binding(2)  sampler, filtering: linear min/mag, clamp-to-edge on u and v, no mipmaps
 * The vertex stage is `post_vs`: one triangle of 3 vertices covering the viewport, no culling, no depth, no blending.
 * Groups 0 and 1 are bound as for draws. The output target is rgba8unorm, single-sampled, view-sized; the last
 * pass writes the frame. `post_color` at a pixel centre returns that pixel exactly (bilinear weights are 1 and 0).
 */
export const POST_WGSL = /* wgsl */ `${SCENE_DEPTH_WGSL}
@group(2) @binding(1) var loft_post_colour: texture_2d<f32>;
@group(2) @binding(2) var loft_post_sampler: sampler;

struct PostIn { @builtin(position) px: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex fn post_vs(@builtin(vertex_index) vi: u32) -> PostIn {
  // (0,0), (2,0), (0,2) in uv: one triangle whose inside covers the whole viewport.
  let uv = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  return PostIn(vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0), uv);
}
/// The picture so far at uv (0..1, v down), bilinearly filtered, clamped at the edges.
fn post_color(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(loft_post_colour, loft_post_sampler, uv, 0.0);
}
`;

export type Camera =
  | { readonly kind: "perspective"; readonly eye: readonly [number, number, number]; readonly target: readonly [number, number, number]; readonly fovY: number }
  | { readonly kind: "orthographic"; readonly eye: readonly [number, number, number]; readonly target: readonly [number, number, number]; readonly height: number };

/** `slot` is a float offset into the `inputs` array; an input occupies as many floats as its type has components. */
export type InputSlot = { readonly name: string; readonly ty: NumTy; readonly slot: number; readonly def: readonly number[] };
/** `slot` is a float offset into the `params` array. `min` and `max` are for editors: a host does not clamp. */
export type ParamSlot = { readonly name: string; readonly slot: number; readonly def: number; readonly min: number; readonly max: number };

/** A per-frame table in bind group 1, declared in `sceneWgsl` as `var<storage, read> NAME: array<vec4<f32>>`. */
export type DynamicBuffer = { readonly name: string; readonly binding: number; readonly vec4s: number };
/**
 * A table filled once, when the artefact was compiled (a distance brick, a sculpt layer, a mesh), in bind group 1 beside
 * the dynamic buffers (bindings distinct from theirs), declared in `sceneWgsl` the same way. The host uploads `data`
 * once, at load; the pose function never returns it.
 */
export type StaticBuffer = { readonly name: string; readonly binding: number; readonly data: Float32Array };

/** Invocations per workgroup of every pose stage's `pose_main`. */
export const POSE_WORKGROUP = 64;

/**
 * One compute dispatch of the pose pass (docs/gpu_native.md, phase 1): the tables of one level, each filled by its
 * program. The module (`wgsl`, compiled after PRELUDE_WGSL) declares bind group 1 itself, with the dynamic buffers as
 * `var<storage, read_write>` and the static ones as `var<storage, read>`, at the same bindings as `sceneWgsl`; its
 * entry point is `@compute @workgroup_size(POSE_WORKGROUP) fn pose_main(@builtin(global_invocation_id) g: vec3<u32>)`.
 * The host dispatches `ceil(invocations / POSE_WORKGROUP)` workgroups (x only). Stages run in list order, after the
 * frame's inputs, params, curves and `cpu` tables are written, before any draw; a stage reads what earlier ones wrote.
 * Bind group 0 is the prelude's, also visible to the compute stage.
 */
export type PoseStage = { readonly label: string; readonly wgsl: string; readonly invocations: number };

/** How a per-frame table is filled: on the GPU by a map or a scan (at `level`, an index into `stages`), or on the CPU. */
export type TableFillKind =
  | { readonly kind: "map"; readonly level: number }
  | { readonly kind: "scan"; readonly level: number }
  /** `why`: the table's own reason (a hand-written fill), or the GPU table that reads it ("read by ..."). */
  | { readonly kind: "cpu"; readonly why: string };

/** Where a per-frame table lives in the dynamic buffers (offset and size in vec4s, `lanes` vec4s per entry), and how it is filled. */
export type TableInfo = { readonly name: string; readonly buffer: string; readonly offset: number; readonly vec4s: number; readonly lanes: number; readonly fill: TableFillKind };

/** A `cpu` table's contents for one frame: written at `offset` vec4s into dynamic buffer `buffer`. */
export type CpuUpload = { readonly buffer: string; readonly offset: number; readonly data: Float32Array };

/**
 * How a draw's size is chosen each frame. The host writes a vec4 per slot into `loft_detail` before the frame and
 * issues the vertex count that goes with it.
 *
 * fixed      `vertices` x `instances`, as declared; no slot.
 * grid       a grid of cells over two axes, at one of `levels` (finest first; `levels[0].vertices` is `Draw.vertices`).
 *            Per instance i, slot `slot + i` receives `(cells[0], cells[1], 0, 0)` and the instance is drawn with that
 *            level's `vertices`. The shape is measured by the compiler at rest: `cell` is a level's largest cell, world
 *            units, and `radius` the surface's reach from its anchor point, both at scale 1. Per frame the pose's tables
 *            hold one vec4 per instance at `bound.offset + i` of dynamic buffer `bound.buffer`: (anchor point xyz,
 *            scale). The host picks, per instance, the coarsest level whose cells (scale x cell) are at most
 *            `View.cellPixels` across on screen at the nearest point of the sphere (anchor, scale x radius), keeping the
 *            previous frame's level while its cells stay within [1 / HYSTERESIS, HYSTERESIS] of that rule's bounds, and
 *            skips an instance whose sphere is under a pixel across or wholly behind the eye. Instances are drawn in
 *            runs of one level (`firstInstance`), so `@builtin(instance_index)` still names the copy.
 * projected  a grid laid over the image of the plane y = `plane` out to view depth `reach`: the host chooses
 *            nx x ny cells of `cell` x `View.cellPixels` pixels covering NDC x in [-1 - m, 1 + m] and NDC y in
 *            [y0, y1] (the rows whose ray meets the plane within `reach`, widened by m), where m is the screen movement of
 *            a point of the plane lifted by `lift`, and writes `(nx, ny, y0, y1)` to `slot`, with m in the slot's
 *            neighbour `slot + 1` as `(m, 0, 0, 0)`. It draws 6 nx ny vertices, or nothing when no row meets the plane.
 */
export type Detail =
  | { readonly kind: "fixed" }
  | {
    readonly kind: "grid";
    readonly slot: number;
    readonly bound: { readonly buffer: string; readonly offset: number };
    readonly radius: number;
    readonly levels: readonly { readonly cells: readonly [number, number]; readonly vertices: number; readonly cell: number }[];
  }
  | { readonly kind: "projected"; readonly slot: number; readonly cell: number; readonly plane: number; readonly reach: number; readonly lift: number };

/** A grid keeps its level while its cells stay within this factor beyond the bounds that would choose it afresh. */
export const HYSTERESIS = 1.25;

export type Draw = {
  readonly label: string;
  /** How its vertex count is chosen per frame. Two draws with one slot (a surface and its ink) share the choice. */
  readonly detail: Detail;
  /** Key into `Artefact.shaders`. The module has entry points `vs` and `fs`. */
  readonly shader: string;
  readonly vertices: number;
  readonly instances: number;
  /** Opaque draws run first, in list order; then transparent draws, in list order. */
  readonly pass: "opaque" | "transparent";
  readonly cull: "none" | "back" | "front";
  readonly depthWrite: boolean;
  /**
   * alpha: straight alpha over (src-alpha, one-minus-src-alpha). add: additive scaled by alpha (src-alpha, one).
   * alpha-min: the colour is left as it is and the target's alpha becomes the lesser of itself and the fragment's.
   * alpha-pull: the target's own alpha mixes it toward the fragment's colour (dst * dstAlpha + src * (1 - dstAlpha)),
   * and its alpha becomes the fragment's. The last two are a style's shadow block (src/draw/light.ts).
   */
  readonly blend: "none" | "alpha" | "add" | "alpha-min" | "alpha-pull";
  /** Scene geometry, or construction lines the host can show and hide. */
  readonly layer: "scene" | "construction";
  /** WGSL `override` constants for this draw (for example the grid density). */
  readonly constants: Readonly<Record<string, number>>;
  /**
   * Transparent draws only (a host rejects it on an opaque draw at load). When set, the host prepends
   * SCENE_DEPTH_WGSL (after PRELUDE_WGSL) to this draw's shader and binds group 2, so its fragment stage
   * can read the opaque scene behind it: `scene_depth(px)` (the depth buffer value, 0 near to 1 far) and
   * `scene_position(px)` (the world position of the opaque surface at that pixel). Used for foam where things meet,
   * soft volume edges and depth fades.
   */
  readonly sceneDepth?: boolean;
};

/**
 * A full-screen pass run after the scene is drawn and resolved, in list order. The module has one entry point, `fs`;
 * the host supplies the vertex stage and prepends POST_WGSL (after PRELUDE_WGSL), which gives `post_color(uv)` (the
 * picture so far), `scene_depth(px)` and `scene_position(px)`. Used by styles: ink lines from depth edges, paper grain,
 * bloom. The last pass's output is the frame.
 */
export type PostPass = { readonly label: string; readonly shader: string };

/**
 * What a host hands the pose function every frame. `inputs` and `params` are laid out by slot. `curves` is the curve
 * table as the host holds it now: `Artefact.curves` until a `setCurves`, the last data set after it (so an edited
 * curve moves the CPU pose exactly as it moves the GPU).
 */
export type FrameState = { readonly time: number; readonly inputs: Float32Array; readonly params: Float32Array; readonly curves: Float32Array };

export type Artefact = {
  readonly version: 1;
  /** Background colour, sRGB 0..1. */
  readonly clear: readonly [number, number, number];
  readonly inputs: readonly InputSlot[];
  readonly inputFloats: number;
  readonly params: readonly ParamSlot[];
  /** rows x CURVE_N x 4 floats. Static until a table-backed curve is edited. */
  readonly curves: Float32Array;
  readonly dynamic: readonly DynamicBuffer[];
  /** Tables uploaded once at load. Absent means none. */
  readonly statics?: readonly StaticBuffer[];
  /** Bind group 1 declarations plus generated functions shared by every shader. */
  readonly sceneWgsl: string;
  readonly shaders: Readonly<Record<string, string>>;
  readonly draws: readonly Draw[];
  /** Full-screen passes after the scene. Absent means none. */
  readonly post?: readonly PostPass[];
  /** The pose pass: compute dispatches that fill every map and scan table, in order (docs/gpu_native.md). */
  readonly stages: readonly PoseStage[];
  /** Every per-frame table: where it lives and how it is filled. */
  readonly tables: readonly TableInfo[];
  /**
   * The `cpu` tables for a frame, which the host uploads before the pose stages run. An empty list when every table
   * is a map or a scan: the only JavaScript a host still runs per frame.
   */
  cpuPose(state: FrameState): readonly CpuUpload[];
  /**
   * The CPU reading of every per-frame table, derived from the same programs as the stages (and the `cpu` fills): for
   * checks, baking and tests, never needed to draw. One Float32Array per dynamic buffer, keyed by name, of length
   * `vec4s * 4`. Pure: same state, same output.
   */
  pose(state: FrameState): Readonly<Record<string, Float32Array>>;
  /** Views the scene suggests, by name. */
  readonly cameras: Readonly<Record<string, Camera>>;
  /** Whether the scene's clock comes round (`OPEN` when absent). A host that draws it may wrap its clock by `loopTime`. */
  readonly loop?: Loop;
  /**
   * `maxTriangles`: what the draw list declares (every draw's vertices / 3 x instances, scene layer), the most a frame
   * can draw; a host drawing at a coarser level of detail draws fewer (`FrameStats`). `draws`: draws declared.
   */
  readonly stats: { readonly maxTriangles: number; readonly draws: number; readonly curveRows: number; readonly stations: number };
};

/** One frame to draw. Missing inputs and params take the artefact's defaults; `time` also fills the `time` input. */
export type View = {
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly inputs?: Readonly<Record<string, number | readonly number[]>>;
  readonly params?: Readonly<Record<string, number>>;
  readonly construction?: boolean;
  /**
   * Level of detail: the size, in pixels, a grid cell should have on screen (`Draw.detail`); default `CELL_PIXELS`.
   * 0 draws every grid at its finest (the authored density).
   */
  readonly cellPixels?: number;
};

/** The default `View.cellPixels`. */
export const CELL_PIXELS = 7;

/**
 * What a host actually drew for one frame: triangles submitted (every draw call's vertices / 3 x instances, construction
 * lines included when shown) and draw calls issued.
 */
export type FrameStats = { readonly triangles: number; readonly draws: number };

/** What every host implements. `frame` returns tightly packed RGBA8, top row first. */
export interface Host {
  load(artefact: Artefact): Promise<Loaded>;
}
export interface Loaded {
  frame(view: View): Promise<Uint8Array>;
  /** Draw the same frame into a texture the caller owns (a canvas's current texture), sized as the view. */
  draw(view: View, target: GPUTexture): Promise<FrameStats>;
  /** Replace table-backed curve data without rebuilding pipelines. */
  setCurves(curves: Float32Array): void;
  destroy(): void;
}

/**
 * The pose members of an artefact written by hand (a fixture, a test), whose dynamic buffers one JavaScript function
 * fills: each buffer is one `cpu` table, with `why`.
 */
export function handPose(dynamic: readonly DynamicBuffer[], pose: (state: FrameState) => Readonly<Record<string, Float32Array>>, why: string): Pick<Artefact, "stages" | "tables" | "cpuPose" | "pose"> {
  return {
    stages: [],
    tables: dynamic.map((d) => ({ name: d.name, buffer: d.name, offset: 0, vec4s: d.vec4s, lanes: 1, fill: { kind: "cpu", why } })),
    cpuPose: (state) => { const t = pose(state); return dynamic.map((d) => ({ buffer: d.name, offset: 0, data: t[d.name]! })); },
    pose,
  };
}

/**
 * Whether a scene's clock runs on, or comes round: a scene that loops every `seconds` is the same at t and at
 * t + seconds by its author's construction (every motion in it takes whole turns in the period), and says so, so that
 * a host may wrap its clock and t = seconds is t = 0 exactly, not to within a rounding of sin(2 pi k).
 */
export type Loop = { readonly kind: "open" } | { readonly kind: "every"; readonly seconds: number };
export const OPEN: Loop = { kind: "open" };
/** The clock a host should draw a scene at for time t. */
export function loopTime(l: Loop, t: number): number {
  switch (l.kind) {
    case "open": return t;
    case "every": return t - Math.floor(t / l.seconds) * l.seconds;
  }
}

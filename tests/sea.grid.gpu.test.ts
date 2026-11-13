// The sea's projected grid, read back from the GPU: the sea draw's own vertex function run in a compute pass, at the
// cell counts and rows the host chooses for a real camera.
import { expect, test } from "bun:test";
import { DETAIL_SLOTS, PRELUDE_WGSL, SCENE_CLEARANCE_WGSL, SCENE_DEPTH_WGSL, type Camera } from "../src/artefact.ts";
import { scene, sea, toon, variable, vec2 } from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { boundsFrom, planFrame } from "../src/host/detail.ts";
import { frameUniform, viewState } from "../src/host/host.ts";
import { headlessDevice } from "../src/host/headless.ts";

const water = sea({ swell: [{ direction: [1, 0.3], length: 14, height: 0.25, speed: 1.1 }, { direction: [-0.4, 1], length: 6, height: 0.08, speed: 0.7, phase: 1 }] });
const compiled = compileScene(scene({ ground: water, things: [], style: toon(), sun: [0.3, 1, 0.2] }));
const a = compiled.artefact;
const seaDraw = a.draws.find((d) => d.label === "sea")!;
const X = variable("x", "f32"), Z = variable("z", "f32");
const height = compiled.cpu([water.height(vec2(X, Z))]);

/** Positions of every vertex the host would draw for the sea under `camera`, from the sea's real vertex stage. */
async function seaVertices(device: GPUDevice, camera: Camera, time: number): Promise<{ readonly positions: Float32Array; readonly nx: number; readonly ny: number }> {
  const view = { camera, width: 1280, height: 800, time };
  const tables = a.pose(viewState(a, view));
  const detail = new Float32Array(DETAIL_SLOTS * 4);
  const plan = planFrame(a.draws, view, boundsFrom(a.draws, tables), new Map(), detail);
  const runs = plan[a.draws.indexOf(seaDraw)]!;
  const vertices = runs[0]!.vertices;
  const slot = seaDraw.detail.kind === "projected" ? seaDraw.detail.slot : -1;
  // The vertex entry point becomes a plain function the probe calls: the code under test is the draw's own.
  const code = PRELUDE_WGSL + SCENE_DEPTH_WGSL + SCENE_CLEARANCE_WGSL + a.sceneWgsl + a.shaders[seaDraw.shader]!.replace("@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32)", "fn vs(vi: u32, ii: u32)") + `
@group(3) @binding(0) var<storage, read_write> probe_out: array<vec4<f32>>;
@compute @workgroup_size(64) fn probe(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= arrayLength(&probe_out)) { return; }
  probe_out[g.x] = vec4<f32>(vs(g.x, 0u).world, 0.0);
}`;
  const V = 0x1 | 0x2 | 0x4;
  const storage = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: V, buffer: { type: "read-only-storage" } });
  const l0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: V, buffer: { type: "uniform" } }, storage(1), storage(2), storage(3), { binding: 4, visibility: V, buffer: { type: "uniform" } }] });
  const l1 = device.createBindGroupLayout({ entries: a.dynamic.map((d) => storage(d.binding)) });
  const l2 = device.createBindGroupLayout({ entries: [0, 1].map((binding) => ({ binding, visibility: V, texture: { sampleType: "unfilterable-float" as const } })) });
  const l3 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 0x4, buffer: { type: "storage" } }] });
  device.pushErrorScope("validation");
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [l0, l1, l2, l3] }),
    compute: { module: device.createShaderModule({ code }), entryPoint: "probe", constants: { LOFT_DETAIL_SLOT: slot } },
  });
  const buf = (data: Float32Array, usage: number) => { const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data as Float32Array<ArrayBuffer>); return b; };
  const state = viewState(a, view);
  const g0 = device.createBindGroup({ layout: l0, entries: [
    buf(frameUniform(view), GPUBufferUsage.UNIFORM), buf(state.inputs, GPUBufferUsage.STORAGE), buf(state.params.length ? state.params : new Float32Array(4), GPUBufferUsage.STORAGE),
    buf(a.curves.length ? a.curves : new Float32Array(4), GPUBufferUsage.STORAGE), buf(detail, GPUBufferUsage.UNIFORM),
  ].map((b, binding) => ({ binding, resource: { buffer: b } })) });
  const g1 = device.createBindGroup({ layout: l1, entries: a.dynamic.map((d) => ({ binding: d.binding, resource: { buffer: buf(tables[d.name]!, GPUBufferUsage.STORAGE) } })) });
  const tex = device.createTexture({ size: [1, 1], format: "r32float", usage: GPUTextureUsage.TEXTURE_BINDING });
  const clearance = device.createTexture({ size: [1, 1], format: "r8unorm", usage: GPUTextureUsage.TEXTURE_BINDING });
  const g2 = device.createBindGroup({ layout: l2, entries: [{ binding: 0, resource: tex.createView() }, { binding: 1, resource: clearance.createView() }] });
  const out = device.createBuffer({ size: vertices * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: vertices * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const g3 = device.createBindGroup({ layout: l3, entries: [{ binding: 0, resource: { buffer: out } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  [g0, g1, g2, g3].forEach((g, i) => pass.setBindGroup(i, g));
  pass.dispatchWorkgroups(Math.ceil(vertices / 64));
  pass.end();
  enc.copyBufferToBuffer(out, 0, read, 0, vertices * 16);
  device.queue.submit([enc.finish()]);
  const error = await device.popErrorScope();
  if (error) throw new Error(error.message);
  await read.mapAsync(GPUMapMode.READ);
  const positions = new Float32Array(read.getMappedRange().slice(0));
  read.unmap();
  return { positions, nx: detail[slot * 4]!, ny: detail[slot * 4 + 1]! };
}

const CAMERAS: readonly [string, Camera][] = [
  ["game", { kind: "perspective", eye: [16, 34, 22], target: [0, 1, 0], fovY: 0.6 }],
  ["low", { kind: "perspective", eye: [-6, 2.5, 9], target: [3, 0.5, 0], fovY: 0.7 }],
  ["top", { kind: "orthographic", eye: [0, 40, 0.001], target: [0, 0, 0], height: 30 }],
];

// Catches: a crack in the water (two triangles that should share an edge computing its ends differently, or a
// T-junction), which would show the sky through the sea. Every edge, keyed by its two end positions as the GPU computed
// them, must belong to exactly two triangles inside the grid and one on its rim, and the rim must be the grid's outline.
// And: a vertex that is not on the swell (the wrong height function, or a height taken at a different point than the
// one drawn), checked against the CPU's height at the vertex's own (x, z) to 5e-4 (0.4% of this swell's amplitude).
test.each(CAMERAS)("the sea grid under the %s camera has no cracks and lies on the swell", async (_, camera) => {
  const device = await headlessDevice();
  const { positions, nx, ny } = await seaVertices(device, camera, 1.7);
  expect(2 * nx * ny).toBeLessThan(10000); // the target for a 1280 x 800 view
  const key = (k: number) => `${positions[4 * k]},${positions[4 * k + 1]},${positions[4 * k + 2]}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < positions.length / 12; t++) {
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as const) {
      const ka = key(3 * t + i), kb = key(3 * t + j);
      const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  const counts = [...edges.values()];
  expect(counts.every((c) => c === 1 || c === 2)).toBe(true);
  expect(counts.filter((c) => c === 1).length).toBe(2 * (nx + ny));
  const frame = compiled.frame(viewState(a, { camera, width: 1280, height: 800, time: 1.7 }));
  let worst = 0;
  for (let k = 0; k < positions.length / 4; k += 7) {
    const [x, y, z] = [positions[4 * k]!, positions[4 * k + 1]!, positions[4 * k + 2]!];
    worst = Math.max(worst, Math.abs(y - (height(frame, { x, z })[0] as number)));
  }
  expect(worst).toBeLessThan(5e-4);
}, 120000);

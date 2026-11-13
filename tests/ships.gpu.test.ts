// The ship examples on a real GPU device (bun-webgpu / Dawn): every shader builds and every draw makes a pipeline, and
// the whirlpool's map evaluated in WGSL agrees with its CPU twin.
import { expect, test } from "bun:test";
import { PRELUDE_WGSL, SCENE_CLEARANCE_WGSL, SCENE_DEPTH_WGSL, type Artefact } from "../src/artefact.ts";
import brig from "../examples/brig.ts";
import fleet from "../examples/fleet.ts";
import maelstrom from "../examples/maelstrom.ts";
import { compileJs, scene, sea, toon, variable, whirlpool } from "../src/index.ts";
import { emitWgsl } from "../src/expr.ts";
import { compileScene } from "../src/compile/index.ts";
import { FRAGMENT, gpu, layouts, probe, stateAt, VERTEX } from "./compile.harness.ts";

async function pipelineErrors(a: Artefact): Promise<string[]> {
  const dev = await gpu();
  const [g0, g1] = layouts(dev, a, VERTEX | FRAGMENT);
  const depth = dev.createBindGroupLayout({ entries: [0, 1].map((binding) => ({ binding, visibility: VERTEX | FRAGMENT, texture: { sampleType: "unfilterable-float" as const } })) });
  const errors: string[] = [];
  for (const d of a.draws) {
    dev.pushErrorScope("validation");
    const module = dev.createShaderModule({ code: PRELUDE_WGSL + (d.sceneDepth === true ? SCENE_DEPTH_WGSL + SCENE_CLEARANCE_WGSL : "") + a.sceneWgsl + a.shaders[d.shader] });
    const layout = dev.createPipelineLayout({ bindGroupLayouts: d.sceneDepth === true ? [g0, g1, depth] : [g0, g1] });
    const blend = d.blend === "alpha" ? { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } as const : undefined;
    try {
      await dev.createRenderPipelineAsync({
        layout,
        vertex: { module, entryPoint: "vs", constants: d.constants },
        fragment: { module, entryPoint: "fs", constants: d.constants, targets: [{ format: "rgba8unorm", blend }] },
        primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: d.cull },
        depthStencil: { format: "depth32float", depthWriteEnabled: d.depthWrite, depthCompare: "less" },
        multisample: { count: 4 },
      });
    } catch (e) {
      errors.push(`${d.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const err = await dev.popErrorScope();
    if (err) errors.push(`${d.label}: ${err.message}`);
  }
  return errors;
}

// Catches: WGSL the ship, rigging, sea-deformation or coiling code emits that Dawn rejects (types, a derivative in
// non-uniform control flow, an override), and any draw whose state cannot make a pipeline.
test("every ship example's shaders build pipelines", async () => {
  const errors: string[] = [];
  for (const [name, s] of [["brig", brig], ["fleet", fleet], ["maelstrom", maelstrom]] as const) {
    for (const e of await pipelineErrors(compileScene(s).artefact)) errors.push(`${name}: ${e}`);
  }
  expect(errors).toEqual([]);
}, 600000);

// Catches: a WGSL spelling of the whirlpool's map that differs from the CPU's (atan2 argument order, the tan branch in
// f32 near the centre and the rim, select's argument order): the funnel and the paint would then sit somewhere other
// than the ships and the shadows the CPU places.
test("the whirlpool's map agrees on the GPU and the CPU, and round-trips in f32", async () => {
  const pool = whirlpool({ at: [3, -2], radius: 20, spin: 0.3, depth: 5, drift: 0.4 });
  const P = variable("p", "vec2"), T = variable("t", "f32");
  const f = pool.flow(P, T);
  const roots = [f.xz, pool.toLocal(f.xz, T)];
  // The map reads only its two arguments and constants: emitted directly, with nothing else bound.
  const c = compileScene(scene({ ground: sea({ swell: [] }), things: [], style: toon(), sun: [0, 1, 0] }));
  const none = (what: string) => (): never => { throw new Error(`the whirlpool's map read a ${what}`); };
  const { lines, out } = emitWgsl(roots, { variable: (name) => name, input: none("input"), param: none("param"), row: none("curve row"), table: none("table") });
  const code = `fn pool_map(p: vec2<f32>, t: f32) -> vec4<f32> {\n${lines.map((l) => `  ${l}`).join("\n")}\n  return vec4<f32>(${out[0]}, ${out[1]});\n}\n`;
  const xs: number[][] = [];
  for (let i = 0; i < 256; i++) {
    const r = 20 * 0.98 * Math.sqrt((i * 0.618034) % 1) + 0.5, a = i * 2.39996;
    xs.push([3 + r * Math.cos(a), -2 + r * Math.sin(a), (i % 16) * 4.3, 0]);
  }
  const gpuOut = await probe(c.artefact, stateAt(c.artefact, 0), code, "fn probe(i: u32, x: vec4<f32>) -> vec4<f32> { return pool_map(x.xy, x.z); }", xs);
  const cpu = compileJs(roots);
  let worstFwd = 0, worstTrip = 0;
  xs.forEach((x, i) => {
    const [fw] = cpu({ vars: { p: [x[0], x[1]], t: x[2] }, inputs: {}, params: {} }) as number[][];
    const g = gpuOut[i];
    worstFwd = Math.max(worstFwd, Math.hypot(g[0] - fw[0], g[1] - fw[1]));
    worstTrip = Math.max(worstTrip, Math.hypot(g[2] - x[0], g[3] - x[1]));
  });
  // World units, on a whirlpool of radius 20.
  expect(worstFwd).toBeLessThan(2e-3);
  expect(worstTrip).toBeLessThan(2e-3);
}, 120000);

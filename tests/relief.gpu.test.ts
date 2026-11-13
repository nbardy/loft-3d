// The relief examples on a real GPU device: every shader module builds and every draw makes a pipeline under the
// contract's layouts (Dawn / bun-webgpu), including the relief's fragment-stage depth and its march loops.
import { expect, test } from "bun:test";
import { PRELUDE_WGSL, SCENE_CLEARANCE_WGSL, SCENE_DEPTH_WGSL } from "../src/artefact.ts";
import { compileScene } from "../src/compile/index.ts";
import serpentRelief from "../examples/serpent_relief.ts";
import shellRelief from "../examples/shell_relief.ts";
import { FRAGMENT, gpu, layouts, VERTEX } from "./compile.harness.ts";

// Catches: WGSL the relief emits that Dawn rejects (a library function defined twice when two of its functions call
// it, derivatives after the miss's discard, the frag_depth output, a loop whose count is not an integer), and draws
// whose state cannot make a pipeline.
test("the relief examples' shaders compile and every draw makes a pipeline", async () => {
  const dev = await gpu();
  const errors: string[] = [];
  for (const a of [compileScene(serpentRelief).artefact, compileScene(shellRelief).artefact]) {
    const [g0, g1] = layouts(dev, a, VERTEX | FRAGMENT);
    const depth = dev.createBindGroupLayout({ entries: [0, 1].map((binding) => ({ binding, visibility: VERTEX | FRAGMENT, texture: { sampleType: "unfilterable-float" as const } })) });
    for (const d of a.draws) {
      dev.pushErrorScope("validation");
      const extra = d.sceneDepth === true ? SCENE_DEPTH_WGSL + SCENE_CLEARANCE_WGSL : "";
      const module = dev.createShaderModule({ code: PRELUDE_WGSL + extra + a.sceneWgsl + a.shaders[d.shader] });
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
  }
  expect(errors).toEqual([]);
}, 120000);

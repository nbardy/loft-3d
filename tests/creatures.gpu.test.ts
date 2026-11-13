// The two creature examples on a real GPU device: every shader module builds and every draw makes a pipeline under the
// contract's layouts, at rest and with their attack inputs declared (the inputs only change buffer contents, so one
// build covers every pose).
import { expect, test } from "bun:test";
import { PRELUDE_WGSL, SCENE_CLEARANCE_WGSL, SCENE_DEPTH_WGSL } from "../src/artefact.ts";
import stormwing from "../examples/stormwing.ts";
import islandback from "../examples/islandback.ts";
import { compileScene } from "../src/compile/index.ts";
import { FRAGMENT, gpu, layouts, VERTEX } from "./compile.harness.ts";

// Catches: WGSL from the parts library that Dawn rejects (a select chain of vec3s across fan cells, nested polylines,
// the shell's pow of |sin|, a fetch of a body's table from a fan ray in the vertex stage) and any draw whose state
// cannot make a pipeline, before a host loads the artefact; and an example whose attack input is not declared.
test("the creature examples build every pipeline", async () => {
  const dev = await gpu();
  const errors: string[] = [];
  for (const [label, sc, input] of [["stormwing", stormwing, "strike"], ["islandback", islandback, "slam"]] as const) {
    const a = compileScene(sc).artefact;
    expect(a.inputs.map((i) => i.name)).toContain(input);
    const [g0, g1] = layouts(dev, a, VERTEX | FRAGMENT);
    const depth = dev.createBindGroupLayout({ entries: [0, 1].map((binding) => ({ binding, visibility: VERTEX | FRAGMENT, texture: { sampleType: "unfilterable-float" as const } })) });
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
        errors.push(`${label} ${d.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const err = await dev.popErrorScope();
      if (err) errors.push(`${label} ${d.label}: ${err.message}`);
    }
  }
  expect(errors).toEqual([]);
}, 300000);

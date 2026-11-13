// Soft things drawn by the real host: what a broken depth clip, a broken stroke window or a non-deterministic bolt would
// get wrong without any other test noticing, and every example's shaders against the host contract's layouts.
import { beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PRELUDE_WGSL, SCENE_CLEARANCE_WGSL, SCENE_DEPTH_WGSL, type Camera } from "../src/artefact.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost, type GpuHost } from "../src/host/index.ts";
import {
  blob, bolt, compile, compileJs, draw, glow, lift, medium, scene, sea, strand, through, toon, vec3, type Drawable, type Scene,
} from "../src/index.ts";
import { FRAGMENT, layouts, VERTEX } from "./compile.harness.ts";

let host: GpuHost;
beforeAll(async () => { host = createHost(await headlessDevice()); });

const swell = sea({ swell: [{ direction: [1, 0], length: 10, height: 0.1, speed: 1 }] });
const W = 96, H = 64;
const px = (rgba: Uint8Array, x: number, y: number) => Array.from(rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
async function shot(s: Scene, camera: Camera, size = { width: W, height: H }): Promise<Uint8Array> {
  const loaded = await host.load(compile(s));
  const out = await loaded.frame({ camera, ...size, time: 0 });
  loaded.destroy();
  return out;
}

// A red pole at the origin and a dense white blob straddling its line of sight, in front of it, behind it, or not there.
const pole = strand({ name: "pole", spine: (m) => through(m, [[0, -1, 0], [0, 9, 0]]), stations: 4, girth: 0.6, paint: [0.9, 0.1, 0.1] });
const front: Camera = { kind: "perspective", eye: [0, 4, 20], target: [0, 4, 0], fovY: 0.5 };
const cloudAt = (z: number): Drawable => draw.density("veil", medium("veil", { puffs: [blob({ centre: [0, 4, z], radii: [2.5, 2.5, 1.2], density: 2, colour: [1, 1, 1] })] }), {
  bounds: { min: [-9, -4, z - 5], max: [9, 12, z + 5] }, sun: [1.2, 1.2, 1.2], sky: 0.5, forward: 0, shadowing: 1, detail: { kind: "none" }, haze: 0,
});
const withThings = (things: Drawable[]) => scene({ ground: swell, things, style: toon(), sun: [0.3, 0.8, 0.5], cameras: {} });

// Catches: the integral not stopping at the opaque scene's depth (a cloud behind a body drawn over it), the clip using
// the wrong end of the ray (a cloud in front of a body not veiling it), the box's back faces depth-rejected behind the
// body (no cloud drawn at the body's pixels at all).
test("a cloud in front of a body veils it and a cloud behind it does not", async () => {
  const bare = await shot(withThings([pole]), front);
  const before = await shot(withThings([pole, cloudAt(5)]), front);
  const behind = await shot(withThings([pole, cloudAt(-5)]), front);
  const onPole = [W / 2, H / 2] as const, beside = [W / 2 + 6, H / 2] as const;
  const dist = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  // The pole is red when bare, and the cloud is near white: in front, the pole's pixel moves most of the way to white.
  expect(px(bare, ...onPole)[0] - px(bare, ...onPole)[1]).toBeGreaterThan(80);
  expect(px(before, ...onPole)[0] - px(before, ...onPole)[1]).toBeLessThan(40);
  // Behind, the pole's pixel is untouched, while the cloud shows beside it.
  expect(dist(px(behind, ...onPole), px(bare, ...onPole))).toBeLessThanOrEqual(2);
  expect(dist(px(behind, ...beside), px(bare, ...beside))).toBeGreaterThan(40);
}, 60000);

// A straight vertical glow seen orthographically, centred between two pixel columns: its row of pixels must be the same
// on both sides of the line (a falloff of distance is symmetric) and change smoothly (no step where the quad of a
// segment ends or a window of neighbours is cut). And the same straight line cut into 8 segments or drawn as one must
// give the same picture, at a joint and between joints: each pixel is lit by the nearest segment only (a pixel lit by
// every quad that covers it is two or three times as bright, since the quads overlap by the glow's reach).
test("a glow's falloff is symmetric about the curve, continuous, and does not depend on how the curve is cut", async () => {
  const line = (name: string, segments: number) => glow(name, (u) => vec3(0, lift(u).mul(16).sub(8).add(50), 0), {
    segments, width: 0.08, halo: 10, colour: [0.3, 0.4, 1], core: [1, 1, 1], intensity: 0.6, veil: { kind: "clear" },
  });
  const cam: Camera = { kind: "orthographic", eye: [0, 50, 30], target: [0, 50, 0], height: 4 };
  const size = { width: 200, height: 200 };
  // A black sky, so the glow's light is all there is in the row.
  const dark = (g: Drawable) => scene({ ground: swell, things: [g], style: toon({ sky: { zenith: [0, 0, 0], horizon: [0, 0, 0] } }), sun: [0.3, 0.8, 0.5], cameras: {} });
  const cut = await shot(dark(line("cut", 8)), cam, size), whole = await shot(dark(line("whole", 1)), cam, size);
  const rowOf = (img: Uint8Array, y: number) => Array.from({ length: size.width }, (_, x) => img[(y * size.width + x) * 4 + 2]);
  // Segment joints are every 2 world units, 100 pixels apart: row 50 is at a joint (to half a pixel), row 75 between.
  const mid = rowOf(cut, 75);
  let asym = 0, step = 0, recut = 0;
  for (let k = 0; k < 100; k++) asym = Math.max(asym, Math.abs(mid[99 - k] - mid[100 + k]));
  for (let x = 1; x < size.width; x++) step = Math.max(step, Math.abs(mid[x] - mid[x - 1]));
  for (const y of [50, 75]) { const a = rowOf(cut, y), b = rowOf(whole, y); for (let x = 0; x < size.width; x++) recut = Math.max(recut, Math.abs(a[x] - b[x])); }
  expect(mid[100]).toBeGreaterThan(mid[0] + 100); // the glow is there
  expect(asym).toBeLessThanOrEqual(2);
  expect(step).toBeLessThan(40);
  expect(recut).toBeLessThanOrEqual(3);
}, 60000);

// Catches: a bolt depending on anything but its seed and the strike (a stateful random source, the frame's own time
// leaking into the shape), and a seed that does not reach the hash (every storm the same bolt).
test("a bolt is the same for the same seed and strike, and another for another seed or strike", () => {
  const make = (seed: number) => bolt({ name: `b${seed}`, from: [0, 12, 0], to: [4, 0, 2], wander: 2, roughness: 0.1, levels: 6, branches: 3, schedule: { first: 0.5, every: 5, jitter: 0.2, seed }, segments: 32 });
  const sample = (seed: number, t: number) => {
    const b = make(seed);
    const roots = [0, 1, 2, 3].flatMap((i) => [0.1, 0.37, 0.62, 0.9].map((u) => b.strokes.point(lift(u), lift(i))));
    return (compileJs(roots)({ vars: {}, inputs: { time: t }, params: {} }) as number[][]).flat();
  };
  const a = sample(3, 1.9), again = sample(3, 1.9), later = sample(3, 2.4), other = sample(4, 1.9), nextStrike = sample(3, 7.9);
  expect(again).toEqual(a);
  // Within one strike the channel holds its shape (1.9 s and 2.4 s are the same strike of the 5 s schedule).
  expect(later).toEqual(a);
  const differs = (x: number[], y: number[]) => Math.max(...x.map((v, i) => Math.abs(v - y[i])));
  expect(differs(other, a)).toBeGreaterThan(0.3);
  expect(differs(nextStrike, a)).toBeGreaterThan(0.3);
});

// Catches: WGSL from any example (or anything it uses) that Dawn rejects, and draws whose state cannot make a pipeline,
// before a host ever loads them. Every file in examples/ with a default scene export.
test("every example's shaders build pipelines under the contract's layouts", async () => {
  const dev = await headlessDevice();
  const dir = resolve(import.meta.dir, "../examples");
  const errors: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const mod = (await import(resolve(dir, file))) as { default?: Scene };
    // An example's default export is not always a scene (a cut list for a clip is one that is not): only scenes compile.
    if (!mod.default || !("style" in mod.default && "things" in mod.default)) continue;
    const a = compile(mod.default);
    const [g0, g1] = layouts(dev, a, VERTEX | FRAGMENT);
    const depth = dev.createBindGroupLayout({ entries: [0, 1].map((binding) => ({ binding, visibility: VERTEX | FRAGMENT, texture: { sampleType: "unfilterable-float" as const } })) });
    for (const d of a.draws) {
      dev.pushErrorScope("validation");
      const module = dev.createShaderModule({ code: PRELUDE_WGSL + (d.sceneDepth === true ? SCENE_DEPTH_WGSL + SCENE_CLEARANCE_WGSL : "") + a.sceneWgsl + a.shaders[d.shader] });
      const blend = d.blend === "none" ? undefined : { color: { srcFactor: "src-alpha", dstFactor: d.blend === "add" ? "one" : "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } as const;
      try {
        await dev.createRenderPipelineAsync({
          layout: dev.createPipelineLayout({ bindGroupLayouts: d.sceneDepth === true ? [g0, g1, depth] : [g0, g1] }),
          vertex: { module, entryPoint: "vs", constants: d.constants },
          fragment: { module, entryPoint: "fs", constants: d.constants, targets: [{ format: "rgba8unorm", blend }] },
          primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: d.cull },
          depthStencil: { format: "depth32float", depthWriteEnabled: d.depthWrite, depthCompare: "less" },
          multisample: { count: 4 },
        });
      } catch (e) {
        errors.push(`${file} ${d.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const err = await dev.popErrorScope();
      if (err) errors.push(`${file} ${d.label}: ${err.message}`);
    }
  }
  expect(errors).toEqual([]);
}, 180000);

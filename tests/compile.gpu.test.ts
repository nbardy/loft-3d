// The compiler's output on a real GPU device (bun-webgpu / Dawn): every shader builds, and every WGSL function a
// drawable can call agrees with its CPU twin over the same posed tables.
import { expect, test } from "bun:test";
import { PRELUDE_WGSL, SCENE_CLEARANCE_WGSL, SCENE_DEPTH_WGSL } from "../src/artefact.ts";
import serpent from "../examples/serpent.ts";
import shell from "../examples/shell.ts";
import scales from "../examples/serpent_scales.ts";
import {
  add, cos, draw, keys, lift, mul, param, place, points, scene, sea, sin, spacing, strand, surface, through, time,
  toon, variable, vec3, wave, framed, type Compiled, type Drawable, type F, type Surface, type TableSource,
} from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { FRAGMENT, gpu, layouts, probe, relErr, stateAt, VERTEX } from "./compile.harness.ts";

// Scenes: the serpent, the two map demonstrations (a shell written as a map, the body with folded scales) and a stroke.
// Catches: any WGSL the compiler generates that Dawn rejects (syntax, types, uniformity of derivatives, override use),
// and any draw whose state or constants cannot make a pipeline, before a host ever loads the artefact.
test("every shader compiles and every draw makes a pipeline under the contract's layouts", async () => {
  const dev = await gpu();
  const stroke = draw.curve("stroke", (u) => vec3(mul(u, 4), add(1, sin(mul(u, 6))), 0), { width: () => 0.05, paint: () => vec3(0, 0, 0), segments: 64 });
  const errors: string[] = [];
  for (const a of [compileScene(serpent).artefact, compileScene(shell).artefact, compileScene(scales).artefact, compileScene(scene({ ground: swell, things: [stroke], style: toon(), sun: [0, 1, 0] })).artefact]) {
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

// A strand exercising everything the body's expressions depend on: a moving spine (time, a param, a wave), a twist,
// both tip kinds, a keyed aspect, a boxy section, and few stations (so interpolation between them matters).
const probeGirth = keys([[0, 0.4], [0.5, 0.9], [1, 0.3]]);
// Hoisted: `keys` makes a new table row each time it is called, so a curve built inside the section function would be a
// different row each time the body is evaluated (the compiler refuses rows first seen after layout).
const probeAspect = keys([[0, 1.4], [1, 0.6]]);
const body = strand({
  name: "probe",
  spine: (m) => add(through(m, [[-4, 0.5, 0], vec3(-1, add(1.2, mul(time, 0.3)), 0.8), vec3(1.5, param("probe.lift", 0.7), -0.6), [4, 2.5, 0.2]]),
    wave(m, { axis: [0, 0, 1], waves: 1.3, rate: 0.6, amplitude: 0.5 })),
  stations: 12,
  girth: (m) => mul(probeGirth(m).x, param("probe.girth", 1.1)),
  section: { aspect: (m) => probeAspect(m).x, squareness: 3 },
  twist: (m) => mul(m, 1.3),
  tips: [{ round: 0.1 }, { point: 0.2 }],
  paint: [1, 0, 0],
});
const swell = sea({ swell: [{ direction: [1, 0], length: 10, height: 0.2, speed: 1 }] });

/** A torus written directly as a function of (u, v), wobbling in time: its normal is the map's own. */
const R = 2, r = 0.6;
const torus = surface((u: F, v: F) => {
  const a = mul(u, Math.PI * 2), b = mul(v, Math.PI * 2);
  const ring = add(R, mul(cos(b), add(r, mul(sin(add(mul(a, 3), time)), 0.1))));
  return vec3(mul(ring, cos(a)), add(mul(sin(b), r), 1), mul(ring, sin(a)));
}, { u: "periodic", v: "periodic" });
const torusDrawn = draw.surface("torus", torus, { paint: () => vec3(1, 1, 1), grid: { u: spacing.even(32), v: spacing.even(12) }, sides: "one", outline: "hull" });
/** Teeth: copies of a small strand at points placed on the probe, each scaled. */
const bump = strand({ name: "bump", spine: (m) => through(m, [[0, 0, 0], [0.1, 0.3, 0]]), stations: 4, girth: 0.05, up: [1, 0, 0], paint: [1, 1, 1] });
const studs = place(points(9, (i) => ({ at: vec3(add(0.1, mul(i, 0.1)), add(0.2, mul(i, 0.17)), add(0.9, mul(time, 0.01))), scale: add(1, i) })), body);
const bumps = draw.points("bumps", studs, bump);

/**
 * Run a drawn surface's own vertex function (`surf_<name>(s, t, i)` in its shader module) on the GPU at grid corners
 * and instance indices, and evaluate the same surface's expressions on the CPU there; return the worst disagreement.
 */
async function agreement(c: Compiled, name: string, surfaceOf: (i: number) => Surface, grid: { u: (s: F) => F; v: (t: F) => F }, instances: number, t: number) {
  const state = stateAt(c.artefact, t);
  const xs: number[][] = [];
  for (let i = 0; i < instances; i++) for (const s of [0, 0.003, 0.05, 0.21, 0.5, 0.77, 0.94, 0.999, 1]) for (const tt of [0, 0.15, 0.36, 0.65, 0.88, 1]) xs.push([s, tt, i]);
  const module = c.artefact.shaders[`surface.${name}`]!.replace(/@vertex[\s\S]*$/, "");
  const code = `fn probe(k: u32, x: vec4<f32>) -> vec4<f32> {
  let p = surf_${name}(x.x, x.y, x.z);
  return select(vec4<f32>(p.normal, 0.0), vec4<f32>(p.pos, 1.0), k % 2u == 0u);
}`;
  const gpuOut = await probe(c.artefact, state, module, code, xs.flatMap((x) => [x, x]));
  const frame = c.frame(state);
  const S = variable("s", "f32"), T = variable("t", "f32");
  let worstPos = 0, worstDir = 0;
  const runs = Array.from({ length: instances }, (_, i) => { const sf = surfaceOf(i); const u = grid.u(S), v = grid.v(T); return c.cpu([sf.point(u, v), sf.normal(u, v)]); });
  xs.forEach(([s, tt, i], k) => {
    const [pos, n] = runs[i](frame, { s, t: tt }) as number[][];
    worstPos = Math.max(worstPos, relErr(gpuOut[2 * k].slice(0, 3), pos));
    worstDir = Math.max(worstDir, relErr(gpuOut[2 * k + 1].slice(0, 3), n));
  });
  return { worstPos, worstDir };
}

// Catches: a surface's vertex stage and its CPU evaluation disagreeing: a `fetch` of a body's table reading another
// entry or lane than the CPU, an interpolation that differs between backends, a slot or curve row bound to the wrong
// place, the grid's spacing applied on one side only, an instance placed by the wrong index or frame axes. Three
// surfaces: a body (a sweep over its table), a torus written directly as a map (finite-difference normal), and
// copies of a body at points placed on another body.
test("drawn surfaces land where a CPU evaluation of the same expressions says", async () => {
  const c = compileScene(scene({ ground: swell, things: [body, torusDrawn, bumps], style: toon(), sun: [0.3, 0.8, 0.2] }));
  const ends = spacing.ends(1).at, round = spacing.from(1, 0.25).at, even = (x: F) => x;
  const b = await agreement(c, "probe", () => body, { u: ends, v: round }, 1, 1.37);
  const tor = await agreement(c, "torus", () => torus, { u: even, v: even }, 1, 0.8);
  const inst = await agreement(c, "bumps", (i) => framed(bump, studs.at(lift<"f32">(i))), { u: ends, v: round }, 9, 0.8);
  expect(b.worstPos).toBeLessThan(1e-4);
  expect(tor.worstPos).toBeLessThan(1e-4);
  expect(inst.worstPos).toBeLessThan(1e-4);
  // Normals near a closing tip come from a finite difference of radii, and the torus's from finite differences of
  // the map (cancellation in f32 over a 1e-3 step), so 1e-3 there.
  expect(Math.max(b.worstDir, inst.worstDir)).toBeLessThan(1e-3);
  expect(tor.worstDir).toBeLessThan(2e-3);
}, 60000);

// Catches: a table declared by raw WGSL landing at the wrong offset in its packed buffer, an accessor reading the wrong
// binding, a fill not run (or run before the table it reads), or a fill's CPU expressions reading the wrong frame.
// Two tables share one buffer; the second reads the first, and both carry values a shader can only get through them.
test("a table a drawable declares reaches the shader with the values its fill wrote", async () => {
  const lifted = param("probe.lift", 0.7);
  const first: TableSource = { name: "first", lanes: 1, entries: 3, role: "data", prepare: (p) => {
    const cpu = p.compile([mul(time, 3), add(lifted, 1)]);
    return (frame, out) => {
      const [t3, l1] = cpu(frame) as number[];
      for (let i = 0; i < 3; i++) out.set([t3 + i, l1, i * 10, -1 - i], i * 4);
    };
  } };
  const second: TableSource = { name: "second", lanes: 2, entries: 1, role: "data", prepare: () => (frame, out) => {
    const src = frame.table(first);
    out.set([src[0] * 2, src[4] * 2, src[8] * 2, 7], 0);
    out.set([1, 2, 3, 4], 4);
  } };
  const refs: { wgsl: string }[] = [];
  const thing: Drawable = { name: "tabled", skeletons: [], surfaces: [], draws(ctx) { refs.push(ctx.table(first), ctx.table(second)); return { shaders: {}, draws: [] }; } };
  const c = compileScene(scene({ ground: swell, things: [body, thing], style: toon(), sun: [0, 1, 0] }));
  const state = stateAt(c.artefact, 2.5, { params: { "probe.lift": 1.25 } });
  const code = `fn probe(i: u32, x: vec4<f32>) -> vec4<f32> { return select(${refs[1].wgsl}(i - 3u), ${refs[0].wgsl}(i), i < 3u); }`;
  const got = await probe(c.artefact, state, "", code, [[0], [0], [0], [0], [0]]);
  expect(got).toEqual([[7.5, 2.25, 0, -1], [8.5, 2.25, 10, -2], [9.5, 2.25, 20, -3], [15, 17, 19, 7], [1, 2, 3, 4]]);
});

// Catches: post passes declared by a drawable (or a style) not reaching `Artefact.post`, reaching it under a shader
// key that does not exist, or being run in the wrong order. Two passes: the first paints magenta, the second keeps
// only the red channel of the picture so far; a host frame must come out red everywhere.
test("post passes from a style and a drawable run in order on the host", async () => {
  const { createHost } = await import("../src/host/index.ts");
  const style = { ...toon(), post: [{ label: "magenta", wgsl: "@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.0, 1.0, 1.0); }" }] };
  const redOnly: Drawable = { name: "redOnly", skeletons: [], surfaces: [], draws: (ctx) => {
    ctx.post({ label: "red", wgsl: "@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> { return vec4<f32>(post_color(in.uv).r, 0.0, 0.0, 1.0); }" });
    return { shaders: {}, draws: [] };
  } };
  const a = compileScene(scene({ ground: swell, things: [body, redOnly], style, sun: [0, 1, 0] })).artefact;
  expect(a.post?.map((p) => p.label)).toEqual(["magenta", "red"]);
  const loaded = await createHost(await gpu()).load(a);
  const px = await loaded.frame({ camera: { kind: "perspective", eye: [0, 3, 10], target: [0, 0, 0], fovY: 0.8 }, width: 16, height: 8, time: 0 });
  loaded.destroy();
  for (let i = 0; i < px.length; i += 4) expect([px[i], px[i + 1], px[i + 2]]).toEqual([255, 0, 0]);
});

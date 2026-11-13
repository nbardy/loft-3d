// Scene depth (Draw.sceneDepth), post passes (Artefact.post), resizing and overlapping frames.
// What each test would catch is said at the test.
import { beforeAll, expect, test } from "bun:test";
import { handPose, type Artefact, type Camera, type View } from "../src/artefact.ts";
import { cameraMatrices, type CameraMatrices, type Vec3 } from "../src/host/camera.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { COLOR_FORMAT, createHost, fixture, type GpuHost } from "../src/host/index.ts";

let device: GPUDevice;
let host: GpuHost;
beforeAll(async () => { device = await headlessDevice(); host = createHost(device); });

const base: View = { camera: fixture.cameras.three!, width: 203, height: 101, time: 0.7 };
const differing = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
/** The fixture with neither feature: one water draw fewer, no post. Drawn by the single-pass schedule. */
const plain: Artefact = { ...fixture, post: undefined, draws: fixture.draws.filter((d) => d.sceneDepth !== true) };
const IDENTITY = /* wgsl */ `@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> { return post_color(in.uv); }`;

// ---- scene_position ----------------------------------------------------------------------------------------------

/**
 * An opaque ground plane y = 0, and a transparent sceneDepth draw covering the screen that writes scene_position as
 * colour: two coordinates per frame, each as 16 bits (hi byte, lo byte) over [-32, 32]. Param "axis" picks x, y
 * (axis 0) or z (axis 1).
 */
const probe: Artefact = {
  version: 1, clear: [0, 0, 0], inputs: [], inputFloats: 0, curves: new Float32Array(0), dynamic: [], sceneWgsl: "",
  params: [{ name: "axis", slot: 0, def: 0, min: 0, max: 1 }],
  shaders: {
    ground: /* wgsl */ `
      @vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
        let c = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(1.0, -1.0))[vi] * 60.0;
        return frame.view_proj * vec4<f32>(c.x, 0.0, c.y, 1.0);
      }
      @fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }`,
    probe: /* wgsl */ `
      @vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
        let uv = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
        return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0); // at the near plane: in front of everything
      }
      fn enc(c: f32) -> vec2<f32> {
        let v = clamp((c + 32.0) / 64.0, 0.0, 1.0) * 255.0;
        return vec2<f32>(floor(v) / 255.0, fract(v));
      }
      @fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
        let w = scene_position(p.xy);
        return select(vec4<f32>(enc(w.x), enc(w.y)), vec4<f32>(enc(w.z), 0.0, 1.0), params[0] > 0.5);
      }`,
  },
  draws: [
    { label: "ground", shader: "ground", vertices: 6, instances: 1, pass: "opaque", cull: "none", depthWrite: true, blend: "none", layer: "scene", constants: {}, detail: { kind: "fixed" } },
    { label: "probe", shader: "probe", vertices: 3, instances: 1, pass: "transparent", cull: "none", depthWrite: false, blend: "none", layer: "scene", constants: {}, detail: { kind: "fixed" }, sceneDepth: true },
  ],
  ...handPose([], () => ({}), "none"),
  cameras: {},
  stats: { maxTriangles: 3, draws: 2, curveRows: 0, stations: 0 },
};

/** WebGPU's standard 4x sample positions within a pixel (fixed by the WebGPU spec). */
const SAMPLE_POS = [[0.375, 0.125], [0.875, 0.375], [0.125, 0.625], [0.625, 0.875]] as const;

function unproject(m: CameraMatrices, ndc: readonly [number, number, number]): Vec3 {
  const v = m.invViewProj;
  const h = [0, 1, 2, 3].map((r) => v[r]! * ndc[0] + v[4 + r]! * ndc[1] + v[8 + r]! * ndc[2] + v[12 + r]!);
  return [h[0]! / h[3]!, h[1]! / h[3]!, h[2]! / h[3]!];
}
/** The depth of the plane y = 0 where the ray through image point (x, y) px meets it. */
function planeDepth(m: CameraMatrices, x: number, y: number, W: number, H: number): number {
  const ndc = [(x / W) * 2 - 1, 1 - (y / H) * 2] as const;
  const a = unproject(m, [ndc[0], ndc[1], 0]), b = unproject(m, [ndc[0], ndc[1], 1]);
  const t = a[1] / (a[1] - b[1]);
  const p: Vec3 = [a[0] + t * (b[0] - a[0]), 0, a[2] + t * (b[2] - a[2])];
  const vp = m.viewProj;
  const clip = [2, 3].map((r) => vp[r]! * p[0] + vp[4 + r]! * p[1] + vp[8 + r]! * p[2] + vp[12 + r]!);
  return clip[0]! / clip[1]!;
}

const probeCameras: readonly Camera[] = [
  { kind: "perspective", eye: [3, 6, 8], target: [0, 0, 0], fovY: 0.8 },
  { kind: "orthographic", eye: [3, 6, 8], target: [0, 0, 0], height: 6 },
];
for (const camera of probeCameras) {
  // Catches: a missing y flip or w divide in the reconstruction, the wrong matrix, depth from the wrong pass, a
  // resolve that averages samples instead of taking the nearest, and a pixel offset of half a pixel.
  test(`scene_position reconstructs the opaque plane y = 0 (${camera.kind})`, async () => {
    const W = 64, H = 40;
    const loaded = await host.load(probe);
    const view = { camera, width: W, height: H, time: 0 };
    const xy = await loaded.frame({ ...view, params: { axis: 0 } });
    const zz = await loaded.frame({ ...view, params: { axis: 1 } });
    loaded.destroy();
    const m = cameraMatrices(camera, W / H);
    const dec = (px: Uint8Array, i: number) => ((px[i]! + px[i + 1]! / 255) / 255) * 64 - 32;
    let worst = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // The documented semantics: the nearest of the pixel's four sample depths, unprojected at the pixel centre.
        const d = Math.min(...SAMPLE_POS.map(([sx, sy]) => planeDepth(m, x + sx, y + sy, W, H)));
        const want = unproject(m, [((x + 0.5) / W) * 2 - 1, 1 - ((y + 0.5) / H) * 2, d]);
        const i = (y * W + x) * 4;
        const got = [dec(xy, i), dec(xy, i + 2), dec(zz, i)];
        worst = Math.max(worst, ...got.map((g, k) => Math.abs(g - want[k]!)));
      }
    }
    // 16-bit encoding over 64 units is 1e-3; f32 depth near 1 at 25 units from a 0.1 near plane is a few 1e-3.
    expect(worst).toBeLessThan(0.01);
  });
}

// ---- post passes ---------------------------------------------------------------------------------------------------

// Catches: the split schedule (stored opaque pass, depth resolve, reloaded transparent pass) drawing different bytes
// from the single pass, and post_color not returning a pixel exactly at its centre (a half-texel uv offset, a
// filtering or sRGB conversion).
test("a post pass that returns post_color leaves the frame byte-identical", async () => {
  for (const [name, a] of [["plain", plain], ["fixture", fixture]] as const) {
    const without = await host.load(a);
    const withIdentity = await host.load({ ...a, shaders: { ...a.shaders, identity: IDENTITY }, post: [...(a.post ?? []), { label: "identity", shader: "identity" }] });
    const p = await without.frame(base), q = await withIdentity.frame(base);
    expect([name, differing(p, q)]).toEqual([name, 0]);
    without.destroy(); withIdentity.destroy();
  }
});

// Catches: passes run out of order, a pass reading the scene instead of the previous pass, ping-pong reading the
// texture it is writing, and the last pass not being the frame.
test("post passes apply in list order, each reading the one before", async () => {
  const clear = [0.2, 0.4, 0.6] as const;
  const shaders = {
    half: /* wgsl */ `@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> { return vec4<f32>(post_color(in.uv).rgb * 0.5, 1.0); }`,
    lift: /* wgsl */ `@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> { return vec4<f32>(post_color(in.uv).rgb + 0.25, 1.0); }`,
  };
  const ops = { half: (v: number) => v * 0.5, lift: (v: number) => v + 0.25 };
  const empty: Artefact = { ...plain, clear, shaders, draws: [], stats: { ...plain.stats, maxTriangles: 0, draws: 0 } };
  for (const order of [["half", "lift", "half"], ["lift", "half", "half"]] as const) {
    const loaded = await host.load({ ...empty, post: order.map((s, i) => ({ label: `${s} ${i}`, shader: s })) });
    const px = await loaded.frame({ ...base, width: 16, height: 8 });
    loaded.destroy();
    // Each pass writes rgba8unorm, so the expectation quantises after every pass, as the GPU does.
    const want = clear.map((c) => order.reduce((b, s) => Math.round(Math.min(1, ops[s](b / 255)) * 255), Math.round(c * 255)));
    for (const i of [0, (5 * 16 + 9) * 4]) {
      const got = Array.from(px.subarray(i, i + 3));
      expect([order.join(","), got.every((g, k) => Math.abs(g - want[k]!) <= 1)]).toEqual([order.join(","), true]);
    }
  }
});

test("sceneDepth on an opaque draw and a post pass naming a missing shader are load errors that name them", async () => {
  const opaqueReader = { ...fixture, draws: fixture.draws.map((d) => (d.label === "tube" ? { ...d, sceneDepth: true } : d)) };
  await expect(host.load(opaqueReader)).rejects.toThrow(/draw "tube" sets sceneDepth but is opaque/);
  await expect(host.load({ ...fixture, post: [{ label: "ink", shader: "inky" }] })).rejects.toThrow(/post pass "ink" names unknown shader "inky"/);
});

// ---- the canvas path, resizing, overlapping frames ---------------------------------------------------------------

// Catches: `draw` and `frame` diverging (the browser path cannot be tested here; this is the same code into a texture
// the caller owns, as a canvas's current texture is).
test("draw into a caller-owned texture gives the same bytes as frame, with both features", async () => {
  const loaded = await host.load(fixture);
  const { width, height } = base;
  const target = device.createTexture({ size: { width, height }, format: COLOR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  await loaded.draw(base, target);
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const buf = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture: target }, { buffer: buf, bytesPerRow, rowsPerImage: height }, { width, height });
  device.queue.submit([encoder.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(buf.getMappedRange());
  const drawn = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) drawn.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
  buf.unmap(); buf.destroy(); target.destroy();
  expect(differing(drawn, await loaded.frame(base))).toBe(0);
  loaded.destroy();
});

// Catches: textures, bind groups or views of a previous size surviving a resize (a stale depth resolve or post
// intermediate would show as differing bytes or a validation error).
test("rendering at one size, another, then the first again matches a fresh render at the first", async () => {
  const other: View = { ...base, width: 160, height: 120 };
  for (const [name, a] of [["plain", plain], ["fixture", fixture]] as const) {
    const fresh = await host.load(a);
    const want = await fresh.frame(base);
    fresh.destroy();
    const loaded = await host.load(a);
    await loaded.frame(base);
    await loaded.frame(other);
    expect([name, differing(await loaded.frame(base), want)]).toEqual([name, 0]);
    loaded.destroy();
  }
});

// Catches: a second frame remapping or resizing the readback buffer under the first one's pending map.
test("a frame started before the previous one resolved is rejected by cause, and the first still completes", async () => {
  const loaded = await host.load(fixture);
  const first = loaded.frame(base);
  await expect(loaded.frame({ ...base, width: 50, height: 50 })).rejects.toThrow(/before the previous frame\(\) resolved/);
  const a = await first;
  expect(a.length).toBe(base.width * base.height * 4);
  expect(differing(a, await loaded.frame(base))).toBe(0);
  loaded.destroy();
});

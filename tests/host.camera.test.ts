// Known world points must land on known pixels, through the whole chain: camera matrices, the Frame uniform layout
// (column-major), WebGPU's [0, 1] depth range, the y flip to a top-row-first image, and the padded readback.
// Expected pixels are derived by hand from the camera definitions, not from camera.ts.
import { beforeAll, expect, test } from "bun:test";
import { handPose, type Artefact, type Camera } from "../src/artefact.ts";
import { cameraMatrices, orbit, project } from "../src/host/camera.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost, type GpuHost } from "../src/host/index.ts";

const W = 203, H = 101, A = W / H;

type Case = { readonly name: string; readonly camera: Camera; readonly points: readonly { readonly p: readonly [number, number, number]; readonly px: readonly [number, number] }[] };
const cases: Case[] = [
  {
    // Eye on +z looking at the origin, 90 degree vertical field: at distance 10 the half-height is 10.
    name: "perspective on axis",
    camera: { kind: "perspective", eye: [0, 0, 10], target: [0, 0, 0], fovY: Math.PI / 2 },
    points: [
      { p: [0, 5, 0], px: [W / 2, H / 4] },                       // above centre: upper half of the image
      { p: [5, 0, 0], px: [W / 2 + (W / 2) * (0.5 / A), H / 2] }, // +x is to the right
      // Twice the near plane (distance / 100) from the eye: an OpenGL-style [-1, 1] depth mapping puts this at
      // negative depth, which WebGPU clips away.
      { p: [0, -0.1, 9.8], px: [W / 2, (3 * H) / 4] },
    ],
  },
  {
    // Eye on +x looking back at the origin: screen right is world -z (right-handed).
    name: "perspective from +x",
    camera: { kind: "perspective", eye: [10, 0, 0], target: [0, 0, 0], fovY: Math.PI / 2 },
    points: [{ p: [0, 0, -5], px: [W / 2 + (W / 2) * (0.5 / A), H / 2] }],
  },
  {
    // World-space height 4, so the half-height is 2 and the half-width 2 * aspect.
    name: "orthographic",
    camera: { kind: "orthographic", eye: [0, 0, 10], target: [0, 0, 0], height: 4 },
    points: [
      { p: [1, 1, -30], px: [W / 2 + (W / 2) * (1 / (2 * A)), H / 4] },
      { p: [-1.5, -1, 5], px: [W / 2 - (W / 2) * (1.5 / (2 * A)), (3 * H) / 4] },
    ],
  },
];

const COLOURS = [[255, 0, 0], [0, 255, 0], [0, 0, 255]] as const;

/** Draws a 3 x 3 pixel square of colour i at each point i of a `points` table. */
function markers(points: readonly (readonly [number, number, number])[]): Artefact {
  const table = new Float32Array(points.length * 4);
  points.forEach((p, i) => table.set([...p, 1], i * 4));
  return {
    version: 1, clear: [0, 0, 0], inputs: [], inputFloats: 0, params: [], curves: new Float32Array(0),
    dynamic: [{ name: "points", binding: 0, vec4s: points.length }],
    sceneWgsl: `@group(1) @binding(0) var<storage, read> points: array<vec4<f32>>;`,
    shaders: {
      mark: /* wgsl */ `
        struct Out { @builtin(position) clip: vec4<f32>, @location(0) @interpolate(flat) i: u32 };
        @vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
          let c = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0))[vi];
          let clip = frame.view_proj * points[ii];
          // 1.5 px half-size: the pixel containing the point is fully covered by every MSAA sample.
          return Out(vec4<f32>(clip.xy + c * 3.0 * frame.viewport.zw * clip.w, clip.zw), ii);
        }
        @fragment fn fs(in: Out) -> @location(0) vec4<f32> {
          return vec4<f32>(f32(in.i == 0u), f32(in.i == 1u), f32(in.i == 2u), 1.0);
        }`,
    },
    draws: [{ label: "marks", shader: "mark", vertices: 6, instances: points.length, pass: "opaque", cull: "none", depthWrite: true, blend: "none", layer: "scene", constants: {}, detail: { kind: "fixed" } }],
    ...handPose([{ name: "points", binding: 0, vec4s: points.length }], () => ({ points: table }), "test markers"),
    cameras: {},
    stats: { maxTriangles: 2 * points.length, draws: 1, curveRows: 0, stations: 0 },
  };
}

let host: GpuHost;
beforeAll(async () => { host = createHost(await headlessDevice()); });

for (const c of cases) {
  test(`${c.name}: world points land on the expected pixels`, async () => {
    const loaded = await host.load(markers(c.points.map((q) => q.p)));
    const px = await loaded.frame({ camera: c.camera, width: W, height: H, time: 0 });
    loaded.destroy();
    c.points.forEach((q, i) => {
      const [x, y] = [Math.floor(q.px[0]), Math.floor(q.px[1])];
      const at = Array.from(px.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));
      expect([q.p, at]).toEqual([q.p, [...COLOURS[i]!]]);
      // The CPU projection the viewer and checks use agrees with the hand derivation.
      const p = project(cameraMatrices(c.camera, A), q.p, W, H);
      expect(Math.abs(p.x - q.px[0]) + Math.abs(p.y - q.px[1])).toBeLessThan(1e-6);
      expect(p.depth > 0 && p.depth < 1).toBe(true);
    });
  });
}

test("the inverse view-projection undoes the view-projection", () => {
  for (const c of cases) {
    const m = cameraMatrices({ ...c.camera, eye: [3, 4, -7] }, A);
    for (let r = 0; r < 4; r++) {
      for (let col = 0; col < 4; col++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += m.viewProj[k * 4 + r]! * m.invViewProj[col * 4 + k]!;
        expect(Math.abs(s - (r === col ? 1 : 0))).toBeLessThan(1e-9);
      }
    }
  }
});

test("orbit keeps the target on the image centre and the distance scaled by zoom", () => {
  const cam: Camera = { kind: "perspective", eye: [-14, 9, -13], target: [0, 1, 0], fovY: 0.6 };
  const moved = orbit(orbit(cam, 0.7, 0.4, 0.8), -2.1, 3, 1.5); // the second pitch overshoots the pole and is held
  const dist = (c: Camera) => Math.hypot(c.eye[0] - c.target[0], c.eye[1] - c.target[1], c.eye[2] - c.target[2]);
  expect(Math.abs(dist(moved) / (dist(cam) * 1.2) - 1)).toBeLessThan(1e-9);
  const p = project(cameraMatrices(moved, A), cam.target, W, H);
  expect(Math.abs(p.x - W / 2) + Math.abs(p.y - H / 2)).toBeLessThan(1e-6);
  expect(moved.eye[1] > cam.target[1]).toBe(true); // pitched up, not flipped through the pole
});

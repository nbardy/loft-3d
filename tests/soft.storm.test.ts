// The storm's cloud with fewer, larger puffs (DESIGN.md 11.4): 96 puffs, each larger by the cube root of the count ratio
// and thinner by as much, with the detail carried by noise in the integrand, must read as the 260-puff cloud it
// replaced. Puff placement is a hash of the index, so two counts are two different arrangements: the comparison is
// of the picture blurred to the scale of the cloud's lobes, and of its brightness and contrast, not of pixels.
// Without the cube-root growth the 96 puffs leave gaps (coverage 0.89, 18 levels lighter); thinned to keep the mass,
// the cloud goes pale (18 levels lighter); thinned by the square, 8 lighter. Each of those fails here.
import { expect, test } from "bun:test";
import type { Camera } from "../src/artefact.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost } from "../src/host/index.ts";
import { blob, compile, draw, medium, scene, sea, toon } from "../src/index.ts";
import { thunderhead } from "../examples/recipes/thunderhead.ts";

const W = 200, H = 125;
const cameras: Camera[] = [
  { kind: "perspective", eye: [36, 7, 40], target: [-3, 14, -10], fovY: 0.9 },
  { kind: "perspective", eye: [2, 4, 56], target: [-3, 14, -12], fovY: 0.85 },
];

/** Frames of the thunderhead with `blobs` puffs (0: the same scene with a cloud of one empty puff, the bare sky). */
async function shots(blobs: number): Promise<Float64Array[]> {
  const head = thunderhead({ at: [-6, 10.5, -16], height: 30, width: 46, blobs: Math.max(blobs, 1), seed: 7, drift: [0.15, 0, 0.05], seconds: 60 });
  const puffs = blobs === 0 ? [blob({ centre: [0, -50, 0], radii: [1, 1, 1], density: 0, colour: [1, 1, 1] })] : head.puffs;
  const cloud = draw.density(`cloud${blobs}`, medium(`m${blobs}`, { puffs }), {
    bounds: head.bounds, sun: [2.1, 1.95, 1.75], sky: 0.9, forward: 0.3, shadowing: 0.8, detail: { kind: "noise", amount: 2, scale: 1.5 }, haze: 0.004,
  });
  const s = scene({ ground: sea({ swell: [] }), things: [cloud], style: toon({ outline: 0.04, sky: { zenith: [0.12, 0.15, 0.24], horizon: [0.52, 0.56, 0.62] } }), sun: [-0.55, 0.5, 0.65], cameras: {} });
  const loaded = await createHost(await headlessDevice()).load(compile(s));
  const out: Float64Array[] = [];
  for (const camera of cameras) for (const time of [1, 9]) {
    const f = await loaded.frame({ camera, width: W, height: H, time });
    const l = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) l[i] = 0.2126 * f[4 * i]! + 0.7152 * f[4 * i + 1]! + 0.0722 * f[4 * i + 2]!;
    out.push(l);
  }
  loaded.destroy();
  return out;
}

function blur(l: Float64Array, r: number): Float64Array {
  const o = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { s += l[Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))]!; n++; }
    o[y * W + x] = s / n;
  }
  return o;
}
const meanSd = (l: Float64Array): [number, number] => {
  let m = 0; for (const v of l) m += v; m /= l.length;
  let v2 = 0; for (const v of l) v2 += (v - m) ** 2;
  return [m, Math.sqrt(v2 / l.length)];
};

test("96 larger puffs read as the 260 they replaced: coverage, brightness and contrast where the cloud is", async () => {
  const [sky, ref, got] = [await shots(0), await shots(260), await shots(96)];
  // The cloud's pixels: where either picture differs from the empty sky.
  let covRef = 0, covGot = 0, n = 0, sumRef = 0, sumGot = 0, diff = 0;
  const inRef: number[] = [], inGot: number[] = [];
  for (let k = 0; k < sky.length; k++) {
    const a = blur(ref[k]!, 6), b = blur(got[k]!, 6);
    for (let i = 0; i < W * H; i++) {
      const r = Math.abs(ref[k]![i]! - sky[k]![i]!) > 4, g = Math.abs(got[k]![i]! - sky[k]![i]!) > 4;
      covRef += +r; covGot += +g;
      if (r || g) { n++; sumRef += ref[k]![i]!; sumGot += got[k]![i]!; diff += Math.abs(a[i]! - b[i]!); inRef.push(ref[k]![i]!); inGot.push(got[k]![i]!); }
    }
  }
  const [, sr] = meanSd(Float64Array.from(inRef)), [, sg] = meanSd(Float64Array.from(inGot));
  const m = { coverage: covGot / covRef, mean: (sumGot - sumRef) / n, blurred: diff / n, contrast: sg / sr };
  // Measured 2026-11-11 (0..255 luminance): coverage 1.15 (the larger puffs' faint halo reaches a little further),
  // mean 2.6 darker, blurred difference 31, contrast 0.94 of the reference.
  expect(m.coverage).toBeGreaterThan(0.93);
  expect(m.coverage).toBeLessThan(1.22);
  expect(Math.abs(m.mean)).toBeLessThan(7);
  expect(m.blurred).toBeLessThan(35);
  expect(m.contrast).toBeGreaterThan(0.85);
}, 120000);

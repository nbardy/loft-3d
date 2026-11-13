// The host end to end on the fixture: what a compiler or viewer bug would silently get wrong if these were absent.
import { beforeAll, expect, test } from "bun:test";
import type { Artefact, View } from "../src/artefact.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost, fixture, type GpuHost } from "../src/host/index.ts";

let host: GpuHost;
beforeAll(async () => { host = createHost(await headlessDevice()); });

// 203 x 101: 812-byte rows, so the readback's 256-byte row padding (1024) must be stripped correctly.
const base: View = { camera: fixture.cameras.three!, width: 203, height: 101, time: 0.7 };
const differing = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);

test("the same view renders the same bytes, even after other frames in between", async () => {
  const loaded = await host.load(fixture);
  const a = await loaded.frame(base);
  await loaded.frame({ ...base, time: 3.1, params: { "tube.girth": 1.7 }, construction: true });
  const b = await loaded.frame(base);
  expect(differing(a, b)).toBe(0);
  loaded.destroy();
});

test("time, a param, an input, curves and the construction layer each change the picture", async () => {
  const loaded = await host.load(fixture);
  const ref = await loaded.frame(base);
  // Each of these reaches the GPU by a different route: pose tables, params buffer, inputs buffer, curve buffer, draw filtering.
  const changed = {
    time: await loaded.frame({ ...base, time: 1.4 }),
    param: await loaded.frame({ ...base, params: { "tube.girth": 1.5 } }),
    input: await loaded.frame({ ...base, inputs: { "tube.belly": [0.2, 0.9, 0.3] } }),
    construction: await loaded.frame({ ...base, construction: true }),
  };
  const curves = fixture.curves.map((v) => v * 0.5);
  loaded.setCurves(curves);
  const halved = await loaded.frame(base);
  loaded.setCurves(fixture.curves);
  const restored = await loaded.frame(base);
  for (const [what, px] of Object.entries(changed)) expect([what, differing(ref, px) > 100]).toEqual([what, true]);
  expect(differing(ref, halved)).toBeGreaterThan(100);
  expect(differing(ref, restored)).toBe(0);
  loaded.destroy();
});

test("a view naming an input or param the artefact lacks is rejected by name", async () => {
  const loaded = await host.load(fixture);
  await expect(loaded.frame({ ...base, params: { "tube.grith": 1 } })).rejects.toThrow(/tube\.grith/);
  await expect(loaded.frame({ ...base, inputs: { "tube.belly": [1, 0] } })).rejects.toThrow(/tube\.belly.*expected 3/);
  loaded.destroy();
});

test("a shader with an error is reported by name with the WGSL compiler message", async () => {
  const broken: Artefact = { ...fixture, shaders: { ...fixture.shaders, fin: fixture.shaders.fin!.replace("curve(FIN_ROW", "curvy(FIN_ROW") } };
  const err = await host.load(broken).then(() => null, (e: Error) => e.message);
  expect(err).toContain(`shader "fin"`);
  expect(err).toContain("curvy");
});

test("cpu tables uploaded with the wrong length, or not at all, are rejected by name", async () => {
  const short = await host.load({ ...fixture, cpuPose: () => [{ buffer: "stations", offset: 0, data: new Float32Array(10) }] });
  await expect(short.frame(base)).rejects.toThrow(/"stations" with 10 floats; expected 288/);
  const missing = await host.load({ ...fixture, cpuPose: () => [] });
  await expect(missing.frame(base)).rejects.toThrow(/did not return cpu table "stations"/);
  // The host stays usable after a rejected frame (the readback guard and error scopes are released).
  await expect(short.frame(base)).rejects.toThrow(/stations/);
  short.destroy(); missing.destroy();
});

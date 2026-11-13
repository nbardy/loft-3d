// The styles on a real device: what a style or interface change would silently break if these were absent.
import { beforeAll, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import serpent from "../examples/serpent.ts";
import shell from "../examples/shell.ts";
import scales from "../examples/serpent_scales.ts";
import type { Camera, View } from "../src/artefact.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost, type GpuHost } from "../src/host/index.ts";
import { compile, draw, scene, spacing, surface, vec3, vec4, type Scene, type Style } from "../src/index.ts";
import { STYLE_NAMES, styleNamed, withStyle, WOODBLOCK_PALETTE, woodblock } from "../src/style/index.ts";
import { SHEET_CAMERA } from "../src/style/sheet.ts";
import { TOON_REFERENCE } from "./fixtures/make_toon_reference.ts";

let host: GpuHost;
beforeAll(async () => { host = createHost(await headlessDevice()); });

const frameOf = async (s: Scene, view: Omit<View, "time"> & { time?: number }): Promise<Uint8Array> => {
  const loaded = await host.load(compile(s));
  const rgba = await loaded.frame({ time: 1.3, ...view });
  loaded.destroy();
  return rgba;
};

// Catches: WGSL a style emits that Dawn rejects (its shade, water, sky, ink or a post pass: syntax, uniformity of a
// derivative, a name colliding with sceneWgsl), and a frame that comes out one flat colour (a NaN or a pass that
// overwrites the picture). Loading builds every pipeline the host will use, post passes included.
test.each(STYLE_NAMES.map((s) => [s]))("every example compiles, builds its pipelines and draws a picture under %s", async (name) => {
  for (const [label, s] of [["serpent", serpent], ["shell", shell], ["scales", scales]] as const) {
    const rgba = await frameOf(withStyle(s, styleNamed(name)), { camera: SHEET_CAMERA, width: 96, height: 60 });
    const colours = new Set<number>();
    for (let i = 0; i < rgba.length; i += 4) colours.add((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
    expect([label, colours.size > 50]).toEqual([label, true]);
  }
}, 300000);

// Regression guard for the interface changes (WaterCtx.contact and .phase split the sea's contact foam into a band
// and toon's shaping of it): toon's frame must equal the one rendered at the commit before any style work, byte for
// byte. Regenerate the reference only on purpose: `bun tests/fixtures/make_toon_reference.ts`. Regenerated 2026-11-11
// when copies made with draw.points began to cast shadows (52 pixels of the sea darker under the spikes, nothing else);
// the body-coordinate change to styles just before it left this frame byte-identical. Regenerated again 2026-11-11 for
// level of detail: the sea became a projected grid and bodies at 200 x 125 draw at coarse levels (22210 of 100000
// bytes changed, almost all on the sea's interpolated surface; tests/detail.gpu.test.ts bounds the change at full size).
// Regenerated again 2026-11-11 when the pose moved to the GPU (docs/gpu_native.md): the tables are f32 from compute
// stages instead of f64 rounded on the CPU; 18 of 25000 pixels changed (23 bytes, at most 44 of 255, silhouette edges).
// Regenerated again 2026-11-11 for rate lifting (docs/gpu_native.md "Rates": constants folded in f32, per-frame work
// moved into frame values): 5 pixels changed by 1 of 255 in one channel each.
test("toon renders exactly as before the style interface grew", async () => {
  const ref = gunzipSync(readFileSync(TOON_REFERENCE.path));
  const a = compile(serpent);
  const rgba = await frameOf(serpent, { camera: a.cameras.three!, width: TOON_REFERENCE.width, height: TOON_REFERENCE.height, time: TOON_REFERENCE.time });
  let differing = 0;
  for (let i = 0; i < rgba.length; i++) if (rgba[i] !== ref[i]) differing++;
  expect(differing).toBe(0);
}, 120000);

/** A flat plate 40 units square at height 2, seen at a grazing angle (the hard case for normals from depth). */
// Catches: a woodblock body showing a colour that is not one of its five inks (a gradient leaking through the value
// bands, a lighting term added after the palette, a blend at the waterline). The sea and sky are replaced by flat
// cream, and post passes removed, so every pixel must be an ink, except antialiased edges: an off-palette pixel must
// sit between two different inks within 2 pixels. A gradient wider than that (a band edge antialiased over a soft
// minimum instead of a pixel, which this caught on the shell's flank: 1281 such pixels) has pixels with no ink near
// them. Measured at 800x500: 1.4% of the serpent's body pixels and 1.7% of the shell's are not between two inks,
// all on lines a pixel wide (a fin's rays, the shell's tile rims: painted dark, they never reach full black).
test("woodblock bodies print only in the palette's inks", async () => {
  const inks = Object.values(WOODBLOCK_PALETTE).map((c) => c.map((x) => Math.round(x * 255)));
  const cream = WOODBLOCK_PALETTE.cream;
  const base = woodblock();
  const flatGround: Style = { ...base, post: [], water: () => vec4(vec3(cream[0], cream[1], cream[2]), 1), shadow: () => vec4(0, 0, 0, 0), sky: () => vec3(cream[0], cream[1], cream[2]) };
  const W = 800, H = 500;
  for (const [label, s] of [["serpent", serpent], ["shell", shell]] as const) {
    const rgba = await frameOf(withStyle(s, flatGround), { camera: compile(s).cameras.three!, width: W, height: H });
    const ink = (i: number): number => {
      for (const [k, c] of inks.entries()) if (Math.abs(rgba[i]! - c[0]!) <= 2 && Math.abs(rgba[i + 1]! - c[1]!) <= 2 && Math.abs(rgba[i + 2]! - c[2]!) <= 2) return k;
      return -1;
    };
    const used = new Set<number>();
    let body = 0, edge = 0, stray = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const k = ink((y * W + x) * 4);
        if (k >= 0) { used.add(k); if (k !== 3) body++; continue; }
        edge++;
        const around = new Set<number>();
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const yy = Math.min(H - 1, Math.max(0, y + dy)), xx = Math.min(W - 1, Math.max(0, x + dx));
          const j = ink((yy * W + xx) * 4);
          if (j >= 0) around.add(j);
        }
        if (around.size < 2) stray++;
      }
    }
    console.log(`woodblock palette, ${label}: ${body} body pixels, ${edge} off-palette, ${stray} not between two inks`);
    expect([label, body > W * H * 0.02, used.size >= 4, stray < body * 0.025]).toEqual([label, true, true, true]);
  }
}, 120000);

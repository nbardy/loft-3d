// Lossless shots of scenes for before/after comparisons of the pose pass (docs/gpu_native.md phase 1).
//   bun tools/pose_shots.ts <outdir> [scene.ts:view ...]
// One PNG per scene (1280x800, t = 1), named after the scene file. Compare two directories with tools/picdiff.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { compile } from "../src/compile/index.ts";
import { createHost } from "../src/host/host.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { resolveCamera } from "../src/cli/cameras.ts";
import { encodePng } from "../src/cli/image.ts";
import type { Scene } from "../src/scene.ts";

export const POSE_SCENES = [
  "examples/serpent.ts:three", "examples/brig.ts:three", "examples/scenes/the_strike.ts:game",
  "examples/bosses/maelstrom_wyrm.ts:game", "examples/bosses/reefback_titan.ts:game", "examples/bosses/thundermaw.ts:game",
  "examples/bosses/tithe_fleet.ts:game", "examples/bosses/wreckers_lamp.ts:game",
];

if (import.meta.main) await shots();
async function shots(): Promise<void> {
const [dir, ...args] = process.argv.slice(2);
if (!dir) throw new Error("usage: bun tools/pose_shots.ts <outdir> [scene.ts:view ...]");
mkdirSync(dir, { recursive: true });
const device = await headlessDevice();
for (const spec of args.length > 0 ? args : POSE_SCENES) {
  const [path, viewName] = spec.split(":") as [string, string];
  const scene = ((await import(resolve(path))) as { default: Scene }).default;
  const a = compile(scene);
  const loaded = await createHost(device).load(a);
  const width = 1280, height = 800;
  const rgba = await loaded.frame({ camera: resolveCamera(a, viewName), width, height, time: 1 });
  loaded.destroy();
  writeFileSync(`${dir}/${basename(path, ".ts")}.png`, encodePng({ width, height, rgba }));
  console.log(`${path} ${viewName}`);
}
process.exit(0);
}

// Lossless pictures of a built artefact at 1280x800 for the sea's before/after comparison (docs/gpu_native.md "The
// sea"): one PNG per view:time, named <tag>_<view>_<time>.png, for tools/picdiff.ts.
//   bun tools/sea_shots.ts <dir> <out dir> <tag> <view:time> [view:time ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolveCamera } from "../src/cli/cameras.ts";
import { encodePng } from "../src/cli/image.ts";
import { readBundle } from "../src/host/files.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { loadBundle } from "../src/host/host.ts";

const [dir, out, tag, ...shots] = process.argv.slice(2) as [string, string, string, ...string[]];
mkdirSync(out, { recursive: true });
const device = await headlessDevice();
const bundle = readBundle(dir);
const loaded = await loadBundle(device, bundle, { kind: "none" });
for (const s of shots) {
  const [view, t] = s.split(":") as [string, string];
  const rgba = await loaded.frame({ camera: resolveCamera(bundle.manifest, view), width: 1280, height: 800, time: Number(t) });
  writeFileSync(`${out}/${tag}_${view}_${t}.png`, encodePng({ width: 1280, height: 800, rgba }));
}
loaded.destroy();
process.exit(0);

// Load time, pose-stage GPU time and pictures of a built artefact, from its files alone (docs/gpu_native.md "Rates"):
// one process per reading, so before and after can alternate with the same loader. Prints one JSON line.
//   bun tools/rates_bench.ts <dir> <proof name> [--png <dir>]
//   bun tools/rates_bench.ts <dir> <proof name> --profile   (per-frame costs at 1280x800, t = 1: GPU ms per draw and
//                                                            per fixed stage, the pose stages in one pass, and the
//                                                            frame's CPU pose and encode, least of 30 frames)
// Pictures: the proof's frames (tools/files_cases.ts), written as lossless PNG for tools/rates_picdiff.ts (lossy files
// would show up as differences). Load: reading the files is not counted, only modules and pipelines (`loadBundle`).
// Pose: `poseTime` at t = 1, 40 repetitions in one timed pass, least of 8, after a warm frame.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolveCamera } from "../src/cli/cameras.ts";
import { encodePng } from "../src/cli/image.ts";
import { readBundle } from "../src/host/files.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { loadBundle } from "../src/host/host.ts";
import { PROOFS, SIZE } from "./files_cases.ts";

const args = process.argv.slice(2);
const k = args.indexOf("--png");
const png = k < 0 ? undefined : args.splice(k, 2)[1];
const [dir, name] = args as [string, string];
const proof = PROOFS[name];
if (proof === undefined) throw new Error(`rates_bench: no proof named "${name}" (${Object.keys(PROOFS).join(", ")})`);
const device = await headlessDevice();
if (args.includes("--profile")) {
  const bundle = readBundle(dir);
  const loaded = await loadBundle(device, bundle, { kind: "none" });
  const view = { camera: resolveCamera(bundle.manifest, proof.view), width: 1280, height: 800, time: 1 };
  await loaded.frame(view);
  const p = await loaded.profile(view, 20);
  const normal = await loaded.frameGpu(view, 20);
  let pose = Infinity, encode = Infinity;
  for (let i = 0; i < 30; i++) { const t = (await loaded.frameTimed(view)).ms; pose = Math.min(pose, t.pose); encode = Math.min(encode, t.encode); }
  loaded.destroy();
  const draws: Record<string, { net: number; triangles: number }> = {};
  for (const d of p.draws) draws[d.label] = { net: d.net, triangles: d.triangles };
  const stages: Record<string, number> = {};
  for (const s of [...p.stages, ...p.poseStages]) stages[s.label] = s.ms;
  console.log(JSON.stringify({ normal, total: p.total, passOverhead: p.passOverhead, cpuPose: pose, cpuEncode: encode, draws, stages }));
  process.exit(0);
}
const bundle = readBundle(dir);
const t = performance.now();
const loaded = await loadBundle(device, bundle, { kind: "none" });
const loadMs = performance.now() - t;
const camera = resolveCamera(bundle.manifest, proof.view);
if (png !== undefined) mkdirSync(png, { recursive: true });
for (const [i, c] of proof.cases.entries()) {
  const rgba = await loaded.frame({ camera, ...SIZE, ...c });
  if (png !== undefined) writeFileSync(`${png}/${name}_${i}.png`, encodePng({ ...SIZE, rgba }));
}
const view = { camera, width: 1280, height: 800, time: 1 };
await loaded.frame(view);
const pose = await loaded.poseTime(view, 40, 8);
loaded.destroy();
console.log(JSON.stringify({ loadMs: Math.round(loadMs), poseMs: pose.total, levels: pose.stages.length }));
process.exit(0);

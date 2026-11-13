// GPU time of the pose stages alone (docs/gpu_native.md phase 1), per scene: every stage dispatched `repeats` times in
// one timed compute pass, divided by the repeats, the least of several rounds (GpuLoaded.poseTime). Also the CPU
// milliseconds of a frame's pose work (frame state, `cpu` tables, uploads, submit, level-of-detail plan), best of the
// frames of `profile`.
//   bun tools/pose_time.ts [scene.ts:view ...]
import { resolve } from "node:path";
import { compile } from "../src/compile/index.ts";
import { createHost } from "../src/host/host.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { resolveCamera } from "../src/cli/cameras.ts";
import type { Scene } from "../src/scene.ts";
import { POSE_SCENES } from "./pose_shots.ts";

const device = await headlessDevice();
for (const spec of process.argv.length > 2 ? process.argv.slice(2) : POSE_SCENES) {
  const [path, viewName] = spec.split(":") as [string, string];
  const a = compile(((await import(resolve(path))) as { default: Scene }).default);
  const loaded = await createHost(device).load(a);
  const view = { camera: resolveCamera(a, viewName), width: 1280, height: 800, time: 1 };
  await loaded.frame(view);
  const t = await loaded.poseTime(view, 40, 8), gpu = t.total;
  let cpu = Infinity;
  for (let i = 0; i < 30; i++) cpu = Math.min(cpu, (await loaded.frameTimed(view)).ms.pose);
  const kinds = { map: 0, scan: 0, cpu: 0 };
  for (const t of a.tables) kinds[t.fill.kind]++;
  console.log(`${path.padEnd(40)} pose stages ${gpu.toFixed(3)} ms GPU in ${a.stages.length} levels; CPU pose ${cpu.toFixed(3)} ms; tables ${kinds.map} map ${kinds.scan} scan ${kinds.cpu} cpu`);
  if (process.env.POSE_LEVELS) a.stages.forEach((st, k) => console.log(`  ${t.stages[k]!.toFixed(3)}  ${st.invocations} inv  ${st.label.slice(0, 110)}`));
  loaded.destroy();
}
process.exit(0);

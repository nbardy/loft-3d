// Pictures and best-case cost of the traced examples (coral, nest, pearls) per schedule and camera, at 1280x800.
//
// Cost is "tracer only": the GPU's own time (timestamp queries, tools/gpu_time.ts) for a render pass holding only the
// traced draws, best of `rounds`. Every (schedule, camera) pair is timed once per round, round-robin, so all of them see
// the same quiet moments of this shared GPU: a pass's elapsed GPU time includes time the GPU spent on other processes,
// and wall-clock frame differences moved by milliseconds with the load. Pictures are the whole scene through the host,
// written as raw RGBA (for differencing) and WebP (for looking) under `out/tracer/<tag>/<schedule>/`.
//
// `bun tools/tracer_bench.ts <tag> [rounds] [scene,scene] [schedule,schedule] [base-dir]`. Schedules: the scene's own
// (`own`) or trace | brick | mesh | auto for every draw.field, and `base`: the scene as compiled by another checkout of
// this repository at base-dir (for example `git archive <ref> | tar -x -C dir`, node_modules linked), so a before and an
// after are timed in the same rounds. Cameras: the scene's own, plus `far` (the overview `three` at twice its distance).
// Prints compile time (the bake included) and the static tables' size.
import { mkdirSync, writeFileSync } from "node:fs";
import type { Artefact, Camera } from "../src/artefact.ts";
import { compile, type Scene } from "../src/index.ts";
import { setupGlobals } from "bun-webgpu";
import { createHost } from "../src/host/index.ts";
import { gpuTimer, type GpuTimer } from "./gpu_time.ts";
import { writeWebp } from "../src/cli/image.ts";
import { FieldDrawable, type FieldSchedule } from "../src/draw/field.ts";
import coral from "../examples/coral.ts";
import coralList from "../examples/coral_list.ts";
import nest from "../examples/nest.ts";
import pearls from "../examples/pearls.ts";

const tag = process.argv[2] ?? "now";
const rounds = Number(process.argv[3] ?? 30);
const which = (process.argv[4] ?? "coral,nest,pearls").split(",");
const schedules = (process.argv[5] ?? "own").split(",") as (FieldSchedule | "own" | "base")[];
const baseDir = process.argv[6];
const W = 1280, H = 800;
const SCENES: Record<string, Scene> = { coral, coral_list: coralList, nest, pearls };
/** The draws a traced example adds (its field or impostors, and a meshed field's ink hull). */
const traced = (label: string): boolean => /^(coral|nest|pearls)(_ink)?$/.test(label);

/** The scene with every field drawn on the given schedule (a fresh drawable: its bake is its own). */
const withSchedule = (s: Scene, k: FieldSchedule | "own" | "base"): Scene =>
  k === "own" || k === "base" ? s : { ...s, things: s.things.map((t) => (t instanceof FieldDrawable ? new FieldDrawable(t.name, t.field, { ...t.o, schedule: k }) : t)) };

/** The example compiled by the checkout at `baseDir` (its own modules: nothing is shared with this one). */
async function baseArtefact(name: string): Promise<Artefact> {
  if (!baseDir) throw new Error("schedule base: pass the base checkout's directory as the fifth argument");
  const root = new URL(`file://${process.cwd()}/${baseDir}/`);
  const scene = (await import(new URL(`examples/${name}.ts`, root).href)).default;
  return (await import(new URL("src/index.ts", root).href)).compile(scene) as Artefact;
}

const far = (c: Camera): Camera => {
  if (c.kind !== "perspective") throw new Error("far: perspective cameras only");
  const e = c.eye.map((x, i) => c.target[i]! + 2 * (x - c.target[i]!)) as unknown as Camera["eye"];
  return { ...c, eye: e };
};

await setupGlobals();
const device = await (await navigator.gpu.requestAdapter())!.requestDevice({ requiredFeatures: ["timestamp-query"] });
const host = createHost(device);
for (const name of which) {
  const runs: { schedule: string; timer: GpuTimer }[] = [];
  let cams: [string, Camera][] = [];
  for (const k of schedules) {
    const t0 = performance.now();
    const a: Artefact = k === "base" ? await baseArtefact(name) : compile(withSchedule(SCENES[name]!, k));
    const ms = performance.now() - t0;
    const mb = (a.statics ?? []).reduce((n, s) => n + s.data.byteLength, 0) / 2 ** 20;
    console.log(`${name} ${k}: compile ${ms.toFixed(0)} ms, static tables ${mb.toFixed(2)} MB, ${a.stats.maxTriangles} triangles declared`);
    cams = [...Object.entries(a.cameras), ["far", far(a.cameras.three!)]];
    const dir = `out/tracer/${tag}/${k}`;
    mkdirSync(dir, { recursive: true });
    const full = await host.load(a);
    for (const [cn, camera] of cams) {
      const px = await full.frame({ camera, width: W, height: H, time: 0 });
      writeFileSync(`${dir}/${name}_${cn}.rgba`, px);
      writeWebp(`${dir}/${name}_${cn}.webp`, { width: W, height: H, rgba: px });
    }
    full.destroy();
    runs.push({ schedule: k, timer: await gpuTimer(device, a, traced, W, H) });
  }
  const best = runs.map(() => cams.map(() => Infinity));
  for (let r = 0; r < rounds; r++) {
    for (const [i, run] of runs.entries()) for (const [j, [, camera]] of cams.entries()) best[i]![j] = Math.min(best[i]![j]!, await run.timer.time(camera, 1));
  }
  console.log(`${name}, ms (best of ${rounds}):  ${cams.map(([c]) => c.padStart(6)).join(" ")}`);
  for (const [i, run] of runs.entries()) console.log(`  ${run.schedule.padEnd(6)} ${best[i]!.map((x) => x.toFixed(2).padStart(6)).join(" ")}`);
  for (const run of runs) run.timer.destroy();
}
process.exit(0);

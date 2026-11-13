// loft CLI. Dispatch only: each command is one function below.
import { createHash } from "node:crypto";
import { loopTime, OPEN, type Loop } from "../artefact.ts";
import type { Artefact } from "../artefact.ts";
import type { GpuLoaded } from "../host/host.ts";
import { parseArgs, USAGE, UsageError, type Command } from "./args.ts";
import { resolveCamera } from "./cameras.ts";
import { contactSheet, writeWebp, type Frame } from "./image.ts";
import { checkInputs, viewInputs, type Sweep } from "./inputs.ts";
import { headlessHost, loadArtefact } from "./load.ts";
import { openVideo } from "./video.ts";
import { exitWith, headed, verdictOf } from "./verdict.ts";
import { EnvironmentError } from "../errors.ts";

const ms = (t0: number) => `${(performance.now() - t0).toFixed(1)} ms`;

/** What the CLI reads of an artefact, whichever way it came: compiled here, or a built directory. */
type Info = Pick<Artefact, "cameras" | "inputs" | "stats">;

async function open(cmd: Extract<Command, { kind: "render" | "frames" | "clip" }>, sweep: Sweep): Promise<{ info: Info; loaded: GpuLoaded }> {
  let t = performance.now();
  switch (cmd.source.kind) {
    case "artefact": {
      // Without the compiler: the loader reads the directory alone (src/cli/run_files.ts).
      const { openFiles } = await import("./run_files.ts");
      const { bundle, loaded } = await openFiles(cmd.source.dir);
      const m = bundle.manifest;
      checkInputs(m, cmd.inputs, sweep);
      console.log(`files    ${ms(t)}  read and loaded ${cmd.source.dir}  (${fillCounts(m.tables)}; ${m.modules.length} modules, ${m.renderPipelines.length + m.computePipelines.length} pipelines)`);
      return { info: m, loaded };
    }
    case "file": case "fixture": {
      const artefact = await loadArtefact(cmd.source);
      checkInputs(artefact, cmd.inputs, sweep);
      console.log(`compile  ${ms(t)}  (at most ${artefact.stats.maxTriangles} triangles, ${artefact.stats.draws} draws)`);
      t = performance.now();
      const loaded = await loadedWithRetries(artefact);
      console.log(`load     ${ms(t)}`);
      return { info: artefact, loaded };
    }
  }
}

/**
 * The artefact on a fresh device, tried up to three times: a shader or pipeline that fails to build from WGSL the
 * compiler wrote is the environment's (until 2026-11-12 it was bun-webgpu freeing descriptor strings early, now
 * patched: docs/reliable_render.md), and a fresh device is what can make it pass.
 */
async function loadedWithRetries(artefact: Artefact): Promise<GpuLoaded> {
  const seen: string[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      return await (await headlessHost()).load(artefact);
    } catch (e) {
      if (!(e instanceof EnvironmentError && e.transient)) throw e;
      seen.push(headed(e.message)[0]);
      console.error(`loft: load attempt ${attempt} failed in the GPU (not the scene): ${seen.at(-1)}`);
      if (attempt === 3) {
        const same = seen.every((m) => m === seen[0]);
        throw new EnvironmentError(`${e.message}\nthe GPU refused the compiled scene on 3 fresh devices${same ? ", the same way each time: likely a bug in Loft's compiler, worth reporting" : ", differently each time"}`, false);
      }
    }
  }
}

/** The loop a drawn thing declares: a compiled scene's own; a built directory's manifest carries none yet, so its clock runs on. */
function loopOf(info: object): Loop {
  const l = (info as { readonly loop?: Loop }).loop;
  return l === undefined ? OPEN : l;
}

/** "n map, n scan, n cpu (not data)": how the per-frame tables are filled. */
function fillCounts(tables: readonly { readonly fill: { readonly kind: "map" | "scan" | "cpu" } }[]): string {
  const n = { map: 0, scan: 0, cpu: 0 };
  for (const t of tables) n[t.fill.kind]++;
  return `tables ${n.map} map, ${n.scan} scan, ${n.cpu} cpu (not data)`;
}

async function timed(label: string, draw: () => ReturnType<GpuLoaded["frameTimed"]>): Promise<Uint8Array> {
  const t = performance.now();
  const r = await draw();
  // The hash names the exact RGBA, so two ways of drawing a frame can be compared without keeping a lossless picture.
  const sha = createHash("sha256").update(r.pixels).digest("hex").slice(0, 16);
  console.log(`frame    ${ms(t)}  ${label}  (${r.drawn.triangles} triangles drawn, ${r.drawn.draws} draw calls)  rgba ${sha}`);
  return r.pixels;
}

/** A files render must not have loaded the compiler: checked at the end, from what this process actually loaded. */
async function witness(cmd: Extract<Command, { kind: "render" | "frames" | "clip" }>): Promise<void> {
  if (cmd.source.kind !== "artefact") return;
  const loadedNow = (await import("./run_files.ts")).compilerModulesLoaded();
  if (loadedNow.length > 0) throw new Error(`--artefact: the compiler was loaded: ${loadedNow.join(", ")}`);
  console.log("compiler modules loaded: 0");
}

async function render(cmd: Extract<Command, { kind: "render" }>) {
  const { info: artefact, loaded } = await open(cmd, { kind: "none" });
  const frames: Frame[] = [];
  for (const name of cmd.views) {
    const camera = resolveCamera(artefact, name);
    const rgba = await timed(name, () => loaded.frameTimed({ camera, ...cmd.size, time: loopTime(loopOf(artefact), cmd.time), params: cmd.params, inputs: cmd.inputs, construction: cmd.construction }));
    frames.push({ ...cmd.size, rgba });
  }
  loaded.destroy();
  const sheet = contactSheet(frames);
  writeWebp(cmd.out, sheet);
  console.log(`wrote ${cmd.out}  ${sheet.width}x${sheet.height}  [${cmd.views.join(", ")}]`);
  await witness(cmd);
}

async function frames(cmd: Extract<Command, { kind: "frames" }>) {
  const { info: artefact, loaded } = await open(cmd, cmd.sweep);
  const camera = resolveCamera(artefact, cmd.view);
  const out: Frame[] = [];
  for (const [k, time] of cmd.times.entries()) {
    const inputs = viewInputs(cmd.inputs, cmd.sweep, k, cmd.times.length);
    const label = cmd.sweep.kind === "linear" ? `t=${time} ${cmd.sweep.name}=${inputs[cmd.sweep.name]!.map((x) => +x.toFixed(4)).join(",")}` : `t=${time}`;
    const rgba = await timed(label, () => loaded.frameTimed({ camera, ...cmd.size, time: loopTime(loopOf(artefact), time), params: cmd.params, inputs }));
    out.push({ ...cmd.size, rgba });
  }
  loaded.destroy();
  const sheet = contactSheet(out);
  writeWebp(cmd.out, sheet);
  console.log(`wrote ${cmd.out}  ${sheet.width}x${sheet.height}  times [${cmd.times.join(", ")}]`);
  await witness(cmd);
}

async function clip(cmd: Extract<Command, { kind: "clip" }>) {
  const { info: artefact, loaded } = await open(cmd, cmd.sweep);
  const camera = resolveCamera(artefact, cmd.view);
  const count = Math.round(cmd.seconds * cmd.fps);
  const video = openVideo(cmd.out, cmd.size.width, cmd.size.height, cmd.fps);
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    const rgba = await loaded.frame({ camera, ...cmd.size, time: loopTime(loopOf(artefact), i / cmd.fps), params: cmd.params, inputs: viewInputs(cmd.inputs, cmd.sweep, i, count) });
    await video.write(rgba);
  }
  await video.finish();
  loaded.destroy();
  console.log(`frame    ${((performance.now() - t0) / count).toFixed(1)} ms mean over ${count} frames (render + encode)`);
  console.log(`wrote ${cmd.out}  ${count} frames at ${cmd.fps} fps`);
  await witness(cmd);
}

/** `loft build`: compile, lower, write the directory (`writeBundle` refuses `cpu` tables by name). */
async function build(cmd: Extract<Command, { kind: "build" }>) {
  let t = performance.now();
  const artefact = await loadArtefact(cmd.source);
  console.log(`compile  ${ms(t)}  ${fillCounts(artefact.tables)}`);
  t = performance.now();
  const [{ lower }, { writeBundle }] = await Promise.all([import("../host/lower.ts"), import("../host/files.ts")]);
  const bundle = lower(artefact);
  const sizes = writeBundle(cmd.out, bundle);
  const m = bundle.manifest;
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`lower    ${ms(t)}  ${m.modules.length} modules from ${m.chunks.length} chunks, ${m.renderPipelines.length} render and ${m.computePipelines.length} compute pipelines, ${m.frame.passes.length} passes`);
  console.log(`wrote ${cmd.out}  ${sizes.files} files: wgsl ${kb(sizes.wgsl)}, bin ${kb(sizes.bin)}, manifest ${kb(sizes.manifest)}`);
}

async function main(argv: readonly string[]) {
  const cmd = parseArgs(argv);
  switch (cmd.kind) {
    case "render": return render(cmd);
    case "frames": return frames(cmd);
    case "clip": return clip(cmd);
    case "dev": return (await import("./dev.ts")).dev(cmd);
    case "bake": return (await import("../bake/command.ts")).bake(cmd);
    case "build": return build(cmd);
    case "check": return (await import("./check.ts")).check(cmd);
    case "gallery": return (await import("./gallery.ts")).gallery(cmd);
    case "profile": return (await import("./profile.ts")).profile(cmd);
    case "variants": return (await import("./variants.ts")).variants(cmd);
    case "help": return void console.log(USAGE);
    case "api": {
      const api = await import("./api.ts");
      try {
        return void console.log(cmd.name.kind === "all" ? api.apiFull() : api.apiOne(cmd.name.name));
      } catch (e) {
        if (e instanceof api.ApiError) throw new UsageError(`api: ${e.message}`);
        throw e;
      }
    }
    case "context": return void console.log((await import("./context.ts")).context());
  }
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  exitWith(await verdictOf(e));
}

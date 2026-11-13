// WGSL volume of a built artefact (docs/gpu_native.md, "Rates"): the unique chunk bytes (what the files hold), the bytes
// of every module as a loader hands it to the driver (chunks repeated per module), the same weighted by the pipelines
// that compile each module, and the largest module.
//   bun tools/wgsl_bytes.ts <dir> [<dir> ...]
import { readFileSync } from "node:fs";
import type { Manifest } from "../src/host/manifest.ts";

export function wgslBytes(dir: string): { unique: number; modules: number; pipelines: number; largest: number; largestLabel: string; count: number } {
  const m = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) as Manifest;
  const size = m.chunks.map((c) => readFileSync(`${dir}/wgsl/${c}.wgsl`).byteLength);
  const mod = m.modules.map((x) => x.chunks.reduce((n, c) => n + size[c]!, 0));
  let pipelines = 0;
  for (const p of m.computePipelines) pipelines += mod[p.module]!;
  for (const p of m.renderPipelines) pipelines += mod[p.vertex.module]! + mod[p.fragment.module]!;
  const k = mod.indexOf(Math.max(...mod));
  return {
    unique: size.reduce((a, b) => a + b, 0), modules: mod.reduce((a, b) => a + b, 0), pipelines,
    largest: mod[k]!, largestLabel: m.modules[k]!.label, count: m.modules.length,
  };
}

if (import.meta.main) {
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  for (const dir of process.argv.slice(2)) {
    const b = wgslBytes(dir);
    console.log(`${dir.padEnd(36)} unique ${kb(b.unique)}  modules ${kb(b.modules)} (${b.count})  by pipeline ${kb(b.pipelines)}  largest ${kb(b.largest)} ${b.largestLabel.slice(0, 60)}`);
  }
}

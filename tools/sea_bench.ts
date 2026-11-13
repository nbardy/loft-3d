// Normal-frame GPU time of several built artefacts of one scene, timed in the same rounds (docs/gpu_native.md "The
// sea"): every directory is loaded once on one device, and each round takes the least of `frames` normal frames of
// each in turn, so before and after see the same clock state and the same load from other processes. Prints, per
// directory, the least and the median over rounds, and the median of its per-round differences from the first.
//   bun tools/sea_bench.ts <proof name> <rounds> <dir> [dir ...] [--time t] [--view camera] [--frames n] [--size WxH]
// A larger size scales the per-pixel work (the sea's) while fixed costs stay: use it to price small parts above the
// timer's tick.
import { resolveCamera } from "../src/cli/cameras.ts";
import { readBundle } from "../src/host/files.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { loadBundle } from "../src/host/host.ts";
import { PROOFS } from "./files_cases.ts";

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const time = Number(opt("--time") ?? 1);
const viewName = opt("--view");
const frames = Number(opt("--frames") ?? 10);
const [W, H] = (opt("--size") ?? "1280x800").split("x").map(Number) as [number, number];
const [name, roundsArg, ...dirs] = args as [string, string, ...string[]];
const proof = PROOFS[name];
if (proof === undefined) throw new Error(`sea_bench: no proof named "${name}" (${Object.keys(PROOFS).join(", ")})`);
const rounds = Number(roundsArg);
const device = await headlessDevice();
const loaded = [];
for (const d of dirs) {
  const bundle = readBundle(d);
  const l = await loadBundle(device, bundle, { kind: "none" });
  const view = { camera: resolveCamera(bundle.manifest, viewName ?? proof.view), width: W, height: H, time };
  await l.frame(view);
  loaded.push({ l, view });
}
const ms: number[][] = dirs.map(() => []);
for (let r = 0; r < rounds; r++) {
  // Alternate the order each round, so neither always runs right after the other.
  const order = r % 2 === 0 ? loaded.map((_, i) => i) : loaded.map((_, i) => loaded.length - 1 - i);
  for (const i of order) ms[i]!.push((await loaded[i]!.l.frameGpu(loaded[i]!.view, frames)).ms);
  console.log(`round ${r}: ${ms.map((m) => m[r]!.toFixed(3)).join("  ")}`);
}
const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
// Paired: each round's difference from the first directory, so a round in the slow clock state (or under another
// process's load) moves both terms together instead of widening the spread.
for (const [i, d] of dirs.entries()) {
  const diff = ms[i]!.map((x, r) => x - ms[0]![r]!);
  console.log(`${d}: least ${Math.min(...ms[i]!).toFixed(3)}  median ${median(ms[i]!).toFixed(3)}  max ${Math.max(...ms[i]!).toFixed(3)}  paired difference from the first: median ${median(diff).toFixed(3)} (${Math.min(...diff).toFixed(3)} to ${Math.max(...diff).toFixed(3)})`);
}
for (const l of loaded) l.l.destroy();
process.exit(0);

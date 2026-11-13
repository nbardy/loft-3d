// The Rust loader (rust/loft-loader, `loft-view`) against the Dawn host, drawing the same artefact folders
// (docs/gpu_native.md, "Rust loader"). Per scene of tools/files_cases.ts, three frames (t = 1; t = 2.5; t = 2.5 with an
// input or param changed), each from a fresh load on both sides (so no level-of-detail memory carries between frames),
// one render at a time.
//   bun tools/rust_compare.ts [--size 1280x800] [--only grab,thundermaw] [--keep]
//   bun tools/rust_compare.ts --time [--rounds 3] [--only ...]
// Folders: out/rust/files/<scene> (`bun src/cli/main.ts build <scene> --out out/rust/files/<scene>`; the stilt crab with
// `--variant stilt --out out/rust/files/reefback_stilt`). The binary is rust/loft-loader/target/release/loft-view
// (`cargo build --release` there).
//
// Pictures: per frame, the pixels whose largest channel differs by more than 8/255, and what they are: how many sit
// at an edge of the Dawn picture (an 8-neighbour differs by more than 24/255 there), the largest 8-connected cluster of
// them (a whole-region difference shows as one large cluster), and the mean signed difference per channel over the
// whole frame (a colour shift). A side-by-side sheet (Dawn, Rust, differences x8) is written as WebP for every frame
// with a difference; the lossless PNGs are deleted unless --keep.
//
// --time: rounds alternating the hosts, per scene, least per round. Dawn: `frameTimed` x 30 and `frameGpu` x 120 on one load, CPU = pose +
// encode (its encode includes awaiting an error scope); GPU = `frameGpu` (profile's "normal frame"). Rust: `loft-view
// --frames 120 --wait` (the same headless frame: CPU in the loader less GPU waits, GPU by the same two spans), and
// `--frames 120` without waiting (a game's frame) for CPU. Pose stages alone: `poseTime(view, 40, 8)` and `--pose-time`.
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolveCamera } from "../src/cli/cameras.ts";
import { encodePng, writeWebp, type Frame } from "../src/cli/image.ts";
import { readBundle } from "../src/host/files.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { loadBundle } from "../src/host/host.ts";
import { PROOFS, type Case, type Proof } from "./files_cases.ts";
import { readPng } from "./picdiff.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const [width, height] = (flag("--size") ?? "1280x800").split("x").map(Number) as [number, number];
const only = flag("--only")?.split(",");
const keep = args.includes("--keep");
const OUT = "out/rust/compare";
const BIN = "rust/loft-loader/target/release/loft-view";
mkdirSync(OUT, { recursive: true });
if (!existsSync(BIN)) throw new Error(`${BIN} missing: cargo build --release in rust/loft-loader`);

const device = await headlessDevice();
// The proofs' scenes, and the crab's tallest variant (most draws), drawn like the crab.
const CASES: Readonly<Record<string, Proof>> = { ...PROOFS, reefback_stilt: PROOFS.reefback_titan! };
const scenes = Object.entries(CASES).filter(([name]) => only === undefined || only.includes(name));
const dirOf = (name: string) => {
  const dir = `out/rust/files/${name}`;
  if (!existsSync(`${dir}/manifest.json`)) throw new Error(`${dir} missing: bun src/cli/main.ts build ${CASES[name]!.path} --out ${dir}`);
  return dir;
};

/** loft-view's flags for one case. */
const caseFlags = (c: Case): string[] => [
  "--time", String(c.time),
  ...Object.entries(c.inputs ?? {}).flatMap(([k, v]) => ["--input", `${k}=${v}`]),
  ...Object.entries(c.params ?? {}).flatMap(([k, v]) => ["--param", `${k}=${v}`]),
];

function run(cmd: string[]): string {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed (${r.exitCode}):\n${r.stderr.toString()}`);
  return r.stdout.toString() + r.stderr.toString();
}

type Diff = { readonly over8: number; readonly over1: number; readonly edge: number; readonly cluster: number; readonly bbox: string; readonly shift: readonly number[]; readonly max: number };

function compare(a: Frame, b: Frame): { readonly diff: Diff; readonly sheet: Frame } {
  const n = a.width * a.height, w = a.width;
  const big = new Uint8Array(n);
  const largest = (i: number, x: Uint8Array, y: Uint8Array, j: number) => Math.max(Math.abs(x[4 * i]! - y[4 * j]!), Math.abs(x[4 * i + 1]! - y[4 * j + 1]!), Math.abs(x[4 * i + 2]! - y[4 * j + 2]!));
  let over8 = 0, over1 = 0, edge = 0, max = 0;
  const shift = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) shift[c]! += b.rgba[4 * i + c]! - a.rgba[4 * i + c]!;
    const d = largest(i, a.rgba, b.rgba, i);
    max = Math.max(max, d);
    if (d > 1) over1++;
    if (d <= 8) continue;
    over8++; big[i] = 1;
    const x = i % w, y = (i - x) / w;
    let contrast = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < a.height) contrast = Math.max(contrast, largest(i, a.rgba, a.rgba, yy * w + xx));
    }
    if (contrast > 24) edge++;
  }
  // Largest 8-connected cluster of >8 pixels.
  let cluster = 0, bbox = "-";
  const seen = new Uint8Array(n), stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!big[s] || seen[s]) continue;
    let size = 0, x0 = w, y0 = a.height, x1 = 0, y1 = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!, x = i % w, y = (i - x) / w;
      size++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, j = yy * w + xx;
        if (xx >= 0 && yy >= 0 && xx < w && yy < a.height && big[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (size > cluster) { cluster = size; bbox = `${x1 - x0 + 1}x${y1 - y0 + 1} at ${x0},${y0}`; }
  }
  const sheet = { width: w * 3, height: a.height, rgba: new Uint8Array(w * 3 * a.height * 4) };
  for (let y = 0; y < a.height; y++) {
    sheet.rgba.set(a.rgba.subarray(y * w * 4, (y + 1) * w * 4), y * w * 12);
    sheet.rgba.set(b.rgba.subarray(y * w * 4, (y + 1) * w * 4), y * w * 12 + w * 4);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = y * w * 12 + w * 8 + x * 4;
      for (let c = 0; c < 3; c++) sheet.rgba[o + c] = Math.min(255, 8 * Math.abs(a.rgba[4 * i + c]! - b.rgba[4 * i + c]!));
      sheet.rgba[o + 3] = 255;
    }
  }
  return { diff: { over8, over1, edge, cluster, bbox, shift: shift.map((s) => s / n), max }, sheet };
}

async function pictures(): Promise<void> {
  console.log(`size ${width}x${height}; columns: >8/255 (share), of them at an edge, largest cluster, >1/255, max, mean signed shift r g b (Rust - Dawn)`);
  for (const [name, proof] of scenes) {
    const dir = dirOf(name);
    const bundle = readBundle(dir);
    const camera = resolveCamera(bundle.manifest, proof.view);
    for (const [k, c] of proof.cases.entries()) {
      const dawnPng = `${OUT}/${name}_${k}_dawn.png`, rustPng = `${OUT}/${name}_${k}_rust.png`;
      const loaded = await loadBundle(device, bundle, { kind: "none" });
      const rgba = await loaded.frame({ camera, width, height, ...c });
      loaded.destroy();
      await Bun.write(dawnPng, encodePng({ width, height, rgba }));
      run([BIN, dir, "--view", proof.view, "--size", `${width}x${height}`, "--out", rustPng, ...caseFlags(c)]);
      const { diff: d, sheet } = compare(readPng(dawnPng), readPng(rustPng));
      const label = `${name} ${JSON.stringify(c)}`;
      console.log(`${label.padEnd(72)} ${String(d.over8).padStart(6)} (${(100 * d.over8 / (width * height)).toFixed(4)}%)  edge ${d.edge}  cluster ${d.cluster} (${d.bbox})  >1 ${d.over1}  max ${d.max}  shift ${d.shift.map((s) => s.toFixed(3)).join(" ")}`);
      if (d.over1 > 0) writeWebp(`${OUT}/${name}_${k}.webp`, sheet);
      if (!keep) { rmSync(dawnPng); rmSync(rustPng); }
    }
  }
}

/** Dawn's load, retried once on the intermittent module failure AGENTS.md records ("null character found" seen here). */
async function loadDawn(bundle: ReturnType<typeof readBundle>) {
  try {
    return await loadBundle(device, bundle, { kind: "none" });
  } catch (e) {
    console.log(`  (Dawn load failed, retried once: ${String(e).split("\n").slice(0, 3).join(" ")})`);
    return await loadBundle(device, bundle, { kind: "none" });
  }
}

const range = (xs: readonly number[]) => `${Math.min(...xs).toFixed(3)}-${Math.max(...xs).toFixed(3)}`;

/** Frames per timing run: long enough that the GPU's clock usually leaves its slow state. */
const FRAMES = 120;

async function times(): Promise<void> {
  const rounds = Number(flag("--rounds") ?? 3);
  for (const [name, proof] of scenes) {
    const dir = dirOf(name);
    const bundle = readBundle(dir);
    const camera = resolveCamera(bundle.manifest, proof.view);
    const dawn = { cpu: [] as number[], gpu: [] as number[], inFrame: [] as number[], pose: [] as number[] };
    const rust = { cpu: [] as number[], game: [] as number[], gpu: [] as number[], inFrame: [] as number[], pose: [] as number[] };
    for (let r = 0; r < rounds; r++) {
      const loaded = await loadDawn(bundle);
      const view = { camera, width, height, time: 1 };
      let cpu = Infinity;
      for (let i = 0; i < 30; i++) {
        const t = await loaded.frameTimed(view);
        cpu = Math.min(cpu, t.ms.pose + t.ms.encode);
      }
      const g = await loaded.frameGpu(view, FRAMES);
      dawn.cpu.push(cpu); dawn.gpu.push(g.ms); dawn.inFrame.push(g.pose); dawn.pose.push((await loaded.poseTime(view, 40, 8)).total);
      loaded.destroy();
      const flags = [BIN, dir, "--view", proof.view, "--size", `${width}x${height}`, "--time", "1", "--frames", String(FRAMES)];
      const least = (out: string, label: string) => Number(new RegExp(`${label}\\s+least ([0-9.]+)`).exec(out)?.[1]);
      const waited = run([...flags, "--wait", "--pose-time"]), game = run(flags);
      rust.pose.push(Number(/pose stages ([0-9.]+) ms/.exec(waited)?.[1])); rust.inFrame.push(least(waited, "gpu  pose pass"));
      rust.cpu.push(least(waited, "cpu  frames 10\\+")); rust.gpu.push(least(waited, "gpu  per frame")); rust.game.push(least(game, "cpu  frames 10\\+"));
    }
    console.log(`${name.padEnd(16)} CPU Dawn ${range(dawn.cpu)}  Rust ${range(rust.cpu)} (game frame ${range(rust.game)})  | GPU frame Dawn ${range(dawn.gpu)}  Rust ${range(rust.gpu)} (its pose pass Dawn ${range(dawn.inFrame)}  Rust ${range(rust.inFrame)}: the clock state) | pose stages Dawn ${range(dawn.pose)}  Rust ${range(rust.pose)} ms   (least per round, ${rounds} rounds)`);
  }
}

await (args.includes("--time") ? times() : pictures());
process.exit(0);

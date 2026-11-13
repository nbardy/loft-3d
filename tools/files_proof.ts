// Phase 2's proof (docs/gpu_native.md): per scene, build the artefact as files, draw the proof frames from the files in
// a process that never loads the compiler (tools/files_frames.ts), draw them from the scene in another, and compare
// both with the phase-1 host's hashes (tools/files_cases.ts). Prints bytes and load times. Each draw is a process of
// its own, one at a time (the machine's GPU is shared).
//   bun tools/files_proof.ts [name ...]        (default: every proof; artefacts in out/files/<name>/)
//   bun tools/files_proof.ts --scene <name>    (the scene path alone: one JSON line)
//   bun tools/files_proof.ts --time <rounds> [name ...]   (load times: the two paths alternated, each in a fresh
//                                              process, `rounds` times; least and most of each. Needs built dirs.)
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PROOFS, SIZE } from "./files_cases.ts";

const BUN = process.execPath;

async function scenePath(name: string): Promise<void> {
  const proof = PROOFS[name]!;
  const { compile } = await import("../src/compile/index.ts");
  const { createHost } = await import("../src/host/host.ts");
  const { headlessDevice } = await import("../src/host/headless.ts");
  const { resolveCamera } = await import("../src/cli/cameras.ts");
  const device = await headlessDevice();
  let t = performance.now();
  const scene = (await import(resolve(proof.path))).default;
  const a = compile(scene);
  const compileMs = performance.now() - t;
  t = performance.now();
  const loaded = await createHost(device).load(a);
  const loadMs = performance.now() - t;
  const camera = resolveCamera(a, proof.view);
  const hashes: string[] = [];
  for (const c of proof.cases) hashes.push(createHash("sha256").update(await loaded.frame({ camera, ...SIZE, ...c })).digest("hex").slice(0, 16));
  loaded.destroy();
  console.log(JSON.stringify({ compileMs: Math.round(compileMs), loadMs: Math.round(loadMs), hashes }));
}

function run(args: string[]): string {
  const r = Bun.spawnSync([BUN, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${args.join(" ")} failed (${r.exitCode}):\n${r.stderr.toString()}${r.stdout.toString()}`);
  return r.stdout.toString();
}
const lastJson = (out: string) => JSON.parse(out.trim().split("\n").pop()!);

async function all(names: readonly string[]): Promise<void> {
  let failed = 0;
  for (const name of names) {
    const proof = PROOFS[name];
    if (proof === undefined) throw new Error(`files_proof: no proof named "${name}"`);
    const dir = `out/files/${name}`;
    const built = run(["src/cli/main.ts", "build", proof.path, "--out", dir]);
    const files = lastJson(run(["tools/files_frames.ts", dir, name, `out/files/${name}.webp`]));
    const scene = lastJson(run(["tools/files_proof.ts", "--scene", name]));
    const same = (h: readonly string[]) => h.every((x, k) => x === proof.phase1[k]);
    const ok = same(files.hashes) && same(scene.hashes) && files.compilerModules.length === 0;
    if (!ok) failed++;
    const wrote = /wrote .*/.exec(built)?.[0] ?? "";
    console.log(`${name.padEnd(16)} ${ok ? "identical" : "DIFFERENT"}  files [${files.hashes.join(" ")}] scene [${scene.hashes.join(" ")}] phase1 [${proof.phase1.join(" ")}]`);
    console.log(`${"".padEnd(16)} files: read ${files.readMs} ms + load ${files.loadMs} ms   scene: compile ${scene.compileMs} ms + load ${scene.loadMs} ms   compiler modules loaded from files: ${files.compilerModules.length}`);
    console.log(`${"".padEnd(16)} ${wrote}`);
  }
  if (failed > 0) { console.error(`${failed} scene(s) differ`); process.exit(1); }
}

/**
 * Load times both ways. A shader's first compile on this machine can cost several times a repeated one (seen: 27 s and
 * then 5 s for the same modules), so one reading per path says more about the order than the path; the paths alternate.
 */
async function times(rounds: number, names: readonly string[]): Promise<void> {
  const span = (xs: number[]) => `${Math.min(...xs)}-${Math.max(...xs)}`;
  for (const name of names) {
    const read: number[] = [], filesLoad: number[] = [], compile: number[] = [], sceneLoad: number[] = [];
    for (let r = 0; r < rounds; r++) {
      const f = lastJson(run(["tools/files_frames.ts", `out/files/${name}`, name]));
      read.push(f.readMs); filesLoad.push(f.loadMs);
      const s = lastJson(run(["tools/files_proof.ts", "--scene", name]));
      compile.push(s.compileMs); sceneLoad.push(s.loadMs);
    }
    console.log(`${name.padEnd(16)} files: read ${span(read)} ms, load ${span(filesLoad)} ms   scene: compile ${span(compile)} ms, load ${span(sceneLoad)} ms   (${rounds} rounds)`);
  }
}

const argv = process.argv.slice(2);
if (argv[0] === "--scene") await scenePath(argv[1]!);
else if (argv[0] === "--time") await times(Number(argv[1]), argv.length > 2 ? argv.slice(2) : Object.keys(PROOFS));
else await all(argv.length > 0 ? argv : Object.keys(PROOFS));
process.exit(0);

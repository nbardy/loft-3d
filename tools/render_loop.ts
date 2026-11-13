// The reproduction loop for intermittent render failures (docs/reliable_render.md): `procs` processes at once, each
// rendering `scene` `runs` times, one render per child process. Prints a tally (k failed of n, by stage); each failure's
// exit code and last stderr lines go to out/loop/<tag>.jsonl, to be searched with rg, not read whole.
//   bun tools/render_loop.ts <tag> <scene.ts:view> [--procs 4] [--runs 12] [--env K=V ...]
import { mkdirSync, appendFileSync } from "node:fs";

const [tag, target, ...rest] = process.argv.slice(2);
if (!tag || !target) throw new Error("usage: bun tools/render_loop.ts <tag> <scene.ts:view> [--procs n] [--runs n] [--env K=V ...]");
const [scene, view] = target.split(":") as [string, string | undefined];
let procs = 4, runs = 12;
const env: Record<string, string> = {};
for (let i = 0; i < rest.length; i += 2) {
  const [k, v] = [rest[i], rest[i + 1]!];
  if (k === "--procs") procs = +v;
  else if (k === "--runs") runs = +v;
  else if (k === "--env") { const [a, b] = v.split("="); env[a!] = b!; }
  else throw new Error(`render_loop: unknown option ${k}`);
}
mkdirSync("out/loop", { recursive: true });
const log = `out/loop/${tag}.jsonl`;

/** The stage a failure came from, read from its stderr: the first rule that matches. */
const STAGES: readonly [string, RegExp][] = [
  ["entry-point mismatch (pipeline)", /isn't the expected one/],
  ["shader module", /failed to compile/],
  ["pipeline", /pipeline creation failed/],
  ["device lost", /device.*lost|DeviceLost/i],
  ["bun panic", /panic|Segmentation fault|oh no: Bun has crashed/i],
  ["uncaptured", /uncaptured WebGPU error/],
];

// `retried`: load attempts the CLI retried on a fresh device (src/cli/main.ts) before this run's verdict. A run that
// passed on its second attempt exits 0, so the raw build-failure rate is attempts, not exit codes.
type Result = { code: number; ms: number; stage: string; tail: string; retried: string[] };

async function once(worker: number, run: number): Promise<Result> {
  const t = performance.now();
  const args = ["src/cli/main.ts", "render", scene, "--size", "320x200", "--out", `out/loop/${tag}_${worker}.webp`, ...(view ? ["--views", view] : [])];
  const p = Bun.spawn(["bun", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  const text = `${out}\n${err}`;
  const stage = code === 0 ? "ok" : (STAGES.find(([, re]) => re.test(text))?.[0] ?? "other");
  const tail = err.trim().split("\n").slice(-6).join("\n");
  const retried = [...err.matchAll(/^loft: load attempt \d+ failed in the GPU \(not the scene\): (.*)$/gm)].map((m) => m[1]!);
  const r = { code, ms: performance.now() - t, stage, tail, retried };
  if (code !== 0 || retried.length > 0 || /uncaptured/.test(text)) appendFileSync(log, JSON.stringify({ worker, run, ...r, rgba: out.match(/rgba (\w+)/)?.[1] }) + "\n");
  return r;
}

const t0 = performance.now();
const all = (await Promise.all(Array.from({ length: procs }, async (_, w) => {
  const rs: Result[] = [];
  for (let r = 0; r < runs; r++) rs.push(await once(w, r));
  return rs;
}))).flat();
const by = new Map<string, number>();
for (const r of all) by.set(r.stage, (by.get(r.stage) ?? 0) + 1);
const failed = all.filter((r) => r.code !== 0).length;
console.log(`${tag}: ${failed} of ${all.length} failed  (${scene}${view ? `:${view}` : ""}, ${procs} x ${runs}, ${((performance.now() - t0) / 1000).toFixed(0)} s, env ${JSON.stringify(env)})`);
for (const [s, n] of by) console.log(`  ${s.padEnd(34)} ${n}`);
const attempts = all.flatMap((r) => r.retried);
console.log(`  load attempts retried               ${attempts.length} (in ${all.filter((r) => r.retried.length > 0).length} runs)`);
for (const m of new Set(attempts)) console.log(`    ${m.slice(0, 160)}`);

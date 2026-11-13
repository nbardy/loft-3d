// Runs every mistake in this directory through `loft render` and prints its exit code and the last line on stderr.
// A mistake passes when it ends in its typed verdict: exit 4 and a last line "loft: scene: ...", or the verdict its
// header names (`// expect: usage` 2, `// expect: load` 3), and no stack frame from inside src/compile/ or src/host/
// is printed. `_ok.ts` must draw (exit 0). The kinds and codes: src/cli/verdict.ts.
//   bun tests/fixtures/mistakes/run.ts [name-filter]
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const dir = import.meta.dir;
const filter = process.argv[2] ?? "";
const files = readdirSync(dir).filter((f) => /^(\d\d_.*|_ok)\.ts$/.test(f) && f.includes(filter)).sort();
mkdirSync("out/mistakes", { recursive: true });

const CODE = { usage: 2, load: 3, scene: 4 } as const;
let bad = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  const expect = (text.match(/^\/\/ expect: (\w+)$/m)?.[1] ?? "scene") as keyof typeof CODE;
  const args = text.match(/^\/\/ args: (.*)$/m)?.[1]?.split(" ") ?? [];
  const p = Bun.spawn(["bun", "src/cli/main.ts", "render", relative(process.cwd(), join(dir, f)), "--views", "three", "--size", "64x40", "--out", `out/mistakes/${f}.webp`, ...args], {
    stdout: "pipe", stderr: "pipe",
  });
  // A mistake that hangs the compiler is a failure too: 60 s is ten times the slowest correct fixture.
  const timer = setTimeout(() => p.kill(), 60_000);
  const err = await new Response(p.stderr).text();
  await new Response(p.stdout).text();
  const code = await p.exited;
  clearTimeout(timer);
  const lines = err.trim().split("\n");
  const last = lines.at(-1) ?? "";
  // The message as a reader meets it: the first line (a stack trace follows it when the error was untyped).
  const first = lines[0] ?? "";
  const deep = /\bat .*src\/(compile|host)\//.test(err);
  const ok = f === "_ok.ts" ? code === 0 : code === CODE[expect] && last.startsWith(`loft: ${expect}: `) && !deep;
  if (!ok) bad++;
  console.log(`${ok ? "pass" : "FAIL"}  ${String(code).padStart(3)}  ${f.padEnd(30)} ${last.slice(0, 400)}${first !== last ? `\n      first line: ${first.slice(0, 400)}` : ""}${deep ? "  [stack inside src/compile or src/host]" : ""}`);
}
console.log(`\n${files.length - bad} of ${files.length} as expected`);
process.exitCode = bad === 0 ? 0 : 1;

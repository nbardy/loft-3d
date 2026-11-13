// Runs the code the docs show, so a guide cannot drift from the library. The bug it catches: a doc that names an
// export, a field or a flag the library does not have (or no longer has).
//
//   bun tools/check_snippets.ts            README.md, docs/guide.md, docs/craft.md, docs/errors.md, docs/context.md and the
//                                          written part of `loft api`
//
// And the names in `loft context`: every identifier in docs/context.md's inline code must be an export of the public
// entry (src/index.ts, src/lib/index.ts), a part of an exported object (`draw.field`) or a field of an exported type
// (`squareness`); a span starting `loft ` is parsed as a command. The map it prints beside them is generated, so this
// keeps the written part true after a rename.
//
// What counts, in those files:
//   ```ts run    a whole scene module: typechecked, rendered once at 160x100 through its first camera, and when it
//                exports `checks` or a `design`, checked with `loft check` (every combination for a design)
//   ```ts check  a whole module that is not a scene (a drawable, a style): typechecked only
//   ```sh        every line starting `loft ` is parsed by the CLI's own parser (nothing is executed), and every
//                path it names under examples/ must exist
// Snippets import from "../src/index.ts", as a file in examples/ does; they are written to out/snippets/ with that
// path rewritten. A snippet may name an earlier one's file (`out/snippets/<n>.ts` is printed for each).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, UsageError } from "../src/cli/args.ts";
import { exportsOf } from "../src/cli/catalogue.ts";

const ROOT = resolve(import.meta.dir, "..");
const DOCS = ["README.md", "docs/guide.md", "docs/craft.md", "docs/errors.md", "docs/context.md", "src/cli/api_preamble.md"];
const OUT = resolve(ROOT, "out/snippets");

type Snippet = { readonly doc: string; readonly line: number; readonly mode: "run" | "check" | "sh"; readonly code: string };

function snippets(doc: string): Snippet[] {
  const lines = readFileSync(resolve(ROOT, doc), "utf8").split("\n");
  const out: Snippet[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(ts run|ts check|sh)\s*$/.exec(lines[i]!);
    if (!m) continue;
    const start = i + 1;
    while (i + 1 < lines.length && !lines[i + 1]!.startsWith("```")) i++;
    out.push({ doc, line: start, mode: m[1] === "sh" ? "sh" : m[1] === "ts run" ? "run" : "check", code: lines.slice(start, i + 1).join("\n") });
    i++;
  }
  return out;
}

const all = DOCS.flatMap(snippets);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const failures: string[] = [];
const fail = (s: Snippet, why: string) => failures.push(`${s.doc}:${s.line}: ${why}`);

// A module snippet whose first line is a comment naming a path (`// examples/reed.ts`) is that file, for later commands.
const named = new Set(all.filter((x) => x.mode !== "sh").map((x) => /^\/\/ (examples\/\S+\.ts)$/.exec(x.code.split("\n")[0]!)?.[1]).filter((x) => x !== undefined));

// Shell lines: parsed, not run.
let commands = 0;
for (const s of all.filter((x) => x.mode === "sh")) {
  for (const raw of s.code.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line.startsWith("loft ")) continue;
    commands++;
    const argv = line.slice(5).split(/\s+/).map((a) => a.replace(/^"|"$/g, ""));
    try { parseArgs(argv); } catch (e) { fail(s, `\`${line}\`: ${e instanceof UsageError ? e.message : String(e)}`); }
    for (const p of argv.filter((a) => a.startsWith("examples/")).flatMap((a) => a.split(",")).filter((a) => !a.includes("*"))) if (!named.has(p) && !existsSync(resolve(ROOT, p))) fail(s, `\`${line}\`: no file ${p}`);
  }
}

// Names in docs/context.md's inline code (outside fences): exports, parts of exported objects, fields of exported types.
const known = new Set<string>();
for (const entry of ["src/index.ts", "src/lib/index.ts"]) for (const e of exportsOf(resolve(ROOT, entry)).values()) {
  known.add(e.name);
  for (const m of e.members) known.add(m.name);
  for (const f of e.fields) known.add(f.name);
}
let names = 0;
{
  const doc = "docs/context.md";
  const lines = readFileSync(resolve(ROOT, doc), "utf8").split("\n");
  let fenced = false;
  for (const [k, line] of lines.entries()) {
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const [, span] of line.matchAll(/`([^`]+)`/g)) {
      const s: Snippet = { doc, line: k + 1, mode: "sh", code: span! };
      if (span!.startsWith("loft ")) { try { parseArgs(span!.slice(5).split(/\s+/)); } catch (e) { fail(s, `\`${span}\`: ${e instanceof UsageError ? e.message : String(e)}`); } continue; }
      if (span!.startsWith("--") || span!.includes("/")) continue; // a flag, or a path
      // Identifiers outside string literals; one-letter ones are coordinates and arguments (m, v, x).
      for (const [id] of span!.replace(/"[^"]*"|'[^']*'/g, "").matchAll(/[A-Za-z_$][\w$]*/g)) {
        if (id.length === 1 || /^\d/.test(id)) continue;
        names++;
        if (!known.has(id)) fail(s, `\`${span}\` names "${id}", which the public entry does not export (nor any exported object or type has)`);
      }
    }
  }
}

// Modules: written out, typechecked together, scenes rendered.
const modules = all.filter((x) => x.mode !== "sh");
const files = modules.map((s, k) => {
  const path = resolve(OUT, `${k + 1}.ts`);
  writeFileSync(path, s.code.replaceAll('"../src/', '"../../src/').replaceAll('"../examples/', '"../../examples/'));
  console.log(`out/snippets/${k + 1}.ts  ${s.mode}  ${s.doc}:${s.line}`);
  return path;
});
writeFileSync(resolve(OUT, "tsconfig.json"), JSON.stringify({ extends: "../../tsconfig.json", include: files.map((f) => f.replace(OUT + "/", "")) }));
const tsc = spawnSync("pnpm", ["exec", "tsc", "--noEmit", "-p", resolve(OUT, "tsconfig.json")], { cwd: ROOT, encoding: "utf8" });
if (tsc.status !== 0) {
  for (const l of (tsc.stdout + tsc.stderr).split("\n").filter((x) => x.includes("snippets/"))) {
    const k = Number(/snippets\/(\d+)\.ts/.exec(l)?.[1]);
    const s = modules[k - 1];
    if (s) fail(s, `typecheck: ${l.trim()}`);
  }
  if (failures.length === 0) failures.push(`typecheck failed outside the snippets:\n${tsc.stdout}${tsc.stderr}`);
}

let rendered = 0, checked = 0;
for (const [k, s] of modules.entries()) {
  if (s.mode !== "run") continue;
  const cam = /cameras:\s*\{\s*(\w+)\s*:/.exec(s.code)?.[1] ?? "three";
  const r = spawnSync("bun", ["src/cli/main.ts", "render", files[k]!, "--out", resolve(OUT, `${k + 1}.webp`), "--views", cam, "--size", "160x100"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) fail(s, `render: ${(r.stderr || r.stdout).trim().split("\n").slice(0, 4).join(" | ")}`);
  else rendered++;
  // A scene that exports checks, or a design, must pass them: an example whose own checks fail teaches the wrong thing.
  if (/export const (checks|design)\b/.test(s.code)) {
    const c = spawnSync("bun", ["src/cli/main.ts", "check", files[k]!, ...(s.code.includes("export const design") ? ["--combinations"] : [])], { cwd: ROOT, encoding: "utf8" });
    if (c.status !== 0) fail(s, `check: ${c.stdout.split("\n").filter((l) => /FAIL|NOT CHECKED/.test(l)).join(" | ")}`);
    else checked++;
  }
}

const typed = modules.length;
console.log(`\n${names} names in docs/context.md found, ${commands} commands parsed, ${typed} modules typechecked, ${rendered} scenes rendered, ${checked} passed their checks; ${failures.length} failed`);
for (const f of failures) console.log(`FAIL ${f}`);
process.exit(failures.length === 0 ? 0 : 1);

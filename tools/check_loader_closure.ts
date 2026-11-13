// The file loader's no-compiler property, checked structurally: from each entry, follow every runtime import (type-only
// imports are erased and do not count; dynamic imports with a literal path do), and fail if the closure reaches a
// FORBIDDEN module (src/cli/run_files.ts: the compiler, the expression evaluators, the library's entry, scenes) or holds
// a dynamic import whose path is not a literal (it could load anything).
//   bun tools/check_loader_closure.ts            (the loader's entries; exits 1 on a violation)
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { FORBIDDEN } from "../src/cli/run_files.ts";

const ROOT = resolve(import.meta.dir, "..");
/** Entries a file artefact is drawn from: the CLI's `--artefact` path, the loader itself, the proof's files process. */
export const LOADER_ENTRIES = ["src/cli/run_files.ts", "src/host/files.ts", "tools/files_frames.ts"] as const;

export type Closure = { readonly files: readonly string[]; readonly packages: readonly string[]; readonly violations: readonly string[] };

export function closure(entries: readonly string[]): Closure {
  const t = new Bun.Transpiler({ loader: "ts" });
  const seen = new Set<string>(), packages = new Set<string>(), violations: string[] = [];
  const queue = entries.map((e) => resolve(ROOT, e));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const name = relative(ROOT, file);
    for (const f of FORBIDDEN) if (f.test(file)) violations.push(`${name} is ${f.name}`);
    const code = readFileSync(file, "utf8");
    const imports = t.scanImports(code);
    const literalDynamic = imports.filter((i) => i.kind === "dynamic-import").length;
    const anyDynamic = (code.match(/\bimport\s*\(/g) ?? []).length;
    if (anyDynamic > literalDynamic) violations.push(`${name} has a dynamic import whose path is not a literal`);
    for (const i of imports) {
      if (i.path.startsWith(".") || i.path.startsWith("/")) queue.push(resolve(dirname(file), i.path));
      else packages.add(i.path);
    }
  }
  return { files: [...seen].map((f) => relative(ROOT, f)).sort(), packages: [...packages].sort(), violations };
}

if (import.meta.main) {
  const c = closure(LOADER_ENTRIES);
  console.log(`loader closure from ${LOADER_ENTRIES.join(", ")}: ${c.files.length} files`);
  for (const f of c.files) console.log(`  ${f}`);
  console.log(`packages: ${c.packages.join(", ")}`);
  if (c.violations.length > 0) {
    console.error(`VIOLATIONS:\n  ${c.violations.join("\n  ")}`);
    process.exit(1);
  }
  console.log("no compiler module, no non-literal dynamic import");
}

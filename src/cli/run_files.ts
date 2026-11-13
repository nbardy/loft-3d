// The CLI's `--artefact dir` path: draws a directory `loft build` wrote, without the scene or the compiler. This file's
// import closure is the loader's (src/host/files.ts) and the headless device, nothing else; tools/check_loader_closure.ts
// and tests/files.test.ts fail if it ever reaches the compiler, and `compilerModulesLoaded` checks the same at run time.
import { headlessDevice } from "../host/headless.ts";
import { loadArtefactFiles } from "../host/files.ts";

/** Modules a file loader must never load: the compiler, the expression evaluators, the library's entry, scenes. */
export const FORBIDDEN: readonly { readonly name: string; readonly test: (path: string) => boolean }[] = [
  { name: "src/compile/**", test: (p) => /\/src\/compile\//.test(p) },
  { name: "src/expr.ts", test: (p) => /\/src\/expr\.ts$/.test(p) },
  { name: "src/grad.ts", test: (p) => /\/src\/grad\.ts$/.test(p) },
  { name: "src/index.ts", test: (p) => /\/src\/index\.ts$/.test(p) },
  { name: "examples/**", test: (p) => /\/examples\//.test(p) },
];

export async function openFiles(dir: string) {
  return loadArtefactFiles(await headlessDevice(), dir);
}

/** The forbidden modules this process has loaded so far (Bun's module registry: what actually ran, not what could). */
export function compilerModulesLoaded(): string[] {
  const registry = (globalThis as { Loader?: { registry?: Map<string, unknown> } }).Loader?.registry;
  if (registry === undefined) throw new Error("compilerModulesLoaded: this runtime has no Loader.registry (bun has one)");
  return [...registry.keys()].filter((p) => FORBIDDEN.some((f) => f.test(p)));
}

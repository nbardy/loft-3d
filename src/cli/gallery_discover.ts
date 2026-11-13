// Finding scenes, and keying outputs by what they were made from.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

/** What a scene file turned out to be. Classified once here; nothing downstream asks again. */
export type Discovered =
  | { readonly kind: "scene"; readonly name: string; readonly path: string; readonly module: { readonly default: unknown; readonly checks: unknown } }
  | { readonly kind: "skipped"; readonly name: string; readonly path: string; readonly reason: string }
  | { readonly kind: "unloadable"; readonly name: string; readonly path: string; readonly error: string };

const GLOB_CHARS = /[*?[\]{}]/;

/** Expands one pattern: its literal directory prefix is the scan root, the rest is the glob. Sorted, absolute. */
export function expandGlob(pattern: string, cwd: string): string[] {
  const parts = pattern.split("/");
  const firstGlob = parts.findIndex((p) => GLOB_CHARS.test(p));
  if (firstGlob < 0) {
    const file = resolve(cwd, pattern);
    return existsSync(file) ? [file] : [];
  }
  const root = resolve(cwd, parts.slice(0, firstGlob).join("/") || ".");
  if (!existsSync(root)) return [];
  return [...new Bun.Glob(parts.slice(firstGlob).join("/")).scanSync({ cwd: root, absolute: true })].sort();
}

/** Names are file basenames; a collision gets its directory prepended so every scene has a distinct, path-safe name. */
function names(paths: readonly string[]): string[] {
  const stem = (p: string) => basename(p).replace(/\.[cm]?[jt]s$/, "");
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(stem(p), (counts.get(stem(p)) ?? 0) + 1);
  return paths.map((p) => ((counts.get(stem(p)) ?? 0) > 1 ? `${basename(dirname(p))}-${stem(p)}` : stem(p)));
}

/** A scene is what `scene()` returns (src/scene.ts); anything else default-exported is not drawable. */
function sceneProblem(v: unknown): string | undefined {
  if (v === undefined) return "no default export";
  if (typeof v !== "object" || v === null) return `default export is a ${typeof v}, not a scene`;
  const o = v as Record<string, unknown>;
  const missing = ["things", "ground", "sun", "cameras"].filter((k) => !(k in o));
  return missing.length > 0 ? `default export is not a scene (no ${missing.join(", ")})` : undefined;
}

export async function discover(patterns: readonly string[], cwd: string): Promise<Discovered[]> {
  const paths = [...new Set(patterns.flatMap((p) => expandGlob(p, cwd)))].sort();
  const nm = names(paths);
  const out: Discovered[] = [];
  for (const [i, path] of paths.entries()) {
    const name = nm[i]!;
    try {
      const module = (await import(path)) as { default?: unknown; checks?: unknown };
      const problem = sceneProblem(module.default);
      out.push(problem === undefined ? { kind: "scene", name, path, module: { default: module.default, checks: module.checks } } : { kind: "skipped", name, path, reason: problem });
    } catch (e) {
      out.push({ kind: "unloadable", name, path, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }
  return out;
}

const IMPORT = /(?:from\s*|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;

function resolveImport(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.js`, join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return undefined;
}

/** Every file a module reaches through relative imports, itself included, sorted. */
export function importClosure(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [resolve(entry)];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(IMPORT)) {
      const dep = resolveImport(f, m[1]!);
      if (dep !== undefined) stack.push(dep);
    }
  }
  return [...seen].sort();
}

export const sha = (...parts: readonly string[]): string => createHash("sha256").update(parts.join("\u0000")).digest("hex");

/** A hash of the contents of the entry and everything it imports. Paths enter relative to the entry's directory so a moved checkout keeps its keys. */
export function closureHash(entry: string): string {
  const root = dirname(resolve(entry));
  return sha(...importClosure(entry).map((f) => `${relative(root, f)}:${sha(readFileSync(f, "utf8"))}`));
}

/** The git commit that last touched `dir` (the library's `src/`), or "uncommitted" outside a repository. */
export function commitOf(dir: string): string {
  const r = Bun.spawnSync(["git", "log", "-1", "--format=%h", "--", "."], { cwd: dir });
  const out = r.exitCode === 0 ? r.stdout.toString().trim() : "";
  return out === "" ? "uncommitted" : out;
}

export function headCommit(dir: string): string {
  const r = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: dir });
  return r.exitCode === 0 ? r.stdout.toString().trim() : "uncommitted";
}


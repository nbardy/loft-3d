// The artefact as files (docs/artefact_format.md): a directory holding
//   manifest.json        the lowered host (src/host/manifest.ts)
//   wgsl/<chunk>.wgsl    each WGSL chunk once, named by its hash; a module is its chunks concatenated
//   bin/<blob>.bin       the curves and static tables, little-endian f32
// `writeBundle` is what `loft build` calls; `loadArtefactFiles` draws from the directory alone. Neither imports the
// compiler: tools/check_loader_closure.ts fails if this file's import closure ever reaches it.
//
// bun / node only (node:fs). The browser host does not import this file.

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBundle, NotDataError, type GpuLoaded } from "./host.ts";
import { FORMAT, FORMAT_VERSION, type Bundle, type Manifest } from "./manifest.ts";

export const MANIFEST = "manifest.json";
const chunkPath = (dir: string, name: string) => join(dir, "wgsl", `${name}.wgsl`);
const blobPath = (dir: string, name: string) => join(dir, "bin", `${name}.bin`);

/** The bytes a written artefact holds, by kind. */
export type FileSizes = { readonly manifest: number; readonly wgsl: number; readonly bin: number; readonly files: number };

/**
 * Writes the bundle into `dir`, replacing what a previous build left there (only the manifest and the `wgsl` and `bin`
 * folders; anything else in `dir` is refused rather than deleted).
 */
export function writeBundle(dir: string, b: Bundle): FileSizes {
  // A `cpu` table is a JavaScript fill: refused by name, before anything is written.
  const cpu = b.manifest.tables.filter((t) => t.fill.kind === "cpu");
  if (cpu.length > 0) {
    throw new NotDataError(`build: ${cpu.length} table(s) are filled by JavaScript, which a file cannot hold: ${cpu.map((t) => `"${t.name}" (${t.fill.kind === "cpu" ? t.fill.why : ""})`).join(", ")}`);
  }
  mkdirSync(dir, { recursive: true });
  const stray = readdirSync(dir).filter((f) => f !== MANIFEST && f !== "wgsl" && f !== "bin");
  if (stray.length > 0) throw new Error(`build: ${dir} holds ${stray.join(", ")}, which a build did not write; give an empty or earlier build directory`);
  rmSync(join(dir, "wgsl"), { recursive: true, force: true });
  rmSync(join(dir, "bin"), { recursive: true, force: true });
  mkdirSync(join(dir, "wgsl"));
  mkdirSync(join(dir, "bin"));
  let wgsl = 0, bin = 0;
  for (const [name, text] of b.chunks) { writeFileSync(chunkPath(dir, name), text); wgsl += statSync(chunkPath(dir, name)).size; }
  for (const [name, bytes] of b.blobs) { writeFileSync(blobPath(dir, name), bytes); bin += bytes.byteLength; }
  // JSON writes NaN and Infinity as null; a number that cannot be written exactly is an error, not a silent null.
  // (Finite doubles round-trip exactly through JSON.stringify and JSON.parse.)
  const json = JSON.stringify(b.manifest, (key, v: unknown) => {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`build: manifest field "${key}" is ${v}, which JSON cannot hold`);
    return v;
  });
  writeFileSync(join(dir, MANIFEST), json);
  return { manifest: statSync(join(dir, MANIFEST)).size, wgsl, bin, files: 1 + b.chunks.size + b.blobs.size };
}

/** Reads a written artefact back. Throws on another format or version, and on a file the manifest names but `dir` lacks. */
export function readBundle(dir: string): Bundle {
  const manifest = JSON.parse(readFileSync(join(dir, MANIFEST), "utf8")) as Manifest;
  if (manifest.format !== FORMAT) throw new Error(`${dir}: not a Loft artefact (format "${String(manifest.format)}")`);
  if (manifest.version !== FORMAT_VERSION) throw new Error(`${dir}: artefact format version ${manifest.version}; this loader reads version ${FORMAT_VERSION}`);
  const chunks = new Map(manifest.chunks.map((name) => [name, readFileSync(chunkPath(dir, name), "utf8")]));
  const blobs = new Map(manifest.blobs.map(({ name, bytes }) => {
    const data = new Uint8Array(readFileSync(blobPath(dir, name)));
    if (data.byteLength !== bytes) throw new Error(`${dir}: bin/${name}.bin has ${data.byteLength} bytes; the manifest says ${bytes}`);
    return [name, data];
  }));
  return { manifest, chunks, blobs };
}

/** Draws from a built directory alone: no scene module, no compiler, no `cpu` tables (a bundle with one is refused by name). */
export async function loadArtefactFiles(device: GPUDevice, dir: string): Promise<{ readonly bundle: Bundle; readonly loaded: GpuLoaded }> {
  const bundle = readBundle(dir);
  return { bundle, loaded: await loadBundle(device, bundle, { kind: "none" }) };
}

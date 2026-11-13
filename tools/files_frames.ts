// Draws a proof's frames from a built directory alone and prints one JSON line: read and load milliseconds, the RGBA
// hashes, and the compiler modules this process loaded (must be none). An entry of its own: its import closure is the
// file loader's (tools/check_loader_closure.ts checks it).
//   bun tools/files_frames.ts <dir> <scene name> [sheet.webp]
import { createHash } from "node:crypto";
import { resolveCamera } from "../src/cli/cameras.ts";
import { compilerModulesLoaded } from "../src/cli/run_files.ts";
import { contactSheet, writeWebp } from "../src/cli/image.ts";
import { readBundle } from "../src/host/files.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { loadBundle } from "../src/host/host.ts";
import { PROOFS, SIZE } from "./files_cases.ts";

const [dir, name, sheet] = process.argv.slice(2) as [string, string, string | undefined];
const proof = PROOFS[name];
if (proof === undefined) throw new Error(`files_frames: no proof named "${name}" (${Object.keys(PROOFS).join(", ")})`);
const device = await headlessDevice();
let t = performance.now();
const bundle = readBundle(dir);
const readMs = performance.now() - t;
t = performance.now();
const loaded = await loadBundle(device, bundle, { kind: "none" });
const loadMs = performance.now() - t;
const camera = resolveCamera(bundle.manifest, proof.view);
const frames = [];
for (const c of proof.cases) frames.push({ ...SIZE, rgba: await loaded.frame({ camera, ...SIZE, ...c }) });
loaded.destroy();
if (sheet !== undefined) writeWebp(sheet, contactSheet(frames));
const hashes = frames.map((f) => createHash("sha256").update(f.rgba).digest("hex").slice(0, 16));
console.log(JSON.stringify({ readMs: Math.round(readMs), loadMs: Math.round(loadMs), hashes, compilerModules: compilerModulesLoaded() }));
process.exit(0);

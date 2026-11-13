// Where a scene's triangles go, and what the host actually draws. For each scene: the declared maximum grouped by kind
// (compile only), then per view the triangles drawn after the host's level of detail and the best-case milliseconds
// per frame (the machine is shared: only the minimum over many frames says what the work costs).
//
//   bun tools/triangles.ts [--frames 20] [--size 1280x800] [--shots out/triangles/after] [--cells 7] [--outline hull|screen] [scene.ts ...]
//
// With `--shots DIR` it also writes every view as a lossless PNG (for picture differences) and a WebP to look at.
// `--cells` is `View.cellPixels` (0: every grid at its finest, the authored density).
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { encodePng, writeWebp } from "../src/cli/image.ts";
import { compile } from "../src/index.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost } from "../src/host/index.ts";
import type { OutlineMethod, Scene } from "../src/scene.ts";
import { VIEWS } from "./triangle_views.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const frames = Number(flag("--frames") ?? 20);
const [width, height] = (flag("--size") ?? "1280x800").split("x").map(Number) as [number, number];
const shots = flag("--shots");
const cells = flag("--cells");
const outline = flag("--outline") as OutlineMethod | undefined;
const files = args.length > 0 ? args : Object.keys(VIEWS);

const host = createHost(await headlessDevice());
for (const file of files) {
  const own = (await import(resolve(file))).default as Scene;
  const scene: Scene = outline === undefined ? own : { ...own, outline };
  const artefact = compile(scene);
  const groups = new Map<string, number>();
  let total = 0;
  for (const d of artefact.draws) {
    if (d.layer !== "scene") continue;
    const tris = (d.vertices / 3) * d.instances;
    total += tris;
    const kind = /^sea/i.test(d.label) ? "sea" : / outline$/.test(d.label) ? "outlines (second pass)" : d.instances > 1 ? "instanced parts" : "bodies, sheets, rest";
    groups.set(kind, (groups.get(kind) ?? 0) + tris);
  }
  console.log(`${file}: declared maximum ${Math.round(total)} triangles in ${artefact.draws.length} draws`);
  for (const [k, v] of [...groups].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(24)} ${String(Math.round(v)).padStart(7)}  ${((100 * v) / total).toFixed(0)}%`);
  const loaded = await host.load(artefact);
  const views = VIEWS[file] ?? Object.fromEntries(Object.entries(artefact.cameras).slice(0, 2));
  for (const [name, camera] of Object.entries(views)) {
    const view = { camera, width, height, time: 1, ...(cells === undefined ? {} : { cellPixels: Number(cells) }) };
    let best = Infinity, drawn = 0, calls = 0, pixels: Uint8Array = new Uint8Array();
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      const r = await loaded.frameTimed(view);
      best = Math.min(best, performance.now() - t0);
      drawn = r.drawn.triangles; calls = r.drawn.draws; pixels = r.pixels;
    }
    console.log(`   view ${name.padEnd(6)} drawn ${String(drawn).padStart(7)} triangles in ${String(calls).padStart(3)} calls; best ${best.toFixed(2)} ms of ${frames} frames`);
    if (shots !== undefined) {
      mkdirSync(shots, { recursive: true });
      const stem = `${shots}/${basename(file, ".ts")}_${name}`;
      writeFileSync(`${stem}.png`, encodePng({ width, height, rgba: pixels }));
      writeWebp(`${stem}.webp`, { width, height, rgba: pixels });
    }
  }
  loaded.destroy();
}

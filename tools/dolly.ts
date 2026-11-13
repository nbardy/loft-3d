// A slow camera dolly at a fixed time, for looking at popping (level switches) and a swimming sea: with time held, the
// only change from frame to frame is the camera. Writes a frames sheet and prints each frame's triangles and level
// switches. `bun tools/dolly.ts <scene.ts> --out out/triangles/dolly.webp [--frames 12] [--from 0.6] [--to 1.6]`
// moves the eye along the line from the target through the game camera (or `three`), from `from` to `to` times its
// distance; with --crop x,y,w,h it also writes a 3x zoomed sheet of that window.
import { resolve } from "node:path";
import { compile } from "../src/index.ts";
import { contactSheet, writeWebp, type Frame } from "../src/cli/image.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost } from "../src/host/index.ts";
import type { Scene } from "../src/scene.ts";

const args = process.argv.slice(2);
const flag = (name: string, d: string): string => { const i = args.indexOf(name); return i < 0 ? d : args.splice(i, 2)[1]!; };
const out = flag("--out", "out/triangles/dolly.webp"), n = Number(flag("--frames", "12"));
const from = Number(flag("--from", "0.6")), to = Number(flag("--to", "1.6")), crop = flag("--crop", "");
const a = compile((await import(resolve(args[0]!))).default as Scene);
const base = a.cameras.game ?? a.cameras.three!;
if (base.kind !== "perspective") throw new Error("dolly: needs a perspective camera");
const loaded = await createHost(await headlessDevice()).load(a);
const frames: Frame[] = [], zoomed: Frame[] = [];
let last = -1;
for (let k = 0; k < n; k++) {
  const s = from + ((to - from) * k) / (n - 1);
  const eye = base.eye.map((e, i) => base.target[i]! + (e - base.target[i]!) * s) as [number, number, number];
  const r = await loaded.frameTimed({ camera: { ...base, eye }, width: 1280, height: 800, time: 1 });
  console.log(`frame ${k}  distance x${s.toFixed(3)}  ${r.drawn.triangles} triangles  ${r.drawn.draws} calls${last >= 0 && last !== r.drawn.triangles ? "  (levels changed)" : ""}`);
  last = r.drawn.triangles;
  frames.push({ width: 1280, height: 800, rgba: r.pixels });
  if (crop !== "") {
    const [cx, cy, cw, ch] = crop.split(",").map(Number) as [number, number, number, number];
    const z = new Uint8Array(cw * 3 * ch * 3 * 4);
    for (let y = 0; y < ch * 3; y++) for (let x = 0; x < cw * 3; x++) {
      const src = ((cy + Math.floor(y / 3)) * 1280 + cx + Math.floor(x / 3)) * 4;
      z.set(r.pixels.subarray(src, src + 4), (y * cw * 3 + x) * 4);
    }
    zoomed.push({ width: cw * 3, height: ch * 3, rgba: z });
  }
}
loaded.destroy();
writeWebp(out, contactSheet(frames));
if (zoomed.length > 0) writeWebp(out.replace(/\.webp$/, "_zoom.webp"), contactSheet(zoomed));
console.log(`wrote ${out}`);

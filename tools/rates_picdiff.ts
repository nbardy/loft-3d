// Pictures before and after a compiler change (docs/gpu_native.md "Rates"): per PNG pair, the share of pixels whose
// largest channel differs by more than 8/255 (the bar: under 0.1%), the largest difference, and the bounding box of the
// differing pixels. With --mask <dir>, a WebP per picture: the after picture dimmed, differing pixels in red.
//   bun tools/rates_picdiff.ts <before dir> <after dir> [--mask <dir>]
import { mkdirSync, readdirSync } from "node:fs";
import { writeWebp } from "../src/cli/image.ts";
import { readPng } from "./picdiff.ts";

const args = process.argv.slice(2);
const k = args.indexOf("--mask");
const mask = k < 0 ? undefined : args.splice(k, 2)[1];
const [da, db] = args as [string, string];
if (mask !== undefined) mkdirSync(mask, { recursive: true });
let worst = 0;
for (const f of readdirSync(db).filter((x) => x.endsWith(".png")).sort()) {
  const a = readPng(`${da}/${f}`), b = readPng(`${db}/${f}`);
  const n = a.width * a.height;
  let over = 0, max = 0, x0 = a.width, y0 = a.height, x1 = -1, y1 = -1;
  const out = new Uint8Array(b.rgba.length);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.rgba[4 * i + c]! - b.rgba[4 * i + c]!));
    max = Math.max(max, m);
    const x = i % a.width, y = (i / a.width) | 0;
    if (m > 8) { over++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let c = 0; c < 3; c++) out[4 * i + c] = m > 8 ? (c === 0 ? 255 : 0) : b.rgba[4 * i + c]! >> 2;
    out[4 * i + 3] = 255;
  }
  worst = Math.max(worst, over / n);
  console.log(`${f.padEnd(24)} >8/255: ${over} px (${((100 * over) / n).toFixed(4)}%)  max ${max}  ${over > 0 ? `box ${x0},${y0}-${x1},${y1}` : ""}`);
  if (mask !== undefined && over > 0) writeWebp(`${mask}/${f.replace(".png", ".webp")}`, { width: a.width, height: a.height, rgba: out });
}
console.log(`worst ${(100 * worst).toFixed(4)}% (bar 0.1%)`);

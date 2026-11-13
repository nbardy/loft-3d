// Contact sheets and WebP stills. A frame is tightly packed RGBA8, top row first (the Host contract).
import { EnvironmentError } from "../errors.ts";
import { deflateSync } from "node:zlib";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Frame = { readonly width: number; readonly height: number; readonly rgba: Uint8Array };
export type Sheet = Frame & { readonly columns: number; readonly rows: number };

/** Row-major grid, `columns = ceil(sqrt(n))` (four views make 2x2). Cells share one size; unused cells are black. */
export function contactSheet(frames: readonly Frame[]): Sheet {
  if (frames.length === 0) throw new Error("contactSheet: no frames");
  const { width, height } = frames[0]!;
  for (const [i, f] of frames.entries()) {
    if (f.width !== width || f.height !== height) throw new Error(`contactSheet: frame ${i} is ${f.width}x${f.height}, expected ${width}x${height}`);
    if (f.rgba.length !== width * height * 4) throw new Error(`contactSheet: frame ${i} has ${f.rgba.length} bytes, expected ${width * height * 4}`);
  }
  const columns = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / columns);
  const sheetW = columns * width;
  const rgba = new Uint8Array(sheetW * rows * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  frames.forEach((f, i) => {
    const x0 = (i % columns) * width;
    const y0 = Math.floor(i / columns) * height;
    for (let y = 0; y < height; y++) rgba.set(f.rgba.subarray(y * width * 4, (y + 1) * width * 4), ((y0 + y) * sheetW + x0) * 4);
  });
  return { width: sheetW, height: rows * height, rgba, columns, rows };
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(f: Frame): Uint8Array {
  const stride = f.width * 4;
  const raw = new Uint8Array((stride + 1) * f.height); // filter type 0 on every row
  for (let y = 0; y < f.height; y++) raw.set(f.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, f.width);
  dv.setUint32(4, f.height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bit, RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}

/** PNG through `cwebp -q 90`, PNG deleted. Throws with cwebp's stderr if it fails. */
export function writeWebp(path: string, f: Frame): void {
  mkdirSync(dirname(path), { recursive: true });
  const png = `${path}.tmp.png`;
  writeFileSync(png, encodePng(f));
  try {
    if (Bun.which("cwebp") === null) throw new EnvironmentError("cwebp is not on PATH; it writes the .webp (install libwebp: brew install webp, apt install webp)", false);
    const r = Bun.spawnSync(["cwebp", "-quiet", "-q", "90", png, "-o", path]);
    if (r.exitCode !== 0) throw new EnvironmentError(`cwebp failed (${r.exitCode}): ${r.stderr.toString()}`, false);
  } finally {
    rmSync(png, { force: true });
  }
}

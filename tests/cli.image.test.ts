import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contactSheet, writeWebp, type Frame } from "../src/cli/image.ts";

const solid = (w: number, h: number, rgb: [number, number, number]): Frame => {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([...rgb, 255], i * 4);
  return { width: w, height: h, rgba };
};
const px = (s: Frame, x: number, y: number) => [...s.rgba.subarray((y * s.width + x) * 4, (y * s.width + x) * 4 + 3)];

test("contact sheet puts frames row-major, in the order given, with the empty cell black", () => {
  const sheet = contactSheet([solid(4, 2, [255, 0, 0]), solid(4, 2, [0, 255, 0]), solid(4, 2, [0, 0, 255])]);
  expect([sheet.width, sheet.height, sheet.columns, sheet.rows]).toEqual([8, 4, 2, 2]);
  expect(px(sheet, 1, 1)).toEqual([255, 0, 0]);
  expect(px(sheet, 6, 0)).toEqual([0, 255, 0]);
  expect(px(sheet, 2, 3)).toEqual([0, 0, 255]);
  expect(px(sheet, 7, 3)).toEqual([0, 0, 0]);
});

test("rows inside a cell stay in order (top row stays on top)", () => {
  const f = solid(2, 2, [0, 0, 0]);
  f.rgba.set([9, 9, 9, 255], 0); // top-left pixel only
  const sheet = contactSheet([solid(2, 2, [1, 1, 1]), f]);
  expect(px(sheet, 2, 0)).toEqual([9, 9, 9]);
  expect(px(sheet, 2, 1)).toEqual([0, 0, 0]);
});

test("mismatched frame sizes are rejected naming the frame", () => {
  expect(() => contactSheet([solid(2, 2, [0, 0, 0]), solid(3, 2, [0, 0, 0])])).toThrow("frame 1");
});

test("WebP written by cwebp decodes to the same colours and leaves no PNG behind", () => {
  const dir = mkdtempSync(join(tmpdir(), "loft-img-"));
  const path = join(dir, "s.webp");
  writeWebp(path, contactSheet([solid(16, 16, [200, 30, 30]), solid(16, 16, [30, 30, 200])]));
  expect(readdirSync(dir)).toEqual(["s.webp"]);
  const back = join(dir, "back.ppm");
  expect(Bun.spawnSync(["dwebp", "-quiet", "-ppm", path, "-o", back]).exitCode).toBe(0);
  const ppm = new Uint8Array(readFileSync(back));
  const rgb = ppm.subarray(ppm.length - 32 * 16 * 3); // header is variable length; pixels are the tail
  const at = (x: number, y: number) => [...rgb.subarray((y * 32 + x) * 3, (y * 32 + x) * 3 + 3)];
  for (const [got, want] of [[at(8, 8), [200, 30, 30]], [at(24, 8), [30, 30, 200]]] as const)
    got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThan(12)); // lossy quality 90
});

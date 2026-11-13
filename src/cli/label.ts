// Text on a picture, for labelled sheets: a 5x7 bitmap font drawn into RGBA, no font files or external tools.
// Lower case draws as upper case; a character outside the font draws as a hollow box (shown, never dropped).
import type { Frame } from "./image.ts";

/** Rows top to bottom, five bits each, most significant bit on the left. */
const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  " ": [0, 0, 0, 0, 0, 0, 0], "=": [0, 0, 31, 0, 31, 0, 0], ",": [0, 0, 0, 0, 12, 4, 8], "+": [0, 4, 4, 31, 4, 4, 0],
  "-": [0, 0, 0, 31, 0, 0, 0], _: [0, 0, 0, 0, 0, 0, 31], ".": [0, 0, 0, 0, 0, 12, 12], ":": [0, 12, 12, 0, 12, 12, 0],
  "/": [0, 1, 2, 4, 8, 16, 0], "(": [2, 4, 8, 8, 8, 4, 2], ")": [8, 4, 2, 2, 2, 4, 8], ";": [0, 12, 12, 0, 12, 4, 8], "'": [4, 4, 8, 0, 0, 0, 0],
};
const BOX = [31, 17, 17, 17, 17, 17, 31];

/** Pixel width of `text` at `scale` (each character 6 cells wide: 5 and a gap). */
export const textWidth = (text: string, scale: number): number => text.length * 6 * scale;

/** `text` drawn into `f` with its top-left at (x, y), clipped to the frame. */
export function drawText(f: Frame, text: string, x: number, y: number, scale: number, rgb: readonly [number, number, number]): void {
  [...text.toUpperCase()].forEach((ch, i) => {
    const rows = GLYPHS[ch] ?? BOX;
    rows.forEach((bits, r) => {
      for (let c = 0; c < 5; c++) {
        if (!((bits >> (4 - c)) & 1)) continue;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          const px = x + (i * 6 + c) * scale + dx, py = y + r * scale + dy;
          if (px < 0 || py < 0 || px >= f.width || py >= f.height) continue;
          const o = (py * f.width + px) * 4;
          f.rgba[o] = rgb[0]; f.rgba[o + 1] = rgb[1]; f.rgba[o + 2] = rgb[2]; f.rgba[o + 3] = 255;
        }
      }
    });
  });
}

/** A blank opaque frame. */
export function blank(width: number, height: number, rgb: readonly [number, number, number]): Frame {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = rgb[0]; rgba[i + 1] = rgb[1]; rgba[i + 2] = rgb[2]; rgba[i + 3] = 255; }
  return { width, height, rgba };
}

/** `src` copied into `dst` with its top-left at (x, y). */
export function paste(dst: Frame, src: Frame, x: number, y: number): void {
  for (let r = 0; r < src.height; r++) dst.rgba.set(src.rgba.subarray(r * src.width * 4, (r + 1) * src.width * 4), ((y + r) * dst.width + x) * 4);
}

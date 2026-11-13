// What shows of each eye in a rendered picture (docs/art_direction/DIRECTION.md, Round 4): the width in pixels of the
// white and iris of every eye in a window, and how light the white is against the brow over it. An eye is found by its
// iris (a patch of the moss ink wholly inside the window), then grown through the cream within a few pixels of it (the
// iris's ink ring lies between) and all the cream joined to that; the black ink round the eye bounds it.
//
//   bun tools/eye_pixels.ts <picture.webp> [x,y,w,h]
//
// Reads the picture through ImageMagick (`magick`). A window keeps the island's own green out.

const [path, win] = process.argv.slice(2);
if (path === undefined) throw new Error("usage: bun tools/eye_pixels.ts <picture.webp> [x,y,w,h]");
const size = Bun.spawnSync(["magick", "identify", "-format", "%w %h", path]).stdout.toString().trim().split(" ").map(Number) as [number, number];
const [x0, y0, W, H] = win === undefined ? [0, 0, size[0], size[1]] : (win.split(",").map(Number) as [number, number, number, number]);
const raw = Bun.spawnSync(["magick", path, "-crop", `${W}x${H}+${x0}+${y0}`, "+repage", "-depth", "8", "rgb:-"]).stdout;
if (raw.length !== W * H * 3) throw new Error(`eye_pixels: expected ${W * H * 3} bytes from magick, got ${raw.length}`);

const at = (i: number) => [raw[i * 3]! / 255, raw[i * 3 + 1]! / 255, raw[i * 3 + 2]! / 255] as const;
const lum = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** The iris's moss, lit or in shadow: green over red and well over blue. */
const green = ([r, g, b]: readonly [number, number, number]) => g > r * 1.08 && g > b * 1.5 && g > 0.25;
/** The white's cream, lit or in shadow (the overprint takes it toward indigo, never toward brick). */
const cream = ([r, g, b]: readonly [number, number, number]) => r > 0.5 && g > 0.5 && b > 0.38 && r - g < 0.16;
/** The brow's dark brick: red, and dark. */
const dark = (c: readonly [number, number, number]) => c[0] > c[1] * 1.8 && lum(c) < 0.2 && lum(c) > 0.06;

const kind = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) { const c = at(i); kind[i] = green(c) ? 2 : cream(c) ? 1 : 0; }
const seen = new Uint8Array(W * H);
type Box = { x0: number; x1: number; y0: number; y1: number; greens: number; whites: number; whiteLum: number; edge: boolean };
/** Every pixel of one of `kinds` joined to `seeds` through such pixels, added to the box. */
function grow(e: Box, seeds: number[], kinds: readonly number[]): void {
  const stack = seeds.filter((i) => !seen[i] && kinds.includes(kind[i]!));
  for (const i of stack) seen[i] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!, x = i % W, y = (i - x) / W;
    e.x0 = Math.min(e.x0, x); e.x1 = Math.max(e.x1, x); e.y0 = Math.min(e.y0, y); e.y1 = Math.max(e.y1, y);
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) e.edge = true;
    if (kind[i] === 2) e.greens++; else { e.whites++; e.whiteLum += lum(at(i)); }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (kinds.includes(kind[j]!) && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
  }
}
const eyes: Box[] = [];
for (let s = 0; s < W * H; s++) {
  if (kind[s] !== 2 || seen[s]) continue;
  const e: Box = { x0: W, x1: 0, y0: H, y1: 0, greens: 0, whites: 0, whiteLum: 0, edge: false };
  grow(e, [s], [2]);
  // An iris: a green patch of an eye's size, wholly inside the window (the island's green runs off it).
  if (e.greens < 12 || e.edge) continue;
  // Its white: the cream within RING pixels of the iris (its ink ring lies between them), and all the cream joined to that.
  const RING = 4, near: number[] = [];
  for (let y = Math.max(0, e.y0 - RING); y <= Math.min(H - 1, e.y1 + RING); y++) for (let x = Math.max(0, e.x0 - RING); x <= Math.min(W - 1, e.x1 + RING); x++) near.push(y * W + x);
  grow(e, near, [1]);
  eyes.push(e);
}
eyes.sort((a, b) => a.x0 - b.x0);
console.log(`${path}  window ${x0},${y0} ${W}x${H}: ${eyes.length} eye(s) found by their iris`);
for (const e of eyes) {
  // The brow: the dark brick in the band above the eye, as wide as the eye and as tall as half of it.
  let n = 0, sum = 0;
  const tall = Math.max(6, Math.round((e.y1 - e.y0) * 0.6));
  for (let y = Math.max(0, e.y0 - tall); y < e.y0 + 2; y++) for (let x = e.x0; x <= e.x1; x++) { const c = at(y * W + x); if (dark(c)) { n++; sum += lum(c); } }
  const white = e.whites > 0 ? e.whiteLum / e.whites : 0, brow = n > 0 ? sum / n : NaN;
  console.log(`  at ${x0 + e.x0},${y0 + e.y0}: white and iris ${e.x1 - e.x0 + 1} px wide, ${e.y1 - e.y0 + 1} px tall (${e.whites} white, ${e.greens} iris pixels); white ${white.toFixed(3)}, brow over it ${Number.isNaN(brow) ? "none found" : `${brow.toFixed(3)} (${n} px): ${(white / brow).toFixed(1)} to 1`}`);
}

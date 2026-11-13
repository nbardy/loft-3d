// Cost pictures for docs/marching/: one folded tree, drawn four ways, counting work per pixel on the CPU.
//   bun tools/explain_marching_3d.ts
// These are operation counts, not GPU milliseconds. They show where the work goes, and by what ratio it changes.
//   A  sphere tracing the folded field over the whole image
//   B  the same, after one coarse march per 8x8 tile that every pixel of the tile shares (cone pre-pass)
//   C  the same tree as a list of branches, each intersected exactly
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = new URL("../docs/marching/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

type V3 = [number, number, number];
const LEVELS = 6, SCALE = 0.62, RAD = 0.11;
const A1 = 0.62, A2 = 0.5; // the two tilts that bring a folded branch upright
const PER_CALL = LEVELS + 1; // capsule evaluations in one call of the folded field

function capsuleY(p: V3): number { const y = Math.min(1, Math.max(0, p[1])); return Math.hypot(p[0], p[1] - y, p[2]) - RAD; }
/** The tree as one folded distance function. */
function tree(p0: V3): number {
  let p: V3 = [p0[0], p0[1], p0[2]], s = 1, d = capsuleY(p);
  for (let i = 0; i < LEVELS; i++) {
    let x = Math.abs(p[0]), y = p[1] - 1, z = Math.abs(p[2]);           // fold into one quadrant, move to the branch point
    let c = Math.cos(A1), n = Math.sin(A1); [x, y] = [c * x - n * y, n * x + c * y];
    c = Math.cos(A2); n = Math.sin(A2); [z, y] = [c * z - n * y, n * z + c * y];
    p = [x / SCALE, y / SCALE, z / SCALE]; s *= SCALE;
    d = Math.min(d, capsuleY(p) * s);
  }
  return d;
}
/** The same tree as a list: every branch as a segment in world space (the fold run backwards). */
function branches(): { a: V3; b: V3; r: number }[] {
  const out: { a: V3; b: V3; r: number }[] = [];
  type M = { o: V3; x: V3; y: V3; z: V3; s: number };
  const at = (m: M, q: V3): V3 => [0, 1, 2].map((k) => m.o[k] + m.s * (m.x[k] * q[0] + m.y[k] * q[1] + m.z[k] * q[2])) as V3;
  const rec = (m: M, level: number) => {
    out.push({ a: at(m, [0, 0, 0]), b: at(m, [0, 1, 0]), r: RAD * m.s });
    if (level === LEVELS) return;
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const inv = (q: V3): V3 => {
        let [x, y, z] = [q[0] * SCALE, q[1] * SCALE, q[2] * SCALE];
        let c = Math.cos(A2), n = Math.sin(A2); [z, y] = [c * z + n * y, -n * z + c * y];
        c = Math.cos(A1); n = Math.sin(A1); [x, y] = [c * x + n * y, -n * x + c * y];
        return [sx * x, y + 1, sz * z];
      };
      const o = at(m, inv([0, 0, 0]));
      const ax = (e: V3): V3 => { const p = at(m, inv(e)); return [(p[0] - o[0]) / (m.s * SCALE), (p[1] - o[1]) / (m.s * SCALE), (p[2] - o[2]) / (m.s * SCALE)]; };
      rec({ o, x: ax([1, 0, 0]), y: ax([0, 1, 0]), z: ax([0, 0, 1]), s: m.s * SCALE }, level + 1);
    }
  };
  rec({ o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], s: 1 }, 0);
  return out;
}

// ---- camera ---------------------------------------------------------------------------------------------------------
const IW = 360, IH = 300, EYE: V3 = [3.4, 2.5, 4.6], TARGET: V3 = [0, 1.3, 0], FOCAL = 3.4;
const fw = (() => { const f: V3 = [TARGET[0] - EYE[0], TARGET[1] - EYE[1], TARGET[2] - EYE[2]]; const l = Math.hypot(...f); return f.map((x) => x / l) as V3; })();
const rt = (() => { const l = Math.hypot(fw[2], fw[0]); return [-fw[2] / l, 0, fw[0] / l] as V3; })();
const up: V3 = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
const dirAt = (sx: number, sy: number): V3 => {
  const x = (sx / IW * 2 - 1) * (IW / IH), y = 1 - sy / IH * 2;
  const d: V3 = [fw[0] * FOCAL + rt[0] * x + up[0] * y, fw[1] * FOCAL + rt[1] * x + up[1] * y, fw[2] * FOCAL + rt[2] * x + up[2] * y];
  const l = Math.hypot(...d); return [d[0] / l, d[1] / l, d[2] / l];
};
const along = (d: V3, t: number): V3 => [EYE[0] + d[0] * t, EYE[1] + d[1] * t, EYE[2] + d[2] * t];
const PIXEL = 2 / IH / FOCAL; // world size of a pixel at unit distance
const N = IW * IH, CAP = 128, T0 = 2.2, TMAX = 14;
const project = (p: V3): [number, number, number] => {
  const v: V3 = [p[0] - EYE[0], p[1] - EYE[1], p[2] - EYE[2]];
  const z = v[0] * fw[0] + v[1] * fw[1] + v[2] * fw[2], x = v[0] * rt[0] + v[1] * rt[1] + v[2] * rt[2], y = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
  return [((x * FOCAL / z) / (IW / IH) + 1) / 2 * IW, (1 - y * FOCAL / z) / 2 * IH, z];
};

/** Sphere tracing one ray from `tStart`. A hit is a distance below half a pixel's footprint at that range. */
function march(d: V3, tStart: number): { n: number; hit: boolean; t: number } {
  let t = tStart, n = 0;
  while (n < CAP && t < TMAX) {
    const dist = tree(along(d, t)); n++;
    if (dist < 0.5 * PIXEL * t) return { n, hit: true, t };
    t += dist;
  }
  return { n, hit: false, t };
}

// ---- A: every pixel marches alone -----------------------------------------------------------------------------------
const aSteps = new Float32Array(N), aHit = new Uint8Array(N), aDepth = new Float32Array(N);
for (let py = 0; py < IH; py++) for (let px = 0; px < IW; px++) {
  const i = py * IW + px, r = march(dirAt(px + 0.5, py + 0.5), T0);
  aSteps[i] = r.n; aHit[i] = r.hit ? 1 : 0; aDepth[i] = r.t;
}
const sum = (a: ArrayLike<number>, keep: (i: number) => boolean = () => true) => { let s = 0; for (let i = 0; i < a.length; i++) if (keep(i)) s += a[i]; return s; };
const hits = sum(aHit);

// ---- B: one coarse march per tile, shared by its pixels --------------------------------------------------------------
// A cone around the tile's centre ray, wide enough to hold every pixel ray of the tile: radius k t at distance t.
// At a point on the axis with distance d to the surface, the ball of radius d holds the cone up to s further along
// when s + k (t + s) <= d, so the cone may advance by (d - k t) / (1 + k). When that advance drops below a pixel the
// cone is touching something; every pixel of the tile starts its own march there. A cone that reaches the far limit
// proves the whole tile empty.
const TILE = 8, TW = Math.ceil(IW / TILE), TH = Math.ceil(IH / TILE);
const K = (TILE * Math.SQRT2 / 2) * PIXEL;
const bCost = new Float32Array(N), bHit = new Uint8Array(N);
let coarseCalls = 0, fineCalls = 0, tilesEmpty = 0;
for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
  const d = dirAt(tx * TILE + TILE / 2, ty * TILE + TILE / 2);
  let t = T0, n = 0, empty = false;
  while (n < CAP) {
    const free = tree(along(d, t)) - K * t; n++;
    if (free <= 0.5 * PIXEL * t) break;
    t += free / (1 + K);
    if (t > TMAX) { empty = true; break; }
  }
  coarseCalls += n; if (empty) tilesEmpty++;
  for (let py = ty * TILE; py < Math.min(IH, (ty + 1) * TILE); py++) for (let px = tx * TILE; px < Math.min(IW, (tx + 1) * TILE); px++) {
    const i = py * IW + px;
    let fine = 0;
    if (!empty) { const r = march(dirAt(px + 0.5, py + 0.5), t); fine = r.n; bHit[i] = r.hit ? 1 : 0; }
    fineCalls += fine; bCost[i] = fine + n / (TILE * TILE);
  }
}
const bMismatch = sum(aHit, (i) => aHit[i] !== bHit[i]) + sum(bHit, (i) => aHit[i] !== bHit[i]);

// ---- C: the tree as a list, each branch intersected exactly --------------------------------------------------------
/** Ray against a capsule, closed form (after Quilez). Returns the distance or -1. */
function hitCapsule(ro: V3, rd: V3, pa: V3, pb: V3, r: number): number {
  const ba: V3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], oa: V3 = [ro[0] - pa[0], ro[1] - pa[1], ro[2] - pa[2]];
  const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  const a = baba - bard * bard; let b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba, h = b * b - a * c;
  if (h < 0) return -1;
  const t = (-b - Math.sqrt(h)) / a, y = baoa + t * bard;
  if (y > 0 && y < baba) return t;
  const oc: V3 = y <= 0 ? oa : [ro[0] - pb[0], ro[1] - pb[1], ro[2] - pb[2]];
  b = dot(rd, oc); c = dot(oc, oc) - r * r; h = b * b - c;
  return h > 0 ? -b - Math.sqrt(h) : -1;
}
const list = branches();
function drawList(dropBelowPx: number) { // dropBelowPx: skip branches thinner than this on screen (0 keeps all)
  const count = new Float32Array(N), depth = new Float32Array(N).fill(Infinity);
  let drawn = 0;
  for (const c of list) {
    const a = project(c.a), b = project(c.b), zNear = Math.min(a[2], b[2]);
    if (c.r / (PIXEL * zNear) < dropBelowPx) continue;
    drawn++;
    // The march calls a hit at half a pixel from the surface; give the list the same half pixel so the pictures match.
    const r = c.r + 0.5 * PIXEL * (a[2] + b[2]) / 2, reach = r / (PIXEL * zNear) + 0.71;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - reach)), x1 = Math.min(IW - 1, Math.ceil(Math.max(a[0], b[0]) + reach));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - reach)), y1 = Math.min(IH - 1, Math.ceil(Math.max(a[1], b[1]) + reach));
    const ex = b[0] - a[0], ey = b[1] - a[1], ee = Math.max(1e-9, ex * ex + ey * ey);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      // inside the branch's screen footprint (a stadium around its projected segment)? That is the quad a GPU would draw.
      const qx = px + 0.5 - a[0], qy = py + 0.5 - a[1], h = Math.min(1, Math.max(0, (qx * ex + qy * ey) / ee));
      if (Math.hypot(qx - ex * h, qy - ey * h) > reach) continue;
      const i = py * IW + px; count[i]++;
      const t = hitCapsule(EYE, dirAt(px + 0.5, py + 0.5), c.a, c.b, r);
      if (t > 0 && t < depth[i]) depth[i] = t;
    }
  }
  let differ = 0;
  for (let i = 0; i < N; i++) if ((depth[i] < Infinity) !== (aHit[i] === 1)) differ++;
  return { count, depth, drawn, solves: sum(count), differ };
}
const all = drawList(0);

// ---- pictures ---------------------------------------------------------------------------------------------------------
const HEAT_MAX = 240; // operations per pixel at the top of the colour scale, the same in every cost picture
const STOPS: V3[] = [[10, 14, 22], [38, 70, 160], [60, 170, 170], [240, 215, 90], [230, 80, 50]];
const heat = (v: number): V3 => {
  const s = Math.min(1, v / HEAT_MAX) * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(s)), f = s - i;
  return [0, 1, 2].map((k) => Math.round(STOPS[i][k] * (1 - f) + STOPS[i + 1][k] * f)) as V3;
};
function picture(name: string, colour: (i: number) => V3) {
  const S = 2, w = IW * S, h = IH * S, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = colour(Math.floor(y / S) * IW + Math.floor(x / S)), o = (y * w + x) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, d: Uint8Array) => { const b = new Uint8Array(12 + d.length), v = new DataView(b.buffer); v.setUint32(0, d.length); b.set(new TextEncoder().encode(type), 4); b.set(d, 8); v.setUint32(8 + d.length, crc(b.subarray(4, 8 + d.length))); return b; };
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const ihdr = new Uint8Array(13), iv = new DataView(ihdr.buffer); iv.setUint32(0, w); iv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const png = OUT + name + ".png";
  writeFileSync(png, Buffer.concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]));
  execFileSync("cwebp", ["-quiet", "-q", "92", png, "-o", OUT + name + ".webp"]);
  unlinkSync(png);
}
const LIGHT: V3 = (() => { const l: V3 = [0.5, 0.8, 0.35], n = Math.hypot(...l); return [l[0] / n, l[1] / n, l[2] / n]; })();
picture("fig5a_shaded", (i) => {
  if (!aHit[i]) return [13, 18, 24];
  const p = along(dirAt((i % IW) + 0.5, Math.floor(i / IW) + 0.5), aDepth[i]), e = 2e-3;
  const g: V3 = [tree([p[0] + e, p[1], p[2]]) - tree([p[0] - e, p[1], p[2]]), tree([p[0], p[1] + e, p[2]]) - tree([p[0], p[1] - e, p[2]]), tree([p[0], p[1], p[2] + e]) - tree([p[0], p[1], p[2] - e])];
  const l = Math.hypot(...g) || 1, lit = 0.28 + 0.72 * Math.max(0, (g[0] * LIGHT[0] + g[1] * LIGHT[1] + g[2] * LIGHT[2]) / l);
  return [Math.round(224 * lit), Math.round(122 * lit), Math.round(95 * lit)];
});
picture("fig5b_march", (i) => heat(aSteps[i] * PER_CALL));
picture("fig5c_shared", (i) => heat(bCost[i] * PER_CALL));
picture("fig5d_list", (i) => heat(all.count[i]));

const round = (x: number, n = 1) => +x.toFixed(n);
const marchOps = sum(aSteps) * PER_CALL, sharedOps = (coarseCalls + fineCalls) * PER_CALL;
const numbers = {
  note: "CPU operation counts for one 360x300 picture of one folded tree. Not GPU time.",
  image: `${IW}x${IH}`, levels: LEVELS, branches: list.length, heatScaleMax: HEAT_MAX,
  pixels: N, hitPixels: hits, coverage: round(100 * hits / N) + "% of pixels hit the tree",
  A_march: { capsuleEvaluations: marchOps, onHitPixels: sum(aSteps, (i) => aHit[i] === 1) * PER_CALL, perPixel: round(marchOps / N), stepsOnHits: round(sum(aSteps, (i) => aHit[i] === 1) / hits), stepsOnMisses: round(sum(aSteps, (i) => aHit[i] === 0) / (N - hits)), shareSpentOnMisses: round(100 * sum(aSteps, (i) => aHit[i] === 0) / sum(aSteps)) + "%" },
  B_sharedCoarseMarch: { tilePx: TILE, tiles: TW * TH, tilesProvenEmpty: tilesEmpty, coarse: coarseCalls * PER_CALL, fine: fineCalls * PER_CALL, capsuleEvaluations: sharedOps, perPixel: round(sharedOps / N), pixelsThatDifferFromA: bMismatch, timesFewerThanA: round(marchOps / sharedOps) },
  C_listAll: { branchesDrawn: all.drawn, raySolves: all.solves, perPixel: round(all.solves / N), pixelsThatDifferFromA: all.differ, timesFewerThanA: round(marchOps / all.solves) },
};
writeFileSync(OUT + "numbers.json", JSON.stringify(numbers, null, 1));
console.log(JSON.stringify(numbers, null, 1));

// A figure and a measurement for docs/tracing_sota.md section 6: a smooth blend drawn with each part's own triangles.
//   bun tools/explain_blend.ts
// Two parts (a disc and a capsule) keep their own outlines. Each vertex is pushed along its own outward normal until
// it lies on the zero set of the smooth union of the two distance fields. The outlines still overlap inside; the union
// of the two pushed outlines is compared against the true blended contour, found independently by scanning the field.
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../docs/marching/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

type V2 = [number, number];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, s: number): V2 => [a[0] * s, a[1] * s];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const norm = (a: V2): V2 => mul(a, 1 / len(a));

const W = 680, H = 320, K = 60; // K: the blend radius
const DISC = { c: [215, 178] as V2, r: 82 };
const CAP = { a: [300, 150] as V2, b: [540, 112] as V2, r: 40 };

const sdDisc = (p: V2) => len(sub(p, DISC.c)) - DISC.r;
const sdCap = (p: V2) => { const pa = sub(p, CAP.a), ba = sub(CAP.b, CAP.a), h = Math.min(1, Math.max(0, dot(pa, ba) / dot(ba, ba))); return len(sub(pa, mul(ba, h))) - CAP.r; };
let calls = 0;
/** The smooth union (the polynomial smooth minimum of radius K). Zero on the blended surface, negative inside. */
const blend = (p: V2): number => {
  calls++;
  const a = sdDisc(p), b = sdCap(p), h = Math.max(K - Math.abs(a - b), 0) / K;
  return Math.min(a, b) - h * h * K * 0.25;
};

type Vertex = { at: V2; n: V2 };
/** The disc's outline: n vertices, outward normals. */
const discOutline = (n: number): Vertex[] => Array.from({ length: n }, (_, i) => { const t = (i / n) * 2 * Math.PI, d: V2 = [Math.cos(t), Math.sin(t)]; return { at: add(DISC.c, mul(d, DISC.r)), n: d }; });
/** The capsule's outline: two straight sides and two half circles, about evenly spaced. */
function capsuleOutline(n: number): Vertex[] {
  const ax = norm(sub(CAP.b, CAP.a)), side: V2 = [-ax[1], ax[0]], L = len(sub(CAP.b, CAP.a)), per = 2 * L + 2 * Math.PI * CAP.r;
  return Array.from({ length: n }, (_, i) => {
    let s = (i / n) * per;
    if (s < L) return { at: add(add(CAP.a, mul(ax, s)), mul(side, CAP.r)), n: side };
    s -= L;
    if (s < Math.PI * CAP.r) { const t = s / CAP.r, d = add(mul(side, Math.cos(t)), mul(ax, Math.sin(t))); return { at: add(CAP.b, mul(d, CAP.r)), n: d }; }
    s -= Math.PI * CAP.r;
    if (s < L) return { at: add(sub(CAP.b, mul(ax, s)), mul(side, -CAP.r)), n: mul(side, -1) };
    s -= L;
    const t = s / CAP.r, d = add(mul(side, -Math.cos(t)), mul(ax, -Math.sin(t)));
    return { at: add(CAP.a, mul(d, CAP.r)), n: d };
  });
}

/**
 * Push a vertex along its normal onto the blend's zero set, at most `REACH` far. On the blended surface the nearest
 * part is at most K / 4 away, so a reach of K / 4 lets every point of the surface be reached from its nearest part;
 * the two outlines then meet at the seam with no overlap, and the edges that cross the seam dip inside (an error of
 * the first order in the edge length: the sweep below). A reach of K / 2 lets each outline run on past the seam along
 * the true surface, and the error is the chord's, second order. A vertex with no root within reach is buried in the
 * other part: it stays inside the solid, at the limit.
 */
let REACH = K / 2;
function push(v: Vertex): { at: V2; t: number; state: "untouched" | "pushed" | "buried"; steps: number } {
  const TMAX = REACH + 1e-6, f = (t: number) => blend(add(v.at, mul(v.n, t)));
  const f0 = f(0);
  if (f0 > -1e-9) return { at: v.at, t: 0, state: "untouched", steps: 0 };
  if (f(TMAX) < 0) return { at: add(v.at, mul(v.n, TMAX)), t: TMAX, state: "buried", steps: 0 };
  // Newton, kept inside a bracket that always holds the root (the slope is one value more per step).
  let lo = 0, hi = TMAX, t = 0, ft = f0, steps = 0;
  while (Math.abs(ft) > 0.01 && steps < 8) {
    const slope = (f(t + 0.25) - ft) / 0.25;
    let next = t - ft / Math.max(slope, 0.05);
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    t = next; ft = f(t); steps++;
    if (ft < 0) lo = t; else hi = t;
  }
  return { at: add(v.at, mul(v.n, t)), t, state: "pushed", steps };
}

// ---- the true contour, independently: zero crossings of the blend along the rows and columns of a fine grid -----------
function trueContour(): V2[] {
  const pts: V2[] = [], STEP = 0.25;
  const cross = (p: V2, q: V2) => { let a = p, b = q; for (let i = 0; i < 30; i++) { const m = mul(add(a, b), 0.5); if (Math.sign(blend(m)) === Math.sign(blend(a))) a = m; else b = m; } return mul(add(a, b), 0.5); };
  for (let y = 0; y <= H; y += STEP) for (let x = 0; x < W; x += STEP) if (Math.sign(blend([x, y])) !== Math.sign(blend([x + STEP, y]))) pts.push(cross([x, y], [x + STEP, y]));
  for (let x = 0; x <= W; x += STEP) for (let y = 0; y < H; y += STEP) if (Math.sign(blend([x, y])) !== Math.sign(blend([x, y + STEP]))) pts.push(cross([x, y], [x, y + STEP]));
  return pts;
}
const segDist = (p: V2, a: V2, b: V2) => { const pa = sub(p, a), ba = sub(b, a), h = Math.min(1, Math.max(0, dot(pa, ba) / Math.max(dot(ba, ba), 1e-12))); return len(sub(pa, mul(ba, h))); };
const toPolylines = (p: V2, lines: V2[][]) => Math.min(...lines.map((l) => Math.min(...l.map((a, i) => segDist(p, a, l[(i + 1) % l.length]!)))));

function measure(nDisc: number, nCap: number) {
  const parts = [discOutline(nDisc), capsuleOutline(nCap)];
  calls = 0;
  const pushed = parts.map((p) => p.map(push));
  const evals = calls, verts = nDisc + nCap;
  const lines = pushed.map((p) => p.map((v) => v.at));
  const truth = trueContour();
  const before = Math.max(...truth.map((p) => toPolylines(p, parts.map((q) => q.map((v) => v.at)))));
  const after = Math.max(...truth.map((p) => toPolylines(p, lines)));
  // How far a drawn edge strays outside the blended solid (a chord across the concave fillet), over edges with a visible end.
  let outside = 0;
  for (const p of pushed) p.forEach((v, i) => { const w = p[(i + 1) % p.length]!; if (v.state !== "buried" || w.state !== "buried") for (let s = 0.1; s < 1; s += 0.1) outside = Math.max(outside, blend(add(mul(v.at, 1 - s), mul(w.at, s)))); });
  const moved = pushed.flat().filter((v) => v.state === "pushed");
  return {
    parts, pushed, truth, verts, evals,
    numbers: {
      vertices: verts, pushed: moved.length, buried: pushed.flat().filter((v) => v.state === "buried").length,
      evaluationsPerVertex: +(evals / verts).toFixed(2), worstNewtonSteps: Math.max(...moved.map((v) => v.steps)),
      farthestPush: +Math.max(...moved.map((v) => v.t)).toFixed(2), blendRadius: K,
      contourToOutlinesBefore: +before.toFixed(2), contourToOutlinesAfter: +after.toFixed(2), edgeOutsideSolid: +outside.toFixed(2),
    },
  };
}

// The sweep: how far a vertex may be pushed, against how fine the outlines are.
const sweep: { reachOverK: number; vertices: number; contourToOutlines: number; edgeOutsideSolid: number; evaluationsPerVertex: number }[] = [];
for (const reach of [K / 4, K / 2, K]) for (const scale of [1, 2, 4, 8]) {
  REACH = reach;
  const m = measure(40 * scale, 56 * scale).numbers;
  sweep.push({ reachOverK: reach / K, vertices: m.vertices, contourToOutlines: m.contourToOutlinesAfter, edgeOutsideSolid: m.edgeOutsideSolid, evaluationsPerVertex: m.evaluationsPerVertex });
}
console.table(sweep);
REACH = K / 2;
const coarse = measure(40, 56), fine = measure(160, 224);
console.log("coarse", coarse.numbers);

// ---- the picture (the coarse outlines, so the vertices can be seen) ----------------------------------------------------
const P = (p: V2) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const COL = ["#e07a5f", "#3d7ea6"];
let g = "";
// The true contour, as a pale band under everything.
g += coarse.truth.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.2" fill="#f4f1de" opacity="0.35"/>`).join("");
// The parts as authored: dashed.
coarse.parts.forEach((part, k) => { g += `<polygon points="${part.map((v) => P(v.at)).join(" ")}" fill="none" stroke="${COL[k]}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`; });
// The pushed outlines, with the path each moved vertex took.
coarse.pushed.forEach((part, k) => {
  g += `<polygon points="${part.map((v) => P(v.at)).join(" ")}" fill="${COL[k]}" fill-opacity="0.16" stroke="${COL[k]}" stroke-width="1.6"/>`;
  part.forEach((v, i) => {
    const from = coarse.parts[k]![i]!.at;
    if (v.state !== "untouched") g += `<line x1="${from[0].toFixed(1)}" y1="${from[1].toFixed(1)}" x2="${v.at[0].toFixed(1)}" y2="${v.at[1].toFixed(1)}" stroke="${COL[k]}" stroke-width="0.8" opacity="0.8"/>`;
    g += `<circle cx="${v.at[0].toFixed(1)}" cy="${v.at[1].toFixed(1)}" r="2.3" fill="${v.state === "buried" ? "#0d1218" : "#fff"}" stroke="${COL[k]}" stroke-width="1"/>`;
  });
});
const n = coarse.numbers;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 46}" font-family="-apple-system, Helvetica, Arial, sans-serif">
<rect width="${W}" height="${H + 46}" fill="#141a22"/>
<text x="14" y="22" fill="#e6edf3" font-size="16" font-weight="600">A blend with each part's own triangles: push every vertex onto the blended surface</text>
<defs><clipPath id="view"><rect width="${W}" height="${H}"/></clipPath></defs>
<g transform="translate(0 30)" clip-path="url(#view)"><rect width="${W}" height="${H}" fill="#0d1218"/>${g}</g>
<text x="14" y="${H + 41}" fill="#9aa7b4" font-size="13.5">${n.vertices} vertices: ${n.pushed} pushed, ${n.buried} buried (dark, hidden). True contour (pale) within ${n.contourToOutlinesAfter} px of the outlines; ${n.contourToOutlinesBefore} px before</text></svg>`;
writeFileSync(OUT + "fig6_push_to_blend.svg", svg);
writeFileSync(OUT + "numbers_blend.json", JSON.stringify({ reachOverK: REACH / K, coarse: coarse.numbers, fine: fine.numbers, sweep }, null, 1));

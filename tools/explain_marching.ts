// Figures for docs/marching/: every picture is computed, not drawn by hand.
//   bun tools/explain_marching.ts
// 2D figures (SVG): sphere tracing step by step on a hit ray and a grazing ray; exact intersection of the same rays;
// which primitives matter in which cell (pruning by distance); rays from a skeleton meeting a blended surface.
// The 3D cost pictures are in explain_marching_3d.ts.
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

// ---- a small 2D scene: three shapes, each a distance function and an exact ray intersection -------------------------
type Shape = { name: string; colour: string; sd(p: V2): number; hit(o: V2, d: V2): number | null; svg: string };
function circle(c: V2, r: number, name: string, colour: string): Shape {
  return {
    name, colour, sd: (p) => len(sub(p, c)) - r,
    hit(o, d) { const oc = sub(o, c), b = dot(oc, d), q = dot(oc, oc) - r * r, h = b * b - q; if (h < 0) return null; const t = -b - Math.sqrt(h); return t > 0 ? t : null; },
    svg: `<circle cx="${c[0]}" cy="${c[1]}" r="${r}"/>`,
  };
}
function capsule(a: V2, b: V2, r: number, name: string, colour: string): Shape {
  const sd = (p: V2) => { const pa = sub(p, a), ba = sub(b, a), h = Math.min(1, Math.max(0, dot(pa, ba) / dot(ba, ba))); return len(sub(pa, mul(ba, h))) - r; };
  return {
    name, colour, sd,
    // Exact in 2D: the nearer of the two end circles and the two side segments.
    hit(o, d) {
      let best: number | null = null;
      const take = (t: number | null) => { if (t !== null && t > 0 && (best === null || t < best)) best = t; };
      for (const c of [a, b]) take(circle(c, r, "", "").hit(o, d));
      const ba = norm(sub(b, a)), n: V2 = [-ba[1], ba[0]];
      for (const s of [1, -1]) {
        const p0 = add(a, mul(n, s * r)), denom = dot(d, n);
        if (Math.abs(denom) < 1e-9) continue;
        const t = dot(sub(p0, o), n) / denom, along = dot(sub(add(o, mul(d, t)), a), ba);
        if (along >= 0 && along <= len(sub(b, a))) take(t);
      }
      return best;
    },
    svg: `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke-width="${2 * r}" stroke-linecap="round"/>`,
  };
}
const SHAPES: Shape[] = [
  circle([250, 95], 52, "A", "#e07a5f"),
  capsule([330, 245], [470, 205], 30, "B", "#3d7ea6"),
  circle([560, 100], 44, "C", "#7fb069"),
];
const scene = (p: V2) => Math.min(...SHAPES.map((s) => s.sd(p)));
const W = 680, H = 320;
const ORIGIN: V2 = [28, 170];
const RAYS: { label: string; dir: V2; colour: string }[] = [
  { label: "the ray that hits", dir: norm([420, 52]), colour: "#f2cc8f" },
  { label: "the ray that grazes and misses (to the edge of the picture)", dir: norm([500, -12]), colour: "#c9b6e4" },
];

function sphereTrace(o: V2, d: V2, eps = 0.6, cap = 200) {
  const steps: { p: V2; r: number }[] = [];
  let t = 0;
  for (let i = 0; i < cap; i++) {
    const p = add(o, mul(d, t)), r = scene(p);
    steps.push({ p, r });
    if (r < eps) return { steps, hit: true, t };
    t += r;
    if (t > 900) break;
  }
  return { steps, hit: false, t };
}

const frame = (inner: string, title: string, note: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 46}" font-family="-apple-system, Helvetica, Arial, sans-serif">
<rect width="${W}" height="${H + 46}" fill="#141a22"/>
<text x="14" y="22" fill="#e6edf3" font-size="16" font-weight="600">${title}</text>
<defs><clipPath id="view"><rect width="${W}" height="${H}"/></clipPath></defs>
<g transform="translate(0 30)" clip-path="url(#view)"><rect width="${W}" height="${H}" fill="#0d1218"/>${inner}</g>
<text x="14" y="${H + 41}" fill="#9aa7b4" font-size="13.5">${note}</text></svg>`;
const shapesSvg = (opacity = 0.9) => SHAPES.map((s) => `<g fill="${s.colour}" stroke="${s.colour}" opacity="${opacity}">${s.svg}</g>`).join("");
const eye = `<circle cx="${ORIGIN[0]}" cy="${ORIGIN[1]}" r="5" fill="#fff"/><text x="${ORIGIN[0] - 6}" y="${ORIGIN[1] + 22}" fill="#9aa7b4" font-size="11">eye</text>`;

// Figure 1: sphere tracing.
{
  let g = shapesSvg() + eye;
  const counts: string[] = [];
  for (const ray of RAYS) {
    const tr = sphereTrace(ORIGIN, ray.dir);
    const end = add(ORIGIN, mul(ray.dir, Math.min(tr.t, 720)));
    g += `<line x1="${ORIGIN[0]}" y1="${ORIGIN[1]}" x2="${end[0].toFixed(1)}" y2="${end[1].toFixed(1)}" stroke="${ray.colour}" stroke-width="1.2"/>`;
    for (const s of tr.steps) {
      if (s.p[0] > W + 40) break;
      g += `<circle cx="${s.p[0].toFixed(1)}" cy="${s.p[1].toFixed(1)}" r="${Math.max(0.5, s.r).toFixed(1)}" fill="none" stroke="${ray.colour}" stroke-width="0.8" opacity="0.75"/><circle cx="${s.p[0].toFixed(1)}" cy="${s.p[1].toFixed(1)}" r="1.6" fill="${ray.colour}"/>`;
    }
    const inView = tr.steps.filter((s) => s.p[0] <= W).length;
    counts.push(`${ray.label}: ${tr.hit ? tr.steps.length : inView} evaluations`);
  }
  writeFileSync(OUT + "fig1_sphere_tracing.svg", frame(g, "Sphere tracing (ray marching): step by the distance to the nearest surface", counts.join("  ·  ")));
  console.log("fig1", counts.join(" | "));
}

// Figure 2: exact intersection of the same rays.
{
  let g = shapesSvg() + eye;
  for (const ray of RAYS) {
    let best: number | null = null;
    for (const s of SHAPES) { const t = s.hit(ORIGIN, ray.dir); if (t !== null && (best === null || t < best)) best = t; }
    const end = add(ORIGIN, mul(ray.dir, best ?? 720));
    g += `<line x1="${ORIGIN[0]}" y1="${ORIGIN[1]}" x2="${end[0].toFixed(1)}" y2="${end[1].toFixed(1)}" stroke="${ray.colour}" stroke-width="1.4"/>`;
    if (best !== null) g += `<circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="5" fill="none" stroke="#fff" stroke-width="1.6"/>`;
  }
  writeFileSync(OUT + "fig2_exact_intersection.svg", frame(g, "Ray tracing (exact intersection): solve once per shape, no steps", `each ray: ${SHAPES.length} solves, one per shape, whether it hits or misses`));
}

// Figure 3: which shapes matter where. A cell of half-diagonal h keeps a shape only if its distance at the cell's
// centre is within 2h of the nearest shape's: no point of the cell can have that shape as its nearest otherwise.
{
  const CELL = 40;
  let g = "", kept = 0, cells = 0;
  for (let y = 0; y < H; y += CELL) for (let x = 0; x < W; x += CELL) {
    const c: V2 = [x + CELL / 2, y + CELL / 2], h = (CELL / 2) * Math.SQRT2;
    const ds = SHAPES.map((s) => s.sd(c)), dmin = Math.min(...ds);
    const keep = SHAPES.filter((_, i) => ds[i] <= dmin + 2 * h);
    kept += keep.length; cells++;
    g += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${keep.length === 1 ? keep[0].colour : keep.length === 2 ? "#8d99ae" : "#f4f1de"}" opacity="${keep.length === 1 ? 0.28 : 0.45}" stroke="#0d1218" stroke-width="1"/>`;
    g += `<text x="${x + CELL / 2}" y="${y + CELL / 2 + 4}" text-anchor="middle" fill="#e6edf3" font-size="11">${keep.map((s) => s.name).join("")}</text>`;
  }
  g += shapesSvg(0.95);
  writeFileSync(OUT + "fig3_regions.svg", frame(g, "Pruning by region: each cell lists only the shapes that can be nearest inside it", `average ${(kept / cells).toFixed(2)} of ${SHAPES.length} shapes per cell here; the saving grows with the number of shapes`));
  console.log("fig3 mean shapes per cell", (kept / cells).toFixed(2));
}

// Figure 4: rays from a skeleton. A blended body (smooth union of circles on a spine) found along the spine's own
// rays: one short root-find per vertex, then triangles; against one march per pixel.
{
  const spine = (u: number): V2 => [60 + 560 * u, 165 + 40 * Math.sin(u * Math.PI * 1.6)];
  const US = [0.03, 0.15, 0.27, 0.39, 0.51, 0.63, 0.75, 0.86, 0.96], RS = [26, 44, 54, 60, 52, 44, 36, 27, 16];
  const blobs = US.map((u, k) => ({ c: spine(u), r: RS[k] }));
  const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  let calls = 0;
  const body = (p: V2) => { calls++; return blobs.reduce((d, b) => smin(d, len(sub(p, b.c)) - b.r, 46), 1e9); };
  const U0 = US[0], U1 = US[US.length - 1]; // the spine is inside the body between the first and last blob centres
  const station = (u: number) => { const c = spine(u), tan = norm(sub(spine(Math.min(1, u + 1e-3)), spine(Math.max(0, u - 1e-3)))); return { c, tan, n: [-tan[1], tan[0]] as V2 }; };
  /** Rays that walk once round the body: up one side, a fan round the tail, back along the other side, a fan round the head. */
  const rays = (side: number, fan: number): { o: V2; d: V2 }[] => {
    const out: { o: V2; d: V2 }[] = [];
    const turn = (c: V2, from: V2, through: V2) => { for (let k = 1; k <= fan; k++) { const a = (k / (fan + 1)) * Math.PI; out.push({ o: c, d: add(mul(from, Math.cos(a)), mul(through, Math.sin(a))) }); } };
    for (let i = 0; i < side; i++) { const st = station(U0 + (U1 - U0) * i / (side - 1)); out.push({ o: st.c, d: st.n }); }
    const tail = station(U1); turn(tail.c, tail.n, tail.tan);
    for (let i = side - 1; i >= 0; i--) { const st = station(U0 + (U1 - U0) * i / (side - 1)); out.push({ o: st.c, d: mul(st.n, -1) }); }
    const head = station(U0); turn(head.c, mul(head.n, -1), mul(head.tan, -1));
    return out;
  };
  // The outline, for the picture only: bisection on many rays (not counted).
  const rim = rays(110, 24).map(({ o, d }) => {
    let lo = 0, hi = 8;
    while (body(add(o, mul(d, hi))) < 0 && hi < 200) hi *= 1.6;
    for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (body(add(o, mul(d, mid))) < 0) lo = mid; else hi = mid; }
    return add(o, mul(d, hi));
  });
  // The vertices, counted: Newton along each ray, started from the neighbouring vertex's answer. Each iteration is one
  // value and one slope along the ray (the slope stands in for the symbolic derivative Loft already has).
  const verts: { base: V2; tip: V2 }[] = [];
  calls = 0;
  let worst = 0, r = RS[0];
  for (const { o, d } of rays(19, 4)) {
    let it = 0;
    for (; it < 8; it++) {
      const F = body(add(o, mul(d, r)));
      if (Math.abs(F) < 0.25) break;
      const slope = (body(add(o, mul(d, r + 0.5))) - F) / 0.5;
      r = Math.min(150, Math.max(1, r - F / Math.max(0.2, slope)));
    }
    worst = Math.max(worst, it);
    verts.push({ base: o, tip: add(o, mul(d, r)) });
  }
  const evals = calls;
  let g = `<polygon points="${rim.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}" fill="#5e548e" opacity="0.85"/>`;
  g += `<polyline points="${Array.from({ length: 61 }, (_, i) => spine(U0 + (U1 - U0) * i / 60).map((x) => x.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="#f2cc8f" stroke-width="2"/>`;
  for (const v of verts) g += `<line x1="${v.base[0].toFixed(1)}" y1="${v.base[1].toFixed(1)}" x2="${v.tip[0].toFixed(1)}" y2="${v.tip[1].toFixed(1)}" stroke="#f2cc8f" stroke-width="0.9" opacity="0.8"/><circle cx="${v.tip[0].toFixed(1)}" cy="${v.tip[1].toFixed(1)}" r="2.6" fill="#fff"/>`;
  writeFileSync(OUT + "fig4_skeleton_rays.svg", frame(g, "Rays from the skeleton: find the blended surface once per vertex, then rasterise", `${verts.length} vertices, ${evals} field evaluations in total (${(evals / verts.length).toFixed(1)} per vertex, worst ${worst} Newton steps), whatever the screen size`));
  writeFileSync(OUT + "numbers_2d.json", JSON.stringify({ skeletonRays: { vertices: verts.length, evaluations: evals, perVertex: +(evals / verts.length).toFixed(1), worstNewtonSteps: worst, tolerancePx: 0.25 } }, null, 1));
  console.log("fig4 evals", evals, "verts", verts.length, "worst", worst);
}

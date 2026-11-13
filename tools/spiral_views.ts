// The spiral shell from the four views it is judged in (docs/art_direction/DIRECTION.md, Round 5, "Finishing"): `game`,
// the lineup's low front camera, the low rear and from above, at 1280 x 800, with the islander at rest. The shell's
// drawn surface (back/spiral_shell.ts) is splatted with a depth buffer and painted by the same band law the shader uses
// (compiled from `bandAt`); the carapace is a stand-in (carapace/base.ts's section). It predicts, per view, how many cream
// bands a line through the shell crosses (the most over four directions), the shell's silhouette against the body's,
// how much lip and throat show, and where the tip is.
//
//   bun tools/spiral_views.ts [--set '{"tilt":0.6}'] [--sketch out/x.ppm] [--quick: the plan and the legs only]
//   bun tools/spiral_views.ts --measure out/spiral/views.webp   counts bands on a render of the views in this order
//       (loft render ... --views game,lowFront,lowRear,top,lowLeft,lowRight: tiled as the render tiles them, rows of RW / 1280), along the same lines, by ink: cream is light with green
//       near red (G/R > 0.7), brick is red (G/R < 0.55), key lines and anything else are neither.

import { cameraMatrices, project } from "../src/host/camera.ts";
import { compileJs, variable } from "../src/index.ts";
import { design } from "../examples/bosses/reefback_titan.ts";
import { bandAt, coilAt, shellTwin, U } from "../examples/bosses/titan/back/spiral_shell.ts";
import { lightPlan } from "../examples/bosses/titan/back/spiral.ts";
import type { Numbers } from "../examples/bosses/titan/numbers.ts";

type V = readonly [number, number, number];
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, k in b ? (typeof v === "object" && !Array.isArray(v) && v !== null ? merge(v as Record<string, unknown>, b[k] as Record<string, unknown>) : b[k]) : v]));
const set = flag("--set");
const n0 = design.resolve({ variant: "islander", picks: [] }).numbers as Numbers;
const n = { ...n0, spiral: set === undefined ? n0.spiral : merge(n0.spiral, JSON.parse(set)) } as Numbers;
const twin = shellTwin(n), P = twin.plan, C = n.carapace, TAU = 2 * Math.PI, WATER = -n.ride;
const f2 = (x: number, d = 2) => x.toFixed(d), fv = (p: readonly number[]) => `(${p.map((x) => f2(x)).join(", ")})`;

const W = 1280, H = 800;
const VIEWS = {
  game: { kind: "perspective", eye: [23, 27, 21], target: [3, 0.5, 2.5], fovY: 0.6 },
  lowFront: { kind: "perspective", eye: [30, 3, 0], target: [0, 3.4, 0], fovY: 0.4 },
  lowRear: { kind: "perspective", eye: [-30, 5, 0], target: [0, 3.4, 0], fovY: 0.4 },
  top: { kind: "orthographic", eye: [1, 50, 0.001], target: [1, 0, 1], height: 34 },
  // The scene's `lowLeft` and its mirror (`lowRight`): the side views a hermit's shell is judged from.
  lowLeft: { kind: "perspective", eye: [1, 5, -30], target: [1, 3.4, 0], fovY: 0.4 },
  lowRight: { kind: "perspective", eye: [1, 5, 30], target: [1, 3.4, 0], fovY: 0.4 },
} as const;
const NAMES = Object.keys(VIEWS) as (keyof typeof VIEWS)[];
const mats = NAMES.map((k) => cameraMatrices(VIEWS[k] as Parameters<typeof cameraMatrices>[0], W / H));
const px = (view: number, p: V) => { const q = project(mats[view]!, [p[0], p[1] + n.ride, p[2]], W, H); return [q.x, q.y, q.depth] as const; };

// ---- the plan ----
const PH = variable("views_phi", "f32"), band = compileJs([bandAt(P, n.spiral.band, PH).across]);
const coilF = compileJs([coilAt(P, PH).across, coilAt(P, PH).inFace]);
/** The print at phi, as the shader prints it: the face's coil (7 cream, 6 brick) where the face shows, the rim's bands (2, 1) elsewhere. */
const printAt = (phi: number): Cls => {
  const [across, inFace] = coilF({ vars: { views_phi: phi }, inputs: {}, params: {} }) as number[];
  if (inFace! > 0.5) return across! > 1 - n.spiral.coil.cream ? 7 : 6;
  return (band({ vars: { views_phi: phi }, inputs: {}, params: {} })[0] as number) < 1 ? 2 : 1;
};
const mouthOpens = ((): V => { const a = twin.at(0, Math.PI / 2), b = twin.at(0.05, Math.PI / 2); const d: V = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; const l = Math.hypot(...d); return [d[0] / l, d[1] / l, d[2] / l]; })();
const tipTop = twin.drawn(0, 0);
console.log(`axis ${fv(P.axis)}; the mouth opens toward ${fv(mouthOpens)}; tip ${fv(tipTop)} (${f2(tipTop[1] - WATER)} above the water)`);

// ---- the legs at rest (tools/spiral_theory.ts's stand-in): least gap of each thigh and shin to the shell ----
{
  const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], addv = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mulv = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k], len = (a: V) => Math.hypot(a[0], a[1], a[2]), unitv = (a: V) => mulv(a, 1 / len(a));
  const cloud: V[] = [];
  for (let i = 0; i <= 120; i++) for (let j = 0; j < 48; j++) cloud.push(twin.at((i / 120) * P.whorls, (j / 48) * TAU));
  const gapTo = (q: V) => { let best = Infinity; for (const c of cloud) best = Math.min(best, len(sub(q, c))); return twin.inside(q) ? -best : best; };
  const capsule = (a: V, b: V, r: number) => Math.min(...Array.from({ length: 13 }, (_, i) => gapTo(addv(a, mulv(sub(b, a), i / 12))) - r));
  const gaps: string[] = [];
  let least = Infinity;
  for (const s of [-1, 1] as const) n.legRoots.forEach((x, i) => {
    const root: V = [x, -0.1, s * C.width * 0.85], foot: V = [n.legFeet[i]![0], n.floor - n.ride, s * n.legFeet[i]![1]];
    const ankle: V = [foot[0], foot[1] + n.legLengths[2], foot[2]];
    const ra = sub(ankle, root), d = len(ra), [l1, l2] = n.legLengths;
    const cosA = Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)), along = unitv(ra);
    const bend: V = [0, 1, s * 0.4], perp = unitv(sub(bend, mulv(along, bend[0] * along[0] + bend[1] * along[1] + bend[2] * along[2])));
    const knee = addv(root, addv(mulv(along, l1 * cosA), mulv(perp, l1 * Math.sqrt(1 - cosA * cosA))));
    const g = Math.min(capsule(root, knee, 0.45), capsule(knee, ankle, 0.38));
    least = Math.min(least, g); gaps.push(`${s < 0 ? "L" : "R"}${i} ${f2(g)}`);
  });
  console.log(`legs at rest, least gap to the shell (below 0: inside): ${f2(least)}  [${gaps.join(", ")}]`);
  console.log(`shell top y ${f2(Math.max(...cloud.map((c) => c[1])))}`);
}

if (args.includes("--quick")) process.exit(0);

// ---- the splats: shell (class per point) and the carapace, each view ----
type Cls = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; // none, brick, cream, lip, throat, body, face brick, face cream
const bufs = NAMES.map(() => ({ cls: new Uint8Array(W * H), z: new Float32Array(W * H).fill(Infinity), shell: new Uint8Array(W * H), body: new Uint8Array(W * H) }));
const splat = (v: number, p: V, c: Cls, r: number) => {
  const q = px(v, p), b = bufs[v]!, x0 = Math.round(q[0]), y0 = Math.round(q[1]);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = x0 + dx, y = y0 + dy; if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const k = y * W + x;
    if (c === 5) b.body[k] = 1; else b.shell[k] = 1;
    if (q[2] < b.z[k]!) { b.z[k] = q[2]; b.cls[k] = c; }
  }
};
let lo: V = [Infinity, Infinity, Infinity], hi: V = [-Infinity, -Infinity, -Infinity];
const NU = 1400, NV = 260;
for (let i = 0; i <= NU; i++) for (let j = 0; j < NV; j++) {
  const u = i / NU, vv = j / NV, p = twin.drawn(u, vv);
  if (p[1] < WATER) continue;
  lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1]), Math.min(lo[2], p[2])]; hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1]), Math.max(hi[2], p[2])];
  const back = (1 - Math.min(u / U.lip, 1)) * P.whorls;
  const c: Cls = u > U.throat + 0.01 ? 4 : u > U.lip - 0.002 ? 3 : back > P.whorls - n.spiral.coil.boss ? 7 : printAt(-TAU * P.turn * vv);
  for (let v = 0; v < NAMES.length; v++) splat(v, p, c, 2);
}
const hullAt = (x: number) => {
  const mm = (x - C.from) / (C.to - C.from);
  const g = mm < 0.45 ? Math.sqrt(Math.max(1 - (1 - mm / 0.45) ** 2, 0)) : mm > 0.6 ? Math.sqrt(Math.max(1 - ((mm - 0.6) / 0.4) ** 2, 0)) : 1;
  return { half: g * C.width, tall: g * C.height, spine: -0.1 + Math.min(mm * 2, 1) * 0.25 + C.rise * Math.max(0, 1 - 2 * mm) };
};
for (let i = 0; i <= 160; i++) for (let j = 0; j < 160; j++) {
  const x = C.from + ((C.to - C.from) * i) / 160, h = hullAt(x), a = (j / 160) * TAU, e = 2 / 2.3;
  const p: V = [x, h.spine + Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** e * h.tall, Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** e * h.half];
  for (let v = 0; v < NAMES.length; v++) splat(v, p, 5, 2);
}
console.log(`shell above the water: x ${f2(lo[0])}..${f2(hi[0])}, y ${f2(lo[1])}..${f2(hi[1])} (${f2(hi[1] - WATER)} tall), z ${f2(lo[2])}..${f2(hi[2])}; the tip is ${f2(hi[1] - tipTop[1])} below the shell's top`);

// ---- lines through the shell: cream runs crossed ----
const DIRS = [[1, 0], [0, 1], [0.707, 0.707], [0.707, -0.707]] as const;
/** Runs of `isCream` at least 3 px long, separated by at least 3 px of `isBrick`, along a line through (cx, cy). */
function crossings(cx: number, cy: number, inShell: (k: number) => boolean, isCream: (k: number) => boolean, isBrick: (k: number) => boolean): number {
  let best = 0;
  for (const [dx, dy] of DIRS) {
    type St = "none" | "cream" | "brick";
    let runs = 0, state = "none" as St, len = 0;
    for (let t = -900; t <= 900; t++) {
      const x = Math.round(cx + dx * t), y = Math.round(cy + dy * t); if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const k = y * W + x; if (!inShell(k)) continue;
      const s: St = isCream(k) ? "cream" : isBrick(k) ? "brick" : state;
      if (s === state) { len++; continue; }
      if (state === "cream" && len >= 3) runs++;
      state = s; len = 1;
    }
    if (state === "cream" && len >= 3) runs++;
    best = Math.max(best, runs);
  }
  return best;
}
/** The curl's centre on screen, and the coil's cream runs crossed along the best of 24 rays from it (a run: 3 px). */
const CURL = twin.drawn(0, 0);
const LP = lightPlan(n, twin), LIGHT_FOOT = LP.towerFoot;
const LIGHT_TOP: V = [LP.towerFoot[0] + LP.dir[0] * (LP.L.height + LP.L.size), LP.towerFoot[1] + LP.dir[1] * (LP.L.height + LP.L.size), LP.towerFoot[2] + LP.dir[2] * (LP.L.height + LP.L.size)];
function turnsOf(v: number, inFace: (k: number) => boolean, isCream: (k: number) => boolean): number {
  const [cx, cy] = px(v, CURL);
  let best = 0;
  for (let r = 0; r < 24; r++) {
    const a = (r / 24) * TAU, dx = Math.cos(a), dy = Math.sin(a);
    let runs = 0, len = 0;
    for (let t = 0; t <= 900; t++) {
      const x = Math.round(cx + dx * t), y = Math.round(cy + dy * t); if (x < 0 || x >= W || y < 0 || y >= H) break;
      const k = y * W + x; if (!inFace(k)) continue;
      if (isCream(k)) len++; else { if (len >= 3) runs++; len = 0; }
    }
    if (len >= 3) runs++;
    best = Math.max(best, runs);
  }
  return best;
}
const centres = NAMES.map((_, v) => {
  const b = bufs[v]!; let sx = 0, sy = 0, m = 0;
  for (let k = 0; k < W * H; k++) if (b.cls[k]! >= 1 && b.cls[k] !== 5 && b.cls[k]! <= 7 && b.cls[k] !== 3 && b.cls[k] !== 4) { sx += k % W; sy += Math.floor(k / W); m++; }
  return [sx / Math.max(m, 1), sy / Math.max(m, 1)] as const;
});
console.log("\n== predicted, per view (1280 x 800, at rest)");
NAMES.forEach((name, v) => {
  const b = bufs[v]!, [cx, cy] = centres[v]!;
  const count = (c: Cls) => b.cls.reduce((s, x) => s + (x === c ? 1 : 0), 0);
  const shellArea = b.shell.reduce((s, x) => s + x, 0), bodyArea = b.body.reduce((s, x) => s + x, 0);
  const runs = crossings(cx, cy, (k) => b.cls[k] === 1 || b.cls[k] === 2, (k) => b.cls[k] === 2, (k) => b.cls[k] === 1);
  const face = count(6) + count(7), turns = turnsOf(v, (k) => b.cls[k] === 6 || b.cls[k] === 7, (k) => b.cls[k] === 7);
  const lt = px(v, LIGHT_TOP), lf = px(v, LIGHT_FOOT);
  console.log(`${name.padEnd(8)} face ${face} px (x ${f2(face / Math.max(b.body.reduce((s, x) => s + x, 0), 1))} the body), coil turns crossed ${turns}; light foot (${f2(lf[0], 0)}, ${f2(lf[1], 0)}) top (${f2(lt[0], 0)}, ${f2(lt[1], 0)})${lt[1] < 0 ? " OUT OF FRAME" : ""}`);
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let k = 0; k < W * H; k++) if (b.shell[k]) { const x = k % W, y = Math.floor(k / W); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  console.log(`${name.padEnd(8)} cream bands crossed ${runs}; shell box x ${x0}..${x1} y ${y0}..${y1}; shell silhouette ${shellArea} px, body ${bodyArea} px (x ${f2(shellArea / Math.max(bodyArea, 1))}); seen: cream ${count(2)} brick ${count(1)} lip ${count(3)} throat ${count(4)} px; centre (${f2(cx, 0)}, ${f2(cy, 0)})`);
});

// ---- the lip's arc from the low front: over every column of the carapace, the lip shows above the carapace's top ----
{
  const v = NAMES.indexOf("lowFront"), b = bufs[v]!;
  let cols = 0, arched = 0, gapSum = 0;
  for (let x = 0; x < W; x++) {
    let top = -1; for (let y = 0; y < H; y++) if (b.body[y * W + x]) { top = y; break; }
    if (top < 0) continue;
    cols++;
    // The nearest lip pixel above the carapace's top in this column (the arc), and the throat between.
    for (let y = top - 1; y >= Math.max(0, top - 120); y--) if (b.cls[y * W + x] === 3) { arched++; gapSum += top - y; break; }
  }
  console.log(`\nlowFront: the lip arcs over ${arched} of the carapace's ${cols} columns (${f2((100 * arched) / Math.max(cols, 1), 0)}%), the lip's underside on average ${f2(gapSum / Math.max(arched, 1), 0)} px above the carapace's top`);
}

// ---- measuring a render ----
const measure = flag("--measure");
if (measure !== undefined) {
  const ppm = `${measure}.ppm`;
  Bun.spawnSync(["dwebp", measure, "-ppm", "-o", ppm]);
  const bytes = new Uint8Array(await Bun.file(ppm).arrayBuffer());
  let at = 0, fields: number[] = [];
  while (fields.length < 4) { let s = ""; while (bytes[at] !== 0x0a && bytes[at] !== 0x20) s += String.fromCharCode(bytes[at++]!); at++; if (s !== "") fields.push(s === "P6" ? 0 : Number(s)); }
  const RW = fields[1]!, rgb = bytes.subarray(at);
  console.log(`\n== measured on ${measure} (${RW} x ${fields[2]}), the panes in order ${NAMES.join(", ")}`);
  // --pane-view game: every pane is that one view (a `loft frames` sheet of times), not the four in order.
  const one = flag("--pane-view"), panes = one === undefined ? NAMES.map((_, v) => v) : Array.from({ length: (RW / W) * (fields[2]! / H) }, () => NAMES.indexOf(one as (typeof NAMES)[number]));
  panes.forEach((v, pane) => {
    const name = `${NAMES[v]} #${pane}`;
    const cols = RW / W, b = bufs[v]!, [cx, cy] = centres[v]!, ox = (pane % cols) * W, oy = Math.floor(pane / cols) * H;
    const pix = (k: number) => { const x = ox + (k % W), y = oy + Math.floor(k / W), i = (y * RW + x) * 3; return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!] as const; };
    const ratio = (k: number) => { const [r, g] = pix(k); return r < 40 ? -1 : g / r; };
    const runs = crossings(cx, cy, (k) => b.shell[k] === 1, (k) => ratio(k) > 0.7, (k) => ratio(k) >= 0 && ratio(k) < 0.55);
    const turns = turnsOf(v, (k) => b.cls[k] === 6 || b.cls[k] === 7, (k) => ratio(k) > 0.7);
    const faceSeen = (() => { let all = 0, seen = 0; for (let k = 0; k < W * H; k++) if (b.cls[k] === 6 || b.cls[k] === 7) { all++; const r = ratio(k); const [rr, gg, bb] = pix(k); if (r > 0.7 || (r >= 0 && r < 0.55 && rr > gg + 40)) seen++; } return seen / Math.max(all, 1); })();
    console.log(`${name.padEnd(12)} cream bands crossed ${runs}; coil turns crossed ${turns}; of the face's predicted pixels, ${f2(faceSeen * 100, 0)}% print shell inks (cream or brick)`);
  });
}

const sketch = flag("--sketch");
if (sketch !== undefined) {
  const PAL: Record<Cls, readonly number[]> = { 0: [33, 51, 94], 1: [168, 56, 33], 2: [237, 224, 191], 3: [250, 240, 200], 4: [30, 20, 20], 5: [120, 60, 50], 6: [190, 40, 20], 7: [255, 245, 210] };
  const rows = Math.ceil(NAMES.length / 2), out = new Uint8Array(W * 2 * H * rows * 3);
  NAMES.forEach((_, v) => { const b = bufs[v]!, ox = (v % 2) * W, oy = Math.floor(v / 2) * H; for (let k = 0; k < W * H; k++) out.set(PAL[b.cls[k] as Cls], ((oy + Math.floor(k / W)) * W * 2 + ox + (k % W)) * 3); });
  const head = new TextEncoder().encode(`P6\n${W * 2} ${H * rows}\n255\n`), all = new Uint8Array(head.length + out.length);
  all.set(head); all.set(out, head.length); await Bun.write(sketch, all);
  console.log(`\nsketch (panes ${NAMES.join(", ")}): ${sketch}`);
}

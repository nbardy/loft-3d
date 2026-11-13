// The spiral shell's theory, before the build (docs/art_direction/DIRECTION.md, Round 5): what the shell's numbers
// give, in units and in pixels from the design's cameras, by plain arithmetic on the shell's own closed form
// (examples/bosses/titan/back/spiral_shell.ts) with the crab at rest (no walk, no lean), its carapace, legs, eyes and
// great claw as rough stand-ins. A change to the numbers changes the prediction.
//
//   bun tools/spiral_theory.ts                      the numbers
//   bun tools/spiral_theory.ts --sketch out/x.ppm   and a point sketch from game, back, far and the picked picture's camera
//   bun tools/spiral_theory.ts --set '{"tilt":0.6}' with numbers of `spiral` overridden (exploring; nothing is saved)
//
// The measured side is `loft check`, `loft profile` and tools/spiral_clear.ts.

import { cameraMatrices, project } from "../src/host/camera.ts";
import { GRID, U, bandEdges, shellTwin, vmath } from "../examples/bosses/titan/back/spiral_shell.ts";
import { S, type Numbers } from "../examples/bosses/titan/numbers.ts";
import { lightPlan, shoulderOf } from "../examples/bosses/titan/back/spiral.ts";

type V = readonly [number, number, number];
const { add, mul, dot, cross, unit } = vmath;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const TAU = 2 * Math.PI;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, k in b ? (typeof v === "object" && !Array.isArray(v) ? merge(v as Record<string, unknown>, b[k] as Record<string, unknown>) : b[k]) : v]));
const set = flag("--set");
const n = { ...S, spiral: set === undefined ? S.spiral : merge(S.spiral, JSON.parse(set)) } as Numbers;
const SP = n.spiral, C = n.carapace;

const twin = shellTwin(n), P = twin.plan;
/** Crab coordinates to the world, the body at rest. */
const world = (p: V): V => [p[0], p[1] + n.ride, p[2]];
const WATER = -n.ride;

const W = 1280, H = 800;
const CAMERAS = {
  game: { eye: [23, 27, 21], target: [3, 0.5, 2.5] },
  back: { eye: [-15, 19, 9], target: [-1.5, 2.5, 0] },
  far: { eye: [33, 21, 21], target: [3, 1.5, -1] },
  // The picked picture's camera (back_spiral_pick.webp): from behind and above, on the flank the curl faces.
  pick: { eye: [-12, 17, 19], target: [-1.5, 2, 0] },
  top: { eye: [1, 50, 0.001], target: [1, 0, 1] },
} as const;
const cams = Object.fromEntries(Object.entries(CAMERAS).map(([k, c]) => [k, cameraMatrices(k === "top" ? { kind: "orthographic", eye: c.eye, target: c.target, height: 34 } : { kind: "perspective", eye: c.eye, target: c.target, fovY: 0.6 }, W / H)]));
const px = (cam: string, p: V) => { const q = project(cams[cam]!, world(p), W, H); return [q.x, q.y, q.depth] as const; };
const fmt = (x: number, d = 2) => x.toFixed(d);
const fv = (p: readonly number[], d = 2) => `(${p.map((x) => fmt(x, d)).join(", ")})`;

// ---- 1. the law's numbers --------------------------------------------------------------------------------------------
console.log("== the shell's numbers");
console.log(`whorls ${SP.whorls}, growth W ${SP.growth}, mouth ${SP.mouth.radial} across the coil by ${SP.mouth.axial} along the axis, spire ${SP.spire}, tilt ${fmt(SP.tilt)} rad, rake ${fmt(SP.rake)} rad`);
console.log(`Raup: W = ${SP.growth}, D = 0, T = ${fmt(P.t / P.c)} (translation per unit of the centre's distance), section ${fmt(P.a / P.r)} : 1 (along the axis : across)`);
console.log(`axis ${fv(P.axis)}  coil plane: fore ${fv(P.fore)} rise ${fv(P.rise)}  tip (the curl's centre) ${fv(P.tip)}`);
console.log(`suture at ${fmt(P.sutureX, 3)} r from the axis; an inner turn shows from phi ${fmt((P.shows[0] * 180) / Math.PI, 1)} to ${fmt((P.shows[1] * 180) / Math.PI, 1)} degrees`);
const m = SP.growth ** SP.band.cream;
const deg = (x: number) => fmt((x * 180) / Math.PI, 1);
const EDGES = bandEdges(P, SP.band);
console.log(`cream bands on the last turn (degrees round the section from its outer side, and mirrored on the far flank): ${EDGES.map(([a, b]) => `${deg(a)}..${deg(b)}`).join(", ")}; brick between and over the crown (${deg(EDGES[0]![0] * 2)} degrees wide)`);
console.log(`seen along the axis the cream spiral's rings stand ${SP.growth} apart and each is ${fmt((1 - 1 / m) * 100, 0)}% of its own radius wide`);

// ---- 2. orientation and extents --------------------------------------------------------------------------------------
{
  // d/du x d/dv of the drawn map faces out of the tube on the outside (and into the throat inside it).
  let bad = 0, count = 0;
  for (let i = 4; i < GRID.outer - 1; i += 7) for (let j = 0; j < 12; j++) {
    const u = (i / (GRID.outer + GRID.roll + GRID.throat)), v = j / 12, e = 1e-4;
    const du = sub(twin.drawn(u + e, v), twin.drawn(u - e, v)), dv = sub(twin.drawn(u, v + e), twin.drawn(u, v - e));
    const back = (1 - u / U.lip) * P.whorls, s = SP.growth ** -back, out = P.outAt(back);
    const centre = add(P.tip, mul(add(mul(out, P.c), mul(P.axis, -P.t)), s));
    count++; if (dot(cross(du, dv), sub(twin.drawn(u, v), centre)) <= 0) bad++;
  }
  console.log(`\n== orientation: ${count - bad} of ${count} sampled outside points face out`);
}
const cloud: { p: V; back: number; phi: number }[] = [];
for (let i = 0; i <= 260; i++) for (let j = 0; j < 72; j++) { const back = (i / 260) * P.whorls, phi = (j / 72) * TAU; cloud.push({ p: twin.at(back, phi), back, phi }); }
const ext = (k: 0 | 1 | 2) => [Math.min(...cloud.map((c) => c.p[k])), Math.max(...cloud.map((c) => c.p[k]))] as const;
const [ex, ey, ez] = [ext(0), ext(1), ext(2)];
console.log(`\n== extents (crab coordinates; the still water is at y = ${fmt(WATER)}, the sea floor at ${fmt(n.floor - n.ride)})`);
console.log(`x ${fmt(ex[0])}..${fmt(ex[1])} (${fmt(ex[1] - ex[0])} long)   y ${fmt(ey[0])}..${fmt(ey[1])} (${fmt(ey[1] - WATER)} above the water)   z ${fmt(ez[0])}..${fmt(ez[1])} (${fmt(ez[1] - ez[0])} wide)`);
const highest = cloud.reduce((b, c) => (c.p[1] > b.p[1] ? c : b));
console.log(`highest point ${fv(highest.p)} at ${fmt(highest.back)} turns back, phi ${fmt(highest.phi)}`);
console.log(`the island it replaces: x -6.5..2.5, 4.7 above the water at its crown, z -4.7..4.7`);

/** Least distance from a point to the shell's outside (the sampled cloud), negative inside the coil. */
const gapTo = (q: V): number => {
  let best = Infinity;
  for (const c of cloud) best = Math.min(best, len(sub(q, c.p)));
  return twin.inside(q) ? -best : best;
};

// ---- 3. the body in the mouth ----------------------------------------------------------------------------------------
console.log("\n== the body in the mouth");
const out0 = P.outAt(0), mouthCentre = add(P.tip, add(mul(out0, P.c), mul(P.axis, -P.t)));
/** The carapace at rest (carapace/base.ts): half-width and half-height of its section at crab x, and its spine's height. */
const hullAt = (x: number) => {
  const mm = (x - C.from) / (C.to - C.from);
  const g = mm < 0.45 ? Math.sqrt(Math.max(1 - (1 - mm / 0.45) ** 2, 0)) : mm > 0.6 ? Math.sqrt(Math.max(1 - ((mm - 0.6) / 0.4) ** 2, 0)) : 1;
  return { half: g * C.width, tall: g * C.height, spine: -0.1 + Math.min(mm * 2, 1) * 0.25 };
};
const lipPoint = (phi: number) => twin.at(0, phi);
const lips = Array.from({ length: 72 }, (_, j) => lipPoint((j / 72) * TAU));
console.log(`mouth centre ${fv(mouthCentre)}; its plane faces ${fv(cross(P.axis, out0).map(Math.abs) as unknown as V)} (forward); the lip runs x ${fmt(Math.min(...lips.map((q) => q[0])))}..${fmt(Math.max(...lips.map((q) => q[0])))}, y ${fmt(Math.min(...lips.map((q) => q[1])))}..${fmt(Math.max(...lips.map((q) => q[1])))}, z ${fmt(Math.min(...lips.map((q) => q[2])))}..${fmt(Math.max(...lips.map((q) => q[2])))}`);
const above = lips.filter((q) => q[1] > WATER);
console.log(`lip above the water: ${fmt((above.length / lips.length) * 100, 0)}% of its round; lowest lip point ${fmt(Math.min(...lips.map((q) => q[1])) - WATER)} from the water (below 0: under it)`);
{
  // The mouth faces down and forward over the carapace's back half (the picked picture): the body is tucked under it.
  // Sample the carapace's upper surface (stand-in: carapace/base.ts) and sort it by where it is against the shell:
  // ahead of the outer lip it must be clear of the shell; under the hood, inside the shell's coil is hidden (the tail in
  // the inner turn); just outside it, the lip rests on it.
  const lipFront = Math.max(...lips.map((q) => q[0]));
  let ahead = Infinity, aheadAt: V = [0, 0, 0], hidden = 0, under = 0, poke = 0;
  for (let i = 0; i <= 60; i++) for (let j = 0; j <= 24; j++) {
    const x = C.from + ((C.to - C.from) * i) / 60, hh = hullAt(x), a = (j / 24) * Math.PI, e = 2 / 2.3;
    const q: V = [x, hh.spine + Math.sin(a) ** e * hh.tall, Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** e * hh.half];
    const d = gapTo(q);
    if (x > lipFront + 0.3) { if (d < ahead) { ahead = d; aheadAt = q; } continue; }
    under++; if (d < 0) hidden++; if (d < 0 && d > -0.35) poke++;
  }
  console.log(`the outer lip's front at x = ${fmt(lipFront)}; the carapace ahead of it is ${fmt(ahead)} from the shell at its nearest (${fv(aheadAt)}; must be above 0)`);
  console.log(`under the hood: ${fmt((hidden / under) * 100, 0)}% of the carapace's top is inside the shell (hidden), ${fmt((poke / under) * 100, 0)}% within 0.35 of its wall (where a seam could show)`);
}

// ---- 4. the crab's limbs at rest -------------------------------------------------------------------------------------
const capsuleGap = (a: V, b: V, r: number): number => Math.min(...Array.from({ length: 13 }, (_, i) => gapTo(add(a, mul(sub(b, a), i / 12))) - r));
console.log("\n== limbs at rest against the shell (surface to surface; below 0 is inside it)");
const legs: { name: string; root: V; knee: V; ankle: V; foot: V }[] = [];
for (const s of [-1, 1] as const) n.legRoots.forEach((x, i) => {
  const root: V = [x, -0.1, s * C.width * 0.85], foot: V = [n.legFeet[i]![0], n.floor - n.ride, s * n.legFeet[i]![1]];
  const ankle: V = [foot[0], foot[1] + n.legLengths[2], foot[2]];
  const ra = sub(ankle, root), d = len(ra), [l1, l2] = n.legLengths;
  const cosA = Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)), along = unit(ra);
  const bend: V = [0, 1, s * 0.4], perp = unit(sub(bend, mul(along, dot(bend, along))));
  const knee = add(root, add(mul(along, l1 * cosA), mul(perp, l1 * Math.sqrt(1 - cosA * cosA))));
  legs.push({ name: `leg${s < 0 ? "L" : "R"}${i}`, root, knee, ankle, foot });
});
for (const L of legs.filter((l) => l.name.endsWith("3") || l.name.endsWith("2"))) console.log(`${L.name}: root ${fv(L.root)} knee ${fv(L.knee)}; thigh ${fmt(capsuleGap(L.root, L.knee, 0.45))}, shin ${fmt(capsuleGap(L.knee, L.ankle, 0.38))}`);
const EYES = [{ tag: "R", root: [4.45, 0.85, 0.5] as V, reach: [1.0, 2.5, -0.05] as V, radius: 0.8 }, { tag: "L", root: [4.35, 0.85, -1.6] as V, reach: [0.9, 2.15, -0.5] as V, radius: 0.62 }];
for (const e of EYES) console.log(`eye${e.tag}: ${fmt(gapTo(add(e.root, e.reach)) - e.radius)} from the shell`);
const wrist: V = [C.to + 0.6, 1.2, C.width * 0.55 + 2.7], hand = unit([-0.3, 0.92, 0.15]), HAND = 3.6 * 2.4, FAT = 0.95 * 2.4;
console.log(`great claw at rest (wrist ${fv(wrist)}, tip ${fv(add(wrist, mul(hand, HAND)))}): ${fmt(capsuleGap(wrist, add(wrist, mul(hand, HAND)), FAT * 0.75))} from the shell`);
const shoulderR: V = [C.to - 1.1, -0.1, C.width * 0.55];
console.log(`shoulders (${fv(shoulderR)}): ${fmt(gapTo(shoulderR) - 0.9)} from the shell`);

// ---- 5. the picture: sizes in pixels ---------------------------------------------------------------------------------
console.log("\n== from the cameras (1280 x 800, the crab at rest)");
/** A sampled point is seen from a camera when its normal faces the eye (self-occlusion by other turns is left to the sketch). */
const faces = (cam: keyof typeof CAMERAS, c: (typeof cloud)[number]) => dot(twin.normal(c.back, c.phi), sub(CAMERAS[cam].eye as V, world(c.p))) > 0;
for (const cam of ["game", "back", "far", "pick"] as const) {
  const pts = cloud.filter((c) => c.p[1] > WATER).map((c) => px(cam, c.p));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const face = dot(P.axis, unit(sub(CAMERAS[cam].eye as V, world(P.tip))));
  const t = px(cam, P.tip);
  // The printed spiral: ring k's cream band's middle, at each quarter turn back, in pixels from the curl's centre.
  const mid = P.sutureX * SP.growth ** SP.band.at;
  const rings = [1, 0, -1, -2].map((k) => {
    // Ring k shows on the turn `1 - k` turns in from the last (ring 1 and ring 0 on the last turn itself).
    const x = mid * (k >= 0 ? SP.growth ** k : 1), phi = Math.acos(Math.min(1, x - 1)), turnsIn = k >= 0 ? 0 : -k;
    const span = Array.from({ length: 24 }, (_, i) => turnsIn + i / 24).filter((b) => b <= P.whorls).map((b) => px(cam, twin.at(b, phi)));
    const rx = span.map((q) => q[0]), ry = span.map((q) => q[1]);
    return span.length < 12 ? "-" : `${fmt(Math.max(...rx) - Math.min(...rx), 0)}x${fmt(Math.max(...ry) - Math.min(...ry), 0)}`;
  });
  console.log(`${cam.padEnd(5)} shell above water ${fmt(Math.max(...xs) - Math.min(...xs), 0)} x ${fmt(Math.max(...ys) - Math.min(...ys), 0)} px, x ${fmt(Math.min(...xs), 0)}..${fmt(Math.max(...xs), 0)}, y ${fmt(Math.min(...ys), 0)}..${fmt(Math.max(...ys), 0)}; the face is seen at cos ${fmt(face)}; curl centre at (${fmt(t[0], 0)}, ${fmt(t[1], 0)}); band rings, outermost first (w x h px): ${rings.join("  ")}`);
  void faces;
}
{
  // The band's width on screen from `game`, on the last turn's upper side and one turn in.
  const widths = [1, 0].map((k) => {
    const x0 = P.sutureX * SP.growth ** (k + SP.band.at - SP.band.cream / 2), x1 = x0 * m, back = 0.35;
    const a = px("game", twin.at(back, Math.acos(Math.min(1, x0 - 1)))), b = px("game", twin.at(back, Math.acos(Math.min(1, x1 - 1))));
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  });
  console.log(`game: cream band width on the last turn's crown ${fmt(widths[0]!, 0)} px (ring 1), ${fmt(widths[1]!, 0)} px (ring 0); one turn in they are 1/${SP.growth} of that`);
}
for (const e of EYES) { const c = add(e.root, e.reach); const a = px("game", c), b = px("game", add(c, [0, e.radius, 0])); console.log(`eye${e.tag} from game: centre (${fmt(a[0], 0)}, ${fmt(a[1], 0)}), about ${fmt(2 * Math.hypot(a[0] - b[0], a[1] - b[1]) / 0.77, 0)} px across`); }

// ---- 6. the light and the groves -------------------------------------------------------------------------------------
console.log("\n== what stands on it");
// The light on the tip, as back/spiral.ts seats it; the groves on their whorls' shoulders.
const LT = SP.light, LPl = lightPlan(n, twin), lightFoot = LPl.towerFoot, lightUp = LPl.out, leanDir = LPl.dir;
const GROVES = SP.groves.map(([db, trees, radius]) => { const back = LPl.top.back + db; return [back, shoulderOf(twin, back), trees, radius] as const; });
const lightTop = add(lightFoot, mul(leanDir, LT.height + 1.0 * LT.size + LT.pose.rise));
console.log(`light: foot ${fv(lightFoot)} (the shell's normal there ${fv(lightUp)}), top ${fv(lightTop)}, ${fmt(lightTop[1] - WATER)} above the water`);
for (const cam of ["game", "back", "far", "pick"] as const) { const a = px(cam, lightFoot), b = px(cam, lightTop); console.log(`  ${cam}: foot (${fmt(a[0], 0)}, ${fmt(a[1], 0)}) top (${fmt(b[0], 0)}, ${fmt(b[1], 0)}): ${fmt(Math.hypot(a[0] - b[0], a[1] - b[1]), 0)} px; the top is ${fmt(b[1], 0)} px below the frame's top`); }
GROVES.forEach(([back, round, trees, radius], i) => { const g = twin.at(back, round), q = px("game", g); console.log(`grove ${i}: ${trees} trees on turf ${radius} across at ${fv(g)}; game (${fmt(q[0], 0)}, ${fmt(q[1], 0)}), turf about ${fmt(radius * 2 * 31, 0)} px`); });

// ---- 7. the throw ----------------------------------------------------------------------------------------------------
{
  // The ship's middle leaves the small claw at about (8.5, 3.8, -7.6) with velocity (-3.0, 6.9, -8.6), world; gravity n.gravity.
  const r0: V = [8.5, 3.8, -7.6], v0: V = [-3.0, 6.9, -8.6];
  let best = Infinity, when = 0;
  for (let t = 0; t <= n.throw.flight; t += 0.02) {
    const q: V = [r0[0] + v0[0] * t, r0[1] + v0[1] * t - 0.5 * n.gravity * t * t - n.ride, r0[2] + v0[2] * t];
    const g = Math.min(gapTo(q), ...[lightFoot, lightTop].map((p) => len(sub(q, p)) - 0.6));
    if (g < best) { best = g; when = t; }
  }
  const plan = cloud.map((c) => Math.hypot(c.p[0] - r0[0], c.p[2] - r0[2]));
  console.log(`\n== the throw: the ship's middle passes no nearer than ${fmt(best)} to the shell or the light (at ${fmt(when)} s; it is a ball of ${fmt(1.9)} and the check asks 0.5 more: the limit is 2.4); in plan the release point is ${fmt(Math.min(...plan))} from the shell's nearest point`);
}

// ---- 8. cost ---------------------------------------------------------------------------------------------------------
{
  const NU = GRID.outer + GRID.roll + GRID.throat, cells = NU * GRID.round;
  console.log(`\n== cost: the shell's grid ${NU} x ${GRID.round} = ${cells} cells, ${cells * 2} triangles, twice with its ink hull = ${cells * 4}`);
}

// ---- the sketch ------------------------------------------------------------------------------------------------------
const sketch = flag("--sketch");
if (sketch !== undefined) {
  // Four half-size panes, or with --pane <camera> that camera alone at the picture's size.
  const pane1 = flag("--pane");
  const names: readonly string[] = pane1 === undefined ? ["game", "back", "far", "pick"] : [pane1, pane1, pane1, pane1];
  const DIV = pane1 === undefined ? 2 : 1;
  const SW = W / 2, SH = H / 2, buf = new Uint8Array(SW * 2 * SH * 2 * 3).fill(0), zb = new Float32Array(SW * 2 * SH * 2).fill(Infinity);
  const sea = [33, 51, 94], cream = [237, 224, 191], brick = [168, 56, 33], dark = [40, 24, 22], moss = [120, 143, 61], coral = [219, 143, 117], bone = [240, 235, 215];
  for (let i = 0; i < buf.length; i += 3) buf.set(sea, i);
  const plot = (pane: number, cam: string, p: V, rgb: readonly number[], size = 1) => {
    const q = px(cam, p), ox = DIV === 1 ? 0 : (pane % 2) * SW, oy = DIV === 1 ? 0 : Math.floor(pane / 2) * SH;
    const x = Math.round(q[0] / DIV), y = Math.round(q[1] / DIV);
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= (2 * SW) / DIV || yy < 0 || yy >= (2 * SH) / DIV) continue;
      const k = (oy + yy) * SW * 2 + ox + xx;
      if (q[2] < zb[k]!) { zb[k] = q[2]; buf.set(rgb, k * 3); }
    }
  };
  const things: { p: V; rgb: readonly number[]; nrm?: V }[] = [];
  // The shell as drawn: paint by the ring of the printed spiral.
  const NUs = 1500, NVs = 220;
  for (let i = 0; i <= NUs; i++) for (let j = 0; j < NVs; j++) {
    const u = i / NUs, v = j / NVs, p = twin.drawn(u, v);
    if (p[1] < WATER) continue;
    const fold = (((-TAU * v) % TAU) + TAU) % TAU; // phi round the section, 0 to 2 pi (the drawn v runs against phi)
    const edge = EDGES.some(([a, b]) => Math.abs(fold - a) < 0.03 || Math.abs(fold - b) < 0.03), inBand = EDGES.some(([a, b]) => fold > a && fold < b);
    const rgb = u > U.throat ? dark : u > U.lip - 0.004 ? cream : edge ? [20, 18, 23] : inBand ? cream : brick;
    things.push({ p, rgb });
  }
  // Stand-ins: the carapace, the legs, the eyes on their stalks, the great claw at rest.
  for (let i = 0; i <= 120; i++) for (let j = 0; j < 120; j++) {
    const x = C.from + ((C.to - C.from) * i) / 120, h = hullAt(x), a = (j / 120) * TAU, e = 2 / 2.3;
    const cz = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** e, cy = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** e;
    things.push({ p: [x, h.spine + cy * h.tall, cz * h.half], rgb: cy < -0.2 ? cream : [150, 45, 28] });
  }
  const tube = (a: V, b: V, r: number, rgb: readonly number[]) => {
    const ax = unit(sub(b, a)), s1 = unit(cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), s2 = cross(ax, s1);
    for (let i = 0; i <= 40; i++) for (let j = 0; j < 16; j++) { const t = (j / 16) * TAU; things.push({ p: add(add(a, mul(sub(b, a), i / 40)), add(mul(s1, Math.cos(t) * r), mul(s2, Math.sin(t) * r))), rgb }); }
  };
  for (const L of legs) { tube(L.root, L.knee, 0.45, [176, 62, 38]); tube(L.knee, L.ankle, 0.38, [176, 62, 38]); tube(L.ankle, L.foot, 0.2, cream); }
  for (const e of EYES) { const c = add(e.root, e.reach); tube(e.root, c, 0.16, bone); for (let i = 0; i < 400; i++) { const z = 1 - (2 * i + 1) / 400, r = Math.sqrt(1 - z * z), t = i * 2.39996; things.push({ p: add(c, mul([r * Math.cos(t), z, r * Math.sin(t)], e.radius)), rgb: coral }); } }
  { // The great claw: a flat hand, its faces out and forward.
    const o = unit(cross([0.7, 0, 0.7], hand));
    for (let i = 0; i <= 80; i++) for (let j = -20; j <= 20; j++) { const mm = i / 80, wdt = FAT * (mm < 0.3 ? 0.55 + 1.5 * mm : 1 - 0.9 * (mm - 0.3) / 0.7); things.push({ p: add(add(wrist, mul(hand, HAND * mm)), mul(o, (j / 20) * wdt)), rgb: mm > 0.6 ? cream : [190, 60, 34] }); }
  }
  // The light and the groves' turf.
  tube(lightFoot, add(lightFoot, mul(leanDir, LT.height)), (LT.girth[0] + LT.girth[1]) / 2, coral);
  tube(add(lightFoot, mul(leanDir, LT.height)), lightTop, 0.56 * LT.size, dark);
  for (const [back, round, , radius] of GROVES) for (let i = 0; i < 300; i++) {
    const r = radius * Math.sqrt(i / 300), t = i * 2.39996, s = P.r * SP.growth ** -back;
    const q = twin.at(back + (r * Math.cos(t)) / (TAU * (P.c + P.r * Math.cos(round)) * SP.growth ** -back), round + (r * Math.sin(t)) / s), up = twin.normal(back, round);
    things.push({ p: add(q, mul(up, 0.08)), rgb: moss });
    if (i % 60 === 0) tube(add(q, mul(up, 0.1)), add(q, [0, 1.5, 0]), 0.5, [51, 82, 43]);
  }
  (DIV === 1 ? names.slice(0, 1) : names).forEach((cam, pane) => { for (const t of things) plot(pane, cam, t.p, t.rgb, DIV === 1 ? 3 : 2); });
  const head = new TextEncoder().encode(`P6\n${SW * 2} ${SH * 2}\n255\n`);
  const outBytes = new Uint8Array(head.length + buf.length); outBytes.set(head); outBytes.set(buf, head.length);
  await Bun.write(sketch, outBytes);
  console.log(`\nsketch (points, no ink, no shading; panes: ${names.join(", ")}): ${sketch}`);
}

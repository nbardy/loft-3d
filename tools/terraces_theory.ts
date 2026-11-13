// The terraced back's theory, before the build (docs/art_direction/DIRECTION.md, Round 5, "Fifth pass"): where its
// planned points fall on screen from the design's cameras at 1280 x 800, the body at rest (crab coordinates taken as
// the world's, as in the first theory). Plain arithmetic on the plan's numbers (numbers.ts `terraces`).
//
//   bun tools/terraces_theory.ts

import { cameraMatrices, project } from "../src/host/camera.ts";
import { S } from "../examples/bosses/titan/numbers.ts";

const W = 1280, H = 800, A = S.atoll, T = S.terraces, WATER = -S.ride, R = (A.rx + A.rz) / 2;
const cams = {
  game: { kind: "perspective", eye: [23, 27, 21], target: [3, 0.5, 2.5], fovY: 0.6 },
  far: { kind: "perspective", eye: [33, 21, 21], target: [3, 1.5, -1], fovY: 0.6 },
  back: { kind: "perspective", eye: [-15, 19, 9], target: [-1.5, 2.5, 0], fovY: 0.6 },
} as const;
type P = readonly [number, number, number];
const deg = (d: number) => (d * Math.PI) / 180;
/** A point r out from the island's centre at a bearing (degrees from the bow toward the right flank), crab y. */
const at = (r: number, bearing: number, y: number): P => [A.centre[0] + r * Math.cos(deg(bearing)), y, A.centre[1] + r * Math.sin(deg(bearing))];
// The hull (terraces.ts): the rim's radius at a bearing; G from the crown (0) to the rim (1); the cap to G = cap.at.
const rimR = (b: number) => ((T.outline.bow + T.outline.tail) / 2 - ((T.outline.tail - T.outline.bow) / 2) * Math.cos(deg(b))) * R;
const crownY = A.top + T.crown, rimY = (b: number) => (Math.cos(deg(b)) > 0 ? -0.19 : WATER + T.rim);
const hull = (G: number, b: number): P => {
  const c = T.cap.at, t = Math.max((G - c) / (1 - c), 0), r = G < c ? (T.cap.radius * G) / c : T.cap.radius + (1 - T.cap.radius) * t;
  const y = G < c ? 1 - T.cap.drop * (G / c) ** 2 : (1 - T.cap.drop) * (1 - t ** T.cliff);
  return at(r * rimR(b), b, rimY(b) + (crownY - rimY(b)) * y);
};
const L = T.light, P0 = T.point.bearing, mound = WATER + T.point.top, tower = L.height + 1.5 * L.size;
const finial = at(L.at + L.lean * tower, P0, mound + tower);
for (const [name, c] of Object.entries(cams)) {
  const cam = cameraMatrices(c as never, W / H);
  const px = (p: P) => { const q = project(cam, p, W, H); return [q.x, q.y] as const; };
  const d = (a: P, b: P) => Math.hypot(px(a)[0] - px(b)[0], px(a)[1] - px(b)[1]);
  const f = (p: P) => `(${px(p).map((x) => x.toFixed(0)).join(", ")})`;
  console.log(`${name}: light mound ${f(at(L.at, P0, mound))} finial ${f(finial)}: mound to finial ${d(at(L.at, P0, mound), finial).toFixed(0)} px, foot across ${d(at(L.at, P0 + (L.girth[0] / L.at) * 57.3, mound), at(L.at, P0 - (L.girth[0] / L.at) * 57.3, mound)).toFixed(0)}`);
  console.log(`  point tip ${f(at(T.point.tip, P0, WATER))}; beach ends ${f(at(rimR(T.beach.bearing - T.beach.span), T.beach.bearing - T.beach.span, WATER))} to ${f(at(rimR(T.beach.bearing + T.beach.span), T.beach.bearing + T.beach.span, WATER))}, ${d(at(rimR(T.beach.bearing - T.beach.span) + T.beach.sand / 2, T.beach.bearing - T.beach.span, WATER), at(rimR(T.beach.bearing + T.beach.span) + T.beach.sand / 2, T.beach.bearing + T.beach.span, WATER)).toFixed(0)} px long, ${d(at(rimR(T.beach.bearing) - T.beach.cove * R, T.beach.bearing, WATER), at(rimR(T.beach.bearing) + T.beach.sand, T.beach.bearing, WATER)).toFixed(0)} px deep`);
  for (const [k, pl] of T.plates.entries()) {
    const [root, sweep, half, tip] = pl, mid = (1 + tip) / 2;
    console.log(`  plate ${k} (root ${root}): rim ${f(hull(1, root))} tip ${f(hull(tip, root - sweep))}, ${d(hull(1, root), hull(tip, root - sweep)).toFixed(0)} px long, ${d(hull(mid, root - sweep / 2 - half), hull(mid, root - sweep / 2 + half)).toFixed(0)} px across at its middle`);
  }
  console.log(`  cap edge across (bearings 40 to 220) ${d(hull(T.cap.at, 40), hull(T.cap.at, 220)).toFixed(0)} px; crown ${f(hull(0, 0))}`);
}
// What a thrown ship passes (rig.ts: released about (8.5, 3.8, -7.6) with velocity (-3.0, 6.9, -8.6), gravity 5).
let least = Infinity;
for (let t = 0; t <= 3.2; t += 0.02) {
  const s = [8.5 - 3.0 * t, 3.8 + 6.9 * t - 2.5 * t * t, -7.6 - 8.6 * t] as const;
  for (const p of [at(T.point.tip, P0, WATER + 0.3), at(L.at, P0, mound + 1), finial, hull(1, 225)]) least = Math.min(least, Math.hypot(s[0] - p[0], s[1] - p[1], s[2] - p[2]));
}
console.log(`thrown ship: nearest to the point, the light or the left-tail rim ${least.toFixed(1)}`);
const foot = (side: number) => [S.legFeet[3][0], S.legFeet[3][1] * side] as const;
const near = (p: P, q: readonly [number, number]) => Math.hypot(p[0] - q[0], p[2] - q[1]);
console.log(`last right foot to stack 1 ${near(at(T.stacks[0][0], T.stacks[0][1], 0), foot(1)).toFixed(1)}; last left foot to the light ${near(at(L.at, P0, 0), foot(-1)).toFixed(1)}; front rim on the centre line x = ${hull(1, 0)[0].toFixed(2)}`);

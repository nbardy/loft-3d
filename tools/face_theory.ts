// The islander face's theory, before the build (docs/art_direction/DIRECTION.md, Round 3): what the eyes measure on
// screen from the `game` camera, and how far apart the named expressions are, from the design's numbers alone. Plain
// arithmetic: the body at rest (no walk, no lean), no lag, each expression at full weight.
//
//   bun tools/face_theory.ts
//
// It imports the same numbers the face draws from (examples/bosses/titan/face/dandy.ts: EYES, CAST, the look), so a
// change there changes the prediction; the measured side is `loft check` (expressionsRead, minScreenSize).

import { cameraMatrices, project } from "../src/host/camera.ts";
import { AUDIENCE, CAST, EYES, FACING, lookOf, type Channel } from "../examples/bosses/titan/face/dandy.ts";
import { S } from "../examples/bosses/titan/numbers.ts";

type V = readonly [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => mul(a, 1 / Math.hypot(...a));
const mix = (a: V, b: V, t: number): V => add(mul(a, 1 - t), mul(b, t));

const W = 1280, H = 800;
const cam = cameraMatrices({ kind: "perspective", eye: AUDIENCE, target: [3, 0.5, 2.5], fovY: 0.6 }, W / H);
const px = (p: V) => { const q = project(cam, p, W, H); return [q.x, q.y] as const; };
// The body at rest: crab coordinates are the world's, raised by the ride.
const world = (p: V): V => [p[0], p[1] + S.ride, p[2]];
// Where the fight's two subjects are (rig.ts): the ship as taken (fiddler cutter: about 8.3 along the keel from the
// shoulder) and the crush disc's centre.
const SHIP: V = [3.9 + Math.cos(S.grabBearing) * 8.3, 0.25, -S.carapace.width * 0.55 + Math.sin(S.grabBearing) * 8.3];
const DISC: V = [S.crushCentre[0], 0, S.crushCentre[1]];

/** One eye's drawn marks under an expression: every point the picture is made of, in pixels. */
function marks(c: Readonly<Record<Channel, number>>, e: (typeof EYES)[number]) {
  const k = lookOf(c, e);
  const base = world(e.root), tip = add(base, k.reach);
  const target = mix(mix(AUDIENCE, SHIP, c.ship), DISC, c.disc);
  const a = unit(sub(FACING, tip)), g = unit(sub(target, tip));
  const F = unit(mix(a, g, k.turn));
  const side0 = unit(cross(F, [0, 1, 0])), up0 = cross(side0, F);
  const side = add(mul(side0, Math.cos(k.slant)), mul(up0, Math.sin(k.slant))), up = sub(mul(up0, Math.cos(k.slant)), mul(side0, Math.sin(k.slant)));
  const gx = dot(g, side0) * k.slide, gy = dot(g, up0) * k.slide;
  const on = (x: number, y: number): V => add(tip, mul(add(add(mul(side0, x), mul(up0, y)), mul(F, Math.sqrt(Math.max(1 - x * x - y * y, 0)))), e.radius));
  const upperMid = add(tip, mul(add(mul(up, Math.cos(k.upper)), mul(F, Math.sin(k.upper))), e.radius));
  const lowerMid = add(tip, mul(add(mul(up, -Math.cos(k.lower)), mul(F, Math.sin(k.lower))), e.radius));
  const corner = add(tip, mul(side, e.radius));
  const d = (p: V, q: V) => { const [ax, ay] = px(p), [bx, by] = px(q); return [bx - ax, by - ay] as const; };
  return {
    diameter: Math.hypot(...d(add(tip, mul(side0, -e.radius)), add(tip, mul(side0, e.radius)))),
    pupil: 2 * k.pupil * Math.hypot(...d(tip, add(tip, mul(side0, e.radius)))),
    // The drawn vectors a viewer compares: stalk root to eye, eye to each lid's middle, eye to pupil, eye to its corner.
    features: { stalk: d(base, tip), upper: d(tip, upperMid), lower: d(tip, lowerMid), pupil: d(tip, on(gx, gy)), corner: d(tip, corner) },
    // How much of the eye's height is open, along its middle (0 shut, 1 lids clear of it).
    open: Math.max(0, (Math.cos(k.upper) + Math.cos(k.lower)) / 2),
  };
}

const names = ["rest", ...Object.keys(CAST.named)] as const;
const exprOf = (n: string) => (n === "rest" ? CAST.rest : CAST.named[n as keyof typeof CAST.named]);
const all = Object.fromEntries(names.map((n) => [n, EYES.map((e) => marks(exprOf(n), e))]));

console.log(`game camera ${W}x${H}, body at rest`);
for (const [i, e] of EYES.entries()) console.log(`eye ${e.tag}: ball ${all.rest![i]!.diameter.toFixed(1)} px across, pupil ${all.rest![i]!.pupil.toFixed(1)} px at rest`);
console.log("\nopen share of each eye (R, L), and the pupil's place from the eye's middle (px):");
for (const n of names) {
  const m = all[n]!;
  console.log(`  ${n.padEnd(8)} open ${m.map((x) => x.open.toFixed(2)).join(" ")}   pupil ${m.map((x) => `(${x.features.pupil[0].toFixed(0)}, ${x.features.pupil[1].toFixed(0)})`).join(" ")}   stalk ${m.map((x) => `(${x.features.stalk[0].toFixed(0)}, ${x.features.stalk[1].toFixed(0)})`).join(" ")}`);
}
console.log("\nhow far apart each pair is: the largest change of any drawn vector, px (and which):");
let least = { px: Infinity, pair: "" };
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  let best = { px: 0, what: "" };
  for (const [ei, e] of EYES.entries()) {
    const A = all[names[i]!]![ei]!.features, B = all[names[j]!]![ei]!.features;
    for (const f of Object.keys(A) as (keyof typeof A)[]) {
      const dpx = Math.hypot(A[f][0] - B[f][0], A[f][1] - B[f][1]);
      if (dpx > best.px) best = { px: dpx, what: `${f}${e.tag}` };
    }
  }
  console.log(`  ${`${names[i]} / ${names[j]}`.padEnd(18)} ${best.px.toFixed(1).padStart(6)}  ${best.what}`);
  if (best.px < least.px) least = { px: best.px, pair: `${names[i]} / ${names[j]}` };
}
console.log(`\nleast apart: ${least.pair} ${least.px.toFixed(1)} px = ${(least.px / all.rest![0]!.diameter).toFixed(2)} of the right eye's width`);

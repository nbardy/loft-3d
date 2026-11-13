// The brow face's theory, before the build (docs/art_direction/DIRECTION.md, Round 4): what the head, the eyes, the
// brows and the mouth measure on screen from the `game` camera, and how far apart the named expressions are, from the
// face's own numbers. Plain arithmetic: the body at rest (no walk, no lean), no lag, each expression at full weight,
// the relief left out (a mandible's tip is placed off the plain surface).
//
//   bun tools/brow_theory.ts
//
// It imports the numbers and the channel formulas the face draws from (examples/bosses/titan/face/brow.ts), so a change
// there changes the prediction; the measured side is `loft check` (minScreenSize, expressionsRead, spansOnScreen).

import { cameraMatrices, project } from "../src/host/camera.ts";
import { shellOut } from "../examples/bosses/lib/face_parts.ts";
import { BROW, CAST, EYES, FACE_RIGHT, GAZE_REACH, HEAD, IRIS, MOUTH_TOP, POP, RADII, SINK, headOf, lookOf, mouthOf, type Channel } from "../examples/bosses/titan/face/brow.ts";
import { AUDIENCE } from "../examples/bosses/titan/face/dandy.ts";
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
const span = (p: V, q: V) => { const [ax, ay] = px(p), [bx, by] = px(q); return [bx - ax, by - ay] as const; };
const len = (d: readonly [number, number]) => Math.hypot(d[0], d[1]);

// The head's frame at rest: crab coordinates are the world's, raised by the ride.
const head = headOf(S.carapace), k = head.unit;
const ct = Math.cos(HEAD.tilt), st = Math.sin(HEAD.tilt);
const OUT: V = [ct, st, 0], UP: V = [-st, ct, 0], RIGHT: V = [0, 0, 1];
const O: V = [head.at[0], head.at[1] + S.ride, head.at[2]];
/** A point of the face's coordinates (X to the viewer's right) in the world. */
const world = (p: V): V => add(O, mul(add(add(mul(RIGHT, -p[0]), mul(UP, p[1])), mul(OUT, p[2])), k));
const FRONT = unit(add(OUT, mul(RIGHT, FACE_RIGHT))), SIDE = unit(cross(FRONT, UP)), EYE_UP = cross(SIDE, FRONT);
const overEye = (c: V, r: number, along: number, over: number): V =>
  add(c, mul(add(mul(add(mul(EYE_UP, Math.cos(over)), mul(FRONT, Math.sin(over))), Math.cos(along)), mul(SIDE, Math.sin(along))), r));

// Where the fight's subjects are, about when each mood looks at them (the fiddler's cutter takes the ship about 8.3
// along its keel from the shoulder; the throw's flight passes about here; the second boat is 2 beyond the islander's
// 4.4 disc and is half shoved when it gloats).
const SHIP: V = [3.9 + Math.cos(S.grabBearing) * 8.3, 0.25, -S.carapace.width * 0.55 + Math.sin(S.grabBearing) * 8.3];
const FLYING: V = [4, 6, -22];
const DISC: V = [S.crushCentre[0], 0, S.crushCentre[1]];
const BOAT2: V = [S.crushCentre[0] + Math.cos(S.boatTwo.bearing) * 9.4, 0.8, S.crushCentre[1] + Math.sin(S.boatTwo.bearing) * 9.4];

const names = ["rest", ...Object.keys(CAST.named)] as const;
const exprOf = (n: string) => (n === "rest" ? CAST.rest : CAST.named[n as keyof typeof CAST.named]);
const shipFor = (n: string): V => (n === "gleeful" ? FLYING : SHIP);

/** One eye's drawn marks under an expression, in pixels. */
function eyeMarks(name: string, c: Readonly<Record<Channel, number>>, e: (typeof EYES)[number]) {
  const q = lookOf(c, e), R = e.radius * k;
  const centre = add(world([-e.side * e.at[0], e.at[1], shellOut(RADII, HEAD.power, e.at[0], e.at[1]) - SINK * e.radius]), mul(FRONT, q.out * R));
  const target = mix(mix(mix(AUDIENCE, shipFor(name), c.ship), DISC, c.disc), BOAT2, c.boat);
  const look = unit(sub(target, centre));
  const gx0 = dot(look, SIDE), gy0 = dot(look, EYE_UP), g = GAZE_REACH / Math.max(Math.hypot(gx0, gy0), GAZE_REACH);
  const gx = gx0 * g, gy = gy0 * g;
  const side = add(mul(SIDE, Math.cos(q.slant)), mul(EYE_UP, Math.sin(q.slant))), up = sub(mul(EYE_UP, Math.cos(q.slant)), mul(SIDE, Math.sin(q.slant)));
  void side;
  const on = (d: V): V => add(centre, mul(d, R));
  const browR = R * 1.12 + BROW.girth[0] * BROW.depth * k + 0.02 * k;
  const ends = [overEye(centre, browR, BROW.span[0] * e.side, q.brow[0]), overEye(centre, browR, BROW.span[1] * e.side, q.brow[2])] as const;
  return {
    centre,
    diameter: len(span(on(mul(SIDE, -1)), on(SIDE))),
    iris: 2 * IRIS * len(span(centre, on(SIDE))),
    // How much of the eye's height shows between the lids, along its middle (0 shut, 1 both lids clear).
    open: Math.max(0, (Math.cos(q.upper) + Math.cos(q.lower)) / 2),
    browThick: ((at: V, g: number) => len(span(sub(at, mul(EYE_UP, g)), add(at, mul(EYE_UP, g)))))(overEye(centre, browR, 0, q.brow[1]), (BROW.girth[0] + BROW.girth[1]) / 2 * k),
    features: {
      browIn: span(centre, ends[0]), browOut: span(centre, ends[1]),
      upper: span(centre, on(add(mul(up, Math.cos(q.upper)), mul(FRONT, Math.sin(q.upper))))),
      lower: span(centre, on(add(mul(up, -Math.cos(q.lower)), mul(FRONT, Math.sin(q.lower))))),
      pupil: span(centre, on(add(add(mul(SIDE, gx), mul(EYE_UP, gy)), mul(FRONT, 0.85)))),
    },
    gaze: [gx, gy] as const,
  };
}
/** The mouth's marks under an expression: its top to each mandible's tip, and its width hinge to hinge. */
function mouthMarks(c: Readonly<Record<Channel, number>>) {
  const m = mouthOf(c);
  const top = world([m.x0, MOUTH_TOP + 0.1, shellOut({ ...RADII, down: RADII.down + c.jaw * HEAD.jawDrop }, HEAD.power, m.x0, MOUTH_TOP + 0.1) + 0.1]);
  const at = (p: readonly [number, number], proud: number): V => world([p[0], p[1], shellOut({ ...RADII, down: RADII.down + c.jaw * HEAD.jawDrop }, HEAD.power, p[0], p[1]) + proud]);
  // plates[0] is the viewer's left: the crab's right.
  const [r, l] = m.plates;
  return {
    features: { jawR: span(top, at(r.tip, r.proud + c.jaw * 0.5)), jawL: span(top, at(l.tip, l.proud + c.jaw * 0.5)) },
    width: len(span(at(r.hinge, 0.1), at(l.hinge, 0.1))),
    cavity: [2 * m.wide * k, 2 * m.tall * k] as const,
  };
}

const eyes = Object.fromEntries(names.map((n) => [n, EYES.map((e) => eyeMarks(n, exprOf(n), e))]));
const mouths = Object.fromEntries(names.map((n) => [n, mouthMarks(exprOf(n))]));

console.log(`game camera ${W}x${H}, body at rest; one face unit is ${(len(span(O, add(O, mul(RIGHT, 1)))) ).toFixed(1)} px across the face and ${len(span(O, add(O, UP))).toFixed(1)} px up it`);
console.log(`head: ${len(span(world([-RADII.across, 0, 0]), world([RADII.across, 0, 0]))).toFixed(0)} px across, ${len(span(world([0, -RADII.down, 0]), world([0, RADII.up, 0]))).toFixed(0)} px brow to chin`);
for (const [i, e] of EYES.entries()) {
  const r = eyes.rest![i]!;
  console.log(`eye ${e.tag}: ball ${r.diameter.toFixed(1)} px across, iris ${r.iris.toFixed(1)} px, brow ${r.browThick.toFixed(1)} px thick at rest`);
}
console.log(`\nopen share of each eye (R, L), the iris's place on it (shares of its radius), and the mouth (hinge to hinge px; hollow face units):`);
for (const n of names) {
  const m = eyes[n]!, mo = mouths[n]!;
  console.log(`  ${n.padEnd(10)} open ${m.map((x) => x.open.toFixed(2)).join(" ")}   iris ${m.map((x) => `(${x.gaze[0].toFixed(2)}, ${x.gaze[1].toFixed(2)})`).join(" ")}   mouth ${mo.width.toFixed(0)} px, hollow ${mo.cavity[0].toFixed(2)} x ${mo.cavity[1].toFixed(2)}`);
}
console.log("\nhow far apart each pair is: the largest change of any drawn vector, px (and which):");
let least = { px: Infinity, pair: "" };
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  let best = { px: 0, what: "" };
  const consider = (what: string, a: readonly [number, number], b: readonly [number, number]) => { const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > best.px) best = { px: d, what }; };
  for (const [ei, e] of EYES.entries()) {
    const A = eyes[names[i]!]![ei]!.features, B = eyes[names[j]!]![ei]!.features;
    for (const f of Object.keys(A) as (keyof typeof A)[]) consider(`${f}${e.tag}`, A[f], B[f]);
  }
  const A = mouths[names[i]!]!.features, B = mouths[names[j]!]!.features;
  for (const f of Object.keys(A) as (keyof typeof A)[]) consider(f, A[f], B[f]);
  console.log(`  ${`${names[i]} / ${names[j]}`.padEnd(24)} ${best.px.toFixed(1).padStart(6)}  ${best.what}`);
  if (best.px < least.px) least = { px: best.px, pair: `${names[i]} / ${names[j]}` };
}
console.log(`\nleast apart: ${least.pair} ${least.px.toFixed(1)} px = ${(least.px / eyes.rest![0]!.diameter).toFixed(2)} of the right eye's width (the check's limit is 0.25)`);

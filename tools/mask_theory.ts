// The samurai face's theory, before the build (docs/art_direction/DIRECTION.md, "Round 4: the samurai's face"): what
// its parts measure on screen from the `game` camera and how far apart its expressions are, from the face's numbers
// alone. Plain arithmetic: the body at rest (no walk, no lean), each expression at full weight.
//
//   bun tools/mask_theory.ts
//
// It imports the numbers the face draws from (examples/bosses/titan/face/mask.ts: CAST, EYE, BROW, MOUTH, featuresIn),
// so a change there changes the prediction; the measured side is `loft check --variant mask`.

import { cameraMatrices, project } from "../src/host/camera.ts";
import { kabuto } from "../examples/bosses/titan/carapace/kabuto.ts";
import { BROW, CAST, CY, EYE, featuresIn, MOUTH, PROUD, R } from "../examples/bosses/titan/face/mask.ts";
import { S } from "../examples/bosses/titan/numbers.ts";

type V = readonly [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => mul(a, 1 / Math.hypot(...a));

const W = 1280, H = 800, EYE_AT: V = [23, 27, 21];
const cam = cameraMatrices({ kind: "perspective", eye: EYE_AT, target: [3, 0.5, 2.5], fovY: 0.6 }, W / H);
const px = (p: V) => { const q = project(cam, p, W, H); return [q.x, q.y] as const; };
const seen = (p: V, q: V) => { const [ax, ay] = px(p), [bx, by] = px(q); return [bx - ax, by - ay] as const; };
const long = (d: readonly [number, number]) => Math.hypot(d[0], d[1]);

const C = kabuto.numbers!.carapace!;
// The body at rest: crab coordinates are the world's, raised by the ride.
const O: V = [C.to! + PROUD - R, CY + S.ride, 0];
// The ship where the gauntlet takes it (rig.ts: the cutter's shoulder, wrist reach 4.2 plus the grip's depth, about 4.8).
const SHIP: V = [C.to! - 1.1 + Math.cos(S.grabBearing) * 9.0, 0.25, -C.width! * 0.55 + Math.sin(S.grabBearing) * 9.0];

function drawn(c: (typeof CAST)["rest"]) {
  const f = featuresIn(c);
  const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
  const N: V = [cp, sp, 0], U: V = [-sp, cp, 0], Z: V = [0, 0, 1];
  // The turn slides every feature across the sphere (the mask's rim stays): its own, and `play` of the way to the audience.
  const shift = (f.turn + f.play * dot(unit(sub(EYE_AT, add(O, mul(N, R)))), Z)) * R;
  const dir = (a: number, b: number): V => { const th = (a + shift) / R, ph = b / R; return add(add(mul(N, Math.cos(ph) * Math.cos(th)), mul(U, Math.sin(ph))), mul(Z, Math.cos(ph) * Math.sin(th))); };
  const at = (a: number, b: number, out: number): V => add(O, mul(dir(a, b), R + out));
  const eye = (side: 1 | -1) => {
    const e = side > 0 ? f.right : f.left;
    const front = dir(side * EYE.a, EYE.b), centre = add(O, mul(front, R + EYE.out));
    const across = unit(cross(front, U)), up = cross(across, front);
    const look = unit(sub(SHIP, centre)), reach = 1 - 0.14 - f.pupil;
    const clampTo = (x: number) => Math.min(Math.max(x, -reach), reach);
    const gx = clampTo(e.pupil[0] + dot(look, across) * 0.5 * f.ship), gy = clampTo(e.pupil[1] + dot(look, up) * 0.5 * f.ship);
    const on = (x: number, y: number): V => add(centre, mul(add(mul(across, x), mul(up, y)), EYE.r));
    const [inner, , outer] = e.brow.map(([a, b]) => at(a, b, BROW.out)) as [V, V, V];
    return {
      centre, across: long(seen(on(-1, 0), on(1, 0))), tall: long(seen(on(0, -1), on(0, 1))), pupilPx: 2 * f.pupil * long(seen(centre, on(1, 0))),
      // The white that shows between the lids at the eye's middle, px.
      whiteTall: Math.max(0, e.upper - e.lower) / 2 * long(seen(on(0, -1), on(0, 1))),
      browLong: long(seen(inner, outer)),
      // How much of the white's height the brow plate's lower edge covers at the eye's middle (the plate stands `out` proud).
      marks: { pupil: seen(centre, on(gx, gy)), upper: seen(centre, on(0, e.upper)), lower: seen(centre, on(0, e.lower)), browIn: seen(centre, inner), browOut: seen(centre, outer) },
    };
  };
  const right = eye(1), left = eye(-1);
  const mid = f.mouth.at(0, 1), cR = f.mouth.at(1, 0), cL = f.mouth.at(-1, 0);
  const lipTop = at(f.mouth.centre, mid.line + mid.open, 0.3), lipBottom = sub(at(f.mouth.centre, mid.line - mid.open, 0.3), mul(U, f.mouth.drop));
  const marks: Record<string, readonly [number, number]> = {
    gape: seen(lipTop, lipBottom), cornerR: seen(lipTop, at(f.mouth.centre + MOUTH.half, cR.line, 0.2)), cornerL: seen(lipTop, at(f.mouth.centre - MOUTH.half, cL.line, 0.2)),
    face: seen(O, at(0, 0, 0)),
  };
  for (const [tag, e] of [["R", right], ["L", left]] as const) for (const [k, v] of Object.entries(e.marks)) marks[`${k}${tag}`] = v;
  return { right, left, marks, facing: dot(dir(0, 0), unit(sub(EYE_AT, at(0, 0, 0)))), pupilsApart: long(seen(add(right.centre, [0, 0, 0]), left.centre)) };
}

const names = ["rest", ...Object.keys(CAST.named)] as const;
const exprOf = (n: string) => (n === "rest" ? CAST.rest : CAST.named[n as keyof typeof CAST.named]);
const all = Object.fromEntries(names.map((n) => [n, drawn(exprOf(n))]));
const rest = all.rest!;

console.log(`game camera ${W}x${H}, body at rest`);
console.log(`the face's middle is turned ${(Math.acos(rest.facing) * 180 / Math.PI).toFixed(0)} degrees from the camera (cos ${rest.facing.toFixed(2)})`);
for (const [tag, e] of [["R", rest.right], ["L", rest.left]] as const) console.log(`eye ${tag}: disc ${e.across.toFixed(1)} px across by ${e.tall.toFixed(1)} tall; pupil ${e.pupilPx.toFixed(1)} px; brow plate ${e.browLong.toFixed(1)} px long`);
console.log("\nper expression: white showing at each eye's middle (R, L) px; pupil's place from the eye's middle (R, L) px; gape px; face mark px");
for (const n of names) {
  const d = all[n]!, p = (v: readonly [number, number]) => `(${v[0].toFixed(0)}, ${v[1].toFixed(0)})`;
  console.log(`  ${n.padEnd(11)} white ${d.right.whiteTall.toFixed(0).padStart(3)} ${d.left.whiteTall.toFixed(0).padStart(3)}   pupil ${p(d.marks.pupilR!)} ${p(d.marks.pupilL!)}   gape ${long(d.marks.gape!).toFixed(1).padStart(5)}   browIn ${p(d.marks.browInR!)} ${p(d.marks.browInL!)}   face ${p(d.marks.face!)}`);
}
const pupilGap = (n: string) => { const d = all[n]!; const a = px(d.right.centre), b = px(d.left.centre); return Math.hypot(a[0] + d.marks.pupilR![0] - b[0] - d.marks.pupilL![0], a[1] + d.marks.pupilR![1] - b[1] - d.marks.pupilL![1]); };
console.log(`\nthe pupils are ${pupilGap("rest").toFixed(1)} px apart at rest and ${pupilGap("furious").toFixed(1)} px crossed`);
console.log("\nhow far apart each pair is: the largest change of any drawn vector, px (and which):");
let least = { px: Infinity, pair: "" };
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  let best = { px: 0, what: "" };
  const A = all[names[i]!]!.marks, B = all[names[j]!]!.marks;
  for (const k of Object.keys(A)) { const d = Math.hypot(A[k]![0] - B[k]![0], A[k]![1] - B[k]![1]); if (d > best.px) best = { px: d, what: k }; }
  console.log(`  ${`${names[i]} / ${names[j]}`.padEnd(24)} ${best.px.toFixed(1).padStart(6)}  ${best.what}`);
  if (best.px < least.px) least = { px: best.px, pair: `${names[i]} / ${names[j]}` };
}
console.log(`\nleast apart: ${least.pair} ${least.px.toFixed(1)} px = ${(least.px / rest.right.across).toFixed(2)} of the right eye's width (${rest.right.across.toFixed(1)} px)`);

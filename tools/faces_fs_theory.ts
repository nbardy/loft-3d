// The theory of the fiddler's and the spider crab's faces, before the build (docs/art_direction/DIRECTION.md, "Round 4:
// the fiddler's and the spider crab's faces"): what each eye measures on screen and how far apart the named
// expressions are, from each face's own numbers. Plain arithmetic: the body at rest (no walk, no lean, no swing, no
// wandering), no lag, each expression at full weight.
//
//   bun tools/faces_fs_theory.ts
//
// It imports the numbers the faces draw from (face/jitter.ts, face/mourner.ts: the casts, the eyes, `poseOf`) and the
// bent stalk's own plain-number twin (src/geom/bend.ts, `bentTip`), so a change there changes the prediction. The
// measured side is `loft check` (minScreenSize, expressionsRead).

import { cameraMatrices, project } from "../src/host/camera.ts";
import { bentTip } from "../src/geom/bend.ts";
import { pendulum } from "../src/geom/pendulum.ts";
import { design } from "../examples/bosses/reefback_titan.ts";
import * as J from "../examples/bosses/titan/face/jitter.ts";
import * as M from "../examples/bosses/titan/face/mourner.ts";

type V = readonly [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => mul(a, 1 / Math.hypot(...a));
const mix = (a: V, b: V, t: number): V => add(mul(a, 1 - t), mul(b, t));

const W = 1280, H = 800;
/** A crab at home plays to the game camera (rig.ts, the audience of a boss on its own). */
const AUDIENCE: V = [23, 27, 21];

/** One eye under one expression, in world coordinates with the body at rest: what lib/stalk_eyes.ts draws. */
type Eye = {
  readonly root: V; readonly middle: V; readonly radius: number;
  readonly audience: V; readonly below: number; readonly target: V; readonly turn: number; readonly slide: number;
  readonly upper: number; readonly lower: number; readonly slant: number; readonly pupil: number;
};

function drawn(e: Eye, px: (p: V) => readonly [number, number]) {
  const g = unit(sub(e.target, e.middle));
  // The socket faces its audience, `below` lower (lib/stalk_eyes.ts, `lookOf`).
  const F = unit(mix(unit(sub(unit(sub(e.audience, e.middle)), [0, e.below, 0])), g, e.turn));
  const side0 = unit(cross(F, [0, 1, 0])), up0 = cross(side0, F);
  const side = add(mul(side0, Math.cos(e.slant)), mul(up0, Math.sin(e.slant))), up = sub(mul(up0, Math.cos(e.slant)), mul(side0, Math.sin(e.slant)));
  const gx = dot(g, side0) * e.slide, gy = dot(g, up0) * e.slide;
  const on = (d: V): V => add(e.middle, mul(d, e.radius));
  const d = (p: V, q: V) => { const [ax, ay] = px(p), [bx, by] = px(q); return [bx - ax, by - ay] as const; };
  return {
    at: px(e.middle),
    diameter: Math.hypot(...d(on(mul(side0, -1)), on(side0))),
    // The drawn vectors a viewer compares: the marks of lib/stalk_eyes.ts.
    features: {
      stalk: d(e.root, e.middle),
      upper: d(e.middle, on(add(mul(up, Math.cos(e.upper)), mul(F, Math.sin(e.upper))))),
      lower: d(e.middle, on(add(mul(up, -Math.cos(e.lower)), mul(F, Math.sin(e.lower))))),
      pupil: d(e.middle, on(add(add(mul(side0, gx), mul(up0, gy)), mul(F, Math.sqrt(Math.max(1 - gx * gx - gy * gy, 0)))))),
      corner: d(e.middle, on(side)),
    },
    // How much of the eye's height is open along its middle (0 shut, 1 lids clear of it).
    open: Math.max(0, (Math.cos(e.upper) + Math.cos(e.lower)) / 2),
  };
}

function report(title: string, cameras: Readonly<Record<string, (p: V) => readonly [number, number]>>, names: readonly string[], tags: readonly string[], eyes: (name: string) => readonly Eye[]) {
  console.log(`\n==== ${title} ====`);
  for (const [cam, px] of Object.entries(cameras)) {
    const all = Object.fromEntries(names.map((n) => [n, eyes(n).map((e) => drawn(e, px))]));
    console.log(`\n${cam} camera ${W}x${H}, body at rest`);
    for (const [i, tag] of tags.entries()) console.log(`  eye ${tag}: ${all.rest![i]!.diameter.toFixed(1)} px across at rest, at (${all.rest![i]!.at[0].toFixed(0)}, ${all.rest![i]!.at[1].toFixed(0)})`);
    console.log("  expression   open (per eye)   eye's middle (px)          pupil from the middle (px)");
    for (const n of names) {
      const m = all[n]!;
      console.log(`  ${n.padEnd(10)} ${m.map((x) => x.open.toFixed(2)).join(" ")}        ${m.map((x) => `(${x.at[0].toFixed(0)}, ${x.at[1].toFixed(0)})`).join(" ")}      ${m.map((x) => `(${x.features.pupil[0].toFixed(0)}, ${x.features.pupil[1].toFixed(0)})`).join(" ")}`);
    }
    const top = Math.min(...names.flatMap((n) => all[n]!.map((x) => x.at[1] - x.diameter / 2)));
    console.log(`  highest any eye's top comes: y = ${top.toFixed(0)} of ${H}`);
    console.log("  how far apart each pair is: the largest change of any drawn vector, px (and which)");
    let least = { px: Infinity, pair: "" };
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      let best = { px: 0, what: "" };
      for (const [ei, tag] of tags.entries()) {
        const A = all[names[i]!]![ei]!.features, B = all[names[j]!]![ei]!.features;
        for (const f of Object.keys(A) as (keyof typeof A)[]) {
          const dpx = Math.hypot(A[f][0] - B[f][0], A[f][1] - B[f][1]);
          if (dpx > best.px) best = { px: dpx, what: `${f}${tag}` };
        }
      }
      console.log(`    ${`${names[i]} / ${names[j]}`.padEnd(20)} ${best.px.toFixed(1).padStart(6)}  ${best.what}`);
      if (best.px < least.px) least = { px: best.px, pair: `${names[i]} / ${names[j]}` };
    }
    console.log(`  least apart: ${least.pair} ${least.px.toFixed(1)} px = ${(least.px / all.rest![0]!.diameter).toFixed(2)} of the right eye's width`);
  }
}

/** The cameras a variant's numbers give (reefback_titan.ts, `camerasFor`): `game` is fixed; `far` rises by 0.35 of the ride's gain. */
function camerasOf(ride: number) {
  const rise = ride - 1.35;
  const cam = (eye: V, target: V) => { const m = cameraMatrices({ kind: "perspective", eye, target, fovY: 0.6 }, W / H); return (p: V) => { const q = project(m, p, W, H); return [q.x, q.y] as const; }; };
  return { game: cam([23, 27, 21], [3, 0.5, 2.5]), far: cam([33, 21 + rise * 0.35, 21], [3, 1.5 + rise * 0.35, -1]) };
}

// ---- the fiddler ----
{
  const n = design.resolve({ variant: "fiddler", picks: [] }).numbers;
  const world = (p: V): V => [p[0], p[1] + n.ride, p[2]];
  // Where the fight's subjects are (rig.ts): the ship as taken (the fiddler's cutter: about 8.3 along the keel from the
  // shoulder), and the slam's disc.
  const SHIP: V = [n.carapace.to - 1.1 + Math.cos(n.grabBearing) * 8.3, 0.25, -n.carapace.width * 0.55 + Math.sin(n.grabBearing) * 8.3];
  const DISC: V = [n.crushCentre[0], 0, n.crushCentre[1]];
  const names = ["rest", ...Object.keys(J.CAST.named)];
  const eyes = (name: string): Eye[] => J.EYES.map((e) => {
    const c = name === "rest" ? J.CAST.rest : J.CAST.named[name as J.Mood], q = J.poseOf(c, e);
    const root = world(e.root);
    const tip = bentTip({ root, along: [0, 1, 0], a: [0, 0, 1], b: [1, 0, 0], length: q.length, lean: q.lean, bow: [q.bow, 0], crook: q.crook }).tip;
    return {
      root, middle: tip, radius: e.radius * c.swell, audience: AUDIENCE, below: J.BELOW, target: mix(mix(AUDIENCE, SHIP, c.ship), DISC, c.disc), turn: J.TURN, slide: J.SLIDE,
      upper: q.upper, lower: q.lower, slant: q.slant, pupil: c.pupil,
    };
  });
  report("the fiddler (face/jitter.ts)", camerasOf(n.ride), names, J.EYES.map((e) => e.tag), eyes);
}

// ---- the spider crab ----
{
  const n = design.resolve({ variant: "stilt", picks: [] }).numbers;
  const world = (p: V): V => [p[0], p[1] + n.ride, p[2]];
  const SHIP: V = [n.carapace.to - 1.1 + Math.cos(n.grabBearing) * 9.17, 0.25, -n.carapace.width * 0.55 + Math.sin(n.grabBearing) * 9.17];
  const DISC: V = [n.crushCentre[0], 0, n.crushCentre[1]];
  const names = ["rest", ...Object.keys(M.CAST.named)];
  const eyes = (name: string): Eye[] => M.EYES.map((e) => {
    const c = name === "rest" ? M.CAST.rest : M.CAST.named[name as M.Mood], q = M.poseOf(c, e);
    const root = world([n.carapace.to + e.socket[0], e.socket[1] * n.carapace.height, e.socket[2]]);
    const along = unit([e.leaves[0], e.leaves[1], e.leaves[2] * e.side]), across = unit(cross(along, [0, 1, 0])), down = cross(along, across);
    const b = bentTip({ root, along, a: across, b: down, length: q.length, lean: q.lean, crook: [0, q.droop] });
    return {
      root, middle: add(b.tip, mul(b.heading, e.radius * M.HANG)), radius: e.radius, audience: AUDIENCE, below: M.BELOW, target: mix(mix(world(M.WATER), SHIP, c.ship), DISC, c.disc), turn: M.TURN, slide: M.SLIDE,
      upper: q.upper, lower: q.lower, slant: q.slant, pupil: c.pupil,
    };
  });
  report("the spider crab (face/mourner.ts)", camerasOf(n.ride), names, M.EYES.map((e) => e.tag), eyes);
  // The pendulums: their own periods, and their steady swing under the walk's sway.
  console.log("\n  the eyes as pendulums (arm, own period; under the walk's sway: swing each way, seconds late, the eye's travel each way)");
  for (const e of M.EYES) {
    const arm = M.armOf(e), p = pendulum({ length: arm, gravity: n.gravity, damping: M.DAMPING }), k = p.gain(n.period);
    const swing = k.perUnit * n.sway;
    console.log(`    eye ${e.tag}: arm ${arm.toFixed(2)}, period ${p.period.toFixed(2)} s; walk ${n.period} s, sway ${n.sway}: ${swing.toFixed(2)} rad (${(swing * 57.3).toFixed(0)} deg), ${k.late.toFixed(2)} s late, ${(swing * arm).toFixed(2)} units`);
    const wd = (2 * Math.PI / p.period) * Math.sqrt(1 - M.DAMPING ** 2);
    for (const [name, j] of Object.entries(M.JOLTS)) console.log(`      ${name}: first swing ${j.map((v) => (Math.abs(v) / (arm * wd) * Math.exp(-M.DAMPING * Math.PI / 2 / Math.sqrt(1 - M.DAMPING ** 2))).toFixed(2)).join(" across, ")} rad fore`);
  }
}

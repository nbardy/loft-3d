// The spiral shell (examples/shell.ts) with real relief: growth ridges round the whorl, a row of knobs on its shoulder
// following the spiral, and a flared lip at the mouth, shell-traced in the shell's own coordinates (u along the coil,
// v round the tube). Everything scales with the shell's own growth factor, so the relief at the apex is the relief at
// the mouth seen smaller, and far down the spire it falls below a pixel and is drawn as the plain surface.
import {
  abs, add, clamp, displace, draw, exp, floor, fract, level, lift, max, mix, mul, profile, scene, smoothstep, spacing,
  sub, vec2, vec3, warp, type F, type P3, type SurfaceDrawable,
} from "../src/index.ts";
import { hash2, hsv } from "../src/lib/index.ts";
import type { ReliefPoint, ReliefSite } from "../src/draw/relief.ts";
import type { Warp } from "../src/map/types.ts";
import shellScene from "./shell.ts";

const shell = (shellScene.things.find((t) => t.name === "shell") as SurfaceDrawable).surface;

// As examples/shell.ts: the scale of the tube at u, 1 at the mouth.
const TURNS = 3.2, GROWTH = 0.16;
const grow = (u: F): F => exp(mul(sub(1, u), -GROWTH * Math.PI * 2 * TURNS));

/** Growth ridges per turn, and the world lengths (at scale 1) of one ridge period along the coil and of one turn round the tube. */
const RIDGES = 16;
const ALONG = (2 * Math.PI * (1.1 + 0.62) * 1.5) / RIDGES, ROUND = 2 * Math.PI * 0.62 * 1.5;
/** The tallest relief at the mouth, world units (the tube's radius there is about 8 times this). */
const HMAX = 0.11;

/** The ridge fold: x counts ridges along the coil; the cell is one ridge period, its id the ridge's number. */
const ridgeFold: Warp<"vec2"> = (pp) => {
  const p = lift<"vec2">(pp);
  const x = mul(p.x, RIDGES * TURNS);
  const k = floor(add(x, 0.5));
  return { x: vec2(sub(x, k), p.y), id: vec2(k, 0), stretch: lift<"f32">(1), toWorld: (d) => d };
};

/** The shoulder line round the tube (v = 0 is the outer periphery, 0.25 the top of the whorl). */
const SHOULDER = 0.11;

/** Heights in units of the local scale: a ridge per cell, a knob on the shoulder every second ridge, the lip. */
function relief(s: ReliefSite): { ridge: F; knob: F; lip: F } {
  const q = s.cell.x;
  // A ridge: a sharp crest across the coil, a gentle back slope (the shell grew in pulses).
  const ridge = mul(profile("spike", mul(abs(add(q.x, mul(max(q.x, 0), 1.2))), 1 / 0.3)), 0.06);
  // Knobs on every second ridge: the cell pair's local coordinate along, and round from the shoulder, in world units at scale 1.
  const pair = sub(fract(add(mul(s.cell.id.x, 0.5), 0.25)), 0.25);
  const kx = mul(add(q.x, mul(pair, 2)), ALONG), ky = mul(sub(fract(add(sub(s.v, SHOULDER), 0.5)), 0.5), ROUND);
  return { ridge, knob: knobAt(kx, ky), lip: mul(smoothstep(0.955, 0.985, s.u), smoothstep(1.0, 0.988, s.u)) };
}
const knobAt = (kx: F, ky: F): F => mul(profile("smooth", mul(add(mul(kx, kx), mul(ky, ky)), 1 / (0.34 * 0.34))), 0.1);

function height(s: ReliefSite): F {
  const r = relief(s);
  const fadeApex = smoothstep(0.02, 0.12, s.u);
  return clamp(mul(mul(add(max(r.ridge, r.knob), mul(r.lip, 0.05)), grow(s.u)), fadeApex), 0, HMAX);
}

function paint(p: ReliefPoint): P3 {
  const r = relief(p);
  // Cream ground; each ridge's band its own warm hue (by the cell's identity); knob tips and ridge crests pale.
  const hue = add(mul(hash2(p.cell.id), 0.08), 0.02);
  const band = hsv(hue, add(0.45, mul(smoothstep(0.25, 0.5, abs(p.cell.x.x)), 0.25)), 0.92);
  const ground = mix(vec3(0.98, 0.9, 0.78), band, mul(smoothstep(0.1, 0.4, abs(fract(add(mul(p.v, 6), mul(p.u, 4))).sub(0.5))), 0.8));
  const crest = smoothstep(0.6, 0.95, mul(r.ridge, 1 / 0.06));
  const tip = smoothstep(0.5, 0.9, mul(r.knob, 1 / 0.1));
  // Knobs darken toward their foot and bleach at the tip, as worn shell does.
  const foot = smoothstep(0.02, 0.4, mul(r.knob, 1 / 0.1));
  return mix(mix(mix(ground, vec3(1, 0.97, 0.9), crest), vec3(0.62, 0.3, 0.24), mul(foot, sub(1, tip))), vec3(1, 0.98, 0.92), tip);
}

const things = [
  draw.relief("shellRelief", shell, {
    height, hMax: HMAX, fold: ridgeFold, paint, steps: 32, outline: "ink",
    grid: { u: spacing.even(260), v: spacing.even(48) },
  }),
  // The inside of the mouth: the same surface turned inside out (v reversed flips its normal) and set in a little.
  draw.surface("shellInside", displace(warp.surface(shell, (x) => ({ x: vec2(lift<"vec2">(x).x, sub(1, lift<"vec2">(x).y)), id: vec2(0, 0), stretch: lift<"f32">(1), toWorld: (d) => d })), level(0.006)), {
    paint: () => vec3(0.98, 0.72, 0.7), grid: { u: spacing.even(220), v: spacing.even(40) }, sides: "one", outline: "none",
  }),
];

export default scene({
  ground: shellScene.ground,
  things,
  style: shellScene.style,
  sun: [-0.4, 0.8, 0.45],
  cameras: {
    ...shellScene.cameras,
    close: { kind: "perspective", eye: [3.2, 3.6, 4.4], target: [0.6, 2.6, 0.6], fovY: 0.5 },
    graze: { kind: "perspective", eye: [7.5, 4.6, 4.8], target: [1.2, 3.6, 0.2], fovY: 0.22 },
  },
});

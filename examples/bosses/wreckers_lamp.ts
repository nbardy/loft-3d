// The Wrecker's Lamp (woodblock). A crooked spire of coral and bone grown round a drowned siren; her eye is the lamp,
// and its beam lures ships onto a ring of six rocks. The bells of the wrecks she has taken hang from bone hooks at the
// spire's foot, swinging just above the water.
//
// The look is DIRECTION.md's woodblock print with one change: lantern yellow is the only warm ink (`print.bands` with
// a yellow accent). The spire and the siren are ink black and indigo with cream bone lines; the lens, the beam and the
// lit water are yellow, printed flat. The rocks and bells cut their key line into their paint (`keyLine`).
//
// The signature attack, the Lure Beam, is defined once as a space-time object: the beam's angle is a closed-form
// function of the cycle clock, and the simulation's capsule (DESIGN.md 9, `hit.capsule`) is that angle's capsule.
// Everything else is derived by reading the same function at another time: the head and the coil turn with it, the
// beam cone and the lit water are the capsule now, and the warning marker is the capsule `LURE.lead` seconds ahead
// (the game's marker sweeps 20 ticks ahead of the beam). It loops on time every `LOOP` seconds: idle scan, tell,
// sweep, overheat (the shutters open), idle.
//
// Scale: the sim's ring of rocks (r 260) is RING.radius here, so the sim's beam capsule (600 x r 50) scales with it.
// The ship is the game's size (about 4.5 long); the monster is drawn larger than the game brief's 6.5 u so it dwarfs
// the ship, as DIRECTION.md asks.

import { foam,
  abs, add, clamp, cos, cross, div, draw, dot, f, floor, fract, keys, length, lift, max, min, mix, mod, mul, neg, normalize, pick, points,
  lt, posed, pow, print, scene, sea, select, sign, sin, size, smoothstep, spacing, step, strand, sub, TAU, through, time, turn, vec2, vec3,
  vec4, woodblock, anticipated, dragged, swing as follow, type Drawable, type Expr, type F, type In, type P3, type PaintAt,
} from "../../src/index.ts";
import { hash3, viewDir, fwidth, type Branch, type Frame as ListFrame, tree, gen } from "../../src/lib/index.ts";
import { hit, hitContour, hitInradius, hitPatch, type Capsule } from "../../src/spacetime/index.ts";
import { coverage, sdTriangleIsosceles, stroke } from "../../src/lib/sdf2.ts";
import { NO_SKELETON, type Surface } from "../../src/map/types.ts";
import { SAIL, scaleShip } from "./lib/scale_ship.ts";

// ==== the numbers an art director would change ====================================================================

/** Seconds per attack cycle; every motion below repeats in this time, so a clip of LOOP seconds loops. */
const LOOP = 6;

/** Inks. Lantern yellow is the only warm colour in the picture. */
const INK = {
  hide: [0.04, 0.04, 0.06],      // the siren: ink black
  spire: [0.11, 0.12, 0.22],     // the spire: black in shadow, indigo where lit
  coral: [0.11, 0.13, 0.24],     // coral branches, a shade lighter than the hide
  bone: [0.93, 0.88, 0.75],      // bone lines, spikes, the vertebral spiral: cream lit, pale in shadow
  rock: [0.44, 0.46, 0.55],      // rocks: pale lit, indigo in shadow
  strata: [0.05, 0.05, 0.08],    // the black lines cut into rock
  bell: [0.4, 0.5, 0.62],        // verdigris bells: pale lit, indigo in shadow
  wood: [0.3, 0.22, 0.15],       // wreck timber
  lantern: [0.97, 0.76, 0.2],    // lens and beam
  lanternPale: [1.0, 0.93, 0.62],// the beam's core and the overheated lens
} as const;

const SPIRE = {
  height: 15,          // tip above the water
  foot: -2,            // spine starts below the water
  lean: 0.21,          // tan(12 degrees): the spire leans this much per unit of height
  leanToward: 2.5,     // radians from +x toward +z (away from the game camera, so the siren faces it)
  crook: 0.75,         // sideways kinks of the spine, world units
  girth: [[0, 3.1], [0.12, 2.5], [0.35, 1.6], [0.62, 1.05], [0.85, 0.7], [1, 0.42]] as const,
  ribs: 3,             // cream bone lines spiralling up the spire
  ribTurns: 2.2,
};
const BASE = { radius: 4.6, crags: 7 };  // the spire's foot: a ring of crags; bells hang just outside `radius`
const RING = { radius: 13, rocks: 6, crag: 3.4 };  // the sim's rock ring (r 260) and each rock's height
/** A crag's girth at the water, how much it narrows to its top (a stack of ledges, not a spike), and its lean. */
const CRAG = { girth: 2.0, top: 0.45, lean: 0.6, ledges: 13, ledge: 0.12 };
/** Key lines cut into the rocks' and bells' paint, in pixels (see `keyLine`). */
const KEY_LINE = { rock: 2.5, bell: 2 };
const CORAL = { trees: 7, levels: 5, length: 1.35, radius: 0.3, ratio: 0.74, tilt: 0.55, turn: 2.4 };
const SIREN = {
  from: 0.5, to: 0.93,  // the coil wraps this stretch of the spire's height
  turns: 1.15,
  girth: 0.6,
  stand: 0.35,          // gap between coil and spire
  breathe: 0.06,        // radial breath, world units
  follow: 0.55,         // share of the head's turn the top of the coil follows
  headSize: 1.0,
  pitch: 0.42,          // radians the head looks down
};
const BELLS = [
  { angle: -0.7, height: 0.9, length: 2.1, swing: 0.3, phase: 0.0 },
  { angle: 0.55, height: 0.6, length: 1.7, swing: 0.38, phase: 1.9 },
  { angle: 2.1, height: 1.0, length: 2.2, swing: 0.26, phase: 3.3 },
] as const;

/** The Lure Beam, in the sim's terms scaled to the art: a capsule from the spire swept a quarter turn. */
const SIM = RING.radius / 260;
const LURE = {
  start: 3.2,                   // the capsule starts at the spire's foot (world units from its axis)
  length: 600 * SIM,            // 30
  radius: 50 * SIM,             // 2.5
  from: -0.55,                  // start angle, radians from +x toward +z
  sweep: Math.PI / 2,           // 90 degrees
  arm: 2.4,                     // seconds into the cycle the beam fires (the end of the tell)
  warn: 1.0,                    // 20 ticks of tell
  sweepSeconds: 2.0,            // 40 ticks
  lead: 1.0,                    // the marker sweeps 20 ticks ahead of the beam
  idleArc: 0.45,                // half-width of the idle scan, radians
  idleCentre: 0.25,
  idleGlow: 0.32,               // the beam's strength while it only scans
  idleReach: 0.45,              // and how far along the capsule it reaches
  heatSeconds: 1.3,             // the overheat after the sweep: shutters open
  rays: 30,                     // printed rays round the beam
  coneEnd: 0.85,                // the cone is drawn this far from the lens toward the water
};

/** The ship for scale (lib/scale_ship.ts): where on the sweep it sails. */
const SHIP = { radius: 17.5, angleInSweep: 0.63, heading: 2.2 };
const WIND = [0.6, 0.8] as const;

// ==== the clock ===================================================================================================

/** Seconds into the current cycle. */
const cycle = (t: F): F => mod(t, LOOP);
const W = TAU / LOOP;

/** The beam's angle during the attack, at cycle clock c: held at `from` until arming, then linear over the sweep (the sim's). */
const sweepAngle = (c: F): F => add(LURE.from, mul(clamp(div(sub(c, LURE.arm), LURE.sweepSeconds), 0, 1), LURE.sweep));
/** How far the lamp is given over to the attack: turns to the start angle through the tell, back to scanning after. */
// The turn into the attack goes the wrong way first (anticipated, back 3: about a fifth of the turn), coy, then swings
// to the start angle; it is complete 0.15 s before arming, so the beam is the sim's capsule from arming on.
const engaged = (c: F): F => mul(anticipated(smoothstep(LURE.arm - LURE.warn * 1.2, LURE.arm - 0.15, c), 3), sub(1, smoothstep(LURE.arm + LURE.sweepSeconds + 0.4, LURE.arm + LURE.sweepSeconds + 1.6, c)));
/** The lamp's yaw at time t: a slow scan, or the attack. */
const beamAngle = (t: F): F => {
  const c = cycle(t);
  const idle = add(LURE.idleCentre, mul(sin(mul(c, W)), LURE.idleArc));
  return mix(idle, sweepAngle(c), engaged(c));
};
/** The beam's strength: faint while it scans, full from arming to the end of the sweep. */
const beamGlow = (t: F): F => {
  const c = cycle(t);
  const on = mul(smoothstep(LURE.arm - 0.12, LURE.arm, c), sub(1, smoothstep(LURE.arm + LURE.sweepSeconds, LURE.arm + LURE.sweepSeconds + 0.35, c)));
  return mix(LURE.idleGlow, 1, on);
};
/** The overheat: 0 shut, 1 open. */
const heat = (t: F): F => {
  const c = cycle(t), end = LURE.arm + LURE.sweepSeconds;
  return mul(smoothstep(end + 0.05, end + 0.35, c), sub(1, smoothstep(end + LURE.heatSeconds, end + LURE.heatSeconds + 0.3, c)));
};
const polar2 = (a: F): Expr<"vec2"> => vec2(cos(a), sin(a));
/** The sim's capsule for a beam at angle a, drawn out to `reach` of its length. */
const capsuleAt = (a: F, reach: In<"f32"> = 1): Capsule =>
  hit.capsule({ a: mul(polar2(a), LURE.start), b: mul(polar2(a), add(LURE.start, mul(reach, LURE.length))), radius: LURE.radius });
/**
 * The beam's shape now: while the lamp only scans (no hit in the sim) it reaches `idleReach` of the way; through the
 * whole attack it is the sim's capsule exactly. The warning marker is the beam's own capsule `lead` seconds ahead.
 */
const lureHit = capsuleAt(beamAngle(time), mix(LURE.idleReach, 1, engaged(cycle(time))));
const markerHit = capsuleAt(sweepAngle(add(cycle(time), LURE.lead)));

// ==== the water ===================================================================================================

const water = sea({
  reach: 4000,
  swell: [
    { direction: [1, 0.3], length: 13, height: 0.16, speed: 1.1 },
    { direction: [-0.3, 1], length: 6, height: 0.03, speed: 0.7, phase: 1.3 },
  ],
  foam: 0.45,
});

// ==== the spire ===================================================================================================

type V3 = [number, number, number];
const leanDir: V3 = [Math.cos(SPIRE.leanToward), 0, Math.sin(SPIRE.leanToward)];
const sideDir: V3 = [-leanDir[2], 0, leanDir[0]];
const SPINE_N = 7;
/** The spire's spine: a lean, kinked side to side (crooked, not a shaft). Plain numbers: the spire is rock. */
const spirePts: V3[] = Array.from({ length: SPINE_N }, (_, i) => {
  const s = i / (SPINE_N - 1), y = SPIRE.foot + s * (SPIRE.height - SPIRE.foot);
  const lean = SPIRE.lean * Math.max(y, 0) * (0.6 + 0.4 * s);
  const kink = SPIRE.crook * Math.sin(i * 2.1 + 0.4) * Math.sin(Math.PI * s);
  return [leanDir[0] * lean + sideDir[0] * kink, y, leanDir[2] * lean + sideDir[2] * kink];
});
/** Piecewise-linear reading of the spine and girth by height, for parts that must sit on the spire's skin. */
function spireAt(y: number): { at: V3; r: number } {
  const s = Math.min(1, Math.max(0, (y - SPIRE.foot) / (SPIRE.height - SPIRE.foot)));
  const k = Math.min(SPINE_N - 2, Math.floor(s * (SPINE_N - 1))), w = s * (SPINE_N - 1) - k;
  const a = spirePts[k]!, b = spirePts[k + 1]!;
  const g = SPIRE.girth;
  let r = g[g.length - 1]![1];
  for (let j = 0; j < g.length - 1; j++) if (s >= g[j]![0] && s <= g[j + 1]![0]) { const u = (s - g[j]![0]) / (g[j + 1]![0] - g[j]![0]); r = g[j]![1] + u * (g[j + 1]![1] - g[j]![1]); }
  return { at: [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w], r };
}

const spireGirth = keys(SPIRE.girth.map(([m, r]) => [m, r] as const));
const spire = strand({
  name: "spire",
  spine: (m) => through(m, spirePts),
  stations: 16,
  girth: (m) => spireGirth(m).x,
  section: { aspect: 1, squareness: 1.8 },
  tips: ["open", { point: 0.06 }],
  // Ink black, with cream bone lines spiralling up it (the bone grown into the coral).
  paint: (m, v) => {
    const s = fract(add(mul(v, SPIRE.ribs), mul(m, SPIRE.ribTurns * SPIRE.ribs)));
    const rib = sub(1, smoothstep(0.05, 0.075, abs(sub(s, 0.5))));
    return mix(vec3(...INK.spire), vec3(...INK.bone), mul(rib, smoothstep(0.08, 0.16, m)));
  },
  detail: { along: 72, around: 20 },
});

/**
 * The bone spiral: a vertebral column winding up the lower spire, listed as one bone per vertebra in the `growth`
 * draw below (the key line between neighbours is the joint). As a strand it was two more draws for the same picture.
 */
const SPIRAL = { vertebrae: 30, from: 0.6, rise: 8.5, turns: 1.6, start: 0.8, root: 0.42, tip: 0.14, gap: 0.12 };
const spiralAt = (s: number): V3 => {
  const y = SPIRAL.from + s * SPIRAL.rise, { at, r } = spireAt(y), a = SPIRAL.start + s * TAU * SPIRAL.turns;
  return [at[0] + Math.cos(a) * (r + 0.18), y, at[2] + Math.sin(a) * (r + 0.18)];
};

/**
 * The key line, cut into a paint: black within about `px` pixels of where the surface turns edge-on to the eye (the
 * width is in pixels because it is measured by the screen rate of n.v). The style's own key line is the hull outline,
 * 0.05 world wide and never under 1.5 px, which a dark rim against the indigo sea swallows from the game camera: the
 * rocks and bells lost their lines when the edge-detection pass that drew them went (2026-11-11).
 */
function keyLine(at: PaintAt, px: number): F {
  const ndv = abs(dot(at.normal, viewDir(at.world)));
  const w = mul(max(fwidth(ndv), 1e-4), px);
  return sub(1, smoothstep(mul(w, 0.6), w, ndv));
}

/** Rock paint: flat rock ink with black strata lines that wander a little. */
function strata(m: F, v: F, count: number, ink: readonly [number, number, number] = INK.rock): P3 {
  const w = add(mul(m, count), mul(sin(add(mul(v, TAU * 3), mul(m, 7))), 0.18));
  const line = sub(1, smoothstep(0.05, 0.09, abs(sub(fract(w), 0.5))));
  return mix(vec3(...ink), vec3(...INK.strata), line);
}

// ---- coral and bone: one listed draw (draw.copies) ----------------------------------------------------------------

/** A branching coral: a tapering branch, then at its tip turn, mirror (two children), tilt and shrink. */
const coralTree = tree({
  part: { kind: "cone", a: [0, 0, 0], b: [0, CORAL.length, 0], ra: CORAL.radius, rb: CORAL.radius * 0.78 },
  step: [gen.shift([0, CORAL.length, 0]), gen.turn("xz", CORAL.turn), gen.mirror("x"), gen.turn("xy", CORAL.tilt), gen.shrink(CORAL.ratio)],
});
const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A frame at a point whose y column is `dir`. */
function frameAlong(o: V3, dir: V3, scale: number): ListFrame {
  const y = norm(dir), x = norm(crossV(y, Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), z = crossV(x, y);
  return { o, m: [[x[0] * scale, x[1] * scale, x[2] * scale], [y[0] * scale, y[1] * scale, y[2] * scale], [z[0] * scale, z[1] * scale, z[2] * scale]], scale };
}
/** A point on the spire's skin at height y and bearing a, pushed in by `sink`, and the outward direction there. */
function onSpire(y: number, a: number, sink = 0.15): { at: V3; out: V3 } {
  const { at, r } = spireAt(y), out: V3 = [Math.cos(a), 0, Math.sin(a)];
  return { at: [at[0] + out[0] * (r - sink), y, at[2] + out[2] * (r - sink)], out };
}

/** Bone is marked by its level (coral levels run 0..CORAL.levels - 1). */
const BONE_LEVEL = 20;
const coralBranches: Branch[] = Array.from({ length: CORAL.trees }, (_, k) => {
  const y = 2.6 + (k / (CORAL.trees - 1)) * 6.2, a = k * 2.39996 + 0.4;
  const { at, out } = onSpire(y, a);
  const dir: V3 = [out[0], 0.9 + 0.3 * Math.sin(k), out[2]];
  return coralTree.branches(CORAL.levels, frameAlong(at, dir, 0.85 + 0.35 * Math.sin(k * 1.7)))
    .map((b) => ({ ...b, id: [b.id[0], b.id[1] + k, b.id[2]] as const }));
}).flat();

/** Bone spikes: thorns along the spire, and the hooks the bells hang from. */
const bone = (a: V3, b: V3, ra: number, k: number): Branch => ({ a, ra, b, rb: ra * 0.12, level: BONE_LEVEL, id: [k, 0, 0] });
const thorns: Branch[] = Array.from({ length: 14 }, (_, k) => {
  const y = 3 + (k / 13) * 9.5, a = k * 1.9 + 2.2;
  const { at, out } = onSpire(y, a, 0.3);
  const len = 1.1 + 0.6 * Math.sin(k * 2.7) ** 2;
  return bone(at, [at[0] + out[0] * len, at[1] + len * 0.75, at[2] + out[2] * len], 0.2, k);
});
/** Where each bell hangs: the tip of a bone hook leaning out of the base rock. */
const hangAt = (b: (typeof BELLS)[number]): V3 => [Math.cos(b.angle) * (BASE.radius + 0.4), b.height + 1.6, Math.sin(b.angle) * (BASE.radius + 0.4)];
const hooks: Branch[] = BELLS.map((b, k) => {
  const tip = hangAt(b), root: V3 = [Math.cos(b.angle) * 2.2, b.height + 0.2, Math.sin(b.angle) * 2.2];
  return { a: root, ra: 0.26, b: tip, rb: 0.07, level: BONE_LEVEL, id: [k + 40, 0, 0] as const };
});
const vertebrae: Branch[] = Array.from({ length: SPIRAL.vertebrae }, (_, k) => {
  const n = SPIRAL.vertebrae, s0 = k / n, s1 = (k + 1 - SPIRAL.gap) / n;
  const r = SPIRAL.root + (SPIRAL.tip - SPIRAL.root) * s0;
  return { a: spiralAt(s0), ra: r, b: spiralAt(s1), rb: r * 0.9, level: BONE_LEVEL, id: [k + 60, 0, 0] as const };
});

const growth = draw.copies("growth", {
  kind: "cone",
  copies: [...coralBranches, ...thorns, ...hooks, ...vertebrae],
  paint: ({ level, id }) => {
    const coral = mix(vec3(...INK.coral), vec3(...INK.bone), mul(step(CORAL.levels - 1.5, level), step(0.5, hash3(id))));
    return mix(coral, vec3(...INK.bone), step(BONE_LEVEL - 0.5, level));
  },
  // The copies' own ink: the woodblock's key-line pass that used to ink them from depth is gone (2026-11-11).
  outline: "silhouette",
  minPixels: 2,
  keepLevels: 2,
  inkBack: 6,
});

// ==== the siren ===================================================================================================

const yaw = beamAngle(time);
const fwd = (a: F): P3 => vec3(cos(a), 0, sin(a));
const UP = vec3(0, 1, 0);
const breath = sin(mul(time, W * 2));

const COIL_N = 9;
const top = spireAt(SPIRE.height - 0.6);
/** Where the neck ends: just above the spire's tip; the head turns about it. */
const neck: V3 = [top.at[0], SPIRE.height + 0.55, top.at[2]];
const yawRest = LURE.idleCentre;
/**
 * The coil, tail first: a helix round the spire's upper part. Its top follows the head's turn (the body twists toward
 * the beam), and the whole coil breathes. The last point is the neck.
 */
const coilPts: P3[] = Array.from({ length: COIL_N }, (_, i) => {
  const s = i / (COIL_N - 1);
  const y = SPIRE.foot + (SPIRE.height - SPIRE.foot) * mix01(SIREN.from, SIREN.to, s);
  const { at, r } = spireAt(y);
  const a0 = yawRest + Math.PI - SIREN.turns * TAU * (1 - s);
  // The coil turns after the head: each turn further down reads the head's yaw later (overlap), up to 0.35 s.
  const a = add(a0, mul(sub(beamAngle(dragged(time, 1 - s, 0.35)), yawRest), SIREN.follow * s * s));
  const rad = add(r + SIREN.stand + SIREN.girth * 0.7 * Math.sin(Math.PI * Math.min(1, s * 1.3)), mul(breath, SIREN.breathe * s));
  return vec3(add(at[0], mul(cos(a), rad)), y + 0.15 * Math.sin(i * 1.3), add(at[2], mul(sin(a), rad)));
});
function mix01(a: number, b: number, s: number): number { return a + (b - a) * s; }
const shoulder = add(vec3(...neck), add(mul(fwd(add(yaw, Math.PI)), 0.35), vec3(0, -0.6, 0)));
const sirenSpine = [...coilPts.slice(0, -1), shoulder, add(vec3(...neck), mul(fwd(yaw), 0.15))];
const sirenGirth = keys([[0, 0.08], [0.25, 0.4], [0.55, SIREN.girth], [0.78, SIREN.girth * 0.8], [0.9, SIREN.girth * 0.95], [1, 0.32]]);
const body = strand({
  name: "siren",
  spine: (m) => through(m, sirenSpine),
  stations: 24,
  girth: (m) => sirenGirth(m).x,
  section: { aspect: 0.85, squareness: 2.2 },
  tips: [{ point: 0.06 }, { round: 0.04 }],
  // Black hide; on the tail, scale lines printed in cream, sparse.
  paint: (m, v) => {
    const row = fract(add(mul(m, 46), mul(abs(sub(fract(mul(v, 6)), 0.5)), 1.6)));
    const scale = mul(sub(1, smoothstep(0.06, 0.11, row)), sub(1, smoothstep(0.35, 0.5, m)));
    return mix(vec3(...INK.hide), vec3(...INK.bone), mul(scale, 0.75));
  },
  detail: { along: 96, around: 16 },
});

// ---- the head: hood, skull and lens, all in the head's frame (forward along the yaw, looking down by `pitch`) ---------

/**
 * The head's pitch: it leans down over the water through the tell (luring), and when the shutters open it recoils
 * upward from the heat and swings back (follow-through).
 */
const lureLean = (() => {
  const c = cycle(time), end = LURE.arm + LURE.sweepSeconds;
  const tell = mul(smoothstep(LURE.arm - LURE.warn, LURE.arm, c), sub(1, smoothstep(end, end + 0.6, c)));
  return add(add(mul(tell, 0.18), mul(heat(time), -0.3)), follow(sub(c, end + 0.05), 0.12, 1.3, 0.3));
})();
const pitch = add(SIREN.pitch, lureLean);
const look = add(mul(fwd(yaw), cos(pitch)), vec3(0, mul(sin(pitch), -1), 0));
const headSide = normalize(cross(look, UP));
const headUp = cross(headSide, look);
const H = SIREN.headSize;
/** A point of the head's frame: forward, up, side (world units times the head's size). */
const headPt = (fw: number | F, up: number | F, sd: number | F): P3 =>
  add(vec3(...neck), add(add(mul(look, mul(lift<"f32">(fw), H)), mul(headUp, mul(lift<"f32">(up), H))), mul(headSide, mul(lift<"f32">(sd), H))));
const nod = mul(sin(add(mul(time, W * 3), 0.7)), 0.05);

/**
 * The head: a hooded cowl, closed, its front a bone-white face (the lens is its one eye) behind a cream rim. One
 * strand: a separate skull inside an open hood cost two more draws for the same picture.
 */
const head = strand({
  name: "head",
  spine: (m) => through(m, [headPt(-0.75, 0.35, 0), headPt(0.1, add(0.45, nod), 0), headPt(0.85, add(0.15, nod), 0)]),
  stations: 6,
  girth: (m) => mul(mix(0.55, 0.62, smoothstep(0, 0.7, m)), H),
  section: { aspect: 1.1, squareness: 2.4 },
  tips: [{ round: 0.25 }, { round: 0.12 }],
  up: headUp,
  paint: (m) => {
    const rim = mul(smoothstep(0.8, 0.82, m), sub(1, smoothstep(0.86, 0.88, m)));
    return mix(mix(vec3(...INK.hide), vec3(...INK.bone), rim), vec3(...INK.bone), smoothstep(0.9, 0.92, m));
  },
  detail: { along: 24, around: 18 },
});
/** The lens: a ball of lantern yellow in front of the skull (paler while overheated: the core shows). */
const LENS = 0.33;
/** Where the lens sits on the face, in the head's frame (forward, up): a single eye on the brow. */
const EYE = { fwd: 0.66, up: 0.3 };
const hot = heat(time);
const lens = strand({
  name: "lens",
  spine: (m) => through(m, [headPt(EYE.fwd, add(EYE.up, nod), 0), headPt(EYE.fwd + LENS * 2 / H, add(EYE.up, nod), 0)]),
  stations: 4,
  girth: LENS,
  tips: [{ round: 0.5 }, { round: 0.5 }],
  up: headUp,
  paint: (m) => mix(vec3(...INK.lantern), vec3(...INK.lanternPale), max(mul(hot, smoothstep(0.3, 0.6, m)), smoothstep(0.75, 0.85, m))),
  detail: { along: 12, around: 14 },
});
/**
 * The shutters, as one strand: the upper lid's edge, back over the lens, round behind it, out to the lower lid's
 * edge. Shut, the lids nearly meet in front of the lens (a slit lets the beam out); overheated, they swing open.
 */
const lidOpen = mix(0.38, 1.45, hot);
const lid = (sgn: number, reach: number): P3 => {
  const ang = mul(lidOpen, sgn);
  return headPt(add(EYE.fwd + 0.1, mul(cos(ang), reach)), add(add(EYE.up, nod), mul(sin(ang), reach)), 0);
};
const shutters = strand({
  name: "shutters",
  spine: (m) => through(m, [lid(1, 0.62), lid(1, 0.3), headPt(EYE.fwd - 0.12, add(EYE.up, nod), 0), lid(-1, 0.3), lid(-1, 0.62)]),
  stations: 10,
  girth: (m) => mul(mix(0.3, 0.42, abs(sub(mul(m, 2), 1))), H),
  section: { aspect: 0.14, squareness: 3 },
  tips: "open",
  // The lids are broad sideways and thin across their curl: the frame's dorsal side is the head's up.
  up: headUp,
  paint: (m) => mix(vec3(...INK.hide), vec3(...INK.bone), step(0.9, fract(mul(m, 9)))),
  detail: { along: 40, around: 12 },
});

/** Arms: one strand from hand to hand through the shoulders, the hands clutching the spire below her. */
const handAt = (sgn: number): P3 => {
  const a = yawRest + Math.PI * 0.5 * sgn + 0.4;
  const { at, r } = spireAt(SPIRE.height - 3.2);
  return vec3(at[0] + Math.cos(a) * r, SPIRE.height - 3.2, at[2] + Math.sin(a) * r);
};
const elbow = (sgn: number): P3 => add(shoulder, add(mul(headSide, 1.1 * sgn), vec3(0, -1.1, 0)));
const arms = strand({
  name: "arms",
  spine: (m) => through(m, [handAt(-1), elbow(-1), add(shoulder, mul(headSide, -0.4)), add(shoulder, mul(headSide, 0.4)), elbow(1), handAt(1)]),
  stations: 14,
  girth: (m) => mix(0.1, 0.22, sin(mul(m, Math.PI))),
  tips: [{ point: 0.04 }, { point: 0.04 }],
  paint: INK.hide,
  detail: { along: 48, around: 10 },
});

/** Hair: black strokes trailing from the back of the hood down the spire, swaying. */
const HAIR = [-0.5, 0, 0.5];
const hair = HAIR.map((sd, k) => draw.curve(`hair_${k}`, (u) => {
  // It drifts, and trails the head's turn: the yaw a third of a second ago less the yaw now.
  const sway = add(mul(sin(add(mul(time, W * 2), k * 1.7 + 0)), 0.5), mul(sub(beamAngle(dragged(time, 1, 0.3 + 0.05 * k)), yaw), 2.5));
  const p0 = headPt(-0.6, 0.3, sd * 0.8);
  const back = fwd(add(yaw, Math.PI + sd * 0.6));
  const drop = add(mul(back, add(1.1, mul(u, 1.2))), vec3(0, mul(u, -5.5), 0));
  const swing = mul(headSide, mul(sway, mul(u, u)));
  return add(add(p0, mul(drop, u)), swing);
}, { width: (u) => mix(0.16, 0.035, u), paint: () => vec3(...INK.strata), segments: 20 }));

// ==== the bells ===================================================================================================

/** One bell a unit long hanging down from its crown at the origin; each copy is hung, swung and sized by `bells`. */
const bellGirth = keys([[0, 0.12], [0.12, 0.3], [0.55, 0.38], [0.85, 0.58], [1, 0.7]]);
const bell = strand({
  name: "bell",
  spine: (m) => vec3(0, mul(m, -1), 0),
  stations: 4,
  girth: (m) => bellGirth(m).x,
  tips: [{ round: 0.1 }, "open"],
  paint: (m, _v, at) => {
    const lip = max(step(0.86, m), mul(step(0.45, m), sub(1, step(0.5, m))));
    return mix(mix(vec3(...INK.bell), vec3(...INK.strata), lip), vec3(...INK.strata), keyLine(at, KEY_LINE.bell));
  },
  detail: { along: 14, around: 14 },
});
/** Bell i's bearing, and where it hangs (the tip of its hook: `hangAt`). */
const bellAngle = (i: F): F => pick(i, BELLS.map((b) => b.angle));
const hang = (i: F): P3 => {
  const a = bellAngle(i), r = BASE.radius + 0.4;
  return vec3(mul(cos(a), r), add(pick(i, BELLS.map((b) => b.height)), 1.6), mul(sin(a), r));
};
/** Each bell swings out from the spire and back on its own clock: its own rate and phase. */
const swing = (i: F): F =>
  mul(sin(add(mul(time, mul(pick(i, BELLS.map((_, k) => (k % 2 === 0 ? 2 : 3))), W)), pick(i, BELLS.map((b) => b.phase)))), pick(i, BELLS.map((b) => b.swing)));
const bells = draw.posed("bells", posed(BELLS.length, (i) => {
  const a = bellAngle(i);
  return { at: hang(i), turn: turn.about(vec3(neg(sin(a)), 0, cos(a)), swing(i)), size: size.even(pick(i, BELLS.map((b) => b.length))) };
}), bell);

// ==== the ring of rocks ===================================================================================================

/**
 * A crag: a leaning stack of rock, broad at the water and narrowing in ledges to a rounded top, faceted (seven sides)
 * and cut with strata and a key line. Drawn at points, so a ring of them is one draw. (It was a spike tapering to a
 * point, which read as a fin.)
 */
const crag = (name: string, height: number, girth: number, lean: number) => strand({
  name,
  spine: (m) => through(m, [[0, -1.8, 0], [lean * 0.1, height * 0.35, -lean * 0.1], [lean * 0.25, height * 0.75, lean * 0.1], [lean * 0.3, height, lean * 0.15]]),
  stations: 8,
  girth: (m) => mul(mix(girth, girth * CRAG.top, pow(m, 1.5)), add(1, mul(max(sin(mul(m, CRAG.ledges)), 0), CRAG.ledge))),
  section: { aspect: 0.8, squareness: 1.6 },
  tips: ["open", { round: 0.3 }],
  paint: (m, v, at) => mix(strata(m, v, 5), vec3(...INK.strata), keyLine(at, KEY_LINE.rock)),
  detail: { along: 16, around: 7 },
});
const ringAngle = (i: F, offset: number): F => add(mul(i, TAU / RING.rocks), offset);
const ringAt = (i: F, r: number | F, offset: number, y: number): P3 => vec3(mul(cos(ringAngle(i, offset)), r), y, mul(sin(ringAngle(i, offset)), r));
/**
 * One crag shape at every rock (one draw): the six of the ring, a smaller one beside each, and a ring of crags at the
 * spire's foot that is its base.
 */
const crags = draw.points("crags", points(RING.rocks * 2 + BASE.crags, (i) => {
  const big = step(i, RING.rocks - 0.5), beside = mul(step(RING.rocks - 0.5, i), step(i, RING.rocks * 2 - 0.5));
  const foot = sub(1, add(big, beside));
  const footAngle = mul(i, 2.39996);
  const footAt = vec3(mul(cos(footAngle), add(2.4, mul(fract(mul(i, 0.73)), 1.6))), -0.5, mul(sin(footAngle), add(2.4, mul(fract(mul(i, 0.73)), 1.6))));
  const at = add(add(mul(ringAt(i, RING.radius, 0.3, 0), big), mul(ringAt(i, RING.radius + 1.4, 0.48, 0), beside)), mul(footAt, foot));
  const small = add(0.45, mul(fract(mul(i, 0.381)), 0.25)), large = add(0.85, mul(fract(mul(i, 0.618)), 0.4));
  return { at, scale: add(add(mul(large, big), mul(small, beside)), mul(add(0.6, mul(fract(mul(i, 0.29)), 0.35)), foot)) };
}), crag("crag", RING.crag, CRAG.girth, CRAG.lean));

/** Wreck timber: planks and spars caught on the rocks. */
const plank = strand({
  name: "plank", spine: (m) => through(m, [[-1.1, 0, 0], [0, 0.06, 0.05], [1.1, 0, 0]]), stations: 4, girth: 0.17,
  section: { aspect: 0.3, squareness: 5 }, tips: "open",
  paint: (m) => mix(vec3(...INK.wood), vec3(...INK.strata), step(0.85, fract(mul(m, 5)))), detail: { along: 6, around: 8 },
});
const timber = draw.points("timber", points(RING.rocks * 2, (i) => ({ at: ringAt(floor(mul(i, 0.5)), add(RING.radius - 1.9, mul(mod(i, 2), 3.6)), 0.62, 0.05), scale: 1 })), plank);

// ==== the Lure Beam ===================================================================================================

/** The lamp: where the beam leaves the lens. */
const lampAt = headPt(EYE.fwd + LENS * 2 / H, add(EYE.up, nod), 0);

/**
 * The beam as a flat print: a cone from the lens whose base is the outline of the sim's capsule on the water, so
 * wherever it is seen from, its footprint is the hit shape exactly. Nothing is translucent (yellow at partial alpha
 * over the indigo sea printed olive, which is not an ink of this print): the beam is printed as
 * rays from the lens, each as wide as the beam is strong, so a faint scanning beam is a fan of yellow lines and the
 * full beam a flat pale yellow with darker rays. A black line runs along its silhouette (where the cone turns
 * edge-on to the eye); only front faces fill.
 */
function beamCone(): Drawable {
  const h = lureHit, glow = beamGlow(time);
  const ab = sub(h.b, h.a), L = length(ab), ax = div(ab, L), sd = vec2(mul(ax.y, -1), ax.x), r = h.radius;
  const per = add(mul(L, 2), mul(r, TAU));
  /** The capsule's outline by arc length (v in [0, 1)): one side, the far cap, the other side, the near cap. */
  const rim = (v: F): P3 => {
    const s = mul(fract(v), per), capLen = mul(r, Math.PI);
    const s2 = sub(s, L), s3 = sub(s2, capLen), s4 = sub(s3, L);
    const side1 = add(add(h.a, mul(ax, s)), mul(sd, r));
    const cap1 = add(h.b, mul(add(mul(sd, cos(div(s2, r))), mul(ax, sin(div(s2, r)))), r));
    const side2 = sub(sub(h.b, mul(ax, s3)), mul(sd, r));
    const cap2 = sub(h.a, mul(add(mul(sd, cos(div(s4, r))), mul(ax, sin(div(s4, r)))), r));
    const xz = select(lt(s, L), side1, select(lt(s2, capLen), cap1, select(lt(s3, L), side2, cap2)));
    return vec3(xz.x, 0, xz.y);
  };
  /** The outline's direction at v (its derivative's direction), in closed form per piece. */
  const rimTangent = (v: F): P3 => {
    const s = mul(fract(v), per), capLen = mul(r, Math.PI);
    const s2 = sub(s, L), s3 = sub(s2, capLen), s4 = sub(s3, L);
    const cap1 = sub(mul(ax, cos(div(s2, r))), mul(sd, sin(div(s2, r))));
    const cap2 = sub(mul(sd, sin(div(s4, r))), mul(ax, cos(div(s4, r))));
    const t = select(lt(s, L), ax, select(lt(s2, capLen), cap1, select(lt(s3, L), mul(ax, -1), cap2)));
    return vec3(t.x, 0, t.y);
  };
  // The cone stops short of the water (`coneEnd`): its fill has faded there and the lit water carries the shape.
  const point = (u: F, v: F): P3 => mix(lampAt, rim(v), mul(u, LURE.coneEnd));
  // A cone's normal does not change along a ruling: cross(rim - apex, d rim / dv), turned to face away from the
  // inside (a point halfway down the axis).
  const normalAt = (v: F, p: P3): P3 => {
    const n = normalize(cross(sub(rim(v), lampAt), rimTangent(v)));
    const inside = mix(lampAt, vec3(mul(add(h.a.x, h.b.x), 0.5), 0, mul(add(h.a.y, h.b.y), 0.5)), 0.5);
    return mul(n, sign(dot(n, sub(p, inside))));
  };
  const surface: Surface = {
    point, normal: (u, v) => normalAt(v, point(u, v)), anchor: (u, v) => vec3(u, v, 0),
    topology: { u: ["free", "free"], v: "periodic" }, skeleton: NO_SKELETON,
  };
  return draw.glazed("beam", surface, {
    colour: (fr) => {
      const k = dot(normalAt(fr.v, fr.world), viewDir(fr.world));
      const facing = step(k, 0);
      const edge = abs(k), w = max(fwidth(edge), 1e-4);
      const line = sub(1, smoothstep(mul(w, 1.0), mul(w, 2.2), edge));
      // Rays: lines of constant v from the lens, wider the stronger the beam (they merge at full strength).
      const d = abs(sub(fract(mul(fr.v, LURE.rays)), 0.5)), dw = max(fwidth(d), 1e-4);
      const ray = sub(1, smoothstep(sub(mul(glow, 0.36), dw), add(mul(glow, 0.36), dw), d));
      const dark = sub(1, smoothstep(0.04, 0.08, d));
      const col = mix(mix(vec3(...INK.lanternPale), vec3(...INK.lantern), mul(dark, glow)), vec3(...INK.strata), line);
      // Thinning toward the water, where the lit sea takes over.
      const fade = sub(1, smoothstep(0.35, 1.0, fr.u));
      const a = mul(max(mul(mul(facing, ray), fade), line), smoothstep(-0.05, 0.2, fr.world.y));
      return vec4(col, mul(a, 0.95));
    },
    grid: { u: spacing.even(10), v: spacing.even(56) },
    phase: "transparent",
    sceneDepth: false,
  });
}

/**
 * The lit water: the sim's capsule itself, printed on the sea as arcs round the spire (light on the water), each arc as
 * wide as the beam is strong, with a black line round the shape.
 */
function litWater(): Drawable {
  const h = lureHit, glow = beamGlow(time);
  const surface: Surface = {
    point: (u, v) => { const xz = hitPatch(h, u, v, f(0.2)); return vec3(xz.x, water.height(xz), xz.y); },
    normal: () => vec3(0, 1, 0), anchor: (u, v) => vec3(u, v, 0),
    topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON,
  };
  return draw.glazed("litwater", surface, {
    colour: (fr) => {
      const p = vec2(fr.world.x, fr.world.z);
      const c = hitContour(h, p, f(1));
      const px = max(fwidth(c.d), 1e-5);
      const inside = coverage(c.d, px);
      const ring = abs(sub(fract(mul(length(p), 0.9)), 0.5)), rw = max(fwidth(ring), 1e-4);
      const width = mul(glow, 0.42);
      const arc = sub(1, smoothstep(sub(width, rw), add(width, rw), ring));
      const outline = mul(coverage(sub(abs(c.d), max(f(0.06), px)), px), glow);
      const col = mix(vec3(...INK.lantern), vec3(...INK.strata), outline);
      return vec4(col, max(mul(inside, arc), outline));
    },
    grid: { u: spacing.even(28), v: spacing.even(8) },
    phase: "on-water",
    sceneDepth: false,
  });
}

/**
 * The warning: the capsule the beam will sweep, `lead` seconds ahead, printed as a cream bone edge with inward teeth
 * and a black line round it over cream hatching. It shows through the tell and the sweep, its teeth growing until
 * arming; it goes when the beam reaches the end of its sweep.
 *
 * Why not `attack()` + `telegraph()` (src/spacetime): a remote attack (no body part) is now possible, but the
 * telegraph's life is "warn, flash once at arming, fade" on a fixed hit shape. The Lure Beam stays dangerous for its
 * whole 2 s sweep, with the marker leading it round; so the hit shape is the library's (`hit.capsule`, `hitContour`,
 * `hitPatch`) and the marker is drawn here in the telegraph's manner.
 */
function warning(): Drawable {
  const h = markerHit;
  const c0 = cycle(time);
  const shown = mul(smoothstep(LURE.arm - LURE.warn, LURE.arm - LURE.warn + 0.15, c0), sub(1, smoothstep(LURE.arm + LURE.sweepSeconds - 0.1, LURE.arm + LURE.sweepSeconds + 0.2, c0)));
  const k = clamp(div(sub(c0, LURE.arm - LURE.warn), LURE.warn), 0, 1);
  const surface: Surface = {
    point: (u, v) => { const xz = hitPatch(h, u, v, f(0.3)); return vec3(xz.x, water.height(xz), xz.y); },
    normal: () => vec3(0, 1, 0), anchor: (u, v) => vec3(u, v, 0),
    topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON,
  };
  return draw.glazed("lurewarning", surface, {
    colour: (fr) => {
      const p = vec2(fr.world.x, fr.world.z);
      const c = hitContour(h, p, f(1.3));
      const px = max(fwidth(c.d), 1e-5);
      const teeth = min(mul(c.pitch, mix(0.3, 0.9, k)), mul(hitInradius(h), 0.8));
      const toothX = mul(sub(fract(c.phase), 0.5), c.pitch);
      const tooth = max(sdTriangleIsosceles(vec2(toothX, mul(c.d, -1)), mul(c.pitch, 0.3), teeth), c.d);
      const edgeW = max(f(0.22), mul(px, 1.5));
      const boneD = min(stroke(add(c.d, mul(edgeW, 0.5)), mul(edgeW, 0.5)), tooth);
      const boneA = coverage(boneD, px);
      const inkA = coverage(sub(boneD, max(f(0.09), px)), px);
      // Inside: diagonal hatching in cream, denser toward arming (printed, not tinted).
      const hatch = abs(sub(fract(mul(add(p.x, p.y), 0.8)), 0.5)), hw = max(fwidth(hatch), 1e-4), hwid = mix(0.06, 0.14, k);
      const fillA = mul(coverage(c.d, px), sub(1, smoothstep(sub(hwid, hw), add(hwid, hw), hatch)));
      const col = mix(vec3(...INK.strata), vec3(...INK.bone), max(boneA, mul(fillA, sub(1, inkA))));
      return vec4(col, mul(max(max(boneA, inkA), mul(fillA, 0.85)), shown));
    },
    grid: { u: { count: 28, at: (s) => s }, v: { count: 8, at: (s) => s } },
    phase: "on-water",
    sceneDepth: false,
  });
}

// ==== the ship ===================================================================================================

const shipAngle = LURE.from + LURE.sweep * SHIP.angleInSweep;
const shipAt: [number, number] = [Math.cos(shipAngle) * SHIP.radius, Math.sin(shipAngle) * SHIP.radius];
const victim = scaleShip.afloat(water, { at: shipAt, heading: SHIP.heading, wind: WIND });

// ==== the scene ===================================================================================================

/**
 * Cameras. They look at the siren's three-quarter front at the stills' moment (`STILL`, mid-sweep), from the side the
 * beam sweeps toward, so the lens, the beam and the ship it is about to catch are all in view.
 */
const STILL = LURE.arm + LURE.sweepSeconds * 0.55;
const faceYaw = LURE.from + LURE.sweep * 0.55;
const around = (r: number, a: number, y: number, at: V3): [number, number, number] => [at[0] + r * Math.cos(a), y, at[2] + r * Math.sin(a)];
const middle: V3 = [3, 3.5, 3];
export const STILL_TIME = STILL;
export default scene({
  ground: water,
  things: [
    spire, growth,
    body, head, lens, shutters, arms, ...hair,
    bells, crags, timber,
    beamCone(), litWater(), warning(),
    ...victim,
  ],
  // Lantern paints have red and green both 0.3 above blue; cream (0.13) and the ship's wood (0.14) stay below 0.25.
  style: woodblock({ print: print.bands({ accent: { hue: "yellow", margin: 0.25, inks: [{ ink: INK.lantern, from: 0 }, { ink: INK.lanternPale, from: 0.82 }] }, named: { sail: SAIL } }), foam: foam.roll() }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    game: { kind: "perspective", eye: around(34, faceYaw - 1.3, 31, middle), target: [middle[0], 5.5, middle[2]], fovY: 0.62 },
    three: { kind: "perspective", eye: around(30, faceYaw - 1.25, 15, middle), target: [middle[0], 6.5, middle[2]], fovY: 0.62 },
    close: { kind: "perspective", eye: around(7.5, faceYaw - 0.85, neck[1] + 1.4, neck), target: [neck[0], neck[1] - 1.0, neck[2]], fovY: 0.62 },
    top: { kind: "perspective", eye: [middle[0] + 0.01, 72, middle[2] + 0.01], target: [middle[0], 0, middle[2]], fovY: 0.62 },
  },
});

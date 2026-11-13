// Thundermaw (woodblock): the storm serpent. A serpent that lives in, and is partly made of, its thunderhead. The
// cloud is not a volume: it is a heap of billowing lobes, each a flattened ball printed as a woodblock cloud is cut
// (cream on its lit face, a pale and an indigo step on its shadow side, a curled line pattern facing the viewer, the
// key line from the style's post pass round every lobe). The serpent threads a loop through the heap, its back
// carrying a mane of the same lobes and its tail dissolving into them. Rain falls from the cloud's belly.
//
// Signature attack (the design note's Lightning Field, one circle): a marked spot on the water is telegraphed; the
// thunderhead darkens and crackles; the serpent rears and darts its head down over the spot (an `attack` lunge, so the
// pose is derived from the hit shape and arming time); at the arming time a bolt drops from its maw to the mark and
// the sea foams where it lands (lib/impact.ts). The attack arms every STRIKE.loop seconds (`every`); `strike.at` moves
// the mark.
//
// From the strategy camera the head leads: the serpent holds its bearing toward the cameras (it sways about it rather
// than flowing round its loop), so the head is the nearest thing, high on its weave, and the body trails away round the
// back of the heap. (Flowing round, the head was a dot at the far end and the body a dark bar across the cloud's face.)
//
// Phases (input `phase`, 1 to 3, continuous): 1 airborne; 2 Storm Eye (the cloud opens into a ring round the
// serpent, which rises, its wings spread and the mane swells); 3 Last Breath (the heap tears into scattered lobes and
// darkens to indigo, the body thins and cream lightning veins run down its back, the jaw hangs open).
//
// Coordinates: y up, the cloud's axis on x = z = 0. The serpent's head is at its spine's m = 0.

import { foam,
  abs, add, atan2, cos, dot, draw, fan, floor, fract, input, lathe, lift, max, min, mix, mul, normalize, palette,
  points, rain, scene, sea, select, sin, smoothstep, spacing, step, sub, time, vec2, vec3, woodblock, print, length, lt,
  displaced, flicker, afterglow, strikeAt, saturate, pow, through, WOODBLOCK_PALETTE, WOODBLOCK_SEA, beats, dragged, slowInOut, swing, uneven, anticipated,
  type Drawable, type F, type P3, type PaintAt,
} from "../../src/index.ts";
import { fwidth } from "../../src/lib/wgsl.ts";
import { animate, attack, every, hit, part, telegraph } from "../../src/spacetime/index.ts";
import { wyrm, type Wyrm } from "../scenes/lib/wyrm.ts";
import { SAIL, scaleShip } from "./lib/scale_ship.ts";
import { impactFoam, impactPaint } from "./lib/impact.ts";
import { PRINT_WARNING } from "./lib/warning.ts";

// ---- the numbers an art director would change ---------------------------------------------------------------------

/** The thunderhead: centre height, horizontal radius, how tall its crown heaps, and the lobes it is printed from. */
const CLOUD = {
  height: 15, radius: 9.5, crown: 6,
  crownLobes: 24, crownSize: [2.3, 4.0] as const,   // lobe radius, smallest to largest
  bellyLobes: 16, bellySize: [2.2, 3.3] as const,
  rimLobes: 22, rimSize: [1.1, 1.7] as const,      // small curls scalloping the heap's edge
  flatten: 0.78,           // a lobe's height over its width: a cumulus lump, not a ball
  billow: 0.09,            // share of a lobe's radius it swells and shrinks by
  billowRate: 0.35,        // Hz
  drift: 0.35,             // world units a lobe wanders
};
/** The serpent: length of its loop through the cloud, girth, head size (1 = examples/serpent.ts's skull). */
const SERPENT = {
  loop: 11.5,              // radius of the loop it threads round the cloud's axis
  arc: 2.5,                // radians of the loop its body covers (head to tail)
  weave: 4.2,              // how far it dips below and rises above the loop's plane (in and out of the lobes)
  weaves: 2,               // dips per turn
  bearing: 0.78,           // radians from +x toward +z where the head holds: toward the strategy cameras
  drift: 0.14, driftRate: 0.035, // radians it slides to and fro along its loop about that bearing, Hz
  girth: 1.35, size: 2.5, stations: 64,
  sway: 0.6, swayRate: 0.5, // the S-wave down the body (world units, Hz)
  wingSpan: 9.5, wingBeat: 0.32, wingRate: 0.45, // longest wing ray, beat amplitude (radians), Hz
  maneLobes: 16,           // cloud lobes riding its back, growing toward the tail
};
/** The marked spot and its strike. */
const STRIKE = {
  // Default mark on the water (x, z): off to the side of the head's bearing, so from the strategy camera the head dives
  // across the view and the bolt and the foam show (at [7, 9] it dived toward the camera and its wings hid them).
  at: [12, 2.5] as const,
  radius: 3.2,             // the hit disc
  loop: 7,                 // seconds between strikes
  arm: 4.2,                // seconds into each loop the bolt lands
  warn: 1.8,               // seconds of warning before it lands
  hover: 7.5,              // height the head darts down to above the mark
  boltWidth: 0.6,          // half-width of the bolt at its top
};
/** The ship for scale (lib/scale_ship.ts), and the weather. */
const SHIP = { at: [17, 9] as const, heading: 2.6 };
const WIND: readonly [number, number] = [0.8, 0.5];
const RAIN = { count: 2600, radius: 9, length: 2.4, width: 0.035, opacity: 0.6 };
const SUN: readonly [number, number, number] = [-0.35, 0.8, 0.5];

/**
 * Inks a paint aims at, as lit values the woodblock style prints: cream above 0.6, pale blue above 0.34, indigo above
 * 0.08. The style multiplies a paint's luminance by 1.06 on its lit side and 0.66 on its shadow side, so a paint that
 * wants one ink on both sides is divided by the side's factor (`aim`).
 */
const INK = { cream: 0.8, pale: 0.47, indigo: 0.2, black: 0.03 } as const;
const COLOURS = {
  back: [0.15, 0.2, 0.38], belly: [0.93, 0.88, 0.75], bone: [0.95, 0.9, 0.78],
  iris: [0.9, 0.22, 0.12], mouth: [0.08, 0.06, 0.1], bolt: [1, 0.98, 0.92],
} as const;

// ---- inputs and the clocks derived from them ----------------------------------------------------------------------

/** 1 airborne, 2 Storm Eye, 3 Last Breath; in between blends. */
const phase = input("phase", "f32", [1]);
const eye = smoothstep(1.3, 2.0, phase);     // 0 -> 1 into phase 2
const breath = smoothstep(2.3, 3.0, phase);  // 0 -> 1 into phase 3
const mark = input("strike.at", "vec2", [...STRIKE.at]);

// ---- the strike: the hit disc and its schedule (the lunge it poses is applied to the serpent below) -----------------

const bolt = attack({
  name: "bolt", arm: every(STRIKE.loop, STRIKE.arm), warn: STRIKE.warn,
  target: { kind: "disc", centre: mark, radius: lift<"f32">(STRIKE.radius) },
  part: "head",
  // Pushed 1.5x and 1.4x (coil 3, rise 3.5): it draws further back and up the wrong way before it darts.
  motion: { kind: "lunge", hit: hit.disc({ centre: mark, radius: STRIKE.radius }), reach: 0.4, lead: 2.5, height: STRIKE.hover, coil: 4.5, rise: 5, approach: 0.5, neck: 4 },
  // A whip: a 1.2 s wind-up before a 0.2 s dart (it was 1.0 before 0.35); the body follows slower (travel 1.1, was 1.6),
  // so it trails the head further.
  timing: { windup: 1.2, strike: 0.2, hold: 0.25, recover: 0.6, travel: 1.1 },
});
/** The dart in three beats: the attack's own wind-up and strike, then 1.2 s of settle. */
const dart = beats(add(sub(time, bolt.arm), 1.4), { anticipate: 1.2, act: 0.2, settle: 1.2 });
/** Seconds from this cycle's strike (negative before it). */
const since = sub(time, bolt.arm);
/** 0 -> 1 over the warning, 0 again once the strike has landed and faded. */
const warning = mul(saturate(add(mul(since, 1 / STRIKE.warn), 1)), sub(1, smoothstep(0.2, 0.8, since)));

const sun = normalize(vec3(...SUN));

// ---- the printed cloud lobe ---------------------------------------------------------------------------------------

/** A flattened ball of radius 1: u from the top pole (0) to the bottom (1), v once round. */
const lobeProfile = (u: F) => vec2(sin(mul(u, Math.PI)), mul(cos(mul(u, Math.PI)), CLOUD.flatten));
const LOBE = lathe(lobeProfile, ["pole", "pole"]);
/** The paint luminance that prints `target` on whichever side of the style's terminator the normal is. */
const aim = (n: P3, target: In1) => mul(target, select(lt(dot(n, sun), 0), 1 / 0.66, 1 / 1.06));
type In1 = F | number;
const grey = (x: F): P3 => vec3(x, x, x);

/** Where the curls face: toward the strategy camera, so the pattern reads from the game's view. */
const VIEW = (() => { const d = [0.55, 0.62, 0.56], l = Math.hypot(...d); return d.map((x) => x / l) as [number, number, number]; })();
const E1 = (() => { const up = [0, 1, 0]; const c = [VIEW[1] * up[2] - VIEW[2] * up[1], VIEW[2] * up[0] - VIEW[0] * up[2], VIEW[0] * up[1] - VIEW[1] * up[0]]; const l = Math.hypot(...c); return c.map((x) => x / l) as [number, number, number]; })();
const E2 = [VIEW[1] * E1[2] - VIEW[2] * E1[1], VIEW[2] * E1[0] - VIEW[0] * E1[2], VIEW[0] * E1[1] - VIEW[1] * E1[0]] as const;

/** 1 on a line of half-width w (in the units of d), antialiased by d's own screen rate. */
function line(d: F, w: In1): F {
  const fw = max(fwidth(d), 1e-4);
  return sub(1, smoothstep(sub(w, fw), add(w, fw), d));
}

/**
 * A lobe's print: three inks from the light (cream, pale, indigo), stepped by `shade` (0 the crown's light, 1 a
 * belly in shadow), and the curl: a spiral line in the face turned to the viewer, plus an inner contour along the top
 * of the face, as the carver cuts the edge of a billow. Each copy's curl sits at its own place on the face (a hash of
 * the copy and the heap's `salt`), so the lobes do not repeat.
 */
function lobePaint(shade: F, salt: number): (u: F, v: F, at: PaintAt) => P3 {
  return (_u, _v, at) => {
    const n = at.normal;
    const ns = dot(n, sun);
    // Steps of the light, moved toward shadow by `shade`.
    const lit = sub(ns, mul(shade, 0.7));
    const target = select(lt(lit, -0.3), INK.indigo, select(lt(lit, 0.18), INK.pale, INK.cream));
    // The face toward the viewer, as a disc: q in the plane across the view, |q| < 1.
    const q = vec2(dot(n, vec3(...E1)), dot(n, vec3(...E2)));
    const facing = dot(n, vec3(...VIEW));
    // A spiral from a centre low and to one side of the face (moved about per copy), three turns out to a third of it.
    const centre = vec2(add(-0.22, mul(sub(h1(at.copy, salt), 0.5), 0.36)), add(-0.24, mul(sub(h1(at.copy, salt + 1), 0.5), 0.3)));
    const c = sub(q, centre);
    const r = length(c), th = atan2(c.y, c.x);
    const turns = sub(mul(r, 9), mul(th, 1 / (Math.PI * 2)));
    const spiral = mul(mul(line(abs(sub(fract(add(turns, 0.5)), 0.5)), 0.12), sub(1, smoothstep(0.3, 0.36, r))), smoothstep(0.2, 0.4, facing));
    // An inner contour a little inside the silhouette, on the upper half of the face.
    const rim = mul(mul(line(abs(sub(facing, 0.42)), 0.035), smoothstep(-0.1, 0.25, q.y)), step(0, facing));
    const pattern = max(spiral, rim);
    const lineInk = select(lt(lit, -0.3), INK.black, INK.indigo);
    return grey(aim(n, mix(target, lineInk, pattern)));
  };
}

/** Darker steps in the warning (the thunderhead gathering) and in the later phases. */
const crownShade = add(add(mul(warning, 0.9), mul(eye, 0.25)), mul(breath, 1.2));
const bellyShade = add(add(0.45, mul(warning, 0.5)), mul(breath, 0.9));

/** A cheap hash of a copy index to [0, 1). */
const h1 = (i: F, k: number): F => fract(mul(sin(add(mul(i, 12.9898), k * 78.233)), 43758.5453));

/** Billowing: a slow swell of each lobe out of step with its neighbours, and a drift. */
const billow = (i: F) => add(1, mul(sin(add(mul(time, CLOUD.billowRate * Math.PI * 2), mul(i, 2.1))), CLOUD.billow));
const drift = (i: F): P3 => mul(vec3(sin(add(mul(time, 0.21), mul(i, 1.3))), mul(sin(add(mul(time, 0.17), mul(i, 0.7))), 0.5), cos(add(mul(time, 0.19), mul(i, 1.9)))), CLOUD.drift);

/**
 * Lobes in a ring band of the heap. Storm Eye opens the heap into a ring (the inner lobes move out, the middle
 * empties); Last Breath tears it: lobes fling out and shrink.
 */
function heap(n: number, o: { readonly y: number; readonly rise: number; readonly inner: number; readonly size: readonly [number, number] }) {
  return points(n, (i) => {
    const a = add(mul(i, 2.39996), mul(time, 0.02));
    const s = add(o.inner, mul(sub(1, o.inner), pow(mul(add(i, 0.5), 1 / n), 0.5)));
    const ringed = mix(s, add(0.85, mul(s, 0.3)), eye);
    const torn = add(ringed, mul(breath, mul(h1(i, 3), 0.9)));
    const r = mul(torn, CLOUD.radius);
    const y = add(add(o.y, mul(sub(1, mul(s, s)), o.rise)), mul(breath, mul(sub(h1(i, 5), 0.5), 6)));
    const size = mix(o.size[1], o.size[0], s);
    const scale = mul(mul(mul(size, billow(i)), add(1, mul(eye, 0.15))), sub(1, mul(breath, mul(h1(i, 7), 0.55))));
    return { at: add(vec3(mul(r, cos(a)), y, mul(r, sin(a))), drift(i)), scale };
  });
}

const lobeGrid = { u: spacing.even(14), v: spacing.even(22) };
const crownLobe = draw.surface("tmLobe", LOBE, { paint: lobePaint(crownShade, 1), grid: lobeGrid, sides: "one", outline: "none" });
const bellyLobe = draw.surface("tmLobeDark", LOBE, { paint: lobePaint(bellyShade, 2), grid: lobeGrid, sides: "one", outline: "none" });
const crownLobes = draw.points("tmCrown", heap(CLOUD.crownLobes, { y: CLOUD.height + 1, rise: CLOUD.crown, inner: 0.05, size: CLOUD.crownSize }), crownLobe);
const rimLobe = draw.surface("tmLobeRim", LOBE, { paint: lobePaint(add(0.15, crownShade), 3), grid: { u: spacing.even(10), v: spacing.even(16) }, sides: "one", outline: "none" });
const rimLobes = draw.points("tmRim", heap(CLOUD.rimLobes, { y: CLOUD.height + 0.6, rise: 0.5, inner: 0.97, size: CLOUD.rimSize }), rimLobe);
const bellyLobes = draw.points("tmBelly", heap(CLOUD.bellyLobes, { y: CLOUD.height - 2.2, rise: 0.8, inner: 0.35, size: CLOUD.bellySize }), bellyLobe);

// ---- the serpent's path: a loop threaded through the heap ----------------------------------------------------------

/** A point of the loop at angle th: round the axis, weaving up and down through the lobes. */
function loopAt(th: F): P3 {
  const rise = add(mul(eye, 3), mul(breath, 1.5));
  const r = add(SERPENT.loop, mul(sin(add(mul(th, 2), 0.7)), 1.2));
  const y = add(add(CLOUD.height, mul(sin(mul(th, SERPENT.weaves)), SERPENT.weave)), rise);
  return vec3(mul(r, cos(th)), y, mul(r, sin(th)));
}
const CONTROL = 18;
/**
 * The rest posture: the head at `bearing` (toward the cameras), the body trailing round the loop behind the heap, the
 * whole sliding to and fro about that bearing; an S-wave travelling down the body.
 */
const restSpine = (m: F): P3 => {
  const slide = mul(sin(mul(time, SERPENT.driftRate * Math.PI * 2)), SERPENT.drift);
  const pts = Array.from({ length: CONTROL }, (_, k) => {
    const s = k / (CONTROL - 1);
    const th = add(slide, SERPENT.bearing + s * SERPENT.arc);
    const p = loopAt(th);
    const outward = vec3(cos(th), 0, sin(th));
    const sway = mul(sin(sub(s * 5, mul(time, SERPENT.swayRate * Math.PI * 2))), SERPENT.sway * (0.3 + s));
    return add(p, mul(outward, sway));
  });
  return through(m, pts);
};

// ---- the serpent, posed by the strike -------------------------------------------------------------------------------

/** The roar: the jaw drops through the wind-up and snaps at the strike; it hangs open in Last Breath. */
// The jaw first clamps a little (anticipated dips below 0), then drops.
const gape = add(add(0.12, mul(anticipated(warning, 2.2), 0.55)), mul(breath, 0.3));

let built: Wyrm | undefined;
const serpent = animate(restSpine, [bolt], (spine) => {
  const w = wyrm({
    name: "thundermaw", spine, stations: SERPENT.stations, girth: SERPENT.girth, size: SERPENT.size, gape,
    colours: { back: COLOURS.back, belly: COLOURS.belly, band: COLOURS.back, membrane: COLOURS.back, bone: COLOURS.bone, iris: COLOURS.iris, mouth: COLOURS.mouth },
    along: 260, crest: { from: 0.1, to: 0.5, height: 1 }, bands: 0,
    paint: bodyPaint,
  });
  built = w;
  return { things: w.things, parts: { head: part("head", w.body, { from: 0, to: 0.4, tip: 0 }) } };
});
const maw = built!;

/**
 * The body's print: indigo back and cream belly (the style steps each into its shadow ink), scale arcs cut into the
 * back, plates across the belly; toward the tail the body turns to cloud (cream with curls). Last Breath runs cream
 * lightning veins down the back.
 */
function bodyPaint(m: F, v: F): P3 {
  const base = palette.countershade(v, { back: COLOURS.back, belly: COLOURS.belly });
  const back = sub(1, smoothstep(0.45, 0.6, abs(sub(fract(add(v, 0.25)), 0.5))));  // 1 on the back half
  // Scales: arcs in a staggered lattice, rows along m.
  const rows = mul(m, 70), ring = mul(v, 14);
  const stagger = mul(floor(rows), 0.5);
  const cell = vec2(sub(fract(rows), 0.5), sub(fract(add(ring, stagger)), 0.5));
  const arc = line(abs(sub(length(add(cell, vec2(0.45, 0))), 0.55)), 0.06);
  const scales = mul(arc, back);
  const plates = mul(line(abs(sub(fract(mul(m, 90)), 0.5)), 0.05), sub(1, back));
  const lined = mix(base, vec3(0.03, 0.03, 0.05), max(mul(scales, 0.9), mul(plates, 0.7)));
  // The tail dissolves into cloud: cream from 0.72 on (sooner in Last Breath).
  const cloudy = smoothstep(sub(0.78, mul(breath, 0.25)), sub(0.95, mul(breath, 0.25)), m);
  const vein = mul(mul(line(abs(sub(v, add(0.25, mul(sin(mul(m, 140)), 0.03)))), 0.012), breath),
    step(0.4, fract(add(mul(time, 3), mul(m, 2)))));
  return mix(mix(lined, vec3(...COLOURS.belly), cloudy), vec3(1, 1, 1), vein);
}

// ---- wings: two ragged fins on the shoulders, beating --------------------------------------------------------------

/** Ray k of a wing on `side` (+1 right, -1 left): from the body's flank at m, out and back, raised by the beat. */
function wingRays(side: number) {
  const roots = [0.13, 0.17, 0.21, 0.26, 0.31];
  const reach = [0.75, 1, 0.92, 0.7, 0.45];
  const sweep = [-0.35, 0.05, 0.4, 0.75, 1.0];
  const spread = add(1, mul(eye, 0.3));
  return roots.map((m0, k) => (r: F | number) => {
    const f = maw.body.frame(vec3(m0, 0.25, 0.6));
    // Each side beats at its own rate and phase (no twins). In the wind-up the wings fold down against the body; at the
    // dart they snap up and open and swing on, each ray further back a little later.
    const own = uneven(side * 3 + 1, 0.12);
    const fold = mul(mul(slowInOut(dart.anticipate), sub(1, dart.act)), -0.5);
    const snap = swing(dragged(dart.after, k, 0.05), 0.75, 1.4, 0.25);
    const beatAngle = add(add(mul(sin(sub(mul(time, mul(own, SERPENT.wingRate * Math.PI * 2)), k * 0.35 + (side > 0 ? 0 : 0.9))), SERPENT.wingBeat), fold), snap);
    const out = add(mul(f.z, mul(cos(beatAngle), side)), mul(f.y, add(sin(beatAngle), 0.55)));
    const dir = normalize(add(out, mul(f.x, sweep[k])));
    const len = mul(spread, SERPENT.wingSpan * reach[k]);
    const rr = lift<"f32">(r);
    // A little droop along the ray, as membrane over a soft bone.
    return add(add(f.o, mul(dir, mul(rr, len))), mul(f.y, mul(sin(mul(rr, Math.PI)), -0.6)));
  });
}
function wingPaint(u: F, v: F): P3 {
  const rib = line(abs(sub(fract(add(mul(u, 4), 0.5)), 0.5)), 0.05);
  const vane = mul(line(abs(sub(fract(mul(v, 5)), 0.5)), 0.04), smoothstep(0.15, 0.3, v));
  const base = mix(vec3(0.5, 0.58, 0.7), vec3(...COLOURS.belly), smoothstep(0.78, 0.84, v));
  return mix(base, vec3(...COLOURS.back), max(rib, mul(vane, 0.0)));
}
const wingGrid = { u: spacing.even(48), v: spacing.even(16) };
const wings = [1, -1].map((side) => draw.surface(side > 0 ? "tmWingR" : "tmWingL", fan({ rays: wingRays(side), sag: 0.08, scallop: 0.42, slack: 2.5 }), { paint: wingPaint, grid: wingGrid, sides: "two", outline: "border" }));

// ---- the mane: cloud lobes riding the back, growing into the tail ---------------------------------------------------

const maneLobe = draw.surface("tmManeLobe", LOBE, { paint: lobePaint(add(mul(warning, 0.4), mul(breath, 1.0)), 4), grid: { u: spacing.even(10), v: spacing.even(16) }, sides: "one", outline: "none" });
const mane = draw.points("tmMane", points(SERPENT.maneLobes, (i) => {
  const s = mul(i, 1 / (SERPENT.maneLobes - 1));
  const m = mix(sub(0.32, mul(breath, 0.12)), 1.0, s);
  const at = maw.body.frame(vec3(m, add(0.25, mul(sin(mul(i, 2.3)), 0.11)), 0.5)).o;
  const scale = mul(mul(add(0.9, mul(s, mul(s, 2.4))), billow(i)), add(add(1, mul(eye, 0.3)), mul(breath, 0.2)));
  return { at, scale };
}), maneLobe);

// ---- lightning: the strike from the maw, and crackle in the cloud ------------------------------------------------

/** Where the bolt leaves the jaw (on the jaw's skin, near its tip). */
const mouth = maw.jaw.frame(vec3(0.7, 0.75, 1)).o;
const markAt = vec3(mark.x, -0.3, mark.y);
/** The strike's number: each cycle's bolt is its own shape. (The library's `bolt()` takes expressions now, but it keeps a
 * schedule of its own beside the attack's and draws only as an additive glow; this stroke is printed flat, keyed by the
 * attack's cycle.) */
const strikeIndex = bolt.cycle(time);
const boltCurve = (u: F | number): P3 => displaced(lift<"f32">(u), mouth, markAt, 6, 0.11, add(mul(strikeIndex, 13), 1));
const boltLight = max(min(flicker(since), 1), mul(afterglow(since, 0.3), 0.8));
const strokeBolt = draw.curve("tmBolt", boltCurve, {
  width: (u) => mul(mul(boltLight, STRIKE.boltWidth), sub(1.15, mul(u, 0.45))), paint: () => vec3(...COLOURS.bolt), segments: 64,
});

/** Crackle inside the heap: short bolts between hashed points, on their own schedule at rest, fast in the warning. */
const sparks = [0, 1, 2].map((j) => {
  const sched = strikeAt({ first: 0.3 + j * 0.9, every: 2.6, jitter: 0.5, seed: 21 + j });
  const fast = floor(mul(time, 6));
  const key = add(mul(sched.index, 1), mul(fast, mul(warning, 1)));
  const end = (c: number): P3 => {
    const a = mul(fract(mul(sin(add(mul(key, 3.1), c + j * 17)), 9137.13)), Math.PI * 2);
    const rr = CLOUD.radius * (0.35 + 0.15 * j);
    return vec3(mul(rr, cos(a)), CLOUD.height - 3.2 - c * 0.4, mul(rr, sin(a)));
  };
  const a = end(1), b = add(end(2), vec3(0, -2.2, 0));
  const light = max(min(flicker(sched.since), 1), mul(warning, step(0.55, fract(add(mul(time, 7.3), j * 0.37)))));
  return draw.curve(`tmSpark${j}`, (u) => displaced(lift<"f32">(u), a, b, 4, 0.12, add(key, j * 31)), {
    width: () => mul(light, 0.16), paint: () => vec3(...COLOURS.bolt), segments: 24,
  });
});

// ---- rain, the sea, the ship ---------------------------------------------------------------------------------------

const water = sea({
  swell: [
    { direction: [1, 0.35], length: 18, height: 0.6, speed: 1.6 },
    { direction: [-0.3, 1], length: 7, height: 0.2, speed: 1.0, phase: 1.3 },
  ],
  foam: 0.5,
});
const shower = rain("tmRain", {
  centre: [0, 0], radius: RAIN.radius, top: CLOUD.height - 3, count: RAIN.count, speed: 15, wind: [WIND[0] * 2.5, WIND[1] * 2.5],
  length: RAIN.length, width: RAIN.width, colour: [0.93, 0.9, 0.82], opacity: RAIN.opacity, flash: boltLight, seed: 7,
});
const scout = scaleShip.afloat(water, { at: [...SHIP.at], heading: SHIP.heading, wind: WIND });
/** The sea foams where the bolt lands. */
const strikeFoam = impactFoam("tmStrikeFoam", water, {
  area: hit.disc({ centre: mark, radius: STRIKE.radius }), pad: 1.5, splashes: [{ at: mark, since }],
  reach: STRIKE.radius * 1.3, seconds: 1.3, foam: COLOURS.belly, line: [0.075, 0.07, 0.09], paint: impactPaint.ridge(),
});

const creature: Drawable[] = serpent.things.filter((t) => !/Crest|Tail[LR]$/.test(t.name));

export default scene({
  ground: water,
  things: [
    ...creature, ...wings, mane, crownLobes, rimLobes, bellyLobes, strokeBolt, ...sparks,
    ...scout, telegraph(bolt, { style: PRINT_WARNING }), strikeFoam, shower,
  ],
  // A storm sky: the indigo block printed low over a narrow cream horizon, the haze below it.
  style: woodblock({ print: print.bands({ named: { sail: SAIL } }), sky: { washes: [{ ink: WOODBLOCK_SEA.haze, from: 0, to: 0.06 }, { ink: WOODBLOCK_PALETTE.indigo, from: 0.08, to: 0.3 }], below: WOODBLOCK_SEA.haze }, foam: foam.roll() }),
  sun: SUN,
  cameras: {
    game: { kind: "perspective", eye: [40, 50, 46], target: [4, 10, 3], fovY: 0.62 },
    three: { kind: "perspective", eye: [36, 20, 38], target: [2, 11, 2], fovY: 0.72 },
    // The head over the mark as the bolt leaves its maw (render it at a time near STRIKE.arm, e.g. 4.3).
    close: { kind: "perspective", eye: [24.5, 14, 19.5], target: [11.5, 6, 3.5], fovY: 0.55 },
    top: { kind: "orthographic", eye: [0, 90, 0.001], target: [0, 0, 0], height: 60 },
  },
});

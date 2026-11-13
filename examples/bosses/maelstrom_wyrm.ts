// The Maelstrom Wyrm, as a woodblock print. An ancient sea serpent coiled round the whirlpool it keeps spinning: only
// its four arched coils and its horned, gilled head break the surface; between them the water turns and drains. Each
// arch carries a pearl gland (one pearl in a vermilion socket). Subject: the game's boss (room-runners-arena-lib
// notes/design/2026-11-01_fleet_spells_bosses.md, 6.1); look: docs/art_direction/DIRECTION.md, row A.
//
// The body is one strand whose spine is written in world coordinates in closed form: a spiral from the head at the
// rim inward to the tail diving into the throat, its height a sum of four arches over a line below the water. At rest
// the arches heave in sequence, the whole coil slithers along its own path, the neck sways while the head holds on
// the ship (eyes on it), the jaw breathes and works, the whiskers drift and the gills flare with the breath. Every rest
// motion repeats in LOOP seconds. The head is an East Asian dragon's on a crocodile's planes (see "the head" below).
//
// The signature attack, Coil Lash: one arch rears into a tall loop, leaning back, then topples outward and slams down
// flat across a capsule on the water (src/spacetime/rear.ts). It is an `attack` like any other: the warning is the
// capsule drawn on the water (`telegraph`), the pose is derived from the attack's envelopes, and after the slam that
// arch's pearl gland swells open (the game's exposure window); the head rears, turns to the lane, roars and flares its
// gills through it; where it slams down the water bursts into clawed foam (lib/impact.ts). Here the attack arms
// every LOOP seconds, first `lash.at` seconds in (`every`); a game sets `lash.at` and `lash.warn` instead.
//
// The style is woodblock with its body inks retuned for this monster (DIRECTION.md: slate and olive coils, vermilion
// gills and pearl glands): every paint below is one of the keys in INKS, and each key prints in two inks, shadow and
// lit (`print.keys`). The sea, the key line and the paper are woodblock's own; the whirlpool's foam arms are printed
// by the style from the whirlpool's own foam, and its eye in the key black (`water.eye`).

import { foam,
  abs, add, clamp, cos, sheetOn, cross, distance, div, dot, draw, eq, fan, floor, fract, inFrame, input, keys, lift, lookAt, lt, max, mix,
  mod, mul, normalize, on, pick, place, points, pow, print, scene, sea, select, sin, smoothstep, spacing, step, strand, sub, TAU, through,
  time, vec2, vec3, whirlpool, length, woodblock, beats, dragged, slowInOut, swing, uneven, type Chart, type F, type Frame, type In, type P3,
} from "../../src/index.ts";
import { animate, attack, every, hit, part, telegraph } from "../../src/spacetime/index.ts";
import { landsInside } from "../../src/check.ts";
import { SAIL, scaleShip } from "./lib/scale_ship.ts";
import { impactFoam, impactPaint } from "./lib/impact.ts";
import { PRINT_WARNING } from "./lib/warning.ts";

type Rgb = readonly [number, number, number];

// ==== the numbers an art director changes ===========================================================================

/** Seconds: every rest motion, and the attack, repeats in this time. */
const LOOP = 6;

const POOL = {
  radius: 15,          // whirlpool radius (the coil keeps inside it)
  spin: 0.94,          // radians per second at the centre (0.15 turns per second, as in the game)
  depth: 3.2,          // funnel depth at the centre
  drift: 0.6,          // inward speed at half the radius
  throat: 0.26,        // throat radius as a share of the radius
  arms: 4,             // foam arms
};

const BODY = {
  radius: 1.15,        // half-thickness of the coil
  headRadius: 13.4,    // the spiral starts here (the neck, at the rim)...
  tailRadius: 2.0,     // ...and winds in to here, where the tail dives into the throat
  turns: 1.3,          // turns of the spiral from neck to tail
  start: -1.5,         // bearing of the neck from the centre, radians from +x toward +z
  dip: 1.7,            // how far below the water the body runs between arches
  neckEnd: 0.16,       // the neck rises out of the water from this m up to the head at m = 0
  headHeight: 7.0,     // height of the head above the water
  headIn: 5.4,         // how far the head leans in over the pool from the spiral
  slither: 0.05,       // radians the coil slides along its own path over the loop
  heave: 0.22,         // share each arch rises and falls, in sequence round the coil (pushed from 0.14: it did not read)
  sway: 0.5,           // world units the head sways
};

/** The four arches: centre on the body (m), half-width (m) and apex height above the water. */
const ARCHES = [
  { at: 0.25, half: 0.062, height: 3.9 },
  { at: 0.43, half: 0.064, height: 4.3 },
  { at: 0.61, half: 0.064, height: 3.7 },
  { at: 0.79, half: 0.066, height: 2.9 },
] as const;

const HEAD = {
  size: 1,             // every head measure below is multiplied by this
  length: 5.6,         // back of the skull to the nose tip
  gape: 0.16,          // jaw opening at rest, radians; it breathes by `breath` and works by `chew`
  breath: 0.06,
  chew: 0.025,
  roar: 0.55,          // extra opening at the height of the Coil Lash
  yaw: 0.9,            // radians the head may turn from the neck, sideways and up or down, to hold on its prey
  pitch: 0.35,
  rearTilt: 0.35,      // the snout lifts as the head rears during the lash...
  rear: 2.2,           // ...and the neck rises this far (pushed from 1.6)
  horn: 0.85,          // antler length, as a share of the drawn one
  gill: 3.0,           // longest gill ray
};

/** Coil Lash: which arch, where it falls, and its timing. */
const LASH = {
  arch: 2,             // index into ARCHES
  at: 3.2,             // seconds into each loop when it lands (arms)
  warn: 1.7,           // seconds of warning on the water before
  bearing: 0.2,        // radians the lane turns from straight out of the pool
  length: 7.8,         // capsule length (a to b)
  radius: 4.0,         // capsule radius (the loop's half-width is this less the body's radius: keep it open)
  lean: 0.65,          // radians the reared loop leans back before it falls (the wrong way first; pushed from 0.45)
  height: 0.45,        // height above the water it lands at
  spread: 0.1,         // body m on each side of the arch's centre that rears
  // The rest of the coil answers the lash: the other arches sink as the lashed one draws the slack (wind-up), then the
  // slam's jolt runs out along the body, reaching each arch `ripple` seconds later per arch away, and swings on.
  sink: 0.5, jolt: 0.9, ripple: 0.15,
};

/** Inks: each paint key prints in two inks (in shadow, lit). Paints elsewhere in the file are exactly these keys. */
const INKS = {
  black: { key: [0.05, 0.05, 0.06], shadow: [0.075, 0.07, 0.09], lit: [0.075, 0.07, 0.09] },
  slate: { key: [0.3, 0.33, 0.38], shadow: [0.17, 0.19, 0.24], lit: [0.4, 0.45, 0.5] },
  olive: { key: [0.4, 0.4, 0.2], shadow: [0.24, 0.26, 0.14], lit: [0.5, 0.51, 0.29] },
  cream: { key: [0.92, 0.87, 0.74], shadow: [0.7, 0.66, 0.55], lit: [0.93, 0.88, 0.75] },
  vermilion: { key: [0.85, 0.22, 0.12], shadow: [0.6, 0.15, 0.1], lit: [0.82, 0.25, 0.16] },
  pearl: { key: [0.97, 0.97, 0.95], shadow: [0.66, 0.72, 0.78], lit: [0.98, 0.96, 0.9] },
  wood: { key: [0.45, 0.28, 0.14], shadow: [0.27, 0.16, 0.09], lit: [0.5, 0.33, 0.18] },
  // The scale ship's sailcloth (lib/scale_ship.ts): its hull, trim and ropes are wood, cream and black above.
  sail: SAIL,
} as const satisfies Record<string, { key: Rgb; shadow: Rgb; lit: Rgb }>;

/** How dark the funnel's shading must be (the whirlpool's crest shade, negative) before it prints as the black eye. */
const SEA_EYE = 1.5;

/** The scale ship (lib/scale_ship.ts): at the rim beyond where the lash lands. */
const SHIP = { beyond: 4.2, along: -1.4 };

const K = (k: keyof typeof INKS) => INKS[k].key;
const rgb = (c: Rgb) => vec3(c[0], c[1], c[2]);

// ==== the water =====================================================================================================

const pool = whirlpool({ at: [0, 0], ...POOL });
const water = sea({
  swell: [
    { direction: [1, 0.3], length: 9, height: 0.2, speed: 1.2 },
    { direction: [-0.3, 1], length: 4, height: 0.025, speed: 0.8, phase: 1.3 },
  ],
  deform: [pool], reach: 260, foam: 0.9,
});
const vortex = pool.in(water);

// ==== the coil ======================================================================================================

const W = TAU / LOOP;
const B = BODY;

/** The funnel's dip at radius r (whirlpool.ts's profile), so the arches stand on the water, not on the still level. */
const funnel = (r: F): F => {
  const s = clamp(div(r, POOL.radius), 0, 1);
  const s2 = mul(s, s), q = sub(1, s2);
  return div(mul(mul(mul(q, q), q), POOL.depth), add(1, mul(s2, 1 / (POOL.throat * POOL.throat))));
};

/** Height of the spine above the still water at m: under the water, the neck, four arches, the tail diving. */
function heightAt(m: F): F {
  let y: F = sub(-B.dip, mul(smoothstep(0.86, 1, m), 3.5));
  // A swan's neck: it leaves the water steeply and levels out under the head.
  const neck = pow(sub(1, smoothstep(0, B.neckEnd, m)), 0.5);
  y = add(y, mul(neck, B.headHeight + B.dip));
  // The head rears during the lash (`lash` is declared below; this runs when the body is posed, after it).
  y = add(y, mul(neck, mul(lash.envelope(time).p, HEAD.rear)));
  for (const [k, a] of ARCHES.entries()) {
    const u = clamp(div(sub(m, a.at - a.half), 2 * a.half), 0, 1);
    // Each arch heaves by its own share (no two alike), in sequence round the coil.
    const heave = add(1, mul(mul(sin(sub(mul(time, W), k * 1.6)), B.heave), uneven(k, 0.3)));
    // The other arches answer the lash (`lashAnswer`; zero for the lashed arch itself).
    y = add(y, mul(lashAnswer(k), sub(1, smoothstep(0, 1, abs(sub(mul(clamp(div(sub(m, a.at - a.half), 2 * a.half), 0, 1), 2), 1))))));
    // sin^0.6: the arch leaves the water steeply, like a half-torus, and is round on top.
    y = add(y, mul(mul(heave, a.height + B.dip), pow(max(sin(mul(u, Math.PI)), 0), 0.6)));
  }
  return y;
}

/**
 * How far arch k is lifted (negative: sunk) by the lash at the moment: it sinks through the wind-up as the lashed arch
 * draws the slack, then the slam's jolt reaches it `ripple` seconds per arch away from the lashed one, and it swings.
 */
function lashAnswer(k: number): F {
  const away = Math.abs(k - LASH.arch);
  if (away === 0) return lift<"f32">(0);
  const b = lashBeat(time);
  const sunk = mul(mul(slowInOut(b.anticipate), sub(1, slowInOut(b.settle))), -LASH.sink);
  return add(sunk, swing(dragged(b.after, away, LASH.ripple), LASH.jolt, 1.1, 0.3));
}

/** The spine at rest (attacks apply on top). Head at m = 0. */
function restSpine(m: F): P3 {
  const neck = sub(1, smoothstep(0, B.neckEnd * 1.4, m));
  const angle = add(add(B.start, mul(m, B.turns * TAU)), mul(sin(sub(mul(time, W), mul(m, 2 * TAU))), B.slither));
  // The head leans in over the pool and sways across it.
  const r = sub(sub(mix(B.headRadius, B.tailRadius, m), mul(neck, B.headIn)), mul(mul(neck, neck), mul(sin(mul(time, W)), B.sway)));
  const y = sub(heightAt(m), funnel(r));
  return vec3(mul(r, cos(angle)), y, mul(r, sin(angle)));
}

// ==== the Coil Lash =================================================================================================

const lashArch = ARCHES[LASH.arch];
/** The lane: from the arch's foot out of the pool (turned by `bearing`), measured at rest at time 0. */
const lashAngle = B.start + lashArch.at * B.turns * TAU;
const lashR = B.headRadius + (B.tailRadius - B.headRadius) * lashArch.at;
const laneAngle = lashAngle + LASH.bearing;
const laneA: [number, number] = [lashR * Math.cos(lashAngle), lashR * Math.sin(lashAngle)];
const laneB: [number, number] = [laneA[0] + LASH.length * Math.cos(laneAngle), laneA[1] + LASH.length * Math.sin(laneAngle)];

const lash = attack({
  name: "lash",
  arm: every(LOOP, input("lash.at", "f32", [LASH.at])),
  warn: input("lash.warn", "f32", [LASH.warn]),
  target: { kind: "disc", centre: lift<"vec2">(laneB), radius: lift<"f32">(0.5) },
  part: "coil",
  motion: {
    kind: "rear", hit: hit.capsule({ a: laneA, b: laneB, radius: LASH.radius }),
    from: lashArch.at - LASH.spread, to: lashArch.at + LASH.spread, height: LASH.height, inset: B.radius * 1.25, lean: LASH.lean,
  },
  // Wind-up 1.3 s before a 0.3 s strike (4.3 times as long; it was 1.1 before 0.38).
  timing: { windup: 1.3, strike: 0.3, zeta: 0.55, hold: 0.45, recover: 0.62, travel: 1.6 },
});
/** The lash in three beats on clock t: the wind-up and the strike are the attack's own, then 1.6 s of settle. */
const lashBeat = (t: F) => beats(add(sub(t, lash.armAt(t)), 1.6), { anticipate: 1.3, act: 0.3, settle: 1.6 });
/** Seconds since the slam (negative before). */
const lashAfter = lashBeat(time).after;
/** 0..1: the lashed arch's gland stands open from the slam for a while (the game's exposure window). */
const open = (() => {
  const e = lash.envelope(time);
  return mul(smoothstep(0, 0.15, e.tau), sub(1, smoothstep(1.6, 2.2, e.tau)));
})();

// ==== the wyrm's parts ==============================================================================================

const BODY_LENGTH = 62; // world length of the spine at rest, for patterns in world units (about)

/** 0..1 on each arch's crown: the pearl gland's vermilion socket (paint, no draw of its own). */
function glandAt(m: F, v: F): F {
  let g: F = lift<"f32">(0);
  // An oval: 0.017 of m along (about 1 unit), 0.11 of the way round across.
  for (const a of ARCHES) g = max(g, sub(1, step(1, length(vec2(div(sub(m, a.at), 0.017), div(sub(v, 0.25), 0.11))))));
  return g;
}

/** Body paint: slate back with crescent scales, an olive flank band, cream belly plates; ink lines between. */
function bodyPaint(m: F, v: F): P3 {
  const s = mul(m, BODY_LENGTH), around = mul(v, TAU * B.radius);
  const dorsal = abs(sub(v, 0.25)), ventral = abs(sub(v, 0.75));
  // Crescent scales: rows along, staggered; a line on each row's lower arc.
  const SCALE = 0.75;
  const row = floor(div(s, SCALE));
  const x = fract(add(div(around, SCALE), mul(mod(row, 2), 0.5)));
  const y = fract(div(s, SCALE));
  const arc = abs(sub(distance(vec3(x, mul(y, 1.3), 0), vec3(0.5, 0, 0)), 0.55));
  const scaleLine = sub(1, step(0.075, arc));
  // Belly plates: transverse lines.
  const plate = sub(1, step(0.09, fract(div(s, 0.55))));
  const back = select(lt(dorsal, 0.3), rgb(K("slate")), rgb(K("olive")));
  const belly = lt(ventral, 0.15);
  const skin = select(belly, rgb(K("cream")), back);
  const line = select(belly, plate, scaleLine);
  // A thin black seam where the cream belly meets the flank.
  const seam = mul(step(0.135, ventral), sub(1, step(0.165, ventral)));
  const lined = select(lt(0.5, max(line, seam)), rgb(K("black")), skin);
  return select(lt(0.5, glandAt(m, v)), rgb(K("vermilion")), lined);
}

const girthCurve = keys([[0, 0.78], [0.04, 0.86], [0.14, 0.98], [0.4, 1], [0.75, 0.92], [0.92, 0.6], [1, 0.2]]);
const restAnimated = animate(restSpine, [lash], (spine) => {
  const body = strand({
    name: "wyrm", spine, stations: 120,
    girth: (m) => mul(girthCurve(m).x, B.radius), section: { aspect: 1.0, squareness: 2.2 },
    tips: [{ round: 0.01 }, { point: 0.05 }], level: 1.2, paint: bodyPaint,
    detail: { along: 300, around: 20 },
  });
  return { things: [body], // The part that lands is the loop between the rear's blend ramps (its outer fifth each side stays in the rest
  // posture, under water at the arch's feet); checks measure this stretch.
  parts: { coil: part("coil", body, { from: lashArch.at - 0.6 * LASH.spread, to: lashArch.at + 0.6 * LASH.spread, tip: lashArch.at }) } };
});
const body = restAnimated.parts.coil!.body;

const ridgeProfile = keys([[0, 0], [0.05, 0.55], [0.9, 0.4], [1, 0]]);

/** A low dark fin down the back, along the arches. */
const ridge = sheetOn({
  on: body, from: 0.06, to: 0.9, name: "wyrmRidge",
  height: (x: In<"f32">) => ridgeProfile(x).x,
  paint: K("black"), rays: 90, sag: 0.6, rake: 0.5, rows: 360,
});

// ---- pearl glands: on each arch's crown, one pearl in a vermilion socket (painted on the body) ----------------------
// Three pearls in a row read as a pair of cartoon eyes from every side camera (two visible, white with a black ring);
// one larger pearl reads as a pearl.
const pearl = strand({
  name: "wyrmPearl", spine: (m) => through(m, [[0, -0.42, 0], [0, 0.42, 0]]), stations: 4, girth: 0.45,
  tips: [{ round: 0.5 }, { round: 0.5 }], up: [1, 0, 0], paint: K("pearl"), detail: { along: 10, around: 12 },
});
/** How far the pearl sits out of the skin (rho), and how much it swells while its gland is open. */
const PEARL = { out: 0.86, open: 0.45 };
const pearls = draw.points("wyrmPearls", place(points(ARCHES.length, (k) => ({
  at: vec3(pick(k, ARCHES.map((a) => a.at)), 0.25, PEARL.out),
  // The lashed arch's gland swells open after the slam.
  scale: add(1, mul(select(eq(k, LASH.arch), open, 0), PEARL.open)),
})), body), pearl);

// ==== the ship ======================================================================================================

const shipBearing = laneAngle + SHIP.along / (POOL.radius + SHIP.beyond);
const shipR = Math.hypot(laneB[0], laneB[1]) + SHIP.beyond;
const shipAt: [number, number] = [shipR * Math.cos(shipBearing), shipR * Math.sin(shipBearing)];
const WIND = [0.6, 0.8] as const;
const skiff = scaleShip.afloat(vortex, { at: shipAt, heading: shipBearing + Math.PI / 2, wind: WIND });

// ==== the slam's water ==============================================================================================
// Where the loop lands (src/spacetime/rear.ts): its top `inset` short of the lane's end, its two legs at the loop's
// half-width either side of the lane. The top lands at the arming time; the legs follow down the body.
const laneDir: [number, number] = [Math.cos(laneAngle), Math.sin(laneAngle)];
const laneSide: [number, number] = [-laneDir[1], laneDir[0]];
const loopHalf = LASH.radius - B.radius * 1.25, loopReach = LASH.length - B.radius * 1.25;
const onLane = (along: number, across: number): [number, number] =>
  [laneA[0] + laneDir[0] * along + laneSide[0] * across, laneA[1] + laneDir[1] * along + laneSide[1] * across];
const slamSince = sub(time, lash.arm);
const slam = impactFoam("wyrmSlam", water, {
  area: hit.capsule({ a: laneA, b: laneB, radius: LASH.radius }), pad: 2.5,
  splashes: [
    { at: onLane(loopReach - 0.6 * loopHalf, 0), since: slamSince },
    { at: onLane(0.55 * (loopReach - loopHalf), loopHalf), since: sub(slamSince, 0.12) },
    { at: onLane(0.55 * (loopReach - loopHalf), -loopHalf), since: sub(slamSince, 0.12) },
  ],
  reach: 2.8, seconds: 1.5, foam: INKS.cream.lit, line: INKS.black.lit, paint: impactPaint.ridge(),
});

// ==== the head ======================================================================================================
// Reference: the East Asian dragon as the woodblock printers cut it (Hokusai's and Kuniyoshi's sea dragons), built on
// a crocodile's planes. A broad cheek and a heavy brow ridge shading the eye; a step down in front of the eyes to a
// long flat-topped snout that ends in a nostril bulb; a jaw hinged far back under the eye, so the mouth runs the
// length of the head. The silhouette is the dragon's: antlers swept back off the crown, whiskers trailing from the lip,
// a fan of vermilion gills behind each cheek.
//
// Head coordinates (the `skull` chart): x back toward the neck, y up, z to the side; the snout points along -x. The
// chart is the neck's end frame turned toward what the wyrm watches (the ship at rest, the lash's lane while it
// lashes), within limits, so the head holds on its prey while the neck sways under it, as a snake's does.

/** 0 at rest .. 1: the lash's posture (wind-up through recovery). The head rears, turns to the lane and roars. */
const lashPose = lash.envelope(time).p;
const Y: In<"vec3"> = [0, 1, 0];
const shipTarget = vec3(shipAt[0], 1.2, shipAt[1]);
const laneTarget = vec3((laneA[0] + laneB[0]) / 2, 0, (laneA[1] + laneB[1]) / 2);
const gaze = mix(shipTarget, laneTarget, lashPose);
const UP = lift<"vec3">(Y);
const S = HEAD.size, HL = HEAD.length * HEAD.size;

/** The neck's end frame (body m = 0) turned to face `gaze`, as a rigid chart in head coordinates. */
function skullChart(host: Chart): Chart {
  const c = lift<"vec3">([0, 0.25, 0]);
  const g = host.frame(c);
  const look = lookAt({ from: { o: g.o, x: mul(g.x, -1), y: g.y, z: mul(g.z, -1) }, target: gaze, yaw: HEAD.yaw, pitch: HEAD.pitch });
  // The snout lifts as it rears, then nods down into the slam and swings back up (follow-through of the whole neck).
  const ahead = normalize(add(look.dir, mul(UP, add(mul(lashPose, HEAD.rearTilt), swing(lashAfter, -0.5, 1.5, 0.3)))));
  const x = mul(ahead, -1);
  const y = normalize(sub(UP, mul(ahead, dot(UP, ahead))));
  const f: Frame = { o: g.o, x, y, z: cross(x, y) };
  return { frame: (l) => ({ ...f, o: add(g.o, inFrame(f, l)) }), at: (t) => skullChart(host.atNear(t, c)), atNear: (t) => skullChart(host.atNear(t, c)) };
}
const skull = skullChart(body);

/** x in head coordinates of the skull's station u (0 the back of the skull .. 1 the nose tip). */
const xAt = (u: number) => (0.12 - u) * HL;
/** The skull's profile at six stations (u, top, bottom, half-width), in head units (times HEAD.size). */
const PROFILE = [
  [0, 0.95, -0.85, 1.25],   // occiput, over the neck
  [0.2, 1.02, -0.78, 1.55], // forehead and cheek: the widest (the brows stand above it)
  [0.4, 0.82, -0.62, 1.08], // the stop in front of the eyes
  [0.6, 0.66, -0.56, 0.82], // the snout's flat top
  [0.8, 0.62, -0.52, 0.85],
  [1, 0.5, -0.45, 0.72],    // the nose tip, behind the nostril bulb
] as const;
/** Half-width and aspect along the skull, with the nostril bulb between the last two stations. */
const withBulb = <T,>(rows: (readonly [number, T])[], bulb: T) => [...rows.slice(0, -1), [0.9, bulb] as const, rows[rows.length - 1]!];
const skullW = keys(withBulb(PROFILE.map(([u, , , w]) => [u, w * S] as const), 0.95 * S));
const skullA = keys(withBulb(PROFILE.map(([u, t, b, w]) => [u, (t - b) / 2 / w] as const), 0.61));

/** Skull paint: slate crown and snout top, olive flanks, scutes cut across the snout's top plane, a black mouth. */
function skullPaint(m: F, v: F): P3 {
  const dorsal = abs(sub(v, 0.25)), ventral = abs(sub(v, 0.75));
  const skin = select(lt(dorsal, 0.2), rgb(K("slate")), rgb(K("olive")));
  const scute = mul(mul(step(0.45, m), sub(1, step(0.88, m))), mul(sub(1, step(0.055, abs(sub(fract(mul(m, 7.5)), 0.5)))), sub(1, step(0.13, dorsal))));
  // The cut line round the flank where slate meets olive (a woodblock's line between two inks).
  const seam = mul(step(0.2, dorsal), sub(1, step(0.225, dorsal)));
  const mouth = mul(step(0.16, m), sub(1, step(0.2, ventral)));
  return select(lt(0.5, max(max(scute, seam), mouth)), rgb(K("black")), skin);
}
const head = place(strand({
  name: "wyrmHead", spine: (m) => through(m, PROFILE.map(([u, t, b]) => [xAt(u), ((t + b) / 2) * S, 0] as const)), stations: 16,
  girth: (m) => skullW(m).x, section: { aspect: (m) => skullA(m).x, squareness: 3 },
  tips: [{ round: 0.2 }, { round: 0.1 }], up: Y, paint: skullPaint, detail: { along: 40, around: 24 },
}), skull);

// ---- the jaw: hinged under the eye, it breathes, works and roars --------------------------------------------------
const gape = add(add(HEAD.gape, mul(sin(mul(time, W * 2)), HEAD.breath)),
  add(mul(lashPose, HEAD.roar), mul(mul(sin(mul(time, W * 7)), HEAD.chew), sub(1, lashPose))));
const jawDir = vec3(mul(cos(gape), -1), mul(sin(gape), -1), 0);   // along the jaw, toward the chin
const jawUp = vec3(mul(sin(gape), -1), cos(gape), 0);               // the jaw's inner side
const hinge = vec3(xAt(0.14), -0.4 * S, 0);
const JL = 0.84 * HL;
const jawW = keys([[0, 0.95 * S], [0.25, 1.0 * S], [0.6, 0.72 * S], [1, 0.62 * S]]);
const jawA = keys([[0, 0.53], [0.25, 0.42], [0.6, 0.42], [1, 0.45]]);
/** Jaw paint: inside, a black floor with a vermilion tongue; outside, olive flanks and a cream throat with plates. */
function jawPaint(m: F, v: F): P3 {
  const inside = abs(sub(v, 0.25)), throat = abs(sub(v, 0.75));
  const tongue = mul(mul(step(0.12, m), sub(1, step(0.8, m))), sub(1, step(0.07, inside)));
  const plates = sub(1, step(0.1, fract(mul(m, 9))));
  const outside = select(lt(throat, 0.16), select(lt(0.5, plates), rgb(K("black")), rgb(K("cream"))), rgb(K("olive")));
  const seam = mul(step(0.16, throat), sub(1, step(0.185, throat)));
  const lined = select(lt(0.5, seam), rgb(K("black")), outside);
  return select(lt(inside, 0.2), select(lt(0.5, tongue), rgb(K("vermilion")), rgb(K("black"))), lined);
}
const jaw = place(strand({
  name: "wyrmJaw",
  spine: (m) => through(m, [-0.1, 0.27, 0.63, 1].map((s) => add(add(hinge, mul(jawDir, s * JL)), mul(jawUp, -0.3 * S)))),
  stations: 8, girth: (m) => jawW(m).x, section: { aspect: (m) => jawA(m).x, squareness: 2.6 },
  tips: [{ round: 0.15 }, { round: 0.12 }], up: jawUp, paint: jawPaint, detail: { along: 28, around: 24 },
}), skull);

// ---- teeth: one curved cone, a row along each lip; the fourth from the front is a fang ------------------------------
const tooth = strand({
  name: "wyrmTooth", spine: (m) => through(m, [[0, -0.05, 0], [-0.03, 0.2, 0], [-0.09, 0.42, 0]]), stations: 4,
  girth: 0.1, tips: ["open", { point: 0.85 }], up: [1, 0, 0], paint: K("cream"), detail: { along: 6, around: 8 },
});
const TEETH = 5;
/** A row of teeth on both lips of a strand (body coordinates: v = `edge` +- `spread`, standing out of the skin). */
const teethOn = (name: string, host: Chart, from: number, to: number, edge: number, spread: number, size: number) =>
  draw.points(name, place(points(2 * TEETH, (i) => {
    const j = mod(i, TEETH), side = select(lt(i, TEETH), -1, 1);
    const fang = select(eq(j, TEETH - 2), 2.2, 1);
    return { at: vec3(add(from, mul(j, (to - from) / (TEETH - 1))), add(edge, mul(side, spread)), 0.9), scale: mul(mul(add(0.9, mul(j, 0.08)), fang), size) };
  }), host), tooth);
const teeth = [teethOn("wyrmTeethUp", head, 0.32, 0.9, 0.75, 0.115, 1.05 * S), teethOn("wyrmTeethDown", jaw, 0.32, 0.92, 0.25, 0.13, 0.85 * S)];

// ---- the eyes: under the brow, a vermilion iris with a black slit and a light catch; both watch `gaze` ------------
const EYE = { u: 0.25, y: 0.62, z: 1.22, r: 0.4 };
/** Where the eyes look, in head coordinates: toward the target, drawn a little toward straight ahead. */
const eyeLook = (() => {
  const f = skull.frame(vec3(0, 0, 0));
  const d = normalize(sub(gaze, f.o));
  return normalize(add(vec3(dot(d, f.x), dot(d, f.y), dot(d, f.z)), vec3(-0.6, 0, 0)));
})();
/** Eye paint: on the front cap, a polar position (lateral, vertical) from the pupil's centre. */
function eyePaint(m: F, v: F): P3 {
  const a = mul(sub(1, m), 2.2);
  const lateral = mul(a, cos(mul(v, TAU))), vertical = mul(a, sin(mul(v, TAU)));
  const q = div(vertical, 0.8);
  const slit = lt(abs(lateral), mul(0.085, max(sub(1, mul(q, q)), 0)));
  const catchLight = lt(length(vec2(sub(lateral, 0.2), sub(vertical, 0.3))), 0.13);
  const iris = select(lt(a, 0.9), rgb(K("vermilion")), rgb(K("black")));
  return select(catchLight, rgb(K("pearl")), select(slit, rgb(K("black")), iris));
}
/** One eye a side: its pupil faces out of the head, turned toward the gaze (a reptile looks along its pupil). */
const eyeAt = (side: number) => {
  const axis = normalize(add(mul(eyeLook, 0.9), vec3(0, 0.1, side)));
  return place(strand({
    name: side < 0 ? "wyrmEyeL" : "wyrmEyeR", spine: (m) => through(m, [mul(axis, -0.6 * EYE.r * S), mul(axis, 0.6 * EYE.r * S)]), stations: 4,
    girth: EYE.r * S, tips: [{ round: 0.5 }, { round: 0.5 }], up: Y, paint: eyePaint, detail: { along: 16, around: 16 },
  }), on(skull, [xAt(EYE.u), EYE.y * S, side * EYE.z * S]));
};
const eyes = [eyeAt(-1), eyeAt(1)];

// ---- the brows: one strand from brow to brow, its crossing buried in the skull, so two ridges show (the scowl) ----
const browSide = (s: number) => [
  [xAt(0.13), 1.12 * S, s * 1.05 * S], [xAt(0.25), 1.22 * S, s * 1.3 * S], [xAt(0.37), 1.02 * S, s * 0.95 * S],
] as const;
const browGirth = keys([[0, 0.12 * S], [0.33, 0.26 * S], [0.5, 0.13 * S], [0.67, 0.26 * S], [1, 0.12 * S]]);
const brow = place(strand({
  name: "wyrmBrow", spine: (m) => through(m, [...browSide(-1), [xAt(0.42), 0.45 * S, 0], ...browSide(1).slice().reverse()]),
  stations: 14, girth: (m) => browGirth(m).x, section: { aspect: 0.75 }, tips: [{ round: 0.1 }, { round: 0.1 }], up: Y,
  paint: K("slate"), detail: { along: 40, around: 12 },
}), skull);

// ---- nostrils: a raised boss each side of the nose tip, open forward ---------------------------------------------
const nostril = strand({
  name: "wyrmNostril", spine: (m) => through(m, [[0.35, -0.08, 0], [0, 0, 0], [-0.22, 0.02, 0]]), stations: 4,
  girth: 0.2, section: { aspect: 0.6 }, tips: [{ round: 0.3 }, { round: 0.2 }], up: Y,
  // The opening: a crescent on the top of the front, so it reads as a nostril from above and from the side.
  paint: (m, v) => select(lt(0.5, mul(step(0.72, m), sub(1, step(0.22, abs(sub(v, 0.25)))))), rgb(K("black")), rgb(K("slate"))),
  detail: { along: 10, around: 12 },
});
const nostrils = draw.points("wyrmNostrils", place(points(2, (i) => ({
  at: vec3(xAt(0.9), 0.52 * S, mul(select(lt(i, 0.5), -1, 1), 0.42 * S)), scale: S,
})), skull), nostril);

// ---- antlers: one strand from tip to tip through the crown (its middle hidden in the skull), ringed near the root --
const antlerSide = (s: number) => ([[0.35, 0.85, 0.6], [1.2, 1.75, 0.95], [2.4, 2.3, 1.3], [3.6, 2.4, 1.5], [4.5, 2.95, 1.55]] as const)
  .map(([x, y, z]) => [x * S * HEAD.horn, y * S * HEAD.horn, s * z * S * HEAD.horn] as const);
const antlerGirth = keys([[0, 0.06], [0.2, 0.2], [0.4, 0.34], [0.5, 0.3], [0.6, 0.34], [0.8, 0.2], [1, 0.06]].map(([m, g]) => [m, g * S] as const));
const antlers = place(strand({
  name: "wyrmAntlers", spine: (m) => through(m, [...antlerSide(-1).reverse(), [0.4 * S, 0.5 * S, 0], ...antlerSide(1)]),
  stations: 22, girth: (m) => antlerGirth(m).x, tips: [{ point: 0.05 }, { point: 0.05 }], up: Y,
  paint: (m) => {
    const r = abs(sub(m, 0.5));
    const ring = mul(mul(step(0.1, r), sub(1, step(0.3, r))), sub(1, step(0.16, fract(mul(r, 30)))));
    return select(lt(0.5, ring), rgb(K("black")), rgb(K("cream")));
  },
  detail: { along: 64, around: 10 },
}), skull);

// ---- whiskers: one strand from tip to tip through the snout, trailing back from the lip and drifting -------------
const whiskerSide = (s: number) => [1, 2, 3, 4, 5].map((k) => {
  // They drift, and after the slam they whip: each point further out reads the nod later and swings further.
  const drift = add(mul(sin(sub(mul(time, W * 2), k * 0.9)), 0.08 * k * S), swing(dragged(lashAfter, k, 0.05), 0.22 * k * S, 1.8, 0.25));
  const droop = [0, 0.55, 1.15, 1.5, 1.45, 1.05][k]!;
  return vec3(xAt(0.84) + 0.95 * k * S, add(-droop * S, drift), add(s * (0.85 + 0.42 * k) * S, mul(drift, s)));
});
const whiskerGirth = keys([[0, 0.03], [0.3, 0.08], [0.42, 0.11], [0.58, 0.11], [0.7, 0.08], [1, 0.03]].map(([m, g]) => [m, g * S] as const));
const whiskers = place(strand({
  name: "wyrmWhiskers",
  spine: (m) => through(m, [...whiskerSide(-1).reverse(), vec3(xAt(0.84), 0, 0), ...whiskerSide(1)]),
  stations: 26, girth: (m) => whiskerGirth(m).x, tips: [{ round: 0.02 }, { round: 0.02 }], up: Y, paint: K("cream"),
  detail: { along: 72, around: 8 },
}), skull);

// ---- gills: a fan of five rays behind each cheek, flaring with the breath and wide open in the lash ---------------
// The gills flare with the breath, open in the lash, and snap wider at the slam and shiver shut.
const flare = add(add(add(1, mul(sin(mul(time, W * 2)), 0.15)), mul(lashPose, 0.4)), swing(lashAfter, 0.3, 2.2, 0.35));
const GILL_ANGLES = [1.0, 0.5, 0, -0.5, -0.95], GILL_REACH = [0.7, 0.9, 1, 0.88, 0.62];
const gillRays = (s: number) => GILL_ANGLES.map((a, k) => (r: F | number) => {
  const rr = lift<"f32">(r);
  const root = vec3(0.4 * S, (0.75 - 0.35 * k) * S, s * 1.1 * S);
  const dir = normalize(vec3(0.65, Math.sin(a), s * Math.cos(a)));
  const len = mul(flare, HEAD.gill * S * GILL_REACH[k]);
  // Swept back toward the tips, and rippling.
  const sweep = vec3(mul(mul(rr, rr), mul(len, 0.35)), mul(sin(sub(mul(time, W * 3), k * 1.1)), mul(rr, 0.12 * S)), 0);
  return skull.frame(add(add(root, mul(dir, mul(rr, len))), sweep)).o;
});
/** Gill paint: vermilion membrane, black rays, fine filament lines between them. */
const gillPaint = (u: F, v: F): P3 => {
  const ray = sub(1, step(0.07, abs(sub(fract(add(mul(u, 4), 0.5)), 0.5))));
  const filament = mul(sub(1, step(0.06, abs(sub(fract(mul(u, 16)), 0.5)))), step(0.3, v));
  return select(lt(0.5, max(ray, filament)), rgb(K("black")), rgb(K("vermilion")));
};
const gills = [-1, 1].map((s) => draw.surface(s < 0 ? "wyrmGillL" : "wyrmGillR", fan({ rays: gillRays(s), sag: 0.1, scallop: 0.4, slack: 2.5 }), {
  paint: gillPaint, grid: { u: spacing.even(24), v: spacing.even(5) }, sides: "two", outline: "border",
}));

// ==== the scene =====================================================================================================

export const strikes = restAnimated.strikes;

export default scene({
  ground: water,
  things: [
    ...restAnimated.things, head, jaw, ...teeth, ...eyes, brow, nostrils, antlers, whiskers, ...gills, ridge, pearls,
    telegraph(lash, { style: { ...PRINT_WARNING, spacing: 1.1, edge: 0.2 } }),
    slam, ...skiff,
  ],
  style: woodblock({ print: print.keys(INKS), water: { eye: { kind: "ink", below: -SEA_EYE, amount: 0.85 } }, foam: foam.roll() }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    // Pulled back and aimed past the pool so the head, held high at the far side, clears the top of the frame.
    game: { kind: "perspective", eye: [5, 35, 33], target: [0.5, 0.5, -2.5], fovY: 0.62 },
    three: { kind: "perspective", eye: [-24, 15, 19], target: [-4.5, 1.5, -3], fovY: 0.7 },
    close: { kind: "perspective", eye: [-9.4, 9.6, -0.8], target: [-0.6, 6.9, -8.4], fovY: 0.7 },
    // The face in profile, from the ship's side.
    face: { kind: "perspective", eye: [-4, 8, 3.6], target: [-1.2, 6.9, -8.5], fovY: 0.66 },
    top: { kind: "orthographic", eye: [0, 50, 0.001], target: [0, 0, 0], height: 38 },
  },
});

export const checks = [landsInside(strikes.lash!)];

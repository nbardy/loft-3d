// A crane on a pontoon fishes a crate out of the water, swings it back and flings it; the splash sends a ring across
// the water that carries a rubber duck away. Shows: a grip `attack` holding a thing that ends `thrown` (src/geom/grab.ts),
// the crane slewed and its trolley run out to wherever the grip's palm is (nothing keyed), a `ringWave` started by the
// crate's own touchdown, and who places the floating things (`placedBy`, `STAND_IN`: a game would pass `hosted(pose)`).
// Ground: a calm sea (the harbour is its own water).
//
// Theory, before running. The throw is set by where it lands and how long it flies (`thrown`): from a wind-back at
// (1, 5, -3) to land at (-5, 0.3, 5) in 1.3 s, so it leaves at about 7.5 /s. The ring leaves the crate's 0.5 edge at
// 2.2 /s, 0.35 high, and holds what floats while its crest is above 0.12: out to 0.5 (0.35 / 0.12)^2 = 4.25. The duck
// floats 2.0 from the splash, so it rides 2.25 in about 1.0 s, then coasts 2.2 x 1.2 = 2.64: forced about 4.9 in all.
// Predicted fits: `grab`'s throw and its checks; `ringWave`; `placing`. Predicted fight: the ring checks (`shoves`,
// `frontFirst`) take an attack whose aftermath is a ring, which leaves the attack's own hit disc at its arming time;
// a splash where a thrown thing lands is neither, so it has no attack to check it by.
//
// Scored. The throw fit (`throwLands`: leaves at 6.97 /s, predicted ~7.5; lands 0.000 off), and `ringWave` and
// `placedBy` fit. The duck was forced 4.89, as predicted. The ring checks fought as predicted: they took only an
// attack's ring. Opened: `shoves` and `frontFirst` take a ring of its own (`{ name, wave, first }`). A second half of the
// same fight is not fixed: an attack fits its own aftermath into its period, and nothing fits a ring it did not make,
// so the period here is set by hand. (The grip's `gap` is unused: a hook does not close by size; no harm.)
import {
  add, atan2, cos, every, hold, length, lift, max, mix, mul, placedBy, ringWave, scene, sea, sin, STAND_IN, strand, sub, thrown, time, toon, vec2, vec3,
  type F, type P3,
} from "../../src/index.ts";
import { attack, hit } from "../../src/spacetime/index.ts";
import { frontFirst, shoves, throwLands, tolerance } from "../../src/check.ts";

const CRATE = { at: [3.2, 0.3, 0.6] as const, half: 0.42 }, JIB = { height: 7, length: 6.5 };
// The period covers the splash's ride and coast by hand: an attack fits its own aftermath into its period, but this ring
// is not the attack's, and at 12 s the cycle turned (the duck jumped home) before the coast was done (t = 16.15).
const LAND = [-5, 0.3, 5] as const, PERIOD = 16;

// ---- the grab: reach down, close, carry back to the wind-back place, fling --------------------------------------------
const crane = attack({
  name: "lift", arm: every(PERIOD, 2.5), warn: 1.6,
  target: { kind: "column", centre: lift<"vec2">([CRATE.at[0], CRATE.at[2]]), radius: lift<"f32">(CRATE.half), top: lift<"f32">(CRATE.at[1] + CRATE.half) },
  motion: { kind: "grip", hit: hit.disc({ centre: [CRATE.at[0], CRATE.at[2]], radius: 0.9 }), close: 0.2, release: 1.6, reachLift: 1.5 },
  effect: hold({
    seconds: 3.4, at: CRATE.at, radius: CRATE.half, carry: { kind: "arc", to: [1, 5, -3], lift: 1.5 },
    end: thrown({ land: LAND, flight: 1.3, gravity: 9.8, stroke: 0.45, follow: 0.4, drag: 0.5, heave: { hz: 1.1, damping: 0.3 }, placer: STAND_IN }),
  }),
  timing: { windup: 0.6, strike: 1.4 },
});
const hook = crane.grip([2, 5.5, 0.5]);
// The crane follows the hook: slewed to its bearing, trolley out to its reach, cable straight down to it.
const bearing = atan2(hook.palm.z, hook.palm.x), reach = max(length(vec2(hook.palm.x, hook.palm.z)), 1.2);
const out = vec3(cos(bearing), 0, sin(bearing)), trolley = add(vec3(0, JIB.height, 0), mul(out, reach));
const top = add(hook.palm, vec3(0, CRATE.half + 0.15, 0));

// ---- the splash and its ring; the duck the ring carries -------------------------------------------------------------------
const lands = (t: F) => crane.toss(t).landsAt, LAND_XZ = vec2(LAND[0], LAND[2]);
const splash = ringWave({ centre: LAND_XZ, radius: 0.5, since: (t) => sub(t, lands(lift<"f32">(t))), speed: 2.2, height: 0.35, length: 1.6, reach: 9, hold: 0.12, drag: 1.2 });
const DUCK = add(LAND_XZ, vec2(-1.414, 1.414));
// Who places the duck: Loft's stand-in (the ring's push); a game would give its pose instead (`hosted(pose(...))`).
const duckAt = placedBy<P3>(STAND_IN, {
  standIn: () => { const xz = add(DUCK, splash.pushed(DUCK, time)); return vec3(xz.x, add(splash.lifts(xz, time), 0.1), xz.y); },
  host: (pose) => pose.at,
});

// ---- drawn ------------------------------------------------------------------------------------------------------------------
const bar = (name: string, a: P3, b: P3, r: number, paint: readonly [number, number, number]) =>
  strand({ name, spine: (m) => mix(a, b, m), stations: 4, girth: r, tips: ["round", "round"], paint, detail: { along: 6, around: 10 } });
const yellow = [0.95, 0.72, 0.1] as const;
const box = (name: string, at: P3, half: number, paint: readonly [number, number, number]) => strand({
  name, spine: (m) => add(at, vec3(0, mul(sub(m, 0.5), half * 2), 0)), stations: 4, girth: half, section: { squareness: 6 }, tips: [{ round: 0.08 }, { round: 0.08 }], paint, detail: { along: 4, around: 16 },
});
const things = [
  box("pontoon", vec3(0, -0.2, 0), 1.6, [0.3, 0.3, 0.34]),
  bar("mast", vec3(0, 0, 0), vec3(0, JIB.height + 0.6, 0), 0.22, yellow),
  bar("jib", vec3(0, JIB.height, 0), add(vec3(0, JIB.height, 0), mul(out, JIB.length)), 0.14, yellow),
  bar("counterjib", vec3(0, JIB.height, 0), sub(vec3(0, JIB.height, 0), mul(out, 2)), 0.16, yellow),
  bar("cable", trolley, top, 0.025, [0.1, 0.1, 0.1]),
  box("crate", hook.thing, CRATE.half, [0.6, 0.4, 0.2]),
  bar("duck", duckAt, add(duckAt, vec3(0.25, 0.05, 0)), 0.18, [1, 0.85, 0.1]),
];

export default scene({
  ground: sea({ swell: [], deform: [splash] }), things,
  style: toon({ bands: 3, outline: 0.03 }), sun: [-0.4, 0.75, 0.5], period: PERIOD,
  cameras: { game: { kind: "perspective", eye: [9, 17, 15], target: [-2, 2, 3], fovY: 0.68 } },
});

const splashed = { name: "splash", wave: splash, first: add(crane.first, 3.4 + 1.3) };
export const checks = [
  throwLands(crane, { least: 6, speed: tolerance.share(0.05), place: tolerance.share(0.05) }),
  shoves(splashed, DUCK, { least: 3, speed: tolerance.share(0.05), place: tolerance.share(0.1) }),
  frontFirst(splashed, [DUCK]),
];

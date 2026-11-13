// The Maelstrom (woodblock). A whirlpool drags two ships and a ring of wreckage toward its throat; out of the throat
// rises its guardian, a thick serpent coiled round the vortex's axis like a corkscrew, its neck arching out over the
// funnel wall with the jaw open above the nearer ship. The coil is the vertical accent the flat printed sea lacks;
// the arch and the head are the silhouette seen from the game's high camera.
//
// The serpent is authored in world coordinates (not wound through the whirlpool's chart, which stretches a body into
// a ribbon along the spiral): its spine is a helix whose phase turns slowly with the water and whose neck sways.
import {
  add, cos, draw, floor, mod, mul, place, points, scene, sea, sin, strand, through, time, vec3, whirlpool, woodblock,
  type F, type P3,
} from "../../src/index.ts";
import { ship } from "../recipes/ship.ts";
import { brig, sloop } from "./lib/fleet.ts";
import { wyrm } from "./lib/wyrm.ts";

// ---- named numbers ------------------------------------------------------------------------------------------------
const R = 30;                 // whirlpool radius
const DEPTH = 9;              // funnel depth at the centre
const LOOP = 8;               // seconds: every motion below repeats in this time
const W = (2 * Math.PI) / LOOP;
const WIND = [0.6, 0.8] as const;

const SERPENT = {
  girth: 1.35,                // half-width at the widest: about half a ship's length across
  size: 2.1,                  // head measures relative to examples/serpent.ts
  coilRadius: 3.6,            // the helix round the throat
  coilTurns: 1.5,
  coilTop: 5.5, coilBottom: -13, // the helix runs from here down into the throat
  neckTop: 10.5,              // height of the arch
  reach: 10.5,                 // how far out over the funnel the head is thrust
  bearing: 1.0,              // direction of the head from the axis (radians from +x toward +z)
  sway: 0.25,                 // radians the whole coil rocks with the water over the loop
  nod: 0.6,                   // world units the head bobs
};

const COLOURS = {
  back: [0.1, 0.12, 0.28], belly: [0.95, 0.9, 0.74], band: [0.28, 0.4, 0.72], membrane: [0.88, 0.22, 0.14],
  bone: [0.98, 0.94, 0.82], iris: [0.95, 0.3, 0.1], mouth: [0.85, 0.2, 0.15],
} as const;

// ---- the water ----------------------------------------------------------------------------------------------------
const pool = whirlpool({ at: [0, 0], radius: R, spin: 0.22, depth: DEPTH, drift: 0.5, throat: 0.28, arms: 4 });
const water = sea({
  swell: [
    { direction: [1, 0.3], length: 20, height: 0.5, speed: 2 },
    { direction: [-0.3, 1], length: 8, height: 0.16, speed: 1.2, phase: 1.3 },
  ],
  deform: [pool], reach: 300, foam: 0.45,
});
const vortex = pool.in(water);

// ---- the guardian -------------------------------------------------------------------------------------------------
const S = SERPENT;
/** Rotate a world point about the vertical axis by angle a. */
const turnY = (p: readonly [number, number, number], a: F): P3 =>
  vec3(add(mul(cos(a), p[0]), mul(sin(a), -p[2])), p[1], add(mul(sin(a), p[0]), mul(cos(a), p[2])));
const rock = (lag: number): F => mul(sin(add(mul(time, W), -lag)), S.sway);
const bx = Math.cos(S.bearing), bz = Math.sin(S.bearing);

/** Head end first: the head thrust out over the funnel, the arch, then the coil winding down into the throat. */
const spinePoints: P3[] = (() => {
  const head: [number, number, number] = [S.reach * bx, S.neckTop - 3, S.reach * bz];
  const arch: [number, number, number] = [S.reach * 0.55 * bx - 0.6 * bz, S.neckTop, S.reach * 0.55 * bz + 0.6 * bx];
  const shoulder: [number, number, number] = [0.6 * bx - 1.4 * bz, S.neckTop - 1.5, 0.6 * bz + 1.4 * bx];
  const N = 9;
  const coil = Array.from({ length: N }, (_, i) => {
    const f = i / (N - 1);
    const a = S.bearing + Math.PI * 0.75 + f * S.coilTurns * 2 * Math.PI;
    const r = S.coilRadius * (1 - 0.45 * f);
    return [r * Math.cos(a), S.coilTop + (S.coilBottom - S.coilTop) * f, r * Math.sin(a)] as [number, number, number];
  });
  const tail: [number, number, number] = [0, S.coilBottom - 8, 0];
  const all = [head, arch, shoulder, ...coil, tail];
  return all.map((p, i) => {
    const lag = i * 0.35;
    const q = turnY(p, rock(lag));
    // The head and neck nod on top of the rocking.
    const nod = i < 3 ? mul(sin(add(mul(time, 2 * W), -i * 0.6)), S.nod * (1 - i / 3)) : 0;
    return add(q, vec3(0, nod, 0));
  });
})();

const gape = add(0.35, mul(sin(mul(time, W)), 0.12));
const guardian = wyrm({
  name: "guardian", spine: (m) => through(m, spinePoints), stations: 72, girth: S.girth, size: S.size, gape,
  colours: COLOURS, along: 420, crest: { from: 0.04, to: 0.62, height: 1.6 }, bands: 14,
});

// ---- ships and wreckage, carried by the water ---------------------------------------------------------------------
/** A heading along the flow (counter-clockwise round the centre), turned inward a little, at whirlpool point (x, z). */
const along = (x: number, z: number, inward: number): number => Math.atan2(z, x) + Math.PI / 2 + inward;
const at = (r: number, a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)];
const preyAt = at(14.5, -2.3), farAt = at(16, 1.95);
const ships = [
  ...ship(brig("prey", 6.5)).afloat(vortex, { at: preyAt, heading: along(...preyAt, -0.35), wind: WIND }),
  ...ship(sloop("drifter", 4.6)).afloat(vortex, { at: farAt, heading: along(...farAt, -0.2), wind: WIND }),
];

const barrel = strand({
  name: "barrel", spine: (m) => through(m, [[-0.35, 0, 0], [0.35, 0, 0]]), stations: 4,
  girth: (m) => add(0.25, mul(sin(mul(m, Math.PI)), 0.05)), tips: [{ round: 0.12 }, { round: 0.12 }],
  paint: (m) => vec3(0.55, 0.32, 0.14).mul(add(0.75, mul(floor(mod(mul(m, 6), 2)), 0.25))), detail: { along: 12, around: 12 },
});
const plank = strand({
  name: "plank", spine: (m) => through(m, [[-1.0, 0, 0], [1.0, 0, 0]]), stations: 4, girth: 0.16,
  section: { aspect: 0.25, squareness: 5 }, tips: "open", paint: [0.66, 0.5, 0.3], detail: { along: 4, around: 12 },
});
const spar = strand({
  name: "spar", spine: (m) => through(m, [[-2.4, 0, 0], [0, 0.05, 0.1], [2.4, 0, 0]]), stations: 4, girth: 0.14,
  tips: ["open", { point: 0.3 }], paint: [0.42, 0.28, 0.16], detail: { along: 12, around: 8 },
});
/** n things scattered round radius r0..r1, each half awash, turned by a hash of its index. */
const scatter = (n: number, r0: number, r1: number, seed: number, awash: number) => points(n, (i: F) => {
  const a = add(mul(i, 2.39996), seed), r = add(r0, mul(mod(mul(i, 0.618034), 1), r1 - r0));
  return { at: vec3(mul(r, cos(a)), awash, mul(r, sin(a))), scale: add(0.8, mul(mod(mul(i, 0.37), 1), 0.5)) };
});
const wreckage = [
  draw.points("barrels", place(scatter(16, 6, 21, 0.3, -0.1), vortex), barrel),
  draw.points("planks", place(scatter(14, 7, 22, 1.9, 0.02), vortex), plank),
  draw.points("spars", place(scatter(4, 9, 20, 4.1, 0.0), vortex), spar),
];

// ---- the scene ----------------------------------------------------------------------------------------------------
export default scene({
  ground: water,
  things: [...guardian.things, ...ships, ...wreckage],
  style: woodblock(),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    game: { kind: "perspective", eye: [-32, 34, 2], target: [3, 1, 5], fovY: 0.66 },
    hero: { kind: "perspective", eye: [29, 6, -10], target: [2, 4.5, 5], fovY: 0.8 },
    close: { kind: "perspective", eye: [11, 16, 30], target: [5, 4, 9], fovY: 0.55 },
  },
});

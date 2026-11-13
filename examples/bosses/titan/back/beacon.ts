// The beacon: a whole lighthouse grown into its rock (docs/art_direction/DIRECTION.md, Round 5; the pictures are
// docs/art_direction/crab_round4/growth/lighthouse_base.webp and lighthouse_turnaround.webp). A stout brick tower
// leaning out along a point, its lower third a crust of barnacle and kelp down to a ragged tide line, a gallery, an
// intact lantern room under a black roof with two shutters, gulls. It rides the shell frame; the gallery and the gulls
// are the fiddler's (back/lighthouse.ts).
//
// It is built to be moved later (the lighthouse wakes: crab_round4/reveal/). Three of its numbers are the structure an
// attack will drive, and each may be given as a number or as an expression of the clock; nothing here animates them:
// - `lean`: the tangent of the tower's angle out along the point. 0 stands it upright.
// - `rise`: how far the tower has come up out of its mound, on a segmented neck. At the number 0 the neck is not built.
// - `shutters`: 0 shut (two boards hanging over the lantern's glass on either side), 1 flung open like wings.

import {
  abs, add, cos, cross, fract, lift, max, min, mix, mul, normalize, place, polyline, pow, rigid, saturate, sin, smoothstep, strand, sub, swing, alive, time, vec3,
  type Drawable, type F, type In, type P3,
} from "../../../../src/index.ts";
import { cut, TAU, type V3 } from "../ink.ts";
import type { Rig } from "../rig.ts";
import { galleryRound, gullsRound, mortar } from "./lighthouse.ts";

export type Beacon = {
  /** Where the tower's axis leaves the mound (crab coordinates, riding the shell frame). */
  readonly foot: V3;
  /** The way the point runs out: a level unit direction (crab x, z). The tower leans along it and rocks along it. */
  readonly out: readonly [number, number];
  readonly height: number;
  /** The tower's girth at its foot and under the gallery. */
  readonly girth: readonly [number, number];
  /** The share of the tower, from the foot, that is crust. */
  readonly crust: number;
  /** The lantern room, gallery and gulls against the fiddler's. */
  readonly size: number;
  readonly gulls: number;
  readonly lean: In<"f32">;
  readonly rise: In<"f32">;
  readonly shutters: In<"f32">;
};

/** The neck, classified once from `rise`: down in the mound (nothing to draw), or risen by an amount. */
type Neck = { readonly kind: "down" } | { readonly kind: "risen"; readonly by: F };
const neckOf = (rise: In<"f32">): Neck => (rise === 0 ? { kind: "down" } : { kind: "risen", by: lift<"f32">(rise) });

export function beaconOn({ n, shell, crushAfter }: Pick<Rig, "n" | "shell" | "crushAfter">, B: Beacon): Drawable[] {
  const I = n.ink, k = B.size, H = B.height, [g0, g1] = B.girth;
  const ink = (c: V3): P3 => vec3(...c);
  // The tower rocks along its point after the slam (a beat after the shell) and never stands quite still. It turns about
  // its foot, so the crust at the foot (copies in the back's list, which do not rock) stays within 0.05 of it.
  const rock = add(swing(sub(crushAfter, 0.15), 0.1, 0.75, 0.2), alive(time, 0.012, 51));
  const along = vec3(B.out[0], 0, B.out[1]), lean = add(B.lean, rock);
  const dir = normalize(add(vec3(0, 1, 0), mul(along, lean)));
  /** Across the lean, level; and the hinge line of the shutters (in the lean's plane, square to the tower). */
  const side = normalize(cross(dir, along)), hinge = normalize(cross(side, dir));
  const neck = neckOf(B.rise);
  const base: P3 = (() => {
    switch (neck.kind) {
      case "down": return vec3(...B.foot);
      case "risen": return add(vec3(...B.foot), mul(dir, neck.by));
    }
  })();
  const at = (m: number | F): P3 => add(base, mul(dir, mul(H, m)));

  // The tower. Brick above; below a ragged tide line, crust: cream with barnacle rings and craters, kelp hanging from
  // the line. Its foot flares, so the crust has a thickness and runs into the mound.
  const tower = place(strand({
    name: "beacon", spine: (m) => at(m), stations: 6, tips: [{ round: 0.05 }, "open"], up: [1, 0, 0],
    girth: (m) => add(mix(g0, g1, m), mul(0.13 * g0, sub(1, smoothstep(0, B.crust, m)))),
    paint: (m, v) => {
      const turn = mul(v, TAU);
      const tide = add(B.crust, add(mul(sin(add(mul(turn, 3), 1)), 0.045), mul(sin(mul(turn, 7)), 0.028)));
      // Brick red with pale mortar; a cream band under the gallery; two black windows up the seaward side.
      const brick = mix(ink(I.accent), ink(I.cream), mul(mortar(m, v, 12, 8), 0.8));
      const band = mul(cut(m, 0.84), sub(1, cut(m, 0.9)));
      const win = mul(sub(1, cut(abs(sub(v, 0.3)), 0.03)), mul(cut(abs(sub(fract(mul(m, 3)), 0.5)), 0.36), mul(cut(m, 0.4), sub(1, cut(m, 0.84)))));
      const clean = mix(mix(brick, ink(I.cream), band), ink(I.black), win);
      // Crust: a lattice of barnacles, each a stone ring with a dark crater.
      const cell = mul(sin(mul(m, 52)), sin(add(mul(turn, 7), mul(m, 9))));
      const crust = mix(mix(ink(I.cream), ink(I.stone), cut(cell, 0.3)), ink(I.bark), cut(cell, 0.78));
      // Kelp: tongues of unequal length hanging from the tide line.
      const tongue = mul(add(0.05, mul(add(1, sin(add(mul(turn, 5), 2))), 0.05)), cut(sin(add(mul(turn, 9), mul(sin(mul(turn, 2)), 1.3))), 0.25));
      const kelp = mul(cut(m, sub(tide, tongue)), sub(1, cut(m, tide)));
      const line = sub(1, cut(abs(sub(m, tide)), 0.006));
      return mix(mix(mix(crust, ink(I.kelp), kelp), clean, cut(m, tide)), ink(I.black), line);
    },
    // (20 by 20: the brick and the crust are paint; at 40 by 28 the tower was four times the headland's light.)
    detail: { along: 20, around: 20 },
  }), rigid(shell));

  // The lantern room: a sill, glass in black mullions, a black roof swelling over the eaves and drawn up to a finial.
  const LANTERN = 1.5 * k, GLASS = 0.5, glassR = 0.5 * k;
  const profile = (m: F): F => {
    const roof = saturate(sub(mul(m, 1 / (1 - GLASS)), GLASS / (1 - GLASS)));
    // Glass: a drum. Roof: a dome out over the eaves, drawn up to a stalk with a ball on it.
    const dome = pow(max(cos(mul(min(mul(roof, 1.3), 1), Math.PI / 2)), 1e-5), 0.7);
    const ball = mul(0.2, max(sub(1, mul(abs(sub(roof, 0.88)), 9)), 0));
    // (A smoothstep, not `cut`: an ink edge is a screen derivative and exists only in paint.)
    return mix(glassR, mul(glassR * 1.25, max(dome, add(0.06, ball))), smoothstep(GLASS - 0.012, GLASS + 0.012, m));
  };
  const lanternFoot = at(0.985);
  const lantern = place(strand({
    name: "lantern", spine: (m) => add(lanternFoot, mul(dir, mul(m, LANTERN))), stations: 4, girth: profile, tips: [{ round: 0.05 }, { round: 0.5 }], up: [1, 0, 0],
    paint: (m, v) => {
      const glass = mix(ink(I.cream), ink(I.black), sub(1, cut(abs(sub(fract(mul(v, 8)), 0.5)), 0.09)));
      const sill = sub(1, cut(m, 0.07));
      // The roof: black, with pale ribs from the finial to the eaves and a pale ball (from above a black roof is a disc).
      const ribbed = mul(sub(1, cut(abs(sub(fract(mul(v, 8)), 0.5)), 0.06)), mul(cut(m, GLASS + 0.02), sub(1, cut(m, GLASS + 0.36))));
      return mix(mix(glass, ink(I.black), max(sill, cut(m, GLASS - 0.03))), ink(I.stone), max(ribbed, cut(m, GLASS + 0.4)));
    },
    detail: { along: 14, around: 18 },
  }), rigid(shell));

  // The shutters: one strand, a board hinged under the eaves on either side of the lantern, joined through the roof
  // where it cannot be seen. Shut, each hangs over the glass; open, it swings out and up about its hinge (1.9 rad at 1).
  const swingBy = mul(B.shutters, 1.9), eaves = add(lanternFoot, mul(dir, LANTERN * GLASS)), board = LANTERN * GLASS * 0.92;
  const hingeAt = (s: 1 | -1): P3 => add(eaves, mul(side, s * (glassR + 0.05 * k)));
  const tipAt = (s: 1 | -1): P3 => add(hingeAt(s), mul(add(mul(dir, mul(cos(swingBy), -1)), mul(side, mul(sin(swingBy), s))), board));
  const KNOTS = [0, 0.36, 0.5, 0.64, 1];
  const onBoard = (m: F): F => smoothstep(0.135, 0.15, abs(sub(m, 0.5)));
  const shutters = place(strand({
    name: "shutters", spine: (m) => polyline(m, [tipAt(-1), hingeAt(-1), eaves, hingeAt(1), tipAt(1)], KNOTS.map((x) => lift<"f32">(x))), stations: 9,
    // A board is thin through and wide along the hinge line (`up`): girth is its half-thickness, the aspect its width.
    girth: (m) => mix(0.02 * k, 0.045 * k, onBoard(m)), section: { aspect: (m) => mix(1, 7.5, onBoard(m)), squareness: 5 }, tips: ["round", "round"], up: hinge,
    // Dark boards with pale slats across them.
    paint: (m) => mix(ink(I.bark), ink(I.stone), mul(sub(1, cut(abs(sub(fract(mul(min(m, sub(1, m)), 14)), 0.5)), 0.2)), 0.8)),
    detail: { along: 24, around: 8 },
  }), rigid(shell));

  const gallery = galleryRound({ n, shell }, at(0.93), g1 + 0.2 * k, 0.6 * k);
  const gulls = gullsRound({ n, shell, crushAfter }, add(lanternFoot, mul(dir, LANTERN)), k * 0.62, B.gulls);

  // The neck: barnacled drums, one on another, from the mound up to the tower's foot. Only a risen tower has one.
  const neckDrawn: Drawable[] = (() => {
    switch (neck.kind) {
      case "down": return [];
      case "risen": return [place(strand({
        name: "beaconNeck", spine: (m) => add(vec3(...B.foot), mul(dir, mul(neck.by, m))), stations: 6, tips: [{ round: 0.05 }, { round: 0.05 }], up: [1, 0, 0],
        // Drums: the girth pinches between segments (five to the neck).
        girth: (m) => mul(g0 * 1.12, sub(1, mul(0.16, smoothstep(0.3, 0.5, abs(sub(fract(mul(m, 5)), 0.5)))))),
        paint: (m, v) => {
          const cell = mul(sin(mul(m, 40)), sin(mul(v, TAU * 6)));
          const joint = cut(abs(sub(fract(mul(m, 5)), 0.5)), 0.44);
          return mix(mix(mix(ink(I.cream), ink(I.stone), cut(cell, 0.3)), ink(I.bark), cut(cell, 0.78)), ink(I.black), joint);
        },
        detail: { along: 30, around: 24 },
      }), rigid(shell))];
    }
  })();

  return [tower, gallery, lantern, shutters, ...gulls, ...neckDrawn];
}

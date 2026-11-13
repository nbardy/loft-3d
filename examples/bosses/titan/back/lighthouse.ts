// A lighthouse: the fiddler's back. One ruined lighthouse leaning back off the pebble, on a low dark rock, its lantern
// broken open; gulls wheel round its top. It rides the shell frame (the body read late, pitching on after the slam),
// and the tower rocks on its rock a beat later still, so from the slam the body thuds, the shell follows, the tower
// sways, and the gulls scatter out and drift back.
//
// The light itself (tower, gallery, lantern, gulls) is `lightOn`: any back may stand one somewhere (back/headland.ts
// stands a smaller one on its point). The fiddler's is `TOWER`.

import {
  abs, add, alive, cos, floor, fract, max, mix, mul, normalize, place, rigid, sin, smoothstep, strand, sub, swing, through, time, vec3, type Drawable, type F, type P3,
} from "../../../../src/index.ts";
import { cut, TAU, type V3 } from "../ink.ts";
import type { Rig } from "../rig.ts";
import type { BackOption } from "../slots.ts";

/** Brickwork's mortar over a tower's (m, v): 1 on a course line or a joint (joints 0.7), the joints of each course
 * offset by half a brick from the next. */
export const mortar = (m: F, v: F, courses: number, round: number): F => {
  const course = sub(1, cut(abs(sub(fract(mul(m, courses)), 0.5)), 0.06));
  const joint = mul(sub(1, cut(abs(sub(fract(add(mul(v, round), mul(floor(mul(m, courses)), 0.5))), 0.5)), 0.06)), 0.7);
  return max(course, joint);
};

/** The gallery round a light's top: a cream ring with black rails, level, `radius` out from `top` (crab coordinates,
 * riding the shell frame); `k` is its size against the fiddler's. */
export function galleryRound({ n, shell }: Pick<Rig, "n" | "shell">, top: P3, radius: number, k: number): Drawable {
  const I = n.ink;
  return place(strand({
    name: "gallery", spine: (m) => add(top, vec3(mul(cos(mul(m, TAU)), radius), 0, mul(sin(mul(m, TAU)), radius))), stations: 12, girth: 0.13 * k,
    section: { aspect: 1.6 }, tips: ["round", "round"], up: [0, 1, 0],
    paint: (m) => mix(vec3(...I.cream), vec3(...I.black), cut(abs(sub(fract(mul(m, 18)), 0.5)), 0.38)),
    detail: { along: 48, around: 8 },
  }), rigid(shell));
}

/** Gulls wheeling round `top` (crab coordinates, riding the shell frame): `count` of them, their circles `k` times the fiddler's. */
export function gullsRound({ n, shell, crushAfter }: Pick<Rig, "n" | "shell" | "crushAfter">, top: P3, k: number, count: number): Drawable[] {
  const I = n.ink;
  // Gulls: cream Vs with black tips, wheeling round the top at their own heights and rates; they flap. At the slam they
  // scatter outward and drift back over four seconds.
  const scatter = mul(smoothstep(0, 0.5, crushAfter), sub(1, smoothstep(1.5, 4.5, crushAfter)));
  const gulls = Array.from({ length: count }, (_, i) => {
    const turn = add(mul(time, i % 2 === 0 ? 0.42 : -0.33), i * 1.3);
    const rho = add((2.2 + 0.55 * i) * k, mul(scatter, (2.5 + 0.4 * i) * k));
    const centre = add(top, vec3(0, (0.9 + 0.45 * i) * k, 0));
    const body = add(add(centre, vec3(mul(cos(turn), rho), mul(sin(add(mul(time, 0.7), i)), 0.35 * k), mul(sin(turn), rho))), vec3(0, mul(scatter, 1.2 * k), 0));
    const radial = vec3(cos(turn), 0, sin(turn));
    const flap = sin(add(mul(time, 6.5 + 0.7 * i), i * 2.1));
    const tipUp = vec3(0, add(0.18 * k, mul(flap, 0.26 * k)), 0);
    return place(strand({
      name: `gull${i}`, spine: (m) => through(m, [add(add(body, mul(radial, -0.55 * k)), tipUp), add(body, mul(radial, -0.2 * k)), body, add(body, mul(radial, 0.2 * k)), add(add(body, mul(radial, 0.55 * k)), tipUp)]),
      stations: 5, girth: (m) => mul(0.085 * k, sub(1, mul(abs(sub(mul(m, 2), 1)), 0.55))), tips: [{ point: 0.2 }, { point: 0.2 }], up: [0, 1, 0],
      paint: (m) => mix(vec3(...I.cream), vec3(...I.black), cut(abs(sub(mul(m, 2), 1)), 0.72)),
      detail: { along: 12, around: 6 },
    }), rigid(shell));
  });
  return gulls;
}

/**
 * A light: its foot (crab coordinates, riding the shell frame), the tower's height, its girth at the foot and the top,
 * its lean (a direction, y up), `size` (the gallery, the lantern and the gulls' circles, as a share of the fiddler's)
 * and how many gulls wheel round it.
 */
export type Light = { readonly foot: V3; readonly height: number; readonly girth: readonly [number, number]; readonly lean: V3; readonly size: number; readonly gulls: number };

/** The fiddler's tower: its foot on the rock. */
const TOWER: Light = { foot: [-0.9, 1.55, -0.7], height: 6.4, girth: [1.05, 0.72], lean: [-0.26, 1, -0.2], size: 1, gulls: 5 };

/** A ruined lighthouse standing at `L.foot` on the shell: the tower, its gallery, its broken lantern, its gulls. */
export function lightOn({ n, shell, crushAfter }: Pick<Rig, "n" | "shell" | "crushAfter">, L: Light): Drawable[] {
  const I = n.ink, k = L.size;
  // The tower rocks on its rock after the slam (a beat after the shell), and never stands quite still.
  const rockBy = add(swing(sub(crushAfter, 0.15), 0.14, 0.75, 0.2), alive(time, 0.015, 51));
  const [lx, ly, lz] = L.lean;
  const dir = normalize(vec3(add(lx, rockBy), ly, add(lz, mul(rockBy, 0.4))));
  const foot = vec3(...L.foot), H = L.height, [g0, g1] = L.girth;
  const at = (m: number | F): P3 => add(foot, mul(dir, mul(H, m)));
  const tower = place(strand({
    name: "lighthouse", spine: (m) => at(m), stations: 6, girth: (m) => mix(g0, g1, m), tips: [{ round: 0.05 }, "open"], up: [1, 0, 0],
    paint: (m, v) => {
      // Salmon brick in courses, offset joints; a cream band below the gallery; three black windows up one side.
      const brick = mix(vec3(...I.coral), vec3(...I.accent), mul(mortar(m, v, 16, 10), 0.75));
      const band = mul(cut(m, 0.74), sub(1, cut(m, 0.8)));
      const win = mul(sub(1, cut(abs(sub(v, 0.3)), 0.025)), cut(abs(sub(fract(mul(m, 4)), 0.5)), 0.38));
      return mix(mix(brick, vec3(...I.cream), band), vec3(...I.black), mul(win, sub(1, cut(m, 0.86))));
    },
    detail: { along: 40, around: 28 },
  }), rigid(shell));
  // The gallery round its top: a cream ring with black rails.
  const gallery = galleryRound({ n, shell }, at(0.9), g1 + 0.32 * k, k);
  // The lantern, broken: a black cage stub, open, its cream glass mostly gone.
  const lantern = place(strand({
    name: "lantern", spine: (m) => add(at(1), mul(dir, mul(m, 1.0 * k))), stations: 4, girth: (m) => mix(0.56 * k, 0.5 * k, m), tips: [{ round: 0.05 }, "open"], up: [1, 0, 0],
    paint: (m, v) => mix(vec3(...I.black), vec3(...I.cream), mul(cut(abs(sub(fract(mul(v, 6)), 0.5)), 0.32), mul(cut(m, 0.2), sub(1, cut(m, 0.75))))),
    detail: { along: 8, around: 24 },
  }), rigid(shell));

  const gulls = gullsRound({ n, shell, crushAfter }, at(1), k, L.gulls);
  return [tower, gallery, lantern, ...gulls];
}

export const lighthouse: BackOption = {
  about: "a leaning ruined lighthouse on a dark rock, gulls wheeling round it",
  draw: (rig) => {
    const { n, shell } = rig;
    const I = n.ink;
    const rock = place(strand({
      name: "rock", spine: (m) => mix(vec3(-2.6, 1.15, -0.5), vec3(0.9, 1.35, -0.3), m), stations: 5, girth: (m) => mul(1.9, add(0.75, mul(sin(mul(m, Math.PI)), 0.25))),
      section: { aspect: 0.42, squareness: 1.7 }, tips: [{ round: 0.5 }, { round: 0.5 }], up: [0, 1, 0],
      // Dark stone with pale strata.
      paint: (m, v) => mix(vec3(...I.bark), vec3(...I.stone), sub(1, cut(abs(sin(add(mul(v, 21), mul(m, 5)))), 0.12))),
      detail: { along: 20, around: 24 },
    }), rigid(shell));
    return [rock, ...lightOn(rig, TOWER)];
  },
};

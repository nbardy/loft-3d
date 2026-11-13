// A shrine on the back: the spider crab's one warm accent. A small red pavilion set on a dark deck on top of the thorny
// ball: four vermilion posts, paper walls lit from inside behind a red lattice, black lintels with upturned ends, a
// black hip roof whose eaves sweep up, a finial; a black staff at the back corner with a paper lantern on its arm; and
// four red lanterns hanging from the eave corners.
//
// It rides the shell frame (`rig.shell`: the body's, read late, pitching on after the slam). The lanterns hang on their
// own swings: they trail the body's sway, jolt at every foot's plant (each plant pushes them away from that foot) and
// swing on after Claw Crush's slam.

import {
  abs, add, cross, draw, fract, lift, max, mix, mul, pick, place, posed, rigid, sin, smoothstep, strand, sub, swing, through, time, turn, unit, vec3, alive, size,
  type F, type P3, type Strand,
} from "../../../../src/index.ts";
import { rotate } from "../../../../src/map/chart.ts";
import { stepClock } from "../legs/stilt.ts";
import { cut, perFrame, sides, type V3 } from "../ink.ts";
import type { BackOption } from "../slots.ts";

/** The pavilion's centre on the body (crab x), the deck's height, the posts' half-spacing and height. */
const X0 = -0.45, DECK = 1.9, HALF = 1.05, POST_TOP = 4.65;

export const shrine: BackOption = {
  about: "a red shrine pavilion with a black upswept roof and swinging lanterns",
  draw: (rig) => {
    const { n, shell, crushAfter } = rig;
    const I = n.ink;
    const on = (thing: Strand): Strand => place(thing, rigid(shell));
    const inShell = (p: V3 | P3): P3 => add(shell.o, rotate(shell, lift<"vec3">(p)));
    const red = vec3(...I.shrine), black = vec3(...I.black);

    const deck = on(strand({
      name: "shrineDeck", spine: (m) => vec3(mix(X0 - 1.55, X0 + 1.55, m), DECK, 0), stations: 4, girth: 1.5,
      section: { aspect: 0.1, squareness: 8 }, tips: [{ round: 0.03 }, { round: 0.03 }], up: [0, 1, 0],
      paint: (m) => mix(vec3(...I.shrineDark), black, sub(1, cut(sin(mul(m, 40)), -0.85))),
      detail: { along: 16, around: 24 },
    }));
    const post = (k: number, x: number, z: number) => on(strand({
      name: `shrinePost${k}`, spine: (m) => vec3(X0 + x, mix(DECK - 0.1, POST_TOP, m), z), stations: 4, girth: 0.12,
      section: { squareness: 4 }, tips: [{ round: 0.05 }, { round: 0.05 }], up: [1, 0, 0],
      paint: (m) => mix(red, black, cut(m, 0.96)), detail: { along: 6, around: 8 },
    }));
    const posts = [post(0, -HALF, -HALF), post(1, -HALF, HALF), post(2, HALF, -HALF), post(3, HALF, HALF)];
    // Paper walls lit from inside, behind a red lattice (three panes a side, a cross bar).
    const walls = on(strand({
      name: "shrineWalls", spine: (m) => vec3(X0, mix(DECK + 0.15, POST_TOP - 0.6, m), 0), stations: 4, girth: 0.93,
      section: { aspect: 1, squareness: 10 }, tips: [{ round: 0.02 }, { round: 0.02 }], up: [1, 0, 0],
      paint: (m, v) => {
        // Thin red lines where the pane coordinates wrap: twelve panes round, two high.
        const mull = cut(abs(sub(fract(mul(v, 12)), 0.5)), 0.43);
        const bar = cut(abs(sub(fract(mul(m, 2)), 0.5)), 0.45);
        return mix(vec3(...I.paper), red, max(mull, bar));
      },
      detail: { along: 12, around: 48 },
    }));
    // The tie beams (red) and the lintels (black, ends swept up), front and back.
    const beam = (k: number, x: number) => on(strand({
      name: `shrineTie${k}`, spine: (m) => vec3(X0 + x, POST_TOP - 0.5, mix(-1.35, 1.35, m)), stations: 4, girth: 0.08,
      section: { aspect: 1.4, squareness: 4 }, tips: [{ round: 0.03 }, { round: 0.03 }], up: [0, 1, 0], paint: () => red, detail: { along: 6, around: 8 },
    }));
    const lintel = (k: number, x: number) => on(strand({
      name: `shrineLintel${k}`, spine: (m) => through(m, [[X0 + x, POST_TOP + 0.32, -1.95], [X0 + x, POST_TOP + 0.08, -1.0], [X0 + x, POST_TOP + 0.02, 0], [X0 + x, POST_TOP + 0.08, 1.0], [X0 + x, POST_TOP + 0.32, 1.95]]),
      stations: 8, girth: 0.13, section: { aspect: 1.3, squareness: 3 },
      tips: [{ round: 0.03 }, { round: 0.03 }], up: [0, 1, 0],
      paint: (_m, v) => mix(black, red, cut(sin(mul(v, Math.PI * 2)), 0.6)), detail: { along: 16, around: 10 },
    }));
    // The roof: a hip roof whose sides are concave (girth falls as (1 - m)^1.7), so the eaves sweep out and up.
    const roof = on(strand({
      name: "shrineRoof", spine: (m) => vec3(X0, mix(POST_TOP + 0.3, POST_TOP + 1.75, m), 0), stations: 8,
      girth: (m) => add(mul(1.95, mul(sub(1, m), sub(1, mul(m, 0.75)))), 0.04), section: { aspect: 1.06, squareness: 3.2 },
      tips: [{ round: 0.02 }, { point: 0.08 }], up: [1, 0, 0],
      // Black, with dark-red rafter lines running up it and a red eave edge.
      paint: (m, v) => mix(mix(black, vec3(...I.shrineDark), mul(sub(1, cut(sin(mul(v, 80)), -0.75)), cut(m, 0.08))), red, sub(1, cut(m, 0.07))),
      detail: { along: 20, around: 32 },
    }));
    const finial = on(strand({
      name: "shrineFinial", spine: (m) => vec3(X0, mix(POST_TOP + 1.6, POST_TOP + 2.5, m), 0), stations: 4,
      girth: (m) => add(0.05, mul(smoothstep(0.7, 0.85, m), mul(smoothstep(1, 0.85, m), 0.12))), tips: ["round", "round"],
      paint: (m) => mix(black, red, cut(m, 0.7)), detail: { along: 10, around: 8 },
    }));
    // The staff at the back corner, leaning back a little, with an arm the paper lantern hangs from.
    const STAFF_FOOT: V3 = [X0 - 1.35, DECK, 1.35], STAFF_TOP: V3 = [X0 - 1.75, DECK + 6.3, 1.55], ARM_END: V3 = [X0 - 1.0, DECK + 6.25, 1.55];
    const staff = on(strand({
      name: "shrineStaff", spine: (m) => through(m, [STAFF_FOOT, STAFF_TOP, ARM_END]), stations: 6, girth: 0.06, tips: ["round", "round"],
      paint: () => black, detail: { along: 16, around: 6 },
    }));

    // ---- the lanterns' swing (one per frame, read by every lantern) ----
    // The body's sway is n.sway sin(w t) across the crab; the lanterns trail it by a third of a second.
    const w = (2 * Math.PI) / n.period;
    const lag = (t: number) => sin(mul(add(time, -t), w));
    // Each plant kicks the lanterns away from that foot (its bearing on the body), ringing down over a second or two.
    const kicks = sides.flatMap((s, si) => n.legFeet.map(([fx, fz], i) => {
      const a = Math.atan2(s * fz, fx);
      const ring = swing(stepClock(rig, si * 4 + i).sincePlant, 0.075, 0.9, 0.12);
      return [mul(ring, -Math.cos(a)), mul(ring, -Math.sin(a))] as const;
    }));
    const sumOf = (j: 0 | 1): F => kicks.reduce<F>((acc, kk) => add(acc, kk[j]), lift<"f32">(0));
    // Fore and aft (along the crab's x) and across (its z): the plants, the sway, and the slam (thrown forward, swinging on).
    const ex = perFrame("shrine_swing_x", add(sumOf(0), swing(sub(crushAfter, 0.15), 0.5, 0.7, 0.1)));
    const ez = perFrame("shrine_swing_z", add(sumOf(1), mul(lag(0.35), n.sway * 0.5)));

    /** A lantern hung at a point of the shell, swinging: its cord along the swung down direction. */
    const hung = (hook: P3, seed: F | number) => {
      const dx = add(ex, alive(time, 0.05, seed)), dz = add(ez, alive(time, 0.05, add(seed, 7)));
      const up = unit(sub(shell.y, add(mul(shell.x, dx), mul(shell.z, dz))));
      return { at: inShell(hook), turn: turn.axes(unit(cross(up, shell.z)), up), size: size.even(1) };
    };
    // One lantern shape: a cord, then a round paper body with black caps and ribs, hanging down from its hook.
    const lantern = (name: string, body: P3) => strand({
      name, spine: (m) => vec3(0, mul(m, -1.5), 0), stations: 8,
      girth: (m) => add(0.025, mul(smoothstep(0.3, 0.36, m), mul(sin(mul(sub(m, 0.3), Math.PI / 0.7)), 0.42))),
      tips: ["round", { round: 0.05 }], up: [1, 0, 0],
      paint: (m, v) => {
        const caps = add(sub(1, cut(m, 0.4)), cut(m, 0.93));
        const rib = mul(sub(1, cut(sin(mul(m, 60)), -0.9)), 0.8);
        return mix(mix(body, vec3(...I.shrineDark), mul(rib, cut(sin(mul(v, Math.PI * 2 * 4)), 0.98))), black, cut(caps, 0.5));
      },
      detail: { along: 24, around: 12 },
    });
    const CORNERS: readonly V3[] = [[X0 + 1.42, POST_TOP + 0.2, 1.48], [X0 + 1.42, POST_TOP + 0.2, -1.48], [X0 - 1.42, POST_TOP + 0.2, 1.48], [X0 - 1.42, POST_TOP + 0.2, -1.48]];
    const reds = draw.posed("shrineLanterns", posed(CORNERS.length, (i) =>
      hung(vec3(pick(i, CORNERS.map((c) => c[0])), pick(i, CORNERS.map((c) => c[1])), pick(i, CORNERS.map((c) => c[2]))), add(i, 50))), lantern("lanternRed", red));
    const paper = draw.posed("shrinePaperLantern", posed(1, () => hung(vec3(...ARM_END), 60)), lantern("lanternPaper", vec3(...I.paper)));

    return [deck, ...posts, walls, beam(0, -HALF), beam(1, HALF), lintel(0, -HALF), lintel(1, HALF), roof, finial, staff, reds, paper];
  },
};

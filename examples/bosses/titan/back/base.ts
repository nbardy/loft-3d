// The back: what rides the shell frame. The base is the atoll (one closed-form surface: a lumpy mesa, moss plateau, a lip,
// stone cliffs with vertical strokes, a foot tucked under into the water), the coral heads round its cliff top and
// foot, trees on the plateau and the fort's rubble and merlons (one `draw.copies` list of rounded cones riding the
// shell frame), and the roofless tower as a strand.

import {
  abs, add, cos, draw, floor, fract, framed, keys, lift, max, mix, mul, place, rigid, sin, smoothstep, spacing, step, strand, sub, surface, vec3,
  type F, type P3,
} from "../../../../src/index.ts";
import { hash3, type Branch } from "../../../../src/lib/index.ts";
import { cut, type V3 } from "../ink.ts";
import type { BackOption } from "../slots.ts";

type Kind = 0 | 1 | 2 | 3; // coral, trunk, crown, stone: the id's first lane, read by the paint
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const cone = (kind: Kind, a: V3, b: V3, ra: number, rb: number, level: number, salt: number): Branch =>
  ({ a, b, ra, rb, level, id: [kind, salt, 0] });

export const base: BackOption = {
  about: "a dead atoll: moss plateau, stone cliffs, coral, trees and a ruined fort",
  draw: ({ n, shell }) => {
    const I = n.ink;
    const A = n.atoll;
    /** Radius scale of the atoll's outline at angle a (radians): an ellipse with lumps. JavaScript twin below. */
    const lumpsOf = (a: F): F => add(1, mul(add(add(sin(add(mul(a, 3), 1.1)), mul(sin(add(mul(a, 5), 2.3)), 0.7)), mul(sin(add(mul(a, 9), 0.4)), 0.4)), A.lumps));
    const lumpsJs = (a: number) => 1 + (Math.sin(3 * a + 1.1) + 0.7 * Math.sin(5 * a + 2.3) + 0.4 * Math.sin(9 * a + 0.4)) * A.lumps;
    /** Plateau height above `top` at local (x, z): low hills, highest at the fort's knoll. JavaScript twin below. */
    const hillsOf = (x: F, z: F): F => {
      const k = sub(1, smoothstep(0, 2.6, add(abs(sub(x, n.fort.at[0])), abs(sub(z, n.fort.at[1])))));
      return add(mul(add(mul(sin(add(mul(x, 0.9), 0.3)), sin(mul(z, 0.8))), 0.5), A.hills), mul(k, 0.6));
    };
    const hillsJs = (x: number, z: number) => {
      const d = Math.abs(x - n.fort.at[0]) + Math.abs(z - n.fort.at[1]);
      const t = Math.min(Math.max(d / 2.6, 0), 1), k = 1 - t * t * (3 - 2 * t);
      return (Math.sin(0.9 * x + 0.3) * Math.sin(0.8 * z)) * 0.5 * A.hills + 0.6 * k;
    };
    // Profile from the crown (u = 0) out over the plateau, over the lip, down the cliff and tucked under (u = 1).
    // The cliff (u 0.56 to 0.88) is even in u, so paint over u is even down its face.
    const rhoOf = keys([[0, 0], [0.45, 0.82], [0.52, 0.93], [0.56, 0.97], [0.88, 1.03], [1, 0.0]]);
    const dropOf = keys([[0, 0], [0.45, 0], [0.52, 0.05], [0.56, 0.14], [0.88, 1.0], [1, 1.05]]); // share of top - base
    const atollPoint = (u: F, v: F): P3 => {
      const a = mul(v, -2 * Math.PI);
      const r = mul(rhoOf(u).x, lumpsOf(a));
      const x = add(A.centre[0], mul(mul(cos(a), r), A.rx)), z = add(A.centre[1], mul(mul(sin(a), r), A.rz));
      // Hills only on the plateau: they fade out over the lip so the cliff top stays a clean line.
      const y = add(sub(A.top, mul(dropOf(u).x, A.top - A.base)), mul(hillsOf(x, z), sub(1, smoothstep(0.4, 0.55, u))));
      return vec3(x, y, z);
    };
    const atollPaint = (u: F, v: F): P3 => {
      // Moss on the plateau with deep-moss tufts (lines of a noise field); it spills unevenly over the lip.
      // (Patterns here and on the copies are sums of sines, not noise: noise per pixel was most of these draws' cost.)
      const turn = mul(v, 2 * Math.PI);
      const spill = add(0.56, add(mul(sin(mul(turn, 7)), 0.03), mul(sin(add(mul(turn, 17), 1)), 0.02)));
      const qx = mul(mul(u, cos(turn)), 7), qz = mul(mul(u, sin(turn)), 7);
      const contour = add(sin(add(qx, mul(sin(mul(qz, 0.8)), 1.7))), sin(add(mul(qz, 1.2), mul(sin(mul(qx, 0.7)), 1.3))));
      const tuft = sub(1, cut(abs(contour), 0.105));
      const moss = mix(vec3(...I.moss), vec3(...I.mossDeep), tuft);
      // Stone cliffs cut by vertical strokes of varying weight; a dark band where the cliff meets its foot.
      const strokeAt = abs(sub(fract(add(mul(v, 70), mul(sin(add(mul(turn, 5), mul(u, 7))), 0.3))), 0.5));
      const stroke = mul(sub(1, cut(strokeAt, 0.075)), cut(u, 0.58));
      const cliff = mix(vec3(...I.stone), vec3(...I.bark), stroke);
      const foot = mix(cliff, vec3(...I.bark), cut(add(u, mul(sin(add(mul(turn, 11), 0.5)), 0.025)), 0.77));
      return mix(moss, foot, cut(u, spill));
    };
    const atoll = draw.surface("atoll", framed(surface(atollPoint, { u: ["cap", "cap"], v: "periodic" }), { frame: shell, scale: lift<"f32">(1) }), {
      paint: atollPaint, grid: { u: spacing.even(48), v: spacing.even(96) }, sides: "one", outline: "hull",
    });

    /** A point on the atoll's rim at angle a (radians), just inside the cliff top: where coral grows. */
    const rimAt = (a: number, inset: number): V3 => {
      const r = 0.93 * lumpsJs(a) * inset;
      return [A.centre[0] + Math.cos(a) * r * A.rx, A.top - 0.12 * (A.top - A.base) + 0.05, A.centre[1] + Math.sin(a) * r * A.rz];
    };
    /** A point at the cliff's foot at angle a, a little above the waterline. */
    const footAt = (a: number): V3 => {
      const r = 1.0 * lumpsJs(a);
      return [A.centre[0] + Math.cos(a) * r * A.rx, A.base + 0.18 * (A.top - A.base), A.centre[1] + Math.sin(a) * r * A.rz];
    };
    /** A point of the plateau at local (x, z). */
    const plateauAt = (x: number, z: number): V3 => [x, A.top + hillsJs(x, z), z];



    /** A coral head: a clump of short thick fingers leaning out from one point, pink with cream tips. */
    function coralHead(at: V3, size: number, turn: number, salt: number): Branch[] {
      const n = 5 + Math.floor(3 * hash(salt + 11));
      return Array.from({ length: n }, (_, j) => {
        const a = turn + (j / n) * 2 * Math.PI, tilt = j === 0 ? 0 : 0.5 + 0.35 * hash(salt * 13 + j);
        const len = size * (0.45 + 0.35 * hash(salt * 7 + j)) * (j === 0 ? 1.25 : 1);
        const dir: V3 = [Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a)];
        const b: V3 = [at[0] + dir[0] * len, at[1] + dir[1] * len, at[2] + dir[2] * len];
        return cone(0, at, b, 0.2 * size, 0.13 * size, 1, salt);
      });
    }
    // Half the heads on the lip of the cliff, half clinging at its foot by the water.
    const corals = Array.from({ length: n.coralHeads }, (_, k) => {
      const a = (k / n.coralHeads) * 2 * Math.PI + 0.3 * hash(k);
      const atFoot = k % 2 === 1;
      const at = atFoot ? footAt(a) : rimAt(a, 0.97);
      return coralHead(at, (atFoot ? 0.9 : 0.6) + 0.4 * hash(k + 7), 6 * hash(k + 3), k);
    }).flat();

    /** A broadleaf tree: a leaning trunk and three overlapping crown blobs. */
    function tree(x: number, z: number, h: number, salt: number): Branch[] {
      const foot = plateauAt(x, z), lean = [0.25 * (hash(salt) - 0.5), 0, 0.25 * (hash(salt + 1) - 0.5)];
      const top: V3 = [foot[0] + lean[0]! * h, foot[1] + h, foot[2] + lean[2]! * h];
      const blob = (dx: number, dy: number, dz: number, r: number, j: number) => cone(2, [top[0] + dx, top[1] + dy, top[2] + dz], [top[0] + dx, top[1] + dy + 0.01, top[2] + dz], r, r, 0, salt * 3 + j);
      return [
        cone(1, [foot[0], foot[1] - 0.3, foot[2]], top, 0.16, 0.1, 0, salt),
        blob(0, 0.35, 0, 0.75 * h * 0.45, 0), blob(0.45, 0.05, 0.3, 0.55 * h * 0.45, 1), blob(-0.4, 0.1, -0.35, 0.6 * h * 0.45, 2),
      ];
    }
    const TREES: readonly (readonly [number, number, number])[] = [[0.6, 2.2, 1.9], [1.4, -1.6, 1.6], [-0.4, 3.6, 1.5], [-3.6, 2.4, 2.0], [-4.3, -2.6, 1.7], [-0.6, -3.4, 1.8]];
    const trees = TREES.slice(0, n.trees).flatMap(([x, z, h], k) => tree(x, z, h, 40 + k));

    // The fort: rubble round the tower's foot, a broken curtain wall to one side, merlons of unequal height on the tower.
    const F0 = n.fort, fortFoot = plateauAt(F0.at[0], F0.at[1]);
    const fortTop: V3 = [fortFoot[0] + F0.lean * F0.height, fortFoot[1] + F0.height, fortFoot[2] - F0.lean * 0.5 * F0.height];
    const stones: Branch[] = [
      ...Array.from({ length: 5 }, (_, k) => {
        const a = (k / 5) * 2 * Math.PI + 0.4, r = F0.girth * 0.82, hgt = 0.25 + 0.5 * hash(k + 90);
        const p: V3 = [fortTop[0] + Math.cos(a) * r, fortTop[1] - 0.15, fortTop[2] + Math.sin(a) * r];
        return k === 3 ? null : cone(3, p, [p[0], p[1] + hgt, p[2]], 0.2, 0.18, 0, 90 + k);
      }).filter((b): b is Branch => b !== null),
      // The curtain wall, broken off: two low courses running out to a corner stub.
      cone(3, [fortFoot[0] + 0.6, fortFoot[1] + 0.3, fortFoot[2] + 0.4], [fortFoot[0] + 2.1, plateauAt(fortFoot[0] + 2.1, fortFoot[2] + 1.0)[1] + 0.35, fortFoot[2] + 1.0], 0.22, 0.2, 0, 100),
      cone(3, [fortFoot[0] + 2.1, plateauAt(fortFoot[0] + 2.1, fortFoot[2] + 1.0)[1], fortFoot[2] + 1.0], [fortFoot[0] + 2.15, plateauAt(fortFoot[0] + 2.1, fortFoot[2] + 1.0)[1] + 0.9, fortFoot[2] + 1.0], 0.3, 0.26, 0, 101),
      cone(3, [fortFoot[0] - 0.4, fortFoot[1] + 0.3, fortFoot[2] + 0.75], [fortFoot[0] - 1.6, plateauAt(fortFoot[0] - 1.6, fortFoot[2] + 1.4)[1] + 0.25, fortFoot[2] + 1.4], 0.2, 0.18, 0, 102),
      // Rubble.
      ...Array.from({ length: 7 }, (_, k) => {
        const a = 2 * Math.PI * hash(k + 110), r = F0.girth + 0.3 + 0.8 * hash(k + 120);
        const x = fortFoot[0] + Math.cos(a) * r, z = fortFoot[2] + Math.sin(a) * r, y = plateauAt(x, z)[1] + 0.05;
        const s = 0.14 + 0.12 * hash(k + 130);
        return cone(3, [x, y, z], [x + s, y + 0.05, z], s, s * 0.8, 0, 110 + k);
      }),
    ];

    const reefList = draw.copies("reef", {
      kind: "cone",
      copies: [...corals, ...trees, ...stones],
      carry: shell,
      // Flat inks with pattern lines: coral cream with brick tips; bark; crowns deep moss with curling lines; stone cream
      // with courses. p is in the crab's coordinates, so the lines ride it.
      paint: ({ p, level, id }) => {
        const specks = mul(mul(sin(mul(p.x, 9)), sin(add(mul(p.y, 9), 1))), sin(add(mul(p.z, 9), 2)));
        const coral = mix(vec3(...I.coral), vec3(...I.cream), cut(specks, 0.33));
        const swirl = add(sin(add(mul(p.x, 2.5), mul(sin(mul(p.y, 3)), 1.5))), sin(add(mul(p.z, 2.5), mul(sin(mul(p.x, 2.2)), 1.5))));
        const curl = sub(1, cut(abs(sin(mul(swirl, 2.2))), 0.12));
        const crownLined = mix(vec3(...I.mossDeep), vec3(...I.black), mul(curl, step(0.5, hash3(id))));
        const course = sub(1, cut(abs(sub(fract(mul(p.y, 3.2)), 0.5)), 0.045));
        const stone = mix(vec3(...I.cream), vec3(...I.bark), course);
        const k = id.x;
        return mix(mix(mix(coral, vec3(...I.bark), step(0.5, k)), crownLined, step(1.5, k)), stone, step(2.5, k));
      },
      outline: "silhouette", minPixels: 1, keepLevels: 2, inkBack: 6,
    });

    // The tower: a squarish, leaning, roofless stump (an open top shows its dark inside), stone courses.
    const tower = place(strand({
      name: "fortTower", spine: (m) => mix(vec3(fortFoot[0], fortFoot[1] - 0.4, fortFoot[2]), vec3(...fortTop), m), stations: 4,
      girth: (m) => mix(F0.girth, F0.girth * 0.85, m), section: { squareness: 4 }, tips: [{ round: 0.05 }, "open"], up: [1, 0, 0],
      paint: (m, v) => {
        const course = sub(1, cut(abs(sub(fract(mul(m, 9)), 0.5)), 0.05));
        const joint = mul(sub(1, cut(abs(sub(fract(add(mul(v, 12), mul(floor(mul(m, 9)), 0.5))), 0.5)), 0.045)), 0.8);
        const slit = mul(sub(1, cut(abs(sub(fract(mul(v, 4)), 0.125)), 0.015)), mul(cut(m, 0.575), sub(1, cut(m, 0.795))));
        return mix(mix(vec3(...I.cream), vec3(...I.stone), max(course, joint)), vec3(...I.black), slit);
      },
      detail: { along: 12, around: 24 },
    }), rigid(shell));
    return [atoll, reefList, tower];
  },
};

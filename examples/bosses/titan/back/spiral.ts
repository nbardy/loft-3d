// The spiral shell: the islander's back (docs/art_direction/DIRECTION.md, Round 5; the picked picture
// docs/art_direction/crab_round5/back_spiral_pick.webp). A hermit's shell: one tube coiled by Raup's law
// (back/spiral_shell.ts), nearly flat, standing on the crab's back like a wheel with its spiral face turned forward,
// up and left (toward the cameras in front, away from the great claw), its mouth down and forward over the carapace;
// one cream coil on the face, broad bands round the rim; a red-brick lighthouse on the outer whorl's summit, on a cream collar
// crusted with barnacles; two groves on turf on the whorls' shoulders; runs of barnacles along the bands' edges.
//
// Everything is placed in crab coordinates from the build's numbers (`n.spiral`, `n.carapace` through the seat, the ride
// height through the waterline) and rides `rig.shell`. Nothing is a world coordinate.

import {
  add, draw, fract, framed, inFrame, lift, max, min, mix, mul, pick, place, rigid, sin, strand, sub, surface, through,
  vec2, vec3, type Drawable, type F, type P3, type Target,
} from "../../../../src/index.ts";
import { hash3, type Branch } from "../../../../src/lib/index.ts";
import { cut, TAU, type V3 } from "../ink.ts";
import type { Numbers } from "../numbers.ts";
import type { Rig } from "../rig.ts";
import type { BackOption } from "../slots.ts";
import { branchOf, GROWTH_KINDS, growthPaints, run, sprout, type Recipe } from "../../lib/growth.ts";
import { lightOn } from "./lighthouse.ts";
import { bandAt, bandEdges, coilAt, GRID, gridU, shellMap, shellTwin, U, vmath } from "./spiral_shell.ts";

const { add: addV, mul: mulV, unit: unitV } = vmath;
const hash = (k: number) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** What a copy in the growth list is: the paint dispatches on it (the id's first lane is its index here). */
const KINDS = [...GROWTH_KINDS, "trunk", "crown", "plinth"] as const;
type Kind = (typeof KINDS)[number];
const cone = (kind: Kind, a: V3, b: V3, ra: number, rb: number, level: number, salt: number): Branch => ({ a, b, ra, rb, level, id: [KINDS.indexOf(kind), salt, 0] });

/** A place on the shell: the point and the shell's outward unit normal there (crab coordinates). */
type Site = { readonly at: V3; readonly out: V3 };
type Twin = ReturnType<typeof shellTwin>;

/** The barnacles' recipe along a band's edge: a knot of three, as the growth kit grows them. */
const KNOT: Recipe = [{ motif: { kind: "barnacles", count: 3 }, many: 1, spread: 0, size: 1, sits: "middle" }];

/** One barnacle of the kit (lib/growth.ts), its radius 0.3 of `size`. */
function barnacle(site: Site, size: number, salt: number): Branch {
  return branchOf(sprout({ kind: "barnacles", count: 1 }, site, size, salt)[0]!, KINDS.indexOf("barnacle"));
}

/** A broadleaf tree: a short trunk and three round crown blobs (the headland's, rounder). Trees grow up, not out. */
function tree(foot: V3, h: number, salt: number): Branch[] {
  const lean = [0.2 * (hash(salt) - 0.5), 0.2 * (hash(salt + 1) - 0.5)] as const;
  const top: V3 = [foot[0] + lean[0] * h, foot[1] + h, foot[2] + lean[1] * h];
  const blob = (dx: number, dy: number, dz: number, r: number, j: number) => cone("crown", [top[0] + dx, top[1] + dy, top[2] + dz], [top[0] + dx, top[1] + dy + 0.01, top[2] + dz], r, r, 0, salt * 3 + j);
  return [
    cone("trunk", [foot[0], foot[1] - 0.25, foot[2]], top, 0.13, 0.09, 0, salt),
    blob(0, 0.3, 0, 0.42 * h, 0), blob(0.3, 0.05, 0.22, 0.3 * h, 1), blob(-0.28, 0.1, -0.25, 0.32 * h, 2),
  ];
}

/** The light's neck, classified once from its pose's `rise`: down (nothing built) or risen by an amount. */
type Neck = { readonly kind: "down" } | { readonly kind: "risen"; readonly by: number };
const neckOf = (rise: number): Neck => (rise === 0 ? { kind: "down" } : { kind: "risen", by: rise });
/** The lantern's shutters, classified once from `shutters`: shut (the boards lie on the black lantern: nothing more to
 * draw) or open by a share of their swing. */
type Shutters = { readonly kind: "shut" } | { readonly kind: "open"; readonly by: number };
const shuttersOf = (s: number): Shutters => (s === 0 ? { kind: "shut" } : { kind: "open", by: s });

/** The outer whorl's summit: the highest point of the last turn's outside, as (turns back, phi). Where the light stands. */
export function summitOf(twin: Twin): { readonly back: number; readonly phi: number } {
  let best = { back: 0, phi: 0 }, y = -Infinity;
  for (let i = 0; i <= 40; i++) for (let j = 0; j < 90; j++) {
    const back = 0.05 + (0.95 * i) / 40, phi = -Math.PI + (TAU * j) / 90, h = twin.at(back, phi)[1];
    if (h > y) { y = h; best = { back, phi }; }
  }
  return best;
}

/** The light's plan in plain numbers: its foot on the outer whorl's summit (sunk a little), leaning a little outward
 * (the shell's normal there laid level), and where its tower stands. Exported for tools/spiral_views.ts. */
export function lightPlan(n: Numbers, twin: Twin) {
  const L = n.spiral.light, top = summitOf(twin), at = twin.at(top.back, top.phi), out = twin.normal(top.back, top.phi);
  const level = Math.hypot(out[0], out[2]);
  const away: V3 = level < 1e-3 ? [-1, 0, 0] : [out[0] / level, 0, out[2] / level];
  const lean: V3 = [away[0] * L.pose.lean, 1, away[2] * L.pose.lean], dir = unitV(lean);
  const foot = addV(at, mulV(out, -0.25));
  const neck = neckOf(L.pose.rise);
  const towerFoot = neck.kind === "down" ? foot : addV(foot, mulV(dir, neck.by));
  return { L, top, at, out, foot, lean, dir, neck, towerFoot };
}

/**
 * A whorl's shoulder: round its section at `back` turns, where the surface faces most nearly up and is neither covered
 * by the next whorl out nor hidden in the one before (the last whorl shows all round but its inner side; the others only
 * between where the next covers them and their own suture). Where a grove stands. Exported for tools/spiral_views.ts.
 */
export function shoulderOf(twin: Twin, back: number): number {
  // (The last whorl shows all round but its inner side, which the inner whorl fills: kept 0.6 rad clear of it, phi = pi.
  // Searching from -pi itself once put a grove there on the hermit's pose, where the tube's circumference c + r cos phi
  // is zero and the trees' offsets divide by it.)
  const [lo, suture] = twin.plan.shows, from = back < 1 ? -Math.PI + 0.6 : lo + 0.2, to = back < 1 ? Math.PI - 0.6 : suture - 0.2;
  let best = from, up = -Infinity;
  for (let k = 0; k <= 120; k++) { const phi = from + ((to - from) * k) / 120, y = twin.normal(back, phi)[1]; if (y > up) { up = y; best = phi; } }
  return best;
}

export const spiral: BackOption = {
  about: "a hermit's spiral shell: a wheel with one cream coil on its face turned to the viewer, bands round its rim, a lighthouse on top, two groves, barnacle runs",
  // What a thrown ship must fly clear of beyond the atoll's cylinder (the design's `fliesClear`): the shell's plan and
  // the light, each a cylinder riding the shell frame.
  keepClear: ({ n, shell }) => {
    const twin = shellTwin(n), { towerFoot, dir, L } = lightPlan(n, twin);
    const pts = Array.from({ length: 40 * 24 }, (_, i) => twin.at((Math.floor(i / 24) / 40) * n.spiral.whorls, ((i % 24) / 24) * TAU));
    const lo = [0, 2].map((k) => Math.min(...pts.map((p) => p[k]!))), hi = [0, 2].map((k) => Math.max(...pts.map((p) => p[k]!)));
    const disc = (x: number, z: number, radius: number): Target => {
      const c = add(shell.o, inFrame(shell, vec3(x, 0, z)));
      return { kind: "disc", centre: vec2(c.x, c.z), radius: lift<"f32">(radius) };
    };
    const mid = addV(towerFoot, mulV(dir, L.height / 2));
    return [
      disc((lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!) / 2),
      disc(mid[0], mid[2], L.girth[0] + Math.hypot(dir[0], dir[2]) * L.height / 2 + 0.3),
    ];
  },
  draw: (rig: Rig) => {
    const { n, shell } = rig;
    const I = n.ink, SP = n.spiral, m = shellMap(n), p = m.plan, twin = shellTwin(n);
    const ink = (k: V3): P3 => vec3(...k);
    const water = -n.ride;
    const [lo, suture] = p.shows;

    // ---- the shell: one surface, painted along the sweep ----
    /** Turns back from the mouth at u (on the outside; beyond the lip it is the lip's and the throat's). */
    const backOf = (u: F): F => mul(sub(1, min(mul(u, 1 / U.lip), 1)), p.whorls);
    const LP = lightPlan(n, twin), G = LP.L.girth[0];
    const groveAt = SP.groves.map(([db, trees, radius]) => { const b0 = LP.top.back + db; return { b0, p0: shoulderOf(twin, b0), trees, radius }; });
    /** A round patch on the surface about (b0, p0), positive inside: the light's collar and the groves' turf. */
    const patch = (back: F, phi: F, b0: number, p0: number, radius: number, lumps: number): F => {
      const size = p.W ** -b0;
      const along = mul(sub(back, b0), TAU * (p.c + p.r * Math.cos(p0)) * size), across = mul(mul(sin(mul(sub(phi, p0), 0.5)), 2), p.r * size);
      const d = add(mul(along, along), mul(across, across)), ang = add(mul(along, 1.7), mul(across, 2.3));
      return sub(radius * radius, mul(d, add(1, mul(sin(mul(ang, 2.1)), lumps))));
    };
    /** Turf under a grove: positive inside its patch (a lumpy round of `radius` on the surface), negative outside. */
    const turf = (back: F, phi: F) => groveAt.map(({ b0, p0, radius }) => patch(back, phi, b0, p0, radius, 0.12));
    const paint = (u: F, v: F): P3 => {
      const phi = m.phiOf(v), back = backOf(u);
      const { across } = bandAt(p, SP.band, phi);
      const coil = coilAt(p, phi), coilCream = cut(coil.across, 1 - SP.coil.cream);
      // Brick with a few growth lines across the tube, unevenly spaced (a shell grows in fits): about three a turn.
      const growth = abs1(sub(fract(add(mul(back, 3.1), mul(sin(mul(back, 4.3)), 0.35))), 0.5));
      const brick = mix(ink(I.brick), ink(I.brickDark), mul(sub(1, cut(growth, 0.012)), 0.9));
      // Which print: the coil where the spiral's face shows, the rim's bands elsewhere; the boss at the curl; the
      // light's collar, a cream patch on the summit.
      const boss = cut(back, p.whorls - SP.coil.boss), collar = cut(patch(back, phi, LP.top.back, LP.top.phi, SP.light.collar, 0.08), 0);
      const plain = max(boss, collar);
      const rimCream = sub(1, cut(across, 1)), rimKey = max(sub(1, cut(abs1(across), 0.06)), sub(1, cut(abs1(sub(across, 1)), 0.06)));
      const coilKey = sub(1, cut(abs1(sub(coil.across, 1 - SP.coil.cream)), 0.035));
      const inBand = max(mix(rimCream, coilCream, coil.inFace), plain);
      // Key lines: both edges of every rim band and of the coil, and the sutures (where a whorl goes under the next one
      // out, at phi = lo on the inner whorl, and where it comes out of the one before, at its own suture).
      const bandKey = mul(mix(rimKey, coilKey, coil.inFace), sub(1, plain));
      const phiUp = mul(fract(mul(phi, 1 / TAU)), TAU);
      const sutureKey = max(mul(sub(1, cut(abs1(sub(phiUp, suture)), 0.045)), sub(1, cut(back, p.whorls - 1))), mul(sub(1, cut(abs1(sub(phiUp, lo)), 0.045)), cut(back, 1)));
      let shellInk: P3 = mix(mix(brick, ink(I.cream), inBand), ink(I.black), max(bandKey, sutureKey));
      // The two groves' turf: moss on a cream cut edge, inked.
      for (const t of turf(back, phi)) {
        const g = cut(t, 0), rim = mul(cut(t, -0.35), sub(1, g)), line = sub(1, cut(abs1(add(t, 0.35)), 0.04));
        shellInk = mix(mix(mix(shellInk, ink(I.cream), rim), ink(I.moss), g), ink(I.black), line);
      }
      // The lip: thick cream with a black key line where it turns from the outside and another where it turns into the
      // throat; the throat dark brick inside.
      const lipLine = max(sub(1, cut(abs1(sub(u, U.lip - 0.004)), 0.004)), sub(1, cut(abs1(sub(u, U.throat + 0.006)), 0.004)));
      const onLip = cut(u, U.lip - 0.002), throat = cut(u, U.throat + 0.01);
      // The collar's rim, inked.
      shellInk = mix(shellInk, ink(I.black), mul(sub(1, cut(abs1(patch(back, phi, LP.top.back, LP.top.phi, SP.light.collar, 0.08)), 0.05)), sub(1, boss)));
      return mix(mix(mix(shellInk, ink(I.cream), onLip), ink(I.black), lipLine), mix(ink(I.brickDark), ink(I.black), 0.45), throat);
    };
    const grid = gridU(n);
    const shellDrawn = draw.surface("spiral", framed(surface(m.point, { u: ["cap", "cap"], v: "periodic" }), { frame: shell, scale: lift<"f32">(1) }), {
      paint, grid: { u: { count: GRID.outer + GRID.roll + GRID.throat, at: grid }, v: { count: GRID.round, at: (s) => s } },
      sides: "one", outline: "hull",
    });

    // ---- what grows on it ----
    const site = (back: number, phi: number): Site => ({ at: twin.at(back, phi), out: twin.normal(back, phi) });
    /** Whether a site shows: above the water and not inside another whorl. */
    const shows = (q: V3, out: V3) => q[1] > water + 0.1 && !twin.inside(addV(q, mulV(out, 0.05)));
    // Runs of barnacle knots along one edge of every band, from the mouth (large, crowded) toward the collar (small,
    // sparse): the kit's `run`. Knots that would sit under water or inside another whorl are dropped.
    const [fLo, fHi] = p.shows, onFace = (phi: number) => { const up = ((phi % TAU) + TAU) % TAU; return up > fLo - 0.1 && up < fHi + 0.1; };
    const reach = 1.6;
    const runs: Branch[] = bandEdges(p, SP.band).filter(([edge]) => !onFace(edge)).flatMap(([edge], k) => {
      const sprigs = run((t) => site(0.03 + t * reach, edge), { recipe: KNOT, clusters: 11, size: 0.85, seed: 900 + 37 * k, thin: 0.8, crowd: 1.6, rests: 2 });
      // The top, not the root: the root is sunk into its own whorl, which `inside` counts.
      return sprigs.filter((g) => g.a[1] > water + 0.1 && !twin.inside(g.b)).map((g) => branchOf(g, KINDS.indexOf(g.kind)));
    });
    // The groves: trees on the turf, the tallest near the middle.
    const groves = groveAt.flatMap(({ b0, p0, trees, radius }, g) => Array.from({ length: trees }, (_, k) => {
      const ang = k * 2.4 + g, r = k === 0 ? 0 : radius * (0.45 + 0.25 * hash(g * 10 + k)), size = p.W ** -b0;
      const back = b0 + (r * Math.cos(ang)) / (TAU * (p.c + p.r * Math.cos(p0)) * size), phi = p0 + (r * Math.sin(ang)) / (p.r * size);
      return tree(twin.at(back, phi), (k === 0 ? 1.15 : 0.85 + 0.2 * hash(g * 10 + k + 5)) * (g === 0 ? 1 : 0.8), 40 + g * 10 + k);
    }).flat());
    // The light's seat: a cream plinth grown out of the summit, a ring of barnacles round its foot, and a crust of them
    // over the collar.
    const plinth = cone("plinth", addV(LP.foot, mulV(LP.out, -0.35)), addV(LP.foot, mulV(LP.dir, 0.45)), G * 1.6, G * 1.15, 0, 700);
    const up0 = LP.out, side0 = unitV(vmath.cross(up0, [1, 0, 0])), side1 = vmath.cross(up0, side0);
    const ring = Array.from({ length: 12 }, (_, k) => {
      const a = (k / 12) * TAU + 0.3 * hash(k + 710), rr = G * (1.7 + 0.25 * hash(k + 720));
      const at = addV(addV(LP.foot, mulV(side0, Math.cos(a) * rr)), mulV(side1, Math.sin(a) * rr));
      return barnacle({ at: addV(at, mulV(up0, 0.05)), out: up0 }, 0.6 + 0.3 * hash(k + 730), 740 + k);
    });
    const crust = Array.from({ length: 16 }, (_, k) => {
      const a = k * 2.39996, rr = SP.light.collar * (0.55 + 0.4 * hash(k + 760)), size = p.W ** -LP.top.back;
      const back = LP.top.back + (rr * Math.cos(a)) / (TAU * (p.c + p.r * Math.cos(LP.top.phi)) * size), phi = LP.top.phi + (rr * Math.sin(a)) / (p.r * size);
      const s = site(back, phi);
      return shows(s.at, s.out) ? [barnacle(s, 0.5 + 0.35 * hash(k + 770), 780 + k)] : [];
    }).flat();

    const paints: Record<Kind, (hit: { p: P3; normal: P3; id: P3 }) => P3> = {
      // The kit's growth (only its barnacles are used here).
      ...growthPaints(I),
      trunk: () => ink(I.bark),
      crown: ({ p: q, id }) => {
        const swirl = add(sin(add(mul(q.x, 2.5), mul(sin(mul(q.y, 3)), 1.5))), sin(add(mul(q.z, 2.5), mul(sin(mul(q.x, 2.2)), 1.5))));
        return mix(ink(I.mossDeep), ink(I.black), mul(sub(1, cut(abs1(sin(mul(swirl, 2.2))), 0.12)), cut(hash3(id), 0.5)));
      },
      // The plinth: cream stone in rough courses.
      plinth: ({ p: q }) => mix(ink(I.cream), ink(I.stone), sub(1, cut(abs1(sub(fract(add(mul(q.y, 4.5), mul(sin(mul(q.x, 6)), 0.15))), 0.5)), 0.08))),
    };
    const growth = draw.copies("spiral_growth", {
      kind: "cone", copies: [...runs, ...groves, plinth, ...ring, ...crust], carry: shell,
      paint: (hit) => pick(hit.id.x, KINDS.map((k) => paints[k](hit))),
      outline: "silhouette", minPixels: 1, keepLevels: 2, inkBack: 6,
    });

    // ---- the light: the fiddler's (back/lighthouse.ts), smaller, on the plinth; a neck under it if risen ----
    const light = lightOn(rig, { foot: LP.towerFoot, height: LP.L.height, girth: LP.L.girth, lean: LP.lean, size: LP.L.size, gulls: LP.L.gulls });
    const neck: Drawable[] = (() => {
      switch (LP.neck.kind) {
        case "down": return [];
        case "risen": {
          const by = LP.neck.by, foot = vec3(...LP.foot), dir = vec3(...LP.dir);
          return [place(strand({
            name: "spiral_neck", spine: (s) => add(foot, mul(dir, mul(s, by))), stations: 4, girth: G * 0.85, tips: ["open", "open"], up: [1, 0, 0],
            // Drums: cream rings with dark joints, one a unit.
            paint: (s) => mix(ink(I.cream), ink(I.bark), sub(1, cut(abs1(sub(fract(mul(s, by)), 0.5)), 0.42))),
            detail: { along: 12, around: 16 },
          }), rigid(shell))];
        }
      }
    })();
    const shutters: Drawable[] = (() => {
      const S = shuttersOf(LP.L.pose.shutters);
      switch (S.kind) {
        case "shut": return [];
        case "open": {
          // Two boards hinged at the lantern's top on either side, swung out by `by` of a right angle and a half.
          const k = LP.L.size, top = addV(LP.towerFoot, mulV(LP.dir, LP.L.height + 0.9 * k)), across = unitV(vmath.cross(LP.dir, [0, 0, 1]));
          const swingTo = (sgn: number): V3 => {
            const a = S.by * 1.5 * (Math.PI / 2), r = 0.62 * k;
            const hinge = addV(top, mulV(across, sgn * 0.56 * k));
            return addV(hinge, addV(mulV(across, sgn * Math.sin(a) * r), mulV(LP.dir, -Math.cos(a) * r)));
          };
          return [place(strand({
            name: "spiral_shutters", spine: (s) => through(s, [swingTo(-1), addV(top, mulV(across, -0.56 * k)), top, addV(top, mulV(across, 0.56 * k)), swingTo(1)]),
            stations: 5, girth: 0.3 * k, section: { aspect: 0.2 }, tips: ["round", "round"], up: [LP.dir[0], LP.dir[1], LP.dir[2]],
            paint: () => ink(I.black), detail: { along: 16, around: 6 },
          }), rigid(shell))];
        }
      }
    })();

    return [shellDrawn, growth, ...neck, ...light, ...shutters];
  },
};

const abs1 = (x: F): F => max(x, mul(x, -1));

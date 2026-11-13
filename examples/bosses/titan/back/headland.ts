// The headland: the islander's back (docs/art_direction/DIRECTION.md, Round 4). The island and the shell as one thing,
// more coastline, and a light on a point off the left flank.
//
// One closed-form surface, a profile swept round the island's centre like the base atoll's, but every station of the
// profile has its own outline (a radius over the bearing) and its own height:
//
//   crown - cap (a low moss dome) - lip - cliff foot - knee - rim - under the water
//
// - The lowest tier is shell. From the cliff's foot down, the surface bulges out to a rim at the carapace's own rim
//   height and tucks under, painted as the carapace is (brick, a black rim line, a cream belly): the shell runs on under
//   the island. The cliff stands on that tier's shoulder; under the island's front it stands on the carapace's dome
//   (`shellTop`), so its foot follows the shell's curve.
// - Brick rises into the cliff in scallops of unequal height: the line where stone meets shell is painted on the cliff
//   above the true crossing of the two surfaces, which is brick against brick and cannot be seen.
// - The shore is one of four kinds at each bearing (`Shore`): shell (the tier), cape (the point: the whole profile runs
//   out to it, cap and cliff and a reef shelf at the water), apron (a horn: low rock from the cliff's foot out over the
//   rim into the sea) or beach (sand below the rim between the horns). A cape or a horn is a blunt half-oval about the
//   island's centre (`cape`), joined to the outlines it belongs to by a smooth maximum; each station takes the point's
//   oval inset by its own distance, so the cliff and the shelf keep their widths down its flanks.
// - The cap tilts down to the point (`capTop`), so a camera on the far side looks down the slope and sees the light's
//   foot and the stair to it.
//
// Everything is placed from the build's numbers: the island's centre and radii (`n.atoll`), the carapace's size
// (`n.carapace`: the rim's height, the shoulder's, the dome under the front), the ride height (the waterline), and
// `n.headland`. The reef list (coral, trees, the fort's rubble, skerries, barnacles) and the light stand on the
// surface's own closed forms, evaluated on the CPU from the same expressions (`twin`), so they follow any of those.
// Nothing here is a world coordinate: the surface, the list and the light ride `rig.shell`.

import {
  abs, add, compileJs, cos, div, draw, fract, framed, inFrame, lift, max, min, mix, mul, pick, pow, saturate, sin, smoothstep, sqrt, step, sub, surface,
  tabulate, variable, vec2, vec3, vec4, type Drawable, type F, type P3, type Target,
} from "../../../../src/index.ts";
import { hash3, type Branch } from "../../../../src/lib/index.ts";
import { cut, TAU, type V3 } from "../ink.ts";
import type { Numbers } from "../numbers.ts";
import type { BackOption } from "../slots.ts";
import { lightOn } from "./lighthouse.ts";

/** The surface's grid: cells from crown to under the water, and round. */
const NU = 52, NV = 144;
/** The profile's stations in u, each on a grid line (so its corner is a row of vertices, not a chamfer). */
const U = { cap: 19 / NU, lip: 22 / NU, foot: 33 / NU, knee: 37 / NU, rim: 41 / NU, under: 47 / NU } as const;
/** The island's own outline (shares of the atoll's radii) at the cliff's foot, and how far inside it the lip and the
 * cap's edge are; the shell's rim; how far inside a cape's outline its lip and cap edge are, and how far outside it
 * its reef shelf's edge. */
const OUT = { foot: 0.9, lip: 0.085, cap: 0.145, rim: 1.04, capeLip: 0.05, capeCap: 0.085, shelf: 0.07 } as const;

/** The kinds of shore, and a value for each. At a bearing the shore is a blend of them (`shoreAt`). */
export type Shore<T> = { readonly shell: T; readonly beach: T; readonly apron: T; readonly cape: T };

/** The plan in plain numbers, from the build's: world units per unit of outline radius (the mean of the atoll's radii),
 * the point and the horns as ovals (bearing, length to the tip and half-width as shares of the radii, top height), and
 * the light's place along the point. */
function planOf(n: Numbers) {
  const A = n.atoll, H = n.headland, R = (A.rx + A.rz) / 2;
  const point = { bearing: H.point.bearing, long: OUT.rim + H.point.reach / R, half: H.point.half / R, top: H.point.top };
  const horns = H.horns.map(([bearing, reach, half, top]) => ({ bearing, long: OUT.rim + reach / R, half: half / R, top }));
  /** A point `rho` out from the island's centre at a bearing (crab x, z). */
  const polar = (rho: number, bearing: number): readonly [number, number] => [A.centre[0] + rho * A.rx * Math.cos(bearing), A.centre[1] + rho * A.rz * Math.sin(bearing)];
  return { R, point, horns, polar, lightRho: point.long - H.light.inset / R };
}

/** What a copy in the reef list is: the paint dispatches on it (the id's first lane is its index here). */
const KINDS = ["coral", "trunk", "crown", "masonry", "rock", "barnacle"] as const;
type Kind = (typeof KINDS)[number];

export const hash = (k: number) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** A rounded cone of the reef list. `mark` rides in the id's third lane: a height the kind's paint measures from (a
 * rock's waterline, a barnacle's top). The other kinds' paints read no height and leave it 0. */
const cone = (kind: Kind, a: V3, b: V3, ra: number, rb: number, level: number, salt: number, mark = 0): Branch =>
  ({ a, b, ra, rb, level, id: [KINDS.indexOf(kind), salt, mark] });

export const sq = (x: F): F => mul(x, x);
/** The smooth maximum of radii (an 8-norm): the larger wins, and where two are equal the corner is filleted by 9%. */
export const join = (rs: readonly F[]): F => sqrt(sqrt(sqrt(rs.map((r) => sq(sq(sq(r)))).reduce((s, r) => add(s, r)))));
/** Piecewise linear through (us[i], vs[i]), flat outside. */
export const stations = (u: F, us: readonly number[], vs: readonly F[]): F =>
  vs.slice(1).reduce<F>((y, v, i) => add(y, mul(saturate(div(sub(u, us[i]!), us[i + 1]! - us[i]!)), sub(v, vs[i]!))), vs[0]!);

/** A cape toward `bearing`, `long` to its tip and `half` across at the centre: a blunt half-oval (a superellipse of
 * exponent 4) about the island's centre. Behind it (cos below 0) its radius is `half`, well inside the island. */
export const cape = (a: F, bearing: number, long: number, half: number): F => {
  const c2 = sq(max(cos(sub(a, bearing)), 0));
  return div(1, sqrt(sqrt(add(mul(sq(c2), 1 / long ** 4), mul(sq(sub(1, c2)), 1 / half ** 4)))));
};
/** The one dispatcher over the kinds of shore: a value per kind, blended by how much the shore is each (shell is the rest). */
export const blend = (w: { readonly beach: F; readonly apron: F; readonly cape: F }) =>
  <T extends F | P3>(v: Shore<T>): T => mix(mix(mix(v.shell, v.beach, w.beach), v.apron, w.apron), v.cape, w.cape) as T;

/** A broadleaf tree: a leaning trunk and three overlapping crown blobs (the base's). `put` makes a copy of the list the
 * tree joins (each back's list has its own kinds; the tree needs `trunk` and `crown`). */
export function broadleaf(put: (kind: "trunk" | "crown", a: V3, b: V3, ra: number, rb: number, level: number, salt: number) => Branch, foot: V3, h: number, salt: number): Branch[] {
  const lean = [0.25 * (hash(salt) - 0.5), 0.25 * (hash(salt + 1) - 0.5)] as const;
  const top: V3 = [foot[0] + lean[0] * h, foot[1] + h, foot[2] + lean[1] * h];
  const blob = (dx: number, dy: number, dz: number, r: number, j: number) => put("crown", [top[0] + dx, top[1] + dy, top[2] + dz], [top[0] + dx, top[1] + dy + 0.01, top[2] + dz], r, r, 0, salt * 3 + j);
  return [
    put("trunk", [foot[0], foot[1] - 0.3, foot[2]], top, 0.16, 0.1, 0, salt),
    blob(0, 0.35, 0, 0.75 * h * 0.45, 0), blob(0.45, 0.05, 0.3, 0.55 * h * 0.45, 1), blob(-0.4, 0.1, -0.35, 0.6 * h * 0.45, 2),
  ];
}
type Inks = Numbers["ink"];
type Hit = { readonly p: P3; readonly id: P3 };
/** Crowns: deep moss, half of them with curling black lines. */
export const crownPaint = (I: Inks) => ({ p, id }: Hit): P3 => {
  const swirl = add(sin(add(mul(p.x, 2.5), mul(sin(mul(p.y, 3)), 1.5))), sin(add(mul(p.z, 2.5), mul(sin(mul(p.x, 2.2)), 1.5))));
  return mix(vec3(...I.mossDeep), vec3(...I.black), mul(sub(1, cut(abs(sin(mul(swirl, 2.2))), 0.12)), step(0.5, hash3(id))));
};
/** Sea rock: stone with dark strata, dark and wet for its first third of a unit above its ground (the id's third lane). */
export const rockPaint = (I: Inks) => ({ p, id }: Hit): P3 =>
  mix(mix(vec3(...I.stone), vec3(...I.bark), sub(1, cut(abs(sin(add(mul(p.y, 9), mul(sin(mul(p.x, 5)), 1.2)))), 0.2))), vec3(...I.bark), sub(1, cut(sub(p.y, id.z), 0.3)));

export const headland: BackOption = {
  about: "an island grown on the shell: a moss dome, scalloped cliffs, a cove, a light leaning off a point",
  // What a thrown ship must fly clear of (the design's `fliesClear`), beyond the atoll's own cylinder: the shell tier's
  // rim (it stands a little outside the atoll's radii), a cylinder over each cape from the rim to its skerries, and one
  // over the light, leaning as it leans. They ride the shell frame.
  keepClear: ({ n, shell }) => {
    const { R, point, horns, polar, lightRho } = planOf(n), L = n.headland.light, A = n.atoll;
    const disc = ([x, z]: readonly [number, number], radius: number): Target => {
      const c = add(shell.o, inFrame(shell, vec3(x, 0, z)));
      return { kind: "disc", centre: vec2(c.x, c.z), radius: lift<"f32">(radius) };
    };
    const lean = (L.lean * L.height) / 2, foot = polar(lightRho, point.bearing);
    return [
      // The rim's outline is at most (1 + 0.525 lumps) of OUT.rim: the lumps' three sines sum to 2.1 at most, a quarter of them reach the rim.
      disc(A.centre, OUT.rim * (1 + 0.525 * A.lumps) * Math.max(A.rx, A.rz)),
      ...[point, ...horns].map((k) => disc(polar((OUT.rim + k.long + 0.4) / 2, k.bearing), Math.max(((k.long + 0.4 - OUT.rim) / 2) * R, k.half * R) + 0.3)),
      disc([foot[0] + Math.cos(point.bearing) * lean, foot[1] + Math.sin(point.bearing) * lean], L.girth[0] + lean + 0.3),
    ];
  },
  draw: (rig) => {
    const { n, shell } = rig;
    const I = n.ink, A = n.atoll, H = n.headland, C = n.carapace;
    const { R, point: POINT, horns: HORNS, lightRho } = planOf(n);
    // Heights hung on the carapace and the ride (crab y): the still water, the carapace's rim line (carapace/base.ts
    // inks it at sin = -0.15 of its half-height), the shoulder the cliff stands on, the reef shelf just above the water.
    const water = -n.ride, rimY = -0.15 * C.height, shoulderY = 0.8 * C.height, kneeY = 0.36 * C.height, shelfY = water + 0.1;

    // ---- outlines: radius (a share of the atoll's radii) over the bearing a ----
    const lumps = (a: F): F => add(1, mul(add(add(sin(add(mul(a, 3), 1.1)), mul(sin(add(mul(a, 5), 2.3)), 0.7)), mul(sin(add(mul(a, 9), 0.4)), 0.4)), A.lumps));
    /** The point's outline inset by `d` (negative: outset). */
    const pointOut = (a: F, d: number): F => cape(a, POINT.bearing, POINT.long - d, POINT.half - d);
    const rimOf = (a: F): F => mul(OUT.rim, add(1, mul(sub(lumps(a), 1), 0.25)));
    const footOf = (a: F): F => join([mul(lumps(a), OUT.foot), pointOut(a, 0)]);
    const lipOf = (a: F): F => join([mul(lumps(a), OUT.foot - OUT.lip), pointOut(a, OUT.capeLip)]);
    const capOf = (a: F): F => join([mul(lumps(a), OUT.foot - OUT.cap), pointOut(a, OUT.capeCap)]);
    /** The horns' outline (the edge of their rock at the water), and their tops' height over the bearing (a horn's own within 0.3 rad of it). */
    const hornEdge = (a: F): F => join(HORNS.map((k) => cape(a, k.bearing, k.long, k.half)));
    const hornTop = (a: F): F => HORNS.slice(1).reduce<F>((y, k) => add(y, mul(smoothstep(Math.cos(0.3), Math.cos(0.12), cos(sub(a, k.bearing))), k.top - HORNS[0]!.top)), lift<"f32">(HORNS[0]!.top));
    /** The sand between the horns: a lobe at the shelf's level that no rock stands on. */
    const cove = { bearing: (HORNS[0]!.bearing + HORNS[1]!.bearing) / 2, half: Math.sin(Math.abs(HORNS[1]!.bearing - HORNS[0]!.bearing) / 2) * 1.15 };
    const sandEdge = (a: F): F => cape(a, cove.bearing, OUT.rim + H.beach / R, cove.half);
    /** How much the shore at a bearing is each kind but shell (which is the rest): rock past the rim wins over sand. */
    const capeAt = (a: F): F => smoothstep(0, 0.06, sub(pointOut(a, 0), rimOf(a)));
    const apronAt = (a: F): F => smoothstep(0, 0.06, sub(hornEdge(a), rimOf(a)));
    const beachAt = (a: F): F => smoothstep(0.01, 0.08, sub(sandEdge(a), rimOf(a)));
    const shoreAt = (a: F) => blend({ beach: beachAt(a), apron: apronAt(a), cape: capeAt(a) });

    // ---- heights ----
    /** A point of the island's plan at radius rho and bearing a, relative to its centre (crab x, z). */
    const planX = (rho: F, a: F): F => mul(mul(rho, A.rx), cos(a)), planZ = (rho: F, a: F): F => mul(mul(rho, A.rz), sin(a));
    const axis = [Math.cos(POINT.bearing), Math.sin(POINT.bearing)] as const;
    /** Along the point's axis from the island's centre (s), and across it (t). */
    const alongPoint = (rho: F, a: F): F => add(mul(planX(rho, a), axis[0]), mul(planZ(rho, a), axis[1]));
    const acrossPoint = (rho: F, a: F): F => sub(mul(planZ(rho, a), axis[0]), mul(planX(rho, a), axis[1]));
    /** Where the cap starts down to the point and where it has arrived (along the axis): from well inside the island, so
     * the game camera, on the far side, looks down the slope. */
    const RAMP = [0.38 * R, POINT.long * R - 1.4] as const;
    /** How far down toward the low rock the cap has come: on the ramp to the point, and anywhere beyond the island's own outline. */
    const lowered = (rho: F, a: F): F => max(
      mul(smoothstep(RAMP[0], RAMP[1], alongPoint(rho, a)), sub(1, smoothstep(1.1, 2.6, abs(acrossPoint(rho, a))))),
      smoothstep(0.93, 1.12, rho),
    );
    /** The cap's height at (rho, a): a low dome with hills (the ruin's knoll highest), down to the point's low rock. */
    const capTop = (rho: F, a: F): F => {
      const x = add(A.centre[0], planX(rho, a)), z = add(A.centre[1], planZ(rho, a));
      const dome = add(A.top, mul(H.dome, sub(1, sq(min(div(rho, OUT.foot - OUT.cap), 1)))));
      const knoll = sub(1, smoothstep(0, 2.2, add(abs(sub(x, n.fort.at[0])), abs(sub(z, n.fort.at[1])))));
      const hills = add(mul(mul(sin(add(mul(x, 0.9), 0.3)), sin(mul(z, 0.8))), 0.5 * A.hills), mul(knoll, 0.3));
      const low = lowered(rho, a);
      return add(mix(dome, POINT.top, low), mul(hills, mul(sub(1, smoothstep(0.4, 0.7, rho)), sub(1, low))));
    };
    /**
     * The top of the carapace under the island at crab (x, z): the base hull's section (carapace/base.ts: a superellipse
     * of squareness 2.3, half-width `width`, half-height `height`, closing over the tail's 0.45 of its length, its spine
     * rising 0.25 from the tail to the middle). Outside the hull's plan it is the spine's height. An approximation of
     * that strand, good to about 0.1 where the island's front stands on it.
     */
    const shellTop = (x: F, z: F): F => {
      const m = div(sub(x, C.from), C.to - C.from);
      const g = sqrt(max(sub(1, sq(saturate(sub(1, div(m, 0.45))))), 0));
      const across = min(div(abs(z), add(mul(g, C.width), 1e-3)), 1);
      const arch = pow(max(sub(1, pow(max(across, 1e-4), 2.3)), 1e-6), 1 / 2.3);
      return add(add(-0.1, mul(saturate(mul(m, 2)), 0.25)), mul(mul(g, C.height), arch));
    };
    /** The cliff foot's height on a shell shore: the tier's shoulder, or the carapace's dome where that is higher. */
    const footY = (a: F): F => {
      const rho = footOf(a);
      return max(shoulderY, sub(shellTop(add(A.centre[0], planX(rho, a)), add(A.centre[1], planZ(rho, a))), 0.1));
    };

    // ---- the surface ----
    const bearingOf = (v: F): F => mul(v, -TAU);
    const US = [0, U.cap, U.lip, U.foot, U.knee, U.rim, U.under, 1];
    /** The radius of the profile at (u, a). */
    const rhoAt = (u: F, a: F): F => {
      const shore = shoreAt(a), rim = rimOf(a), foot = footOf(a), shelf = pointOut(a, -OUT.shelf), horn = hornEdge(a);
      const kneeR = shore({ shell: sub(rim, 0.03), beach: rim, apron: sub(horn, 0.09), cape: mix(foot, shelf, 0.5) });
      const rimR = shore({ shell: rim, beach: sandEdge(a), apron: horn, cape: shelf });
      return stations(u, US, [lift<"f32">(0), capOf(a), lipOf(a), foot, kneeR, rimR, sub(rimR, 0.06), lift<"f32">(0)]);
    };
    const islandPoint = (u: F, v: F): P3 => {
      const a = bearingOf(v), rho = rhoAt(u, a), shore = shoreAt(a), lip = lipOf(a), wet = lift<"f32">(shelfY - 0.05);
      // The cap's height is its own field out to the lip; below the lip the profile hangs from the lip's height.
      const lipY = sub(capTop(lip, a), 0.12);
      const top = sub(capTop(mix(rho, lip, step(U.lip, u)), a), mul(saturate(div(sub(u, U.cap), U.lip - U.cap)), 0.12));
      const onShell = footY(a);
      const fY = shore({ shell: onShell, beach: onShell, apron: onShell, cape: lift<"f32">(shelfY + 0.14) });
      const kY = shore({ shell: lift<"f32">(kneeY), beach: lift<"f32">(rimY), apron: hornTop(a), cape: lift<"f32">(shelfY + 0.07) });
      const rY = shore({ shell: lift<"f32">(rimY), beach: wet, apron: wet, cape: lift<"f32">(shelfY) });
      const hang = stations(u, [U.lip, U.foot, U.knee, U.rim, U.under, 1], [lipY, fY, kY, rY, lift<"f32">(A.base), lift<"f32">(A.base - 0.2)]);
      return vec3(add(A.centre[0], planX(rho, a)), add(top, sub(hang, lipY)), add(A.centre[1], planZ(rho, a)));
    };

    // What the inks read per bearing, from two static tables (v from 0 to 1 once round): the cap's edge and how much the
    // shore is cape, apron and beach; how far the point's lip stands beyond the island's own, where the turf's tongues end
    // and where the scallops' line runs (both in u), and where the cap's moss gives way to bare rock. Evaluated per pixel these were six ovals, three joins and seven sines
    // of the bearing, and with the rest of the inks the island's draw cost four times the base atoll's (profile, game
    // camera, 2026-11-11: the paint, not the grid; a flat ink brought it under the atoll's). The surface itself, in the
    // vertex stage, still evaluates the outlines exactly.
    const BEARINGS = 1025;
    const shoreTable = tabulate("headland_shore", (x) => { const a = bearingOf(x); return vec4(capOf(a), capeAt(a), apronAt(a), beachAt(a)); }, BEARINGS, "static");
    const edgeTable = tabulate("headland_edges", (x) => {
      const a = bearingOf(x), turn = mul(x, TAU);
      // Turf hangs over the cliff's top in tongues (19 round, bunched).
      const lobe = add(0.5, mul(sin(add(mul(turn, 19), mul(sin(mul(turn, 4)), 1.5))), 0.5));
      const spill = add(U.lip + 0.02, add(mul(mul(lobe, sq(lobe)), 0.085), mul(sin(mul(turn, 7)), 0.015)));
      // Brick rises into the stone in scallops: about 22 arches round, of unequal height.
      const high = add(0.06, add(mul(sin(add(mul(turn, 3), 1)), 0.025), mul(sin(add(mul(turn, 5), 2)), 0.02)));
      const scallop = sub(U.foot - 0.012, mul(high, abs(sin(add(mul(turn, 11), mul(sin(mul(turn, 2)), 0.6))))));
      // (The fourth lane: the island's own cap edge, a little out; beyond it the cap is bare rock.)
      return vec4(sub(pointOut(a, OUT.capeLip), mul(lumps(a), OUT.foot - OUT.lip)), spill, scallop, mul(lumps(a), OUT.foot - OUT.cap + 0.03));
    }, BEARINGS, "static");
    const islandPaint = (u: F, v: F): P3 => {
      const a = bearingOf(v), turn = mul(v, TAU), at = shoreTable(v), edge = edgeTable(v);
      const capEdge = at.x, capeW = at.y, apronW = at.z, beachW = at.w;
      // Inks are crisp: each kind of shore where its weight passes a half.
      const shore = blend({ beach: cut(beachW, 0.5), apron: cut(apronW, 0.5), cape: cut(capeW, 0.5) }), rocky = max(cut(capeW, 0.35), cut(apronW, 0.35));
      const ink = (k: V3): P3 => vec3(...k);
      // -- the cap: moss with deep tufts (lines of a sine field, as the base's); bare cracked rock beyond the island's own
      // outline (the point); the stair down the ramp to the light.
      const rho = mul(div(min(u, U.cap), U.cap), capEdge);
      const qx = mul(planX(rho, a), 0.875), qz = mul(planZ(rho, a), 0.875);
      const contour = add(sin(add(qx, mul(sin(mul(qz, 0.8)), 1.7))), sin(add(mul(qz, 1.2), mul(sin(mul(qx, 0.7)), 1.3))));
      const moss = mix(ink(I.moss), ink(I.mossDeep), sub(1, cut(abs(contour), 0.105)));
      // One crack pattern for every bare rock top (the point's cap, a horn's apron): lines over (u, bearing).
      const crack = sub(1, cut(abs(sin(add(mul(u, 75), mul(sin(mul(turn, 23)), 1.6)))), 0.1));
      const rock = mix(ink(I.stone), ink(I.bark), mul(crack, 0.85));
      const bare = cut(rho, edge.w);
      const s = alongPoint(rho, a), t = acrossPoint(rho, a);
      const onStair = mul(cut(sub(0.13, abs(sub(t, mul(sin(mul(s, 1.5)), 0.22)))), 0), mul(cut(s, RAMP[0] + 0.3), sub(1, cut(s, RAMP[1] + 0.2))));
      const stair = mix(ink(I.cream), ink(I.bark), sub(1, cut(abs(sub(fract(mul(s, 3.2)), 0.5)), 0.12)));
      const cap = mix(mix(moss, rock, bare), stair, onStair);

      // -- the cliff: turf hangs over its top in tongues, roots below them; stone cut by vertical strokes; on the point no
      // turf, level strata (its flanks run nearly along a bearing, so strokes over the bearing are few there), a dark foot.
      const onPoint = cut(edge.x, 0.02);
      const spill = mix(edge.y, U.cap + 0.01, onPoint);
      const strokeAt = abs(sub(fract(add(mul(v, 70), mul(sin(add(mul(turn, 5), mul(u, 7))), 0.3))), 0.5));
      const strata = sub(1, cut(abs(sub(fract(add(mul(u, 34), mul(sin(mul(turn, 13)), 0.25))), 0.5)), 0.1));
      const stone = mix(ink(I.stone), ink(I.bark), max(sub(1, cut(strokeAt, 0.075)), mul(strata, onPoint)));
      const root = mul(mul(sub(1, cut(abs(sub(fract(mul(v, 57)), 0.5)), 0.07)), sub(1, cut(u, add(spill, 0.045)))), sub(1, onPoint));
      const dark = mul(cut(u, U.foot - 0.045), cut(capeW, 0.5));
      const cliff = mix(mix(stone, ink(I.bark), root), ink(I.bark), dark);

      // -- below the cliff, by the kind of shore.
      // Shell: brick mottled as the carapace is, the carapace's black rim line and cream belly carried round.
      const blot = cut(mul(sin(add(mul(u, 60), mul(sin(mul(turn, 5)), 1.7))), sin(add(mul(turn, 9), mul(u, 31)))), 0.575);
      const brick = mix(ink(I.brick), ink(I.brickDark), blot);
      const tier = mix(mix(brick, ink(I.black), sub(1, cut(abs(sub(u, U.rim)), 0.006))), ink(I.cream), cut(u, U.rim + 0.006));
      // Beach: the shell's shoulder, then sand (cream, speckled) from the rim down.
      // (One dot lattice serves the sand's specks and the reef's scales.)
      const dots = mul(sin(mul(turn, 67)), sin(mul(u, 190)));
      const sand = mix(ink(I.cream), ink(I.stone), cut(dots, 0.82));
      // Apron (a horn): cracked rock on top, strata down its seaward face, dark at the water.
      const apron = mix(mix(rock, mix(ink(I.stone), ink(I.bark), strata), cut(u, U.knee)), ink(I.bark), cut(u, U.rim - 0.012));
      // Cape (the point): the reef shelf at the water (coral scales, cream between), dark rock under it.
      const reef = mix(mix(ink(I.cream), ink(I.coral), cut(abs(dots), 0.12)), ink(I.bark), cut(u, U.rim + 0.012));
      const below = shore({ shell: tier, beach: mix(tier, sand, cut(u, U.knee + 0.004)), apron, cape: reef });

      // -- where the cliff ends. On shell and beach, brick rises into the stone in scallops (about 22 round, unequal),
      // inked; on rock the cliff simply stands on its foot.
      const scallop = edge.z;
      const ends = mix(scallop, U.foot + 0.002, rocky);
      const line = mul(sub(1, cut(abs(sub(u, scallop)), 0.005)), sub(1, rocky));
      return mix(mix(mix(cap, cliff, cut(u, spill)), below, cut(u, ends)), ink(I.black), line);
    };

    // Round the island the vertices crowd three ways (3.3 times denser at v = 0, 1/3, 2/3 than between): the point is at
    // v = 1/3 and the horns either side of 2/3 for the numbers as written, and a cape's flank needs the columns.
    const island = draw.surface("island", framed(surface(islandPoint, { u: ["cap", "cap"], v: "periodic" }), { frame: shell, scale: lift<"f32">(1) }), {
      paint: islandPaint, grid: { u: { count: NU, at: (s) => s }, v: { count: NV, at: (s) => sub(s, mul(sin(mul(s, 3 * TAU)), 0.7 / (3 * TAU))) } },
      sides: "one", outline: "hull",
    });

    // ---- the same closed forms on the CPU, for placing things on the surface ----
    const UV = [variable("headland_u", "f32"), variable("headland_v", "f32")] as const;
    const twin = <T>(e: F | P3) => { const f = compileJs([e]); return (x: number, y: number): T => f({ vars: { headland_u: x, headland_v: y }, inputs: {}, params: {} })[0] as T; };
    /** The surface's point at (u, bearing). */
    const onIsland = ((f) => (u: number, bearing: number): V3 => f(u, -bearing / TAU))(twin<V3>(islandPoint(UV[0], UV[1])));
    /** The cap at a share `f` of the way from the crown to its edge, at a bearing. */
    const onCap = (f: number, bearing: number): V3 => onIsland(f * U.cap, bearing);
    /** A point `rho` out from the island's centre at a bearing, at height y (crab coordinates). */
    const polar = (rho: number, bearing: number, y: number): V3 => { const [x, z] = planOf(n).polar(rho, bearing); return [x, y, z]; };
    const capTopJs = twin<number>(capTop(UV[0], UV[1]));
    /** How far the shore at a bearing is from plain shell (0 shell, 1 wholly something else). */
    const notShell = ((f) => (bearing: number) => f(bearing, 0))(twin<number>(max(max(capeAt(UV[0]), apronAt(UV[0])), beachAt(UV[0]))));

    // ---- the reef list ----
    /** A coral head: a clump of short thick fingers leaning out from one point, pink with cream tips (the base's). */
    function coralHead(at: V3, size: number, turn: number, salt: number): Branch[] {
      const count = 5 + Math.floor(3 * hash(salt + 11));
      return Array.from({ length: count }, (_, j) => {
        const a = turn + (j / count) * TAU, tilt = j === 0 ? 0 : 0.5 + 0.35 * hash(salt * 13 + j);
        const len = size * (0.45 + 0.35 * hash(salt * 7 + j)) * (j === 0 ? 1.25 : 1);
        const b: V3 = [at[0] + Math.sin(tilt) * Math.cos(a) * len, at[1] + Math.cos(tilt) * len, at[2] + Math.sin(tilt) * Math.sin(a) * len];
        return cone("coral", at, b, 0.2 * size, 0.13 * size, 1, salt);
      });
    }
    /** Barnacles: a cluster of squat cones, cream with a dark crater. */
    function barnacles(at: V3, size: number, salt: number): Branch[] {
      return Array.from({ length: 4 }, (_, j) => {
        const a = TAU * hash(salt * 5 + j), r = j === 0 ? 0 : size * (0.9 + 0.5 * hash(salt * 3 + j)), s = size * (j === 0 ? 1 : 0.55 + 0.3 * hash(salt + j));
        const p: V3 = [at[0] + Math.cos(a) * r, at[1] - 0.12, at[2] + Math.sin(a) * r];
        return cone("barnacle", p, [p[0], p[1] + 0.12 + 0.4 * s, p[2]], 0.6 * s, 0.24 * s, 1, salt, p[1] + 0.12 + 0.4 * s + 0.24 * s);
      });
    }
    // Round the shell shores, on the tier's shoulder: coral and barnacles by turns. Not on a cape, not on the beach.
    const shoulder = Array.from({ length: n.coralHeads }, (_, k) => {
      const bearing = (k / n.coralHeads) * TAU + 0.3 * hash(k);
      if (notShell(bearing) > 0.05) return [];
      const at = onIsland(U.foot + (U.knee - U.foot) * (0.35 + 0.4 * hash(k + 5)), bearing);
      return k % 3 === 2 ? barnacles(at, 0.32 + 0.15 * hash(k + 7), 300 + k) : coralHead([at[0], at[1] - 0.1, at[2]], 0.6 + 0.4 * hash(k + 7), 6 * hash(k + 3), k);
    }).flat();

    // Trees, each [share of the cap's radius, bearing, height], placed by looking: one tall on the crown, the rest round
    // the right flank and the tail, two small on the left. None within 0.9 of the sight lines from the light's foot to the
    // game and far cameras (they run from the point through the island's middle toward the bow's right), none on the stair,
    // none forward of the middle near the centre line (the head and its antennae).
    const TREES: readonly (readonly [number, number, number])[] = [[0.15, 2.52, 2.0], [0.8, 2.14, 1.8], [0.82, 2.93, 1.6], [0.82, 1.31, 1.7], [0.85, -2.55, 1.4], [0.85, -1.3, 1.3]];
    const trees = TREES.slice(0, n.trees).flatMap(([f, bearing, h], k) => broadleaf(cone, onCap(f, bearing), h, 40 + k));

    // Where the fort stood: its rubble, a scatter of cream stones on the knoll. No stub stands (the first build's ring of
    // them hid the light's foot and the stair from the game camera): the light is the island's one tower.
    const ground = (x: number, z: number): V3 => {
      const dx = (x - A.centre[0]) / A.rx, dz = (z - A.centre[1]) / A.rz;
      return [x, capTopJs(Math.hypot(dx, dz), Math.atan2(dz, dx)), z];
    };
    const F0 = n.fort;
    const ruin: Branch[] = Array.from({ length: 8 }, (_, k) => {
      const a = TAU * hash(k + 110), r = 0.3 + F0.girth * 1.6 * hash(k + 120), p = ground(F0.at[0] + Math.cos(a) * r, F0.at[1] + Math.sin(a) * r), s = 0.16 + 0.14 * hash(k + 130);
      return cone("masonry", [p[0], p[1] + 0.05, p[2]], [p[0] + s, p[1] + 0.1, p[2]], s, s * 0.8, 0, 110 + k);
    });

    // Skerries: stacks standing in the sea off each cape's tip, shrinking outward, leaning a little; and boulders on the beach.
    const stack = (rho: number, bearing: number, tall: number, wide: number, salt: number): Branch => {
      const foot = polar(rho, bearing, A.base - 0.4), lean = 0.18 * (hash(salt) - 0.5);
      return cone("rock", foot, [foot[0] + lean, water + tall, foot[2] - lean], wide, wide * 0.55, 0, salt, water);
    };
    const skerries = [
      ...[POINT, ...HORNS].flatMap((k, i) => [stack(k.long + 0.2, k.bearing + 0.05, 1.25, 0.5, 200 + i * 3), stack(k.long + 0.38, k.bearing - 0.03, 0.75, 0.36, 201 + i * 3)]),
      stack(POINT.long + 0.52, POINT.bearing + 0.09, 0.45, 0.26, 220),
    ];
    const boulders = [0.35, 0.62].map((f, i) => {
      const bearing = HORNS[0]!.bearing + (HORNS[1]!.bearing - HORNS[0]!.bearing) * f, p = polar(OUT.rim + (H.beach / R) * 0.45, bearing, shelfY + 0.35), s = 0.2 + 0.08 * i;
      return cone("rock", p, [p[0] + 0.05, p[1] + 0.12, p[2]], s, s * 0.8, 0, 230 + i, p[1] - s);
    });
    // Barnacles on the carapace ahead of the cliff's foot, thinning forward: within 0.9 of the island, clear of the head.
    const nape = Array.from({ length: 9 }, (_, k) => {
      const bearing = (k - 4) * 0.21 + 0.06 * (hash(k + 50) - 0.5), foot = onIsland(U.foot, bearing), out = 0.2 + 0.7 * hash(k + 60);
      const at: V3 = [foot[0] + Math.cos(bearing) * out, foot[1] + 0.1 - 0.12 * out, foot[2] + Math.sin(bearing) * out * 0.8];
      return barnacles(at, 0.22 + 0.12 * hash(k + 70) * (1 - out), 400 + k);
    }).flat();

    const paints: Record<Kind, (hit: { p: P3; id: P3 }) => P3> = {
      // Coral: pink with cream specks.
      coral: ({ p }) => mix(vec3(...I.coral), vec3(...I.cream), cut(mul(mul(sin(mul(p.x, 9)), sin(add(mul(p.y, 9), 1))), sin(add(mul(p.z, 9), 2))), 0.33)),
      trunk: () => vec3(...I.bark),
      crown: crownPaint(I),
      // The ruin: cream stone in courses.
      masonry: ({ p }) => mix(vec3(...I.cream), vec3(...I.bark), sub(1, cut(abs(sub(fract(mul(p.y, 3.2)), 0.5)), 0.045))),
      rock: rockPaint(I),
      // Barnacles: cream, a small dark crater at the very top (the id's third lane is the top's height). The first build's
      // crater was a third of the cone and from a low camera they read as mushrooms.
      barnacle: ({ p, id }) => mix(vec3(...I.cream), vec3(...I.bark), cut(sub(p.y, id.z), -0.045)),
    };
    const reefList = draw.copies("reef", {
      kind: "cone",
      copies: [...shoulder, ...trees, ...ruin, ...skerries, ...boulders, ...nape],
      carry: shell,
      // One thin dispatcher on the copy's kind; p is in the crab's coordinates, so every pattern rides it.
      paint: (hit) => pick(hit.id.x, KINDS.map((k) => paints[k](hit))),
      outline: "silhouette", minPixels: 1, keepLevels: 2, inkBack: 6,
    });

    // ---- the light: the fiddler's (back/lighthouse.ts), smaller, on the point, leaning out along it ----
    const L = H.light;
    const foot = polar(lightRho, POINT.bearing, capTopJs(lightRho, POINT.bearing) - 0.25);
    const light: Drawable[] = lightOn(rig, { foot, height: L.height, girth: L.girth, lean: [axis[0] * L.lean, 1, axis[1] * L.lean], size: L.size, gulls: L.gulls });

    return [island, reefList, ...light];
  },
};

// The terraces: the bruiser's back (docs/art_direction/DIRECTION.md, Round 5, "Fifth pass"; the pictures are
// docs/art_direction/crab_round5/back_paintover_*.webp and back_model_sheet.webp). The island and the shell as ONE
// form: a level turf cap over pale stone cliffs, and three broad shell plates laid on the cliffs like leaves, rising
// from the water, leaning the same way as they climb, pointed at their tips under the turf. Their ribs run on past the
// red as flutes in the stone, so shell and stone read as one form.
//
// One closed-form surface over (u, v): u runs from the crown (0) to the rim (U_RIM) and on down the shore to under the
// water (1); v is the bearing (a turn). Above the rim G = u / U_RIM: the hull is a cap (a level disc to G = cap.at) and
// a cliff, and every plate is a function of (G, bearing):
//
//   s = (1 - G) / (1 - tip)            0 at the rim, 1 at the plate's tip
//   middle(s) = root - sweep * s       the plate leans back as it climbs (every plate the same way: the screw's hand)
//   x = (bearing - middle) / width(s)  -1 to 1 across it; width is a leaf's, widest a quarter of the way up, 0 at the tip
//
// and it stands `thick * sqrt(1 - x^2)` out of the hull (more on its leading edge: a shingle's lip). Ledges are arcs of
// level tread cut into the cliff (the height read at a held G while the radius runs on: DERIVATION in `ledged`).
//
// Below the rim the shore is one of the headland's four kinds at each bearing (its `Shore` and `blend`): shell (into
// the water), beach (sand in a cove under the plates' lifted rim), apron (the reef shelf the stacks stand on) or cape
// (the point, with a mound for the light).
//
// Everything hangs off the shell frame (`rig.shell`) and the build's numbers: the island's centre and radii (`n.atoll`),
// the carapace's rim line (`n.carapace`), the ride (the water) and `n.terraces`. Nothing is a world coordinate. Growth
// is the kit's (examples/bosses/lib/growth.ts), placed at named places of this surface (`facing`, `ashore`, `seam`).

import {
  abs, add, compileJs, cos, div, draw, floor, fract, framed, inFrame, lift, max, min, mix, mul, pick, pow, saturate, sin, smoothstep, sqrt, step, sub, surface,
  tabulate, variable, vec2, vec3, vec4, type Drawable, type F, type P3, type Target,
} from "../../../../src/index.ts";
import type { Branch } from "../../../../src/lib/index.ts";
import { branchOf, cluster, GROWTH_KINDS, growthPaints, RECIPES, run, sprout, type Site, type Sprig } from "../../lib/growth.ts";
import { cut, TAU, type V3 } from "../ink.ts";
import type { Numbers } from "../numbers.ts";
import type { BackOption } from "../slots.ts";
import { beaconOn } from "./beacon.ts";
import { blend, broadleaf, cape, crownPaint, hash, rockPaint, stations } from "./headland.ts";

/** The grid: rows from the crown to under the water (the rim on row ROW_RIM), columns round (2.5 degrees each: a broad
 * plate is 20 to 24 columns across). */
const NU = 46, NV = 144, ROW_RIM = 30;
/** The rim's u: above it u / U_RIM is G, below it the shore runs to u = 1. */
const U_RIM = 0.74;
/** The shore's stations below the rim (sigma: 0 the rim, 1 closed under the water): under the lip, the far edge of
 * the top, the waterline, the foot. */
const SIGMA = [0, 0.1, 0.6, 0.75, 0.87, 1] as const;

/** What a copy in the reef list is (the id's first lane is its index here): the kit's growth, then this back's own. */
const KINDS = [...GROWTH_KINDS, "trunk", "crown", "rock"] as const;
type Kind = (typeof KINDS)[number];
const cone = (kind: Kind, a: V3, b: V3, ra: number, rb: number, level: number, salt: number, mark = 0): Branch =>
  ({ a, b, ra, rb, level, id: [KINDS.indexOf(kind), salt, mark] });

const rad = (degrees: number): number => (degrees * Math.PI) / 180;
/** The bearing at v. It runs backwards in v: so the grid's faces wind outward (with v forward they face in and the
 * hull outline paints the island black). And v at a bearing, on the CPU. */
const bearingOf = (v: F): F => mul(v, -TAU);
const vAt = (bearing: number): number => (((-bearing / TAU) % 1) + 1) % 1;
/** The signed difference of two bearings, in (-pi, pi]. */
const turnFrom = (a: F, b: F | number): F => mul(sub(fract(add(div(sub(a, b), TAU), 0.5)), 0.5), TAU);
/** A leaf's width along a plate, s from its root (0) to its tip (1): full most of the way up, then drawn to a point
 * (the paint-overs' plates; a leaf widest a quarter of the way up left bare stone over the upper cliff). (1 - s)^0.45
 * (1 + 0.6 s) peaks at 1.03 near s = 0.2; 0.91 at s = 0.5, 0.52 at 0.9. */
const leaf = (s: F): F => div(mul(pow(max(sub(1, s), 1e-5), 0.45), add(1, mul(s, 0.6))), 1.03);

/** A plate in plain numbers (radians), from numbers.ts `terraces.plates`. */
type Plate = { readonly root: number; readonly sweep: number; readonly half: number; readonly tip: number; readonly thick: number };

/** The plan in plain numbers, from the build's. Lengths become shares of the atoll's mean radius; bearings radians. */
function planOf(n: Numbers) {
  const A = n.atoll, T = n.terraces, R = (A.rx + A.rz) / 2;
  const mid = (T.outline.bow + T.outline.tail) / 2, egg = (T.outline.tail - T.outline.bow) / 2;
  /** A point `rho` (a share of the radii) out from the island's centre at a bearing (crab x, z). */
  const polar = (rho: number, bearing: number): readonly [number, number] => [A.centre[0] + rho * A.rx * Math.cos(bearing), A.centre[1] + rho * A.rz * Math.sin(bearing)];
  const point = { bearing: rad(T.point.bearing), long: T.point.tip / R, half: T.point.half / R };
  const beach = { bearing: rad(T.beach.bearing), long: T.outline.tail + T.beach.sand / R, half: Math.sin(rad(T.beach.span)) * T.outline.tail * 1.12 };
  const shelf = { bearing: rad(T.shelf.bearing), long: mid + T.shelf.reach / R, half: T.shelf.half / R };
  const plates: readonly Plate[] = T.plates.map(([root, sweep, half, tip, thick]) => ({ root: rad(root), sweep: rad(sweep), half: rad(half), tip, thick }));
  return { R, mid, egg, polar, point, beach, shelf, plates, lightRho: T.light.at / R };
}

export const terraces: BackOption = {
  about: "a turf cap on pale cliffs, three broad shell plates laid up them like leaves, a cove beach, a crusted light on a point, three stacks",
  // What a thrown ship must fly clear of beyond the atoll's cylinder (the design's `fliesClear`): the rim with its
  // plates, the point from the rim to its tip, the shelf with its stacks, and the light as it leans. They ride the shell.
  keepClear: ({ n, shell }) => {
    const { R, polar, point, shelf, lightRho } = planOf(n), T = n.terraces, L = T.light;
    const disc = ([x, z]: readonly [number, number], radius: number): Target => {
      const c = add(shell.o, inFrame(shell, vec3(x, 0, z)));
      return { kind: "disc", centre: vec2(c.x, c.z), radius: lift<"f32">(radius) };
    };
    const rim = T.outline.tail + 2 * T.outline.lumps, reach = (L.height + 1.5 * L.size) * L.lean, foot = polar(lightRho, point.bearing);
    const farthest = Math.max(...T.stacks.map(([r]) => r / R));
    return [
      disc(n.atoll.centre, rim * Math.max(n.atoll.rx, n.atoll.rz) + Math.max(...T.plates.map((p) => p[4]))),
      disc(polar((rim + point.long) / 2, point.bearing), Math.max(((point.long - rim) / 2) * R, point.half * R) + 0.3),
      disc(polar((rim + farthest) / 2, shelf.bearing), Math.max(((farthest - rim) / 2) * R, shelf.half * R) + 0.6),
      disc([foot[0] + Math.cos(point.bearing) * reach / 2, foot[1] + Math.sin(point.bearing) * reach / 2], L.girth[0] * 1.2 + reach / 2 + 0.3),
    ];
  },
  draw: (rig) => {
    const { n, shell } = rig;
    const I = n.ink, A = n.atoll, T = n.terraces, C = n.carapace;
    const { R, mid, egg, polar, point: POINT, beach: BEACH, shelf: SHELF, plates: PLATES, lightRho } = planOf(n);
    // Heights (crab y): the still water, the carapace's rim line (carapace/base.ts inks it at sin = -0.15 of its
    // half-height), the crown.
    const water = -n.ride, rimY = -0.15 * C.height, crownY = A.top + T.crown;
    const ink = (k: V3): P3 => vec3(...k);
    const CAP = T.cap;

    // ---- outlines: radius (a share of the atoll's radii) over the bearing a ----
    const sandEdge = (a: F): F => cape(a, BEACH.bearing, BEACH.long, BEACH.half);
    /** How much a bearing is the cove's: 1 at the beach's middle, 0 beyond its span. */
    const coveAt = (a: F): F => { const d = div(turnFrom(a, BEACH.bearing), rad(T.beach.span) * 1.15); return mul(saturate(sub(1, mul(d, d))), saturate(sub(1, mul(d, d)))); };
    /** The rim: an egg, narrow at the bow, with slight lumps, pulled in over the beach (the cove). */
    const rimOf = (a: F): F => sub(add(sub(mid, mul(egg, cos(a))), mul(add(sin(add(mul(a, 3), 1.1)), mul(sin(add(mul(a, 5), 2.3)), 0.7)), T.outline.lumps)), mul(coveAt(a), T.beach.cove));
    const pointOut = (a: F): F => cape(a, POINT.bearing, POINT.long, POINT.half);
    const shelfEdge = (a: F): F => cape(a, SHELF.bearing, SHELF.long, SHELF.half);
    /** How much the shore at a bearing is each kind but shell (which is the rest): rock past the rim wins over sand. */
    const capeAt = (a: F): F => smoothstep(0, 0.06, sub(pointOut(a), rimOf(a)));
    const apronAt = (a: F): F => smoothstep(0, 0.06, sub(shelfEdge(a), rimOf(a)));
    const beachAt = (a: F): F => smoothstep(0.01, 0.08, sub(sandEdge(a), rimOf(a)));
    const shoreAt = (a: F) => blend({ beach: beachAt(a), apron: apronAt(a), cape: capeAt(a) });

    // ---- the hull: a cap and a cliff ----
    /** The cap's edge (G) at a bearing: it wanders, so the turf's edge is no ring. */
    const capOf = (a: F): F => add(CAP.at, mul(add(sin(add(mul(a, 2), 0.7)), mul(sin(add(mul(a, 5), 2.9)), 0.5)), CAP.wander / 1.5));
    /** The hull's radius (a share of the rim's) and height (a share from the rim, 0, to the crown, 1) at G. On the cap
     * (gc = G / cap below 1) the radius runs out to cap.radius and the height falls cap.drop as gc^2; on the cliff (t
     * from 0 at the cap's edge to 1 at the rim) the radius runs on to the rim and the height falls as t^cliff. */
    const hullR = (G: F, a: F): F => { const c = capOf(a), gc = div(min(G, c), c), t = saturate(div(sub(G, c), sub(1, c))); return add(mul(gc, CAP.radius), mul(t, 1 - CAP.radius)); };
    const hullH = (G: F, a: F): F => {
      const c = capOf(a), gc = div(min(G, c), c), t = saturate(div(sub(G, c), sub(1, c)));
      return sub(sub(1, mul(mul(gc, gc), CAP.drop)), mul(pow(max(t, 1e-6), T.cliff), 1 - CAP.drop));
    };
    /** The rim's height at a bearing: the carapace's rim line beside the carapace; round the tail, where the island
     * stands over open water, it comes down toward the water (the plates run down to the sea, as the pictures have them). */
    const rimLow = water + T.rim, rimAt = (a: F): F => mix(rimLow, rimY, smoothstep(-0.55, 0.2, cos(a)));
    /** DERIVATION (a level tread): the height is read at a held G. Over a ledge [g, g + w] in G, Gy = G until g, then g
     * (held: the tread is level while the radius runs on), then climbs back to reach 1 at the rim: Gy = G - w sat((G - g)
     * / w) + w sat((G - g - w) / (1 - g - w)). Each ledge is an arc: blended in by its window of bearing. */
    const ledged = (G: F, a: F): F => T.ledges.reduce<F>((Gy, [g, w, bearing, span]) => {
      const held = add(sub(Gy, mul(w, saturate(div(sub(G, g), w)))), mul(w, saturate(div(sub(G, g + w), 1 - g - w))));
      const d = div(turnFrom(a, rad(bearing)), rad(span)), window = smoothstep(1, 0.55, abs(d));
      return mix(Gy, held, window);
    }, G);
    const ledgeAt = (G: F, a: F): F => T.ledges.reduce<F>((on, [g, w, bearing, span]) => {
      const d = div(turnFrom(a, rad(bearing)), rad(span));
      return max(on, mul(smoothstep(1, 0.7, abs(d)), mul(cut(G, g - 0.004), sub(1, cut(G, g + w + 0.004)))));
    }, lift<"f32">(0));

    // ---- the plates ----
    /** Where a point (G, a) is on a plate: s along it (0 the rim, 1 the tip; above 1 past the tip), x across it (-1 to
     * 1 inside its width; a width of at least `least` of its half, so the flutes past the tip have one). */
    const onPlate = (P: Plate, G: F, a: F, least: number) => {
      const s = max(div(sub(1, G), 1 - P.tip), 0), d = turnFrom(a, sub(P.root, mul(P.sweep, s))), w = mul(P.half, leaf(min(s, 1)));
      // `x` across the plate; `xLeast` across a width of at least `least` of its half (the flute past its tip). The two
      // share the bearing's difference and the leaf, the dear parts (the paint evaluates every plate per pixel).
      return { s, x: div(d, max(w, 1e-4)), xLeast: div(d, max(w, P.half * least)) };
    };
    /** How far the plates stand out of the hull at (G, a): the sum of them (they do not overlap). */
    const plateOut = (G: F, a: F): F => PLATES.map((P) => {
      const { s, x } = onPlate(P, G, a, 0);
      const across = mul(sqrt(max(sub(1, mul(x, x)), 0)), add(1, mul(saturate(x), 0.35)));
      return mul(mul(across, sqrt(saturate(sub(1, mul(s, s))))), P.thick);
    }).reduce((sum, d) => add(sum, d));

    // ---- the surface ----
    const islandPoint = (u: F, v: F): P3 => {
      const G = min(div(u, U_RIM), 1), sigma = saturate(div(sub(u, U_RIM), 1 - U_RIM)), a = bearingOf(v), shore = shoreAt(a);
      const rim = rimOf(a), out = plateOut(G, a);
      // A plate stands out mostly sideways (the cliff's normal), a little up.
      const hullRho = add(mul(hullR(G, a), rim), div(mul(out, 0.9), R));
      // Over the beach the rim lifts: the plates arch over the sand.
      const hullHeight = add(add(add(rimAt(a), mul(hullH(ledged(G, a), a), sub(crownY, rimAt(a)))), mul(out, 0.4)), mul(mul(beachAt(a), T.beach.arch), smoothstep(0.7, 1, G)));
      // Below the rim, by the kind of shore: [under the lip, the far edge of the top, the waterline, the foot].
      const sand = sandEdge(a), ledge = shelfEdge(a), tip = pointOut(a);
      const rhoAt = (k: 0 | 1 | 2 | 3): F => shore({
        shell: sub(rim, [0.01, 0.035, 0.05, 0.06][k]!), beach: [sub(rim, 0.035), sub(sand, 0.02), add(sand, 0.01), sand][k]!,
        apron: [rim, sub(ledge, 0.03), ledge, sub(ledge, 0.01)][k]!, cape: [add(rim, 0.04), sub(tip, 0.05), tip, sub(tip, 0.01)][k]!,
      });
      const rho = stations(sigma, SIGMA, [hullRho, rhoAt(0), rhoAt(1), rhoAt(2), rhoAt(3), lift<"f32">(0)]);
      const top = capeTop(rho, a);
      const yAt = (k: 0 | 1 | 2 | 3): F => shore({
        shell: [sub(rimAt(a), 0.12), lift<"f32">(water + 0.1), lift<"f32">(water - 0.3), lift<"f32">(A.base)][k]!, beach: lift<"f32">([water + 0.5, water + 0.05, water - 0.25, A.base][k]!),
        apron: lift<"f32">([water + 0.42, water + 0.2, water - 0.2, A.base][k]!), cape: [top, top, lift<"f32">(water - 0.2), lift<"f32">(A.base)][k]!,
      });
      const y = stations(sigma, SIGMA, [hullHeight, yAt(0), yAt(1), yAt(2), yAt(3), lift<"f32">(A.base - 0.2)]);
      return vec3(add(A.centre[0], mul(mul(rho, A.rx), cos(a))), y, add(A.centre[1], mul(mul(rho, A.rz), sin(a))));
    };

    /** The point's top at (rho, a): low rock running out, a mound where the light stands, high at its root (it comes
     * out from under the plates), rounded across. Crab y. */
    function capeTop(rho: F, a: F): F {
      const s = mul(mul(rho, R), cos(sub(a, POINT.bearing))), t = mul(mul(rho, R), sin(sub(a, POINT.bearing)));
      const from = sub(s, lightRho * R), mound = sub(1, smoothstep(0.35, 1.35, sqrt(add(mul(from, from), mul(t, t)))));
      const root = sub(1, smoothstep(T.outline.tail * R, T.outline.tail * R + 1.3, s));
      const across = mul(div(t, POINT.half * R), div(t, POINT.half * R));
      return add(water, sub(add(add(T.point.low, mul(mound, T.point.top - T.point.low)), mul(root, T.rim - T.point.low - 0.1)), mul(across, 0.18)));
    }

    // What the inks read of the shore, per bearing, from one static table (x: v, the bearing backwards over a turn).
    const shoreTable = tabulate("terraces_shore", (x) => { const a = bearingOf(x); return vec4(capeAt(a), apronAt(a), beachAt(a), capOf(a)); }, 1025, "static");
    const islandPaint = (u: F, v: F): P3 => {
      const G = min(div(u, U_RIM), 1), sigma = saturate(div(sub(u, U_RIM), 1 - U_RIM)), a = bearingOf(v);
      const at = shoreTable(v);
      const shore = blend({ beach: cut(at.z, 0.5), apron: cut(at.y, 0.5), cape: cut(at.x, 0.5) });
      // On a plate: which (at most one), its s and x. Past its tip, its flute (a narrow corridor of stone ribs).
      const plates = PLATES.map((P) => onPlate(P, G, a, 0.3));
      // Each plate's depth inside its red (min(1 - |x|, 1 - s), positive inside) and inside its flute (past the tip, to
      // `flute` in G, within 0.3 of its half). They do not overlap, so the one a pixel is on is chosen by plain steps and
      // each edge is cut ONCE, on the deepest: a cut per plate cost a screen derivative each, 30 to a pixel.
      const deep = plates.map(({ s, x }) => min(sub(1, abs(x)), sub(1, s)));
      const deepF = plates.map(({ s, xLeast }, k) => min(sub(1, abs(xLeast)), min(sub(s, 1), sub(1 + T.flute / (1 - PLATES[k]!.tip), s))));
      const X = plates.map(({ x }, k) => mul(x, step(0, deep[k]!))).reduce((m, w) => add(m, w));
      const XF = plates.map(({ xLeast }, k) => mul(xLeast, step(0, deepF[k]!))).reduce((m, w) => add(m, w));
      const red = cut(deep.reduce((m, w) => max(m, w)), 0), flutes = cut(deepF.reduce((m, w) => max(m, w)), 0);

      // The plate: brick with dark ribs along it (lines of x: they gather to the tip, a fan), a cream lip on its leading
      // edge, a black key line round it. (`1 - cut(|f - 0.5|, w)` is 1 inside the half-width w of the period's middle.)
      const ribLine = (x: F, width: number): F => sub(1, cut(abs(sub(fract(mul(add(x, 1), T.ribs / 2)), 0.5)), width));
      const plate = mix(mix(mix(ink(I.brick), ink(I.brickDark), mul(ribLine(X, 0.07), sub(1, cut(abs(X), 0.8)))), ink(I.cream), mul(cut(X, 0.78), sub(1, cut(X, 0.93)))), ink(I.black), cut(abs(X), 0.93));
      // Stone: pale, with sparse level strata (lines of the hull's height) that wander a little; on a flute, ribs instead.
      const h = hullH(G, a);
      // Broken into dashes of unequal length, so no stratum closes into a ring.
      const dash = cut(add(sin(add(mul(a, 7), mul(h, 11))), mul(sin(add(mul(a, 17), 1.3)), 0.6)), -0.45);
      const strata = mul(mul(sub(1, cut(abs(sub(fract(add(mul(h, 6.5), mul(sin(mul(a, 3)), 0.12))), 0.5)), 0.045)), cut(G, add(at.w, 0.06))), dash);
      // Cream with stone-dark lines, as the paint-overs' cliffs (grey stone read as a bald drum under the turf).
      const stone = mix(mix(ink(I.cream), ink(I.stone), 0.35), ink(I.bark), max(mul(strata, 0.8), mul(flutes, mul(ribLine(XF, 0.1), 0.8))));
      // Turf: the cap, down to its wandering edge, and hanging over each plate's tip in a tongue; and the ledges' treads.
      const tongue = mul(mul(T.tongue, sub(1, cut(abs(XF), 0.6))), flutes);
      const turfEdge = add(add(at.w, mul(sin(add(mul(a, 23), 0.4)), 0.008)), tongue);
      const isTurf = max(sub(1, cut(G, turfEdge)), ledgeAt(G, a));
      const tuft = mul(sub(1, cut(abs(sub(fract(add(mul(a, 9), mul(G, 7))), 0.5)), 0.02)), cut(sin(add(mul(G, 61), mul(a, 13))), 0.6));
      const turf = mix(ink(I.moss), ink(I.mossDeep), tuft);
      // Key lines: the turf's edge, and the foot of the cap's shoulder.
      const turfLine = sub(1, cut(abs(sub(G, turfEdge)), 0.006));
      const above = mix(mix(mix(stone, plate, red), turf, mul(isTurf, sub(1, red))), ink(I.black), mul(turfLine, sub(1, red)));

      // Below the rim, by the kind of shore.
      const dots = mul(sin(mul(v, 67 * TAU)), sin(mul(sigma, 60)));
      // Shell: the carapace's black rim line; under it the shell's dark underside.
      const belly = mix(ink(I.black), ink(I.brickDark), cut(sigma, 0.03));
      // Beach: dark under the plates' lip, then sand, speckled.
      const sandInk = mix(ink(I.bark), mix(ink(I.cream), ink(I.stone), cut(dots, 0.93)), cut(sigma, SIGMA[1]));
      // Rock (the shelf, the point): stone with level strata, dark and wet at the water.
      const rockStrata = sub(1, cut(abs(sub(fract(add(mul(sigma, 14), mul(sin(mul(v, 40 * TAU)), 0.3))), 0.5)), 0.06));
      const rock = mix(mix(ink(I.stone), ink(I.bark), mul(rockStrata, 0.85)), ink(I.bark), cut(sigma, SIGMA[3] - 0.035));
      // The point's top is paler, crusted: cream with stone blots (the light's crust runs down into it).
      const crust = mix(mix(ink(I.cream), ink(I.stone), cut(dots, 0.35)), rock, cut(sigma, SIGMA[2] - 0.02));
      const below = shore({ shell: belly, beach: sandInk, apron: rock, cape: crust });
      return mix(above, below, cut(u, U_RIM + 0.002));
    };

    // Rows: ROW_RIM of them from the crown to the rim, the rest for the shore. Columns: even in bearing.
    const rows = (s: F): F => stations(s, [0, ROW_RIM / NU, 1], [lift<"f32">(0), lift<"f32">(U_RIM), lift<"f32">(1)]);
    const island = draw.surface("island", framed(surface(islandPoint, { u: ["cap", "cap"], v: "periodic" }), { frame: shell, scale: lift<"f32">(1) }), {
      paint: islandPaint, grid: { u: { count: NU, at: rows }, v: { count: NV, at: (s: F): F => s } }, sides: "one", outline: "hull",
    });

    // ---- the same closed forms on the CPU, for placing things on the surface ----
    const UV = [variable("terraces_u", "f32"), variable("terraces_v", "f32")] as const;
    const twin = <X>(e: F | P3) => { const g = compileJs([e]); return (x: number, y: number): X => g({ vars: { terraces_u: x, terraces_v: y }, inputs: {}, params: {} })[0] as X; };
    const onIsland = twin<V3>(islandPoint(UV[0], UV[1]));
    const capeTopJs = twin<number>(capeTop(UV[0], UV[1]));
    /** The site at (u, v): the surface's point and its outward normal, by differences. */
    const siteAt = (u: number, v: number): Site => {
      const p = onIsland(u, v), e = 2e-3, du = onIsland(Math.min(u + e, 1), v), dv = onIsland(u, v + e);
      const a: V3 = [du[0] - p[0], du[1] - p[1], du[2] - p[2]], b: V3 = [dv[0] - p[0], dv[1] - p[1], dv[2] - p[2]];
      const c: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], l = Math.hypot(c[0], c[1], c[2]) || 1;
      // Outward: away from the island's axis, or up where the surface is level.
      const sign = c[0] * (p[0] - A.centre[0]) + c[2] * (p[2] - A.centre[1]) + c[1] * 2 >= 0 ? 1 : -1;
      return { at: p, out: [(c[0] / l) * sign, (c[1] / l) * sign, (c[2] / l) * sign] };
    };
    /** Named places. On the hull at G, at a bearing (radians). */
    const facing = (G: number, bearing: number): Site => siteAt(G * U_RIM, vAt(bearing));
    /** On the shore below the rim at a bearing: sigma 0 the rim, SIGMA's stations below it. */
    const ashore = (sigma: number, bearing: number): Site => siteAt(U_RIM + sigma * (1 - U_RIM), vAt(bearing));
    /** The seam between two plates (the stone strip between one's trailing edge and the next's leading edge) as a curve
     * up it: t = 0 at the rim, 1 at `high` (G). It leans as the plates do. Growth gathers in these. */
    const seam = (from: Plate, to: Plate, high: number) => (t: number): Site => {
      const G = 0.985 - t * (0.985 - high), s = Math.max((1 - G) / (1 - (from.tip + to.tip) / 2), 0);
      const gap = ((((to.root - from.root) % TAU) + TAU) % TAU), middle = from.root + gap / 2 - ((from.sweep + to.sweep) / 2) * s;
      return facing(G, middle);
    };
    /** At a plate's tip (just below it, on the red). */
    const tipOf = (P: Plate): Site => facing(P.tip + 0.03, P.root - P.sweep * 0.94);

    // ---- growth: a few large clusters at low seams, thinning upward, rests between (the kit's recipes) ----
    const Pb = POINT.bearing, lightFoot = polar(lightRho, Pb), moundY = capeTopJs(lightRho, Pb);
    const mound: Site = { at: [lightFoot[0], moundY, lightFoot[1]], out: [0, 1, 0] };
    /** A site on the mound's flank, `far` from the light's foot toward a bearing (radians, crab), sunk as the mound falls. */
    const onMound = (far: number, toward: number, drop: number): Site => ({ at: [mound.at[0] + Math.cos(toward) * far, moundY - drop, mound.at[2] + Math.sin(toward) * far], out: unitOf([Math.cos(toward) * 0.7, 0.7, Math.sin(toward) * 0.7]) });
    const G0 = T.light.girth[0];
    const [broad0, broad1, broad2, blade0, blade1, blade2] = PLATES as unknown as readonly [Plate, Plate, Plate, Plate, Plate, Plate];
    const growth: Sprig[] = [
      // The light's foot: crust all round it, thickest to seaward; a seam's worth where the mound meets the water.
      ...[0, 1, 2].flatMap((k) => cluster(RECIPES.crust, onMound(G0 * 1.2, Pb + 0.4 + k * 2.1, 0.12), k === 0 ? 1.15 : 0.85, 500 + k)),
      ...cluster(RECIPES.seam, onMound(1.3, Pb - 0.9, 0.42), 1.3, 510),
      // The low seams, every one between a broad plate and a blade (round from the bow): denser where the camera sees.
      ...run(seam(broad0, blade0, 0.62), { recipe: RECIPES.seam, clusters: 2, size: 1.35, seed: 21, rests: 0 }),
      ...run(seam(blade0, broad1, 0.66), { recipe: RECIPES.seam, clusters: 2, size: 1.2, seed: 22, thin: 0.6, rests: 0 }),
      ...run(seam(blade1, broad2, 0.68), { recipe: RECIPES.seam, clusters: 1, size: 1.05, seed: 23 }),
      ...run(seam(broad2, blade2, 0.66), { recipe: RECIPES.seam, clusters: 1, size: 1.15, seed: 24 }),
      // The shelf: a reef's worth at the foot of the tallest stack.
      ...cluster(RECIPES.reef, ashore(0.35, rad(T.shelf.bearing + 9)), 1.2, 30),
      // Beads at the broad plates' tips, where each turns to turf (the pictures' signature).
      ...[broad0, broad1, broad2].flatMap((P, g) => cluster(RECIPES.bead, tipOf(P), 0.85, 40 + g)),
    ];

    // ---- trees: two groves on the treads, open turf between ----
    const trees = T.groves.flatMap(([G, bearing, count], g) => Array.from({ length: count }, (_, k) => {
      // Round the grove's middle, not in a row: each tree its own step of bearing and height.
      const turn = (k / count) * TAU + g, far = k === 0 ? 0 : 0.085;
      const foot = facing(Math.max(G + far * Math.cos(turn), 0.04), rad(bearing) + (far * 5.5 * Math.sin(turn)) / Math.max(G * 4, 0.6)).at;
      return broadleaf(cone, foot, 1.15 + 0.4 * hash(g * 7 + k), 40 + g * 10 + k);
    }).flat());

    // ---- the stacks on the shelf: three tapered forms, shrinking outward; boulders on the sand ----
    const stacks = T.stacks.map(([r, bearing, tall, girth], k) => {
      const [x, z] = polar(r / R, rad(bearing)), lean = 0.16 * (hash(200 + k) - 0.5);
      return cone("rock", [x, A.base - 0.3, z], [x + lean, water + tall, z - lean], girth, girth * 0.42, 0, 200 + k, water);
    });
    const boulders = [0.3, 0.72].map((f, k) => {
      const p = ashore(0.42, rad(T.beach.bearing + T.beach.span * (2 * f - 1) * 0.7)).at, s = 0.2 + 0.07 * k;
      return cone("rock", [p[0], p[1], p[2]], [p[0] + 0.05, p[1] + 0.1, p[2]], s, s * 0.8, 0, 230 + k, p[1] - s);
    });

    const paints: Record<Kind, (hit: { p: P3; normal: P3; id: P3 }) => P3> = {
      ...growthPaints(I), trunk: () => ink(I.bark), crown: crownPaint(I), rock: rockPaint(I),
    };
    const reefList = draw.copies("reef", {
      kind: "cone",
      copies: [...growth.map((g) => branchOf(g, KINDS.indexOf(g.kind))), ...trees, ...stacks, ...boulders],
      carry: shell,
      // One thin dispatcher on the copy's kind; p is in the crab's coordinates, so every pattern rides it.
      paint: (hit) => pick(hit.id.x, KINDS.map((k) => paints[k](hit))),
      outline: "silhouette", minPixels: 1, keepLevels: 2, inkBack: 6,
    });

    // ---- the light, on the mound ----
    const L = T.light;
    const light: Drawable[] = beaconOn(rig, {
      foot: [mound.at[0], moundY - 0.3, mound.at[2]], out: [Math.cos(Pb), Math.sin(Pb)], height: L.height, girth: L.girth, crust: L.crust, size: L.size, gulls: L.gulls,
      lean: L.lean, rise: L.rise, shutters: L.shutters,
    });

    return [island, reefList, ...light];
  },
};

const unitOf = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

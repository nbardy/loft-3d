// RECIPE: sea growth for any creature. Copy this file and edit it; it imports only the library's public entry.
//
// What it makes, and from what. A small kit of print motifs (docs/art_direction/crab_round4/growth/motif_sheet.webp:
// acorn barnacles, a mussel bed, a branching coral, a fan coral, a kelp fringe), every one of them made of rounded
// cones (`Branch`), so a whole creature's growth is copies in ONE `draw.copies` list (no draw per barnacle), and three
// ways to put it on a surface: one motif (`sprout`), a cluster at a place (`cluster`, by a `Recipe` of parts), or a run
// of clusters along a curve with rests between them (`run`: a seam, a band's edge, a tide line). Flat inks with key
// lines (`growthPaints`). It all runs once, on the CPU, when the scene is built: plain numbers, seeded, so the same seed
// grows the same growth.
//
// Parameters: a site (a point and the outward normal), a size and a seed for each call; `RECIPES` holds four clusters;
// `run` takes how many clusters, how they crowd the low end, thin upward and break into rests.
//
// What it cannot do:
// - move: growth is fixed in the coordinates of the list it rides (it sways only if that list's carrier does);
// - anything that is not a cone: no plates, no blades, no shells with an opening, no fronds wider than a cone;
// - lie on the surface: each motif stands on its site along the normal there, and does not follow a curved surface
//   beyond that point (a large cluster on a tight curve floats at its edges);
// - avoid itself or the body: clusters may cross each other, and nothing keeps a cone out of the creature.
//
// Copying it: add a motif first (a case in `Motif`, a function returning `Sprig`s, a line in `sprout`, a paint in
// `growthPaints`), then a recipe. Relatives worth trying: the same cones placed by a branching rule are trees and
// antlers (the library's `tree`); placed on a sphere by a golden-angle spiral they are a sea urchin's spines; on a run
// along a strand's spine they are a dorsal row of spikes.
//
// Nothing here knows the creature. The creature gives **sites** (a point on its surface and the outward normal there,
// in whatever coordinates its list rides) and its inks, and adds the kit's kinds to its own list:
//
//   const KINDS = [...GROWTH_KINDS, "trunk", "rock"] as const;                       // the list's kinds, the kit's first
//   const grown = [
//     ...cluster(RECIPES.seam, site, 1.2, 7),                                         // one cluster: a size and a seed
//     ...run((t) => edgeOfBand(t), { recipe: RECIPES.seam, clusters: 5, size: 1, seed: 3 }),  // low end at t = 0
//   ];
//   draw.copies("reef", {
//     kind: "cone", carry: frame, outline: "silhouette", minPixels: 1, keepLevels: 2, inkBack: 6,
//     copies: [...grown.map((g) => branchOf(g, KINDS.indexOf(g.kind))), ...mine],
//     paint: (hit) => pick(hit.id.x, KINDS.map((k) => paints[k](hit))),              // paints = { ...growthPaints(inks), trunk, rock }
//   });
//
// A copy's id carries its kind's index in the list (first lane) and two numbers its own paint reads (`lanes`).
// Sizes: at size 1 a cluster is about 1.6 across and its largest barnacle 0.5; `cluster` scales everything.

import { abs, add, cos, dot, edgeOf, max, mix, mul, sin, sqrt, sub, vec3, type Branch, type Expr, type F, type P3 } from "../../../src/index.ts";

export type V3 = readonly [number, number, number];
type Rgb = readonly [number, number, number];

/** A place on a surface: the point, and the surface's outward unit normal there. */
export type Site = { readonly at: V3; readonly out: V3 };

/** What a cone of the kit is painted as. A creature's list puts these among its own kinds. */
export const GROWTH_KINDS = ["barnacle", "mussel", "coral", "fan", "kelp"] as const;
export type GrowthKind = (typeof GROWTH_KINDS)[number];

/** One rounded cone of growth: its ends and radii, and two numbers its kind's paint reads (a barnacle: its axis's x and
 * z; the others: a salt). */
export type Sprig = { readonly kind: GrowthKind; readonly a: V3; readonly b: V3; readonly ra: number; readonly rb: number; readonly lanes: readonly [number, number] };

/** The motifs. */
export type Motif =
  /** Acorn barnacles: squat cream cones with a dark crater, one large and the rest crowding it. */
  | { readonly kind: "barnacles"; readonly count: number }
  /** A mussel bed: blue-black teardrops standing in a fan from one root. */
  | { readonly kind: "mussels"; readonly count: number }
  /** A branching coral: a stem, three boughs, knobbed twigs. */
  | { readonly kind: "coral" }
  /** A fan coral: thin ribs radiating in one plane, forked at their ends. */
  | { readonly kind: "fan" }
  /** A kelp fringe: ribbons hanging from the site, waving as they fall. */
  | { readonly kind: "kelp"; readonly strands: number };

// ---- plain vector arithmetic (the kit runs once, on the CPU, when the scene is built) ----
const plus = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const crossOf = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const UP: V3 = [0, 1, 0];
/** Two unit directions across a site: `side` level along the surface, `rise` up it (on a level surface: x and z). */
function across(site: Site): { readonly side: V3; readonly rise: V3 } {
  const level = Math.hypot(site.out[0], site.out[2]) > 1e-3;
  const side = level ? unit(crossOf(UP, site.out)) : [1, 0, 0] as const;
  return { side, rise: unit(crossOf(site.out, side)) };
}
/** A number in [0, 1) from a seed: the same seed, the same growth. */
export const chance = (seed: number): number => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** One motif grown at a site, `size` times its drawn size. The one dispatcher over the motifs. */
export function sprout(m: Motif, site: Site, size: number, seed: number): Sprig[] {
  switch (m.kind) {
    case "barnacles": return barnacles(site, size, seed, m.count);
    case "mussels": return mussels(site, size, seed, m.count);
    case "coral": return coral(site, size, seed);
    case "fan": return fan(site, size, seed);
    case "kelp": return kelp(site, size, seed, m.strands);
  }
}

function barnacles(site: Site, size: number, seed: number, count: number): Sprig[] {
  const { side, rise } = across(site);
  return Array.from({ length: count }, (_, j) => {
    const turn = 2 * Math.PI * (j / Math.max(count - 1, 1) + 0.37 * chance(seed + j)), far = j === 0 ? 0 : size * (0.42 + 0.3 * chance(seed * 3 + j));
    const r = size * (j === 0 ? 0.3 : 0.14 + 0.1 * chance(seed * 5 + j));
    const root = plus(plus(plus(site.at, side, Math.cos(turn) * far), rise, Math.sin(turn) * far), site.out, -0.35 * r);
    // It stands out of the surface, tipped a little upward and each its own way; never below level (its paint assumes so).
    const lean = unit(plus(plus(plus(site.out, UP, 0.45), side, 0.5 * (chance(seed * 7 + j) - 0.5)), rise, 0.5 * (chance(seed * 11 + j) - 0.5)));
    const axis = unit([lean[0], Math.max(lean[1], 0.12), lean[2]]);
    return { kind: "barnacle", a: root, b: plus(root, axis, 1.15 * r), ra: r, rb: 0.42 * r, lanes: [axis[0], axis[2]] as const };
  });
}

function mussels(site: Site, size: number, seed: number, count: number): Sprig[] {
  const { side, rise } = across(site);
  return Array.from({ length: count }, (_, j) => {
    // A fan about the root: each shell leans further to its side, the outer ones lower.
    const f = count === 1 ? 0 : (j / (count - 1)) * 2 - 1, long = size * (0.36 + 0.12 * chance(seed + j)) * (1 - 0.25 * Math.abs(f));
    const way = unit(plus(plus(plus(site.out, UP, 0.5), side, 1.1 * f), rise, 0.25 * (chance(seed * 3 + j) - 0.3)));
    const root = plus(plus(site.at, side, 0.16 * size * f), site.out, -0.04 * size);
    return { kind: "mussel", a: root, b: plus(root, way, long), ra: 0.07 * size, rb: 0.3 * long, lanes: [chance(seed * 13 + j), 0] as const };
  });
}

function coral(site: Site, size: number, seed: number): Sprig[] {
  const { side, rise } = across(site);
  const stem = unit(plus(site.out, UP, 0.7)), top = plus(site.at, stem, 0.42 * size), salt = chance(seed);
  const twig = (from: V3, way: V3, long: number, ra: number, rb: number): Sprig => ({ kind: "coral", a: from, b: plus(from, way, long), ra, rb, lanes: [salt, 0] as const });
  const boughs = [-1, 0, 1].flatMap((k) => {
    const way = unit(plus(plus(stem, side, 0.85 * k + 0.3 * (chance(seed + k + 5) - 0.5)), rise, 0.5 * (chance(seed + k + 9) - 0.5)));
    const end = plus(top, way, size * (0.5 - 0.08 * Math.abs(k)));
    // Each bough forks into two knobbed twigs (wider at the end than at the fork, as the print draws them).
    const forks = [-1, 1].map((q) => twig(end, unit(plus(plus(way, side, 0.55 * q), UP, 0.35)), size * (0.26 + 0.1 * chance(seed + k * 3 + q)), 0.075 * size, 0.095 * size));
    return [twig(top, way, size * (0.5 - 0.08 * Math.abs(k)), 0.1 * size, 0.085 * size), ...forks];
  });
  return [twig(plus(site.at, site.out, -0.08 * size), stem, 0.5 * size, 0.13 * size, 0.105 * size), ...boughs];
}

function fan(site: Site, size: number, seed: number): Sprig[] {
  // The fan's plane holds `side` and its stem; it faces out of the surface.
  const { side } = across(site), stem = unit(plus(site.out, UP, 0.9)), salt = chance(seed);
  const rib = (from: V3, way: V3, long: number, r: number): Sprig => ({ kind: "fan", a: from, b: plus(from, way, long), ra: r, rb: 0.75 * r, lanes: [salt, 0] as const });
  const root = plus(site.at, site.out, -0.05 * size);
  return [-2, -1, 0, 1, 2].flatMap((k) => {
    const lean = 0.42 * k + 0.1 * (chance(seed + k + 3) - 0.5), way = unit(plus(stem, side, Math.tan(lean)));
    const long = size * (0.95 - 0.09 * Math.abs(k)), fork = plus(root, way, 0.6 * long);
    return [rib(root, way, 0.62 * long, 0.06 * size), ...[-1, 1].map((q) => rib(fork, unit(plus(way, side, 0.32 * q)), 0.42 * long, 0.048 * size))];
  });
}

function kelp(site: Site, size: number, seed: number, strands: number): Sprig[] {
  const { side, rise } = across(site);
  return Array.from({ length: strands }, (_, j) => {
    const f = strands === 1 ? 0 : (j / (strands - 1)) * 2 - 1, long = size * (0.9 + 0.5 * chance(seed + j)), salt = chance(seed * 3 + j);
    // A ribbon in three lengths, lying down the surface from the site (on a steep face: hanging), swinging to its side
    // and back, a little proud of the surface.
    const knots = [0, 1, 2, 3].map((k): V3 => plus(plus(plus(site.at, side, size * (0.28 * f + 0.16 * Math.sin(1.9 * k + 6 * salt) * (k > 0 ? 1 : 0))), rise, -(k / 3) * long), site.out, 0.04 * size * (k + 1)));
    return [0, 1, 2].map((k): Sprig => ({ kind: "kelp", a: knots[k]!, b: knots[k + 1]!, ra: size * (0.105 - 0.02 * k), rb: size * (0.085 - 0.02 * k), lanes: [salt, 0] as const }));
  }).flat();
}

// ---- clusters ----
/** One part of a cluster: a motif, how many of it at cluster size 1, how far from the middle (cluster sizes), its own
 * size against the cluster's, and where it sits: `low` hangs below the middle (kelp), `high` stands above it (coral). */
export type Part = { readonly motif: Motif; readonly many: number; readonly spread: number; readonly size: number; readonly sits: "low" | "middle" | "high" };
/** A cluster is its parts. */
export type Recipe = readonly Part[];

/** Recipes, by where they belong. */
export const RECIPES = {
  /** A low seam or a valley between plates: barnacles thick, a mussel bed, a coral standing over them, kelp below. */
  seam: [
    { motif: { kind: "barnacles", count: 6 }, many: 1, spread: 0.55, size: 1.1, sits: "middle" },
    { motif: { kind: "mussels", count: 5 }, many: 1, spread: 0.45, size: 1.1, sits: "middle" },
    { motif: { kind: "coral" }, many: 1, spread: 0.35, size: 0.85, sits: "high" },
    { motif: { kind: "kelp", strands: 3 }, many: 1, spread: 0.3, size: 1.2, sits: "low" },
  ],
  /** A reef flat: corals, a fan, mussels at their feet. */
  reef: [
    { motif: { kind: "coral" }, many: 1, spread: 0.4, size: 0.9, sits: "middle" },
    { motif: { kind: "fan" }, many: 1, spread: 0.5, size: 1.1, sits: "high" },
    { motif: { kind: "mussels", count: 5 }, many: 1, spread: 0.35, size: 0.9, sits: "low" },
    { motif: { kind: "barnacles", count: 4 }, many: 1, spread: 0.7, size: 0.8, sits: "middle" },
  ],
  /** A crust: nothing but barnacles, with a mussel bed among them. */
  crust: [
    { motif: { kind: "barnacles", count: 6 }, many: 2, spread: 0.6, size: 1.05, sits: "middle" },
    { motif: { kind: "mussels", count: 3 }, many: 1, spread: 0.3, size: 0.8, sits: "low" },
  ],
  /** Three or four barnacles in a knot: a bead on a plate's tip. */
  bead: [{ motif: { kind: "barnacles", count: 4 }, many: 1, spread: 0, size: 1.1, sits: "middle" }],
} as const satisfies Record<string, Recipe>;

/** A cluster grown at a site: each part of the recipe `many` times (at least once), scattered `spread` from the middle. */
export function cluster(recipe: Recipe, site: Site, size: number, seed: number): Sprig[] {
  const { side, rise } = across(site);
  const lift = { low: -0.45, middle: 0, high: 0.4 } as const;
  return recipe.flatMap((part, i) => Array.from({ length: Math.max(1, Math.round(part.many)) }, (_, j) => {
    const s = seed * 17 + i * 5 + j * 3, turn = 2 * Math.PI * chance(s), far = part.spread * size * (0.5 + 0.5 * chance(s + 1));
    const at = plus(plus(site.at, side, Math.cos(turn) * far), rise, Math.sin(turn) * far * 0.6 + lift[part.sits] * size * part.spread * 1.6);
    return sprout(part.motif, { at, out: site.out }, size * part.size * (0.85 + 0.3 * chance(s + 2)), s);
  }).flat());
}

/**
 * A run of clusters along a curve: `curve(t)` is the site at t (t = 0 its low end, 1 its high end; a seam climbing a
 * shell, a band's edge). The clusters crowd the low end and thin upward, in size and in number, and bunch with rests
 * between bunches rather than standing evenly:
 * - `clusters`: how many;
 * - `size`: of the lowest; the highest is `size * (1 - thin)` (`thin` default 0.55);
 * - `crowd`: how hard they crowd the low end (1 even, 2 as the square of t; default 1.7);
 * - `rests`: how many gaps the run is broken by (default 1): clusters falling in a gap are moved to its lower edge.
 */
export function run(curve: (t: number) => Site, o: { readonly recipe: Recipe; readonly clusters: number; readonly size: number; readonly seed: number; readonly thin?: number; readonly crowd?: number; readonly rests?: number }): Sprig[] {
  const thin = o.thin ?? 0.55, crowd = o.crowd ?? 1.7, rests = o.rests ?? 1;
  /** The gaps: `rests` of them, each a tenth to a fifth of the run, spread over its upper three quarters. */
  const gaps = Array.from({ length: rests }, (_, g) => { const from = 0.25 + (0.75 * (g + 0.3 * chance(o.seed + g))) / rests; return [from, from + 0.1 + 0.1 * chance(o.seed + g + 7)] as const; });
  return Array.from({ length: o.clusters }, (_, k) => {
    const even = o.clusters === 1 ? 0 : (k + 0.35 * (chance(o.seed * 3 + k) - 0.5)) / (o.clusters - 1);
    const raw = Math.min(Math.max(even, 0), 1) ** crowd;
    const gap = gaps.find(([from, to]) => raw > from && raw < to);
    const t = gap === undefined ? raw : gap[0] - 0.02 * k;
    return cluster(o.recipe, curve(Math.max(t, 0)), o.size * (1 - thin * t), o.seed * 31 + k);
  }).flat();
}

/** A sprig as a copy of a `draw.copies` cone list whose kinds hold the kit's: `kind` is its kind's index there. */
export const branchOf = (g: Sprig, kind: number): Branch => ({ a: g.a, b: g.b, ra: g.ra, rb: g.rb, level: 2, id: [kind, g.lanes[0], g.lanes[1]] });

// ---- paint: flat inks with key lines, in the list's coordinates ----
/** The inks the kit paints with. */
export type GrowthInks = { readonly cream: Rgb; readonly stone: Rgb; readonly bark: Rgb; readonly coral: Rgb; readonly coralDeep: Rgb; readonly mussel: Rgb; readonly kelp: Rgb; readonly mossDeep: Rgb };
/** A crisp edge (one pixel), as the woodblock's inks are cut. */
const cut = (x: F, at: number | F): F => edgeOf(x, at, 1e-5);
type Hit = { readonly p: P3; readonly normal: P3; readonly id: Expr<"vec3"> };

/** The kit's paints, one per kind: a creature spreads them into its own list's record. */
export function growthPaints(I: GrowthInks): Record<GrowthKind, (hit: Hit) => P3> {
  const ink = (k: Rgb): P3 => vec3(...k);
  return {
    // Cream, a dark crater where the surface faces along the cone's own axis (the id carries the axis's x and z; it
    // never points below level), and thin ridge lines down its sides.
    barnacle: ({ p, normal, id }) => {
      const axis = vec3(id.y, sqrt(max(sub(1, add(mul(id.y, id.y), mul(id.z, id.z))), 0)), id.z), facing = dot(normal, axis);
      const ridge = mul(sub(1, cut(abs(sin(mul(add(add(p.x, p.z), mul(p.y, 0.4)), 30))), 0.3)), sub(1, cut(facing, 0.55)));
      return mix(mix(ink(I.cream), ink(I.stone), ridge), ink(I.bark), cut(facing, 0.9));
    },
    // Blue-black, with pale growth lines across the shell.
    mussel: ({ p, id }) => mix(ink(I.mussel), ink(I.cream), mul(sub(1, cut(abs(sin(add(mul(add(p.y, mul(p.x, 0.5)), 21), mul(id.y, 6.3)))), 0.16)), 0.75)),
    // Pink with cream specks.
    coral: ({ p }) => mix(ink(I.coral), ink(I.cream), cut(mul(mul(sin(mul(p.x, 9)), sin(add(mul(p.y, 9), 1))), sin(add(mul(p.z, 9), 2))), 0.33)),
    // A deeper red, flat: the fan is all line.
    fan: () => ink(I.coralDeep),
    // Olive, every other ribbon darker.
    kelp: ({ id }) => mix(ink(I.kelp), ink(I.mossDeep), cut(cos(mul(id.y, 40)), 0.2)),
  };
}

// RECIPE: a boat's hull lofted from a lines plan. Copy this file and edit it; it imports only the public entry.
//
// What it makes: the hull of a wooden monohull with a transom stern, the way a naval architect's lines plan defines
// one: a sheer line (the deck edge's height along the length), a half-breadth plan (how wide each station is), a keel
// profile and a body plan (the shape of each section). Each station is a section curve across the hull; the skin is a
// loft through them, a uniform Catmull-Rom spline along the length (`through`), so it passes through every station
// exactly. Deck, bulwarks and transom are `sheet`s between curves of the same lines; paint is a function of (u, v).
//
// From which library pieces: `through` (the loft along the length), `sheet` and `mapNormal` (the deck, bulwarks and
// transom), `fwidth` and a box distance (gun ports drawn in paint), plain expressions for every law.
//
// Coordinates (all local to the hull): x toward the bow, y up, z to starboard, the waterline at y = 0, amidships at
// x = 0. The skin's (u, v): u from the stern (0) to the bow (1); v round the section from the port deck edge (0)
// through the keel (1/2) to the starboard deck edge (1), so the normal d/du x d/dv points outward. The skin is a
// `skin` target as it stands (`{ kind: "skin", skin: h.skin, frame }`): checks measure contact with its own shape.
//
// A section, half of it at a time (w = |2v - 1|, 0 at the keel, 1 at the deck edge): from the keel to the turn of the
// bilge a quarter superellipse of exponent `fullness` (2 a round bilge, higher a flat floor and hard bilge, nearer 1 a
// V), its floor lifted by `deadrise`; from there to the deck edge the topsides, drawn in by `tumblehome`. The two pieces
// meet with a common vertical tangent at the greatest breadth, so the section has no crease.
//
// Parameters: `HullSpec`, sixteen numbers, all fixed at build (decided once, in `canonical`).
//
// What it cannot do:
// - lines other than these power laws and smoothsteps: no hollow bow, no bulbous forefoot, no flared entry.
// - a section other than superellipse plus topsides: no chine (a hard corner), no flat-bottomed punt, no catamaran.
// - move: a body that flexes, breathes or is crushed in place needs its stations to be functions of time.
// - be anything but a monohull with a transom stern and a raked stem.
//
// What to change first when copying it: `section` (the body plan) and `half` (the half-breadth law). The skin is
// `through(u, stations)`, so any row of section curves you write, moving or not, lofts the same way: a pod, a seed, a
// fuselage. For a body round in every section use `lathe`; for one swept straight, `extrude`.

import {
  abs, add, atan2, clamp, cos, div, fract, lift, lt, mapNormal, max, min, mix, mul, NO_SKELETON, pow, select, sheet, sign, sin, smoothstep, sqrt, sub,
  through, vec2, vec3, fwidth, length, type Expr, type F, type In, type P3, type Paint, type Rgb, type Skeleton, type Surface,
} from "../../src/index.ts";

export type { Rgb };

/** Exact distance to an axis-aligned box centred on the origin with half extents `half` (the gun ports). */
const sdBox = (p: Expr<"vec2">, half: Expr<"vec2">): F => { const q = sub(abs(p), half); return add(length(max(q, 0)), min(max(q.x, q.y), 0)); };

export type HullSpec = {
  /** Stem to stern along the waterline, world units. */
  readonly length: number;
  /** Greatest breadth. */
  readonly beam: number;
  /** Keel below the waterline amidships (the draught). */
  readonly depth: number;
  /** Deck edge above the waterline amidships. */
  readonly freeboard: number;
  /** Rise of the deck edge at the stern and at the bow, above `freeboard`. Default [0.3, 0.45] of the freeboard. */
  readonly sheer?: readonly [number, number];
  /** Raised decks: extra height of the sheer over the after and the forward part of the hull. Default [0, 0]. */
  readonly castle?: readonly [number, number];
  /** Fineness of the bow: exponent of the half-breadth law forward of the widest station (higher is bluffer). Default 2. */
  readonly entry?: number;
  /** The same aft of it. Default 2.4. */
  readonly run?: number;
  /** Where the widest station is, as a fraction from the stern. Default 0.55. */
  readonly widest?: number;
  /** Section shape: superellipse exponent below the turn of the bilge. Default 2.6. */
  readonly fullness?: number;
  /** Rise of the floor per unit of breadth. Default 0.18. */
  readonly deadrise?: number;
  /** How far the topsides lean in at the deck edge, as a fraction of the half-breadth. Default 0.08. */
  readonly tumblehome?: number;
  /** Breadth of the transom (the flat stern) as a fraction of the beam. Default 0.5. */
  readonly transom?: number;
  /** Forward rake of the stem per unit of height. Default 0.45. */
  readonly rake?: number;
  /** Station curves the skin is lofted through. Default 17. */
  readonly stations?: number;
  /** Bulwark height above the deck, as a fraction of the freeboard. Default 0.22. */
  readonly bulwark?: number;
};

/** Every number of the lines decided. */
export type Lines = { readonly [K in keyof HullSpec]-?: Exclude<HullSpec[K], undefined> };

export type HullLook = {
  readonly hull: Rgb; readonly bottom: Rgb; readonly wale: Rgb; readonly trim: Rgb; readonly deck: Rgb;
  /** Gun ports per side (0 for none). */
  readonly ports: number;
};

/** A station: its place along the length (u) and its section curve (v round the section). */
export type Station = { readonly u: number; readonly curve: (v: F) => P3 };

/** sign(x) |x|^k with the base floored (WGSL's pow is undefined at 0). For x >= 0 here. */
const powz = (x: F, k: In<"f32">): F => pow(max(x, 1e-12), k);

export class Hull {
  readonly lines: Lines;
  readonly stations: readonly Station[];
  /** The outer skin, lofted through the stations. */
  readonly skin: Surface;
  /** The deck, inside the bulwarks; (u, v) with v from starboard (0) to port (1), so it faces up. */
  readonly deck: Surface;
  /** The inner faces of the bulwarks, from the rail down to the deck edge (two-sided). */
  readonly bulwarks: readonly [Surface, Surface];
  /** The flat stern, from the stern section up to the chord across its top. */
  readonly transom: Surface;

  constructor(spec: HullSpec) {
    this.lines = canonical(spec);
    const n = this.lines.stations;
    this.stations = Array.from({ length: n }, (_, i) => {
      const u = lift<"f32">(i / (n - 1));
      return { u: i / (n - 1), curve: (v: F) => this.section(u, v) };
    });
    const skinPoint = (u: F, v: F): P3 => through(u, this.stations.map((s) => s.curve(v)));
    this.skin = { point: skinPoint, normal: mapNormal(skinPoint), anchor: skinPoint, topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON };
    const L = this.lines;
    // The deck edge: the rail lowered by the bulwark and drawn in a little.
    const deckEdge = (u: F, v: number): P3 => {
      const p = skinPoint(u, lift<"f32">(v));
      return vec3(p.x, sub(p.y, L.bulwark * L.freeboard), mul(p.z, 0.93));
    };
    const deckPoint = (u: F, v: F): P3 => {
      const camber = mul(mul(v, sub(1, v)), 4 * 0.025 * L.beam);
      return add(mix(deckEdge(u, 1), deckEdge(u, 0), v), vec3(0, camber, 0));
    };
    this.deck = { point: deckPoint, normal: mapNormal(deckPoint), anchor: deckPoint, topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON };
    this.bulwarks = [
      sheet((u) => skinPoint(lift<"f32">(u), lift<"f32">(1)), (u) => deckEdge(lift<"f32">(u), 1)),
      sheet((u) => skinPoint(lift<"f32">(u), lift<"f32">(0)), (u) => deckEdge(lift<"f32">(u), 0)),
    ];
    const stern = this.stations[0].curve;
    const top = (v: F): P3 => mix(stern(lift<"f32">(0)), stern(lift<"f32">(1)), v);
    this.transom = sheet((v) => stern(lift<"f32">(v)), (v) => top(lift<"f32">(v)));
  }

  /** Station position along the length, world x. */
  x(u: F): F { return mul(sub(u, 0.5), this.lines.length); }

  /** Half-breadth at the turn of the bilge (the greatest at that station). */
  half(u: F): F {
    const L = this.lines, um = L.widest;
    const fore = sub(1, powz(div(max(sub(u, um), 0), 1 - um), L.entry));
    const aft = sub(1, mul(powz(div(max(sub(um, u), 0), um), L.run), 1 - L.transom));
    return mul(mul(fore, aft), L.beam / 2);
  }

  /** Keel below the waterline: the forefoot is cut away toward the stem. */
  keel(u: F): F {
    return mul(sub(1, mul(powz(smoothstep(0.7, 1, u), 1.5), 0.5)), this.lines.depth);
  }

  /** Deck edge above the waterline: sheer rising toward both ends, and raised decks. */
  sheerAt(u: F): F {
    const L = this.lines;
    const aft = div(max(sub(0.5, u), 0), 0.5), fore = div(max(sub(u, 0.5), 0), 0.5);
    const castles = add(mul(smoothstep(0.31, 0.23, u), L.castle[0]), mul(smoothstep(0.8, 0.87, u), L.castle[1]));
    return add(add(L.freeboard, add(mul(mul(aft, aft), L.sheer[0]), mul(mul(fore, fore), L.sheer[1]))), castles);
  }

  /** Section fullness along the length: finer toward the bow and the stern, where the water parts and closes. */
  fullnessAt(u: F): F {
    const ends = max(smoothstep(0.55, 0.95, u), smoothstep(0.4, 0.05, u));
    return mix(lift<"f32">(this.lines.fullness), lift<"f32">(Math.min(this.lines.fullness, 1.9)), ends);
  }

  /** Height of the greatest breadth (the turn of the bilge). */
  private bilge(): number { return 0.2 * this.lines.freeboard; }

  /** The share of the half-section (keel to deck edge) below the turn of the bilge, by rough arc length. */
  private split(u: F): F {
    const B = this.half(u), D = this.keel(u), F_ = this.sheerAt(u), yb = this.bilge();
    const below = add(mul(add(B, add(D, yb)), 0.9), 1e-4);
    return div(below, add(below, sub(F_, yb)));
  }

  /** The section at station u, at v round it (port deck edge 0, keel 1/2, starboard deck edge 1). */
  section(u: F, v: F): P3 {
    const L = this.lines;
    const B = this.half(u), D = this.keel(u), F_ = this.sheerAt(u), yb = this.bilge();
    const w = abs(sub(mul(v, 2), 1)), side = sign(sub(mul(v, 2), 1));
    const wb = this.split(u);
    const a = mul(clamp(div(w, wb), 0, 1), Math.PI / 2);
    const tau = clamp(div(sub(w, wb), sub(1, wb)), 0, 1);
    const e = div(2, this.fullnessAt(u));
    const cb = powz(cos(a), e), sb = powz(sin(a), e);
    // Toward the stern the lower sections pinch in to the sternpost (a wineglass stern): the transom is wide only above.
    // A bounded factor, not a power of sb: as a power, neighbouring stations differed by orders of magnitude near the
    // keel, the loft's Catmull-Rom overshoot flipped the sign of z there and the skin folded along the keel (caught by
    // the outward-normal test in tests/ships.test.ts).
    const zLow = mul(mul(B, sb), sub(1, mul(mul(smoothstep(0.32, 0, u), 0.75), sub(1, sb))));
    const yLow = add(sub(yb, mul(add(D, yb), cb)), mul(mul(zLow, cb), L.deadrise));
    const zTop = mul(B, sub(1, mul(mul(tau, tau), L.tumblehome)));
    const yTop = add(yb, mul(sub(F_, yb), tau));
    const low = lt(w, wb);
    const z = select(low, zLow, zTop), y = select(low, yLow, yTop);
    // The stem rakes forward as it rises; the stern counter a little aft.
    const rise = add(y, D);
    const bow = mul(smoothstep(0.72, 1, u), smoothstep(0.72, 1, u));
    const counter = smoothstep(0.2, 0, u);
    const x = add(this.x(u), sub(mul(mul(rise, bow), L.rake), mul(mul(rise, counter), 0.18)));
    return vec3(x, y, mul(z, side));
  }

  /** The skeleton the hull casts shadows with: capsules along its length at half the freeboard. */
  skeleton(): Skeleton {
    const n = 9;
    return {
      joints: n,
      joint: (k) => {
        const u = lift<"f32">(0.04 + (0.92 * k) / (n - 1));
        return { p: vec3(this.x(u), mul(this.sheerAt(u), 0.45), 0), r: max(mul(this.half(u), 0.85), 0.05) };
      },
    };
  }

  /**
   * Paint in the hull's own coordinates: the bottom below the boot-top line, a black wale, strakes, a band of gun
   * ports with their lids, and a trim band under the rail. Evaluated per pixel from the same closed-form lines.
   */
  paint(look: HullLook): Paint {
    const L = this.lines;
    const rgb = (c: Rgb) => vec3(c[0], c[1], c[2]);
    return (u, v) => {
      const w = abs(sub(mul(v, 2), 1));
      const D = this.keel(u), F_ = this.sheerAt(u), yb = this.bilge();
      const wb = this.split(u);
      // The waterline (y = 0) on the bilge piece, ignoring deadrise: cos(a)^(2/n) = yb / (D + yb).
      const c = powz(div(yb, add(D, yb)), div(this.fullnessAt(u), 2));
      const wl = mul(div(atan2(sqrt(max(sub(1, mul(c, c)), 0)), c), Math.PI / 2), wb);
      const tau = div(sub(w, wb), sub(1, wb));
      const topsH = sub(F_, yb);
      const edge = (d: F) => { const fw = max(fwidth(d), 1e-4); return sub(1, smoothstep(mul(fw, -1), fw, d)); };
      let col: Expr<"vec3"> = rgb(look.hull);
      // Strakes: thin lines between planks.
      const plank = abs(sub(fract(mul(w, 16)), 0.5));
      col = mix(col, mul(col, 0.72), mul(edge(sub(0.47, plank)), 0.6));
      // Trim band under the rail, and the wale.
      col = mix(col, rgb(look.trim), edge(sub(abs(sub(tau, 0.86)), 0.065)));
      col = mix(col, rgb(look.wale), edge(sub(abs(sub(tau, 0.16)), 0.07)));
      // Gun ports: squares in world units along the band between wale and trim, with lids in the trim colour.
      if (look.ports > 0) {
        const span = 0.5, start = 0.24, n = look.ports;
        const cell = div(sub(u, start), span / n);
        const inRange = mul(smoothstep(-0.01, 0, cell), sub(1, smoothstep(n, n + 0.01, cell)));
        const cellWorld = (span / n) * L.length;
        const q = vec2(mul(sub(fract(cell), 0.5), cellWorld), mul(sub(tau, 0.5), topsH));
        const size = 0.11 * L.freeboard + 0.05;
        const port = sdBox(q, vec2(size, size));
        col = mix(col, rgb(look.trim), mul(edge(sub(port, 0.05 * size + 0.03)), inRange));
        col = mix(col, vec3(0.06, 0.04, 0.05), mul(edge(port), inRange));
      }
      // Below the topsides: boot-top stripe then the bottom.
      const below = sub(1, smoothstep(wb, add(wb, 0.002), w));
      col = mix(col, mul(rgb(look.hull), 0.85), below);
      col = mix(col, vec3(0.08, 0.06, 0.07), edge(sub(abs(sub(w, add(wl, 0.03))), 0.018)));
      col = mix(col, rgb(look.bottom), edge(sub(w, add(wl, 0.012))));
      return col;
    };
  }
}

function positive(x: number, what: string): number {
  if (!(x > 0) || !Number.isFinite(x)) throw new Error(`hull: ${what} must be a positive number, got ${x}`);
  return x;
}

function canonical(spec: HullSpec): Lines {
  const f = positive(spec.freeboard, "freeboard");
  const stations = spec.stations ?? 17;
  if (!(Number.isInteger(stations) && stations >= 4)) throw new Error(`hull: stations must be an integer >= 4, got ${stations}`);
  const lines: Lines = {
    length: positive(spec.length, "length"), beam: positive(spec.beam, "beam"), depth: positive(spec.depth, "depth"), freeboard: f,
    sheer: spec.sheer ?? [0.3 * f, 0.45 * f], castle: spec.castle ?? [0, 0],
    entry: positive(spec.entry ?? 2, "entry"), run: positive(spec.run ?? 2.4, "run"), widest: spec.widest ?? 0.55,
    fullness: spec.fullness ?? 2.6, deadrise: spec.deadrise ?? 0.18, tumblehome: spec.tumblehome ?? 0.08,
    transom: spec.transom ?? 0.5, rake: spec.rake ?? 0.45, stations, bulwark: spec.bulwark ?? 0.22,
  };
  if (!(lines.widest > 0.2 && lines.widest < 0.8)) throw new Error(`hull: widest must lie in (0.2, 0.8), got ${lines.widest}`);
  if (!(lines.fullness >= 1.2)) throw new Error(`hull: fullness must be >= 1.2, got ${lines.fullness}`);
  if (!(lines.transom >= 0 && lines.transom < 1)) throw new Error(`hull: transom must lie in [0, 1), got ${lines.transom}`);
  return lines;
}

/** A hull from its lines (see the header for its law and limits). */
export function hull(spec: HullSpec): Hull {
  return new Hull(spec);
}

// The sweep (DESIGN.md 7.2, "multiply"): a section swept along a spine, with frames transported along the spine. It is
// a Surface (the skin, rho = 1), a Chart (body coordinates (m, v, rho)) and a Skeleton (capsules along the spine).
//
// Body coordinates: m in [0, 1] runs along the spine (its parameter), v in [0, 1] runs round it (v = 0 the +side
// line, 0.25 the dorsal line, 0.5 the other side, 0.75 the belly), rho is the distance out as a fraction of the
// thickness (the skin is rho = 1).
//
// Frames cannot be computed locally (they are transported along the spine), so each frame the pose pass samples the
// spine into a map (`spineSamples`) and carries frames along it with a scan (`transport.ts`), and everything else (the
// skin, its normal, the chart, the skeleton) is ordinary expressions over `fetch`es of the station table. Both tables
// are programs (docs/gpu_native.md): the GPU fills them in pose stages; tools read the same programs on the CPU.

import {
  add, clamp, cos, cross, div, f, fetch, floor, iterate, lift, lt, ge, mapOf, max, min, mix, mul, neg, normalize, pick, pow, saturate, select,
  sin, sqrt, sub, substitute, TAU, time, length, vec3, vec4, type Expr, type ProgramTable, type TableProgram, type TableSource,
} from "../expr.ts";
import { scopedName } from "../expr.ts";
import { compose, rotate, world } from "./chart.ts";
import { rotateAbout, SAMPLE, SAMPLE_VEC4S, stationRadii, stationScan, STATION_VEC4S } from "./transport.ts";
export { rotateAbout };
import type { Chart, End, F, Frame, P3, Placeable, Skeleton, Surface, Topology } from "./types.ts";

type Fn1 = (m: F) => F;

/** How an end closes, canonical. Lengths are fractions of m. */
export type Tip =
  | { readonly kind: "round"; readonly length: number }
  | { readonly kind: "point"; readonly length: number }
  | { readonly kind: "open" };

/** A superellipse section: half-width `girth(m)` (tips not yet applied), height over width `aspect(m)`. */
export type Section = {
  readonly girth: Fn1;
  readonly aspect: Fn1;
  /** Superellipse exponent: 2 an ellipse, higher boxier. At least 1.2 (the normal needs |x|^(n-1)). */
  readonly squareness: number;
  readonly tips: readonly [Tip, Tip];
  /**
   * The least stretch volume preservation honours: radii scale by 1 / sqrt(max(stretch, leastStretch)), so they grow by
   * at most 1 / sqrt(leastStretch). Stretch is measured per unit of m, so where a posed spine's stations bunch it reads
   * as compression and the body swells (a reared coil swelled into a ball three times its girth, 2026-11-11; see
   * `bulge` in StrandSpec). 0.05 (at most 4.47 times) unless the author bounds it.
   */
  readonly leastStretch: number;
};

/** How frames are carried along the spine. */
export type Transport = {
  /** How many frames the pose pass computes. */
  readonly stations: number;
  /** Roll about the tangent, radians, added to the rotation-minimising frame. */
  readonly twist: Fn1;
  /** Direction the frame starts from at m = 0 (the dorsal side faces it). */
  readonly up: P3;
  /** Per world unit: how fast accumulated roll bleeds back toward `up`. 0 is the pure rotation-minimising frame. */
  readonly level: number;
};

/** An interpolated station: position, d(position)/dm, frame (tangent, dorsal, side), stretch. */
export type FrameSample = { readonly p: P3; readonly der: P3; readonly t: P3; readonly d: P3; readonly s: P3; readonly stretch: F };

/** Closure factor of an end at distance x (in m) from it: 0 at the end, 1 beyond the tip length. */
function tipLaw(tip: Tip, x: F): F {
  switch (tip.kind) {
    case "round": { const q = saturate(sub(1, div(x, tip.length))); return sqrt(max(sub(1, mul(q, q)), 0)); }
    case "point": return saturate(div(x, tip.length));
    case "open": return f(1);
  }
}
function endOf(tip: Tip): End {
  switch (tip.kind) {
    case "round": case "point": return "pole"; // the radius reaches 0 at the end
    case "open": return "cap";
  }
}

/** Quaternion (x, y, z, w) rotation of v, as WGSL's usual `v + 2 q.xyz x (q.xyz x v + q.w v)`. */
function qrot(q: Expr<"vec4">, v: P3): P3 {
  const u = q.xyz;
  return add(v, mul(cross(u, add(cross(u, v), mul(v, q.w))), 2));
}

/**
 * The station table's sample at m: Catmull-Rom through the station positions with mirrored phantom ends (as in
 * `through`), its derivative per unit m, the nlerped frame and the interpolated stretch. Neighbour indices are clamped
 * before they are read, so no fetch leaves the table even where `select` discards it.
 */
export function stationSample(t: TableSource, m: F): FrameSample {
  const count = t.entries, span = count - 1;
  const x = mul(clamp(m, 0, 1), span);
  const k = min(floor(x), count - 2);
  const fr = sub(x, k);
  const P = (i: F): P3 => fetch(t, i, 0).xyz;
  const p1 = P(k), p2 = P(add(k, 1));
  const p0 = select(lt(k, 0.5), sub(mul(p1, 2), p2), P(max(sub(k, 1), 0)));
  const p3 = select(ge(add(k, 2), count - 0.5), sub(mul(p2, 2), p1), P(min(add(k, 2), count - 1)));
  const a = sub(p2, p0);
  const b = sub(add(sub(mul(p0, 2), mul(p1, 5)), mul(p2, 4)), p3);
  const c = sub(add(sub(mul(p1, 3), p0), p3), mul(p2, 3));
  const f2 = mul(fr, fr), f3 = mul(f2, fr);
  const p = mul(add(add(mul(p1, 2), mul(a, fr)), add(mul(b, f2), mul(c, f3))), 0.5);
  const der = mul(add(a, add(mul(b, mul(fr, 2)), mul(c, mul(f2, 3)))), 0.5 * span);
  const q = normalize(mix(fetch(t, k, 1), fetch(t, add(k, 1), 1), fr));
  const stretch = mix(fetch(t, k, 2).z, fetch(t, add(k, 1), 2).z, fr);
  return { p, der, t: qrot(q, lift<"vec3">([1, 0, 0])), d: qrot(q, lift<"vec3">([0, 1, 0])), s: qrot(q, lift<"vec3">([0, 0, 1])), stretch };
}

/**
 * sign(x) |x|^k written as x (x^2)^((k-1)/2), floored inside the pow (WGSL's pow is undefined at 0). It must be
 * continuous through 0: the earlier sign(x) pow(max(|x|, 1e-6), k) jumped by 2 (1e-6)^k there, and on the dorsal
 * line cos(angle) is +6e-17 in f64 but -4e-8 in f32, so CPU and GPU landed on opposite sides of a 2e-4 step
 * (caught by the CPU-against-GPU surface test at squareness 3).
 */
const superPow = (x: F, k: number): F => mul(x, pow(max(mul(x, x), 1e-12), (k - 1) / 2));

/** Finite-difference step in m for the taper slope (the lean of the normal along the spine). */
const SLOPE_H = 1e-3;

type Ring = { readonly st: FrameSample; readonly pos: P3; readonly normal: P3; readonly radial: P3 };

/**
 * The memo of a body's time slices, shared by every slice of it: whole slices by time, prefixes (stations 0 .. k - 1
 * only) by time and k, all numbered in one sequence (the number names the slice's table).
 */
export type Slices = { readonly whole: Map<Expr<"f32">, Body>; readonly prefix: Map<string, Body>; readonly skeleton: Map<string, Skeleton>; count: number };
export const newSlices = (): Slices => ({ whole: new Map(), prefix: new Map(), skeleton: new Map(), count: 0 });

/**
 * Which stations a body's table holds. `all`, or the first `stations` only: a slice read only near the start of the
 * body (a head riding the neck, taken at an earlier time for a smear). Frames are transported from m = 0, so a prefix
 * is exact for every station but its last two (whose tangents would need the stations after them), and readers stay
 * below those (`Body.atNear`).
 */
export type Posted =
  | { readonly kind: "all" }
  | { readonly kind: "prefix"; readonly stations: number }
  /**
   * Stations `first` .. the end only (a smear's copy of a striking tail): the frame at `first` is the live body's frame
   * there, carried to this slice's tangent by the minimal rotation, then transported as usual. Positions and radii are
   * exact from `first + 1` on; frames differ from the whole slice's by how far the body rolled between the two times.
   */
  | { readonly kind: "part"; readonly first: number; readonly live: Body };

/** The value of a constant f32 expression (a literal, or a literal component of a literal vector), or NaN. */
function constantOf(e: Expr): number {
  const n = e.node;
  switch (n.op) {
    case "const": return n.v.length === 1 ? n.v[0]! : NaN;
    case "get": {
      const i = "xyzw".indexOf(n.sel);
      if (n.sel.length !== 1 || i < 0) return NaN;
      const a = n.a.node;
      return a.op === "const" ? (a.v[i] ?? NaN) : a.op === "vec" && a.args.length === (a.ty === "vec2" ? 2 : a.ty === "vec3" ? 3 : 4) ? constantOf(a.args[i]!) : NaN;
    }
    default: return NaN;
  }
}

/** A swept body. Build with `sweep`; `strand` (src/geom/strand.ts) is the library form with defaults and a look. */
export class Body implements Surface, Chart, Placeable<Body> {
  /** The per-frame table of transported stations. */
  readonly table: StationTable;
  readonly topology: Topology;
  readonly skeleton: Skeleton;

  constructor(
    readonly name: string,
    /** The spine in the local coordinates of `chart` (and of time). */
    readonly spine: (m: F) => P3,
    readonly section: Section,
    readonly transport: Transport,
    /** Where the spine lives: `world`, or a host's chart (`place(body, on(host, ...))`). */
    readonly chart: Chart,
    /** The time this body is taken at (`time` itself for the live body). */
    readonly slice: F,
    protected readonly slices: Slices,
    tableName: string,
    readonly posted: Posted,
  ) {
    this.table = new StationTable(tableName, this);
    this.topology = { u: [endOf(section.tips[0]), endOf(section.tips[1])], v: "periodic" };
    this.skeleton = {
      joints: transport.stations,
      joint: (k) => {
        const r = fetch(this.table, k, 2);
        return { p: fetch(this.table, k, 0).xyz, r: max(r.x, r.y) };
      },
    };
  }

  /** Expressions of this body read at its slice time. */
  private now<T extends readonly Expr[]>(es: T): T {
    return (this.slice === time ? es : substitute(es, time, this.slice)) as unknown as T;
  }

  /** Tip closure at m: both ends multiplied. */
  closure(m: F): F {
    return mul(tipLaw(this.section.tips[0], m), tipLaw(this.section.tips[1], sub(1, m)));
  }

  /** Half-width before stretch, with the tips applied. */
  halfWidth(m: F): F {
    return mul(this.section.girth(m), this.closure(m));
  }

  /**
   * The skin at (m, v): a superellipse ring in the frame's side/dorsal plane, radii thinned by 1 / sqrt(stretch). The
   * normal is analytic (the in-plane superellipse gradient, minus the taper's lean along the tangent, as in
   * `strand_kit::ring_point`), so shading never depends on tessellation, and it turns to face along the spine at a
   * closing tip.
   */
  private ring(m: F, v: F): Ring {
    const st = stationSample(this.table, m);
    const aspect = this.section.aspect;
    const keep = div(1, sqrt(max(st.stretch, this.section.leastStretch)));
    const a = (x: F) => mul(this.halfWidth(x), keep);
    const b = (x: F) => mul(a(x), aspect(x));
    const m0 = clamp(sub(m, SLOPE_H), 0, 1), m1 = clamp(add(m, SLOPE_H), 0, 1);
    // d(radius)/d(arc length): the radii difference over the m step, divided by the spine's speed |dP/dm|.
    const ds = mul(sub(m1, m0), max(length(st.der), 1e-6));
    const slopeA = div(sub(a(m1), a(m0)), ds), slopeB = div(sub(b(m1), b(m0)), ds);

    const n = this.section.squareness, e = 2 / n;
    const angle = mul(v, TAU);
    const c = cos(angle), s = sin(angle);
    const sp = superPow;
    const x = sp(c, e), y = sp(s, e);
    const A = a(m), B = mul(A, aspect(m));
    const pos = add(st.p, add(mul(st.s, mul(A, x)), mul(st.d, mul(B, y))));
    // The gradient of |x/a|^n + |y/b|^n, multiplied through by a (so a ring collapsed at a tip keeps a direction):
    // (gx * b / a, gy) up to scale, and b / a is the aspect.
    const gx = mul(sp(x, n - 1), aspect(m)), gy = sp(y, n - 1);
    const gl = max(sqrt(add(mul(gx, gx), mul(gy, gy))), 1e-9);
    const nx = div(gx, gl), ny = div(gy, gl);
    const lean = add(mul(slopeA, mul(x, nx)), mul(slopeB, mul(y, ny)));
    const inPlane = add(mul(st.s, nx), mul(st.d, ny));
    const normal = normalize(sub(inPlane, mul(st.t, lean)));
    return { st, pos, normal, radial: normalize(inPlane) };
  }

  point(u: F, v: F): P3 { return this.now([this.ring(u, v).pos])[0]; }
  /**
   * The skin straightened at rest: (arc length along the rest spine, the rest section's ring). A function of (u, v)
   * alone (rest arc lengths are lane r.w of the stations; the section is read at time 0), so a pattern over it rides the
   * body through any bend, and every slice of the body (`at(t)`) has the same anchor.
   */
  anchor(u: F, v: F): P3 {
    const t = this.table, span = t.entries - 1;
    const x = mul(clamp(u, 0, 1), span);
    const k = min(floor(x), span - 1);
    const s = mix(fetch(t, k, 2).w, fetch(t, add(k, 1), 2).w, sub(x, k));
    const [a, aspect] = substitute([this.halfWidth(u), this.section.aspect(u)], time, f(0)) as F[];
    const e = 2 / this.section.squareness, angle = mul(v, TAU);
    return vec3(s, mul(a, superPow(cos(angle), e)), mul(mul(a, aspect), superPow(sin(angle), e)));
  }
  normal(u: F, v: F): P3 { return this.now([this.ring(u, v).normal])[0]; }

  /**
   * Body coordinates (m, v, rho) to the point and the frame there: `x` the spine tangent (toward increasing m), `y` the
   * outward direction at v within the section (no taper lean), `z = x cross y`. At v = 0.25 it is the station frame.
   */
  frame(c: P3): Frame {
    const r = this.ring(c.x, c.y);
    const [o, x, y, z] = this.now([mix(r.st.p, r.pos, c.z), r.st.t, r.radial, cross(r.st.t, r.radial)] as const);
    return { o, x, y, z };
  }

  /** This body with `time` read as t: its own stations, posed every frame (a telegraph, a smear). */
  at(t: F): Body {
    const seen = this.slices.whole.get(t);
    if (seen) return seen;
    const body = this.remake(this.chart.at(t), t, this.slices, `${this.table.base}_${this.slices.count++}`, { kind: "all" });
    this.slices.whole.set(t, body);
    return body;
  }

  /**
   * This body's skeleton at time t at the given stations only, without frames (`SkeletonTable`): what a wake needs of a
   * past slice. Joint j is station `stations[j]`.
   */
  skeletonAt(t: F, stations: readonly number[]): Skeleton {
    const key = `${t.id}:${stations.join(",")}`;
    const seen = this.slices.skeleton.get(key);
    if (seen) return seen;
    const table = new SkeletonTable(`${this.table.base}_skel${this.slices.count++}`, this, t, stations);
    const sk: Skeleton = { joints: table.entries, joint: (k) => { const j = fetch(table, k, 0); return { p: j.xyz, r: j.w }; } };
    this.slices.skeleton.set(key, sk);
    return sk;
  }

  /**
   * This body at time t for a reader of m in [from, 1] only (a smear's copy of the part that strikes): it posts the
   * stations from just before `from` and seeds its frame from the live body (`Posted` "part"). The spine is the cost of a
   * slice, so a tail from m = 0.8 costs a fifth of a whole slice.
   */
  partAt(t: F, from: number): Body {
    const first = Math.floor(Math.min(Math.max(from, 0), 1) * (this.transport.stations - 1)) - 1;
    const whole = this.slices.whole.get(t);
    if (first <= 0 || whole) return whole ?? this.at(t);
    const key = `${t.id}:part${first}`;
    const seen = this.slices.prefix.get(key);
    if (seen) return seen;
    const body = this.remake(this.chart.at(t), t, this.slices, `${this.table.base}_${this.slices.count++}`, { kind: "part", first, live: this });
    this.slices.prefix.set(key, body);
    return body;
  }

  /**
   * This body at time t for a reader of body coordinates c only (a part placed there): when c's m is a constant, the
   * slice posts only the stations up to it (a smear's copies of a head riding the neck read the neck's first stations,
   * not the whole body: 4 against 48 in examples/strike.ts). Exact where it is read: the reads at m touch stations up to
   * floor(m (n - 1)) + 2, and only the last two of a prefix differ from the whole slice.
   */
  atNear(t: F, c: P3): Body {
    const n = this.transport.stations, m = constantOf(c.x);
    const k = Number.isFinite(m) ? Math.floor(Math.min(Math.max(m, 0), 1) * (n - 1)) + 5 : n;
    const whole = this.slices.whole.get(t);
    if (k >= n || whole) return whole ?? this.at(t);
    const key = `${t.id}:${k}`;
    const seen = this.slices.prefix.get(key);
    if (seen) return seen;
    const body = this.remake(this.chart.at(t), t, this.slices, `${this.table.base}_${this.slices.count++}`, { kind: "prefix", stations: k });
    this.slices.prefix.set(key, body);
    return body;
  }

  /** The same body with its spine placed in `chart` (composed with where it already was). */
  placed(chart: Chart): Body {
    return this.remake(compose(chart, this.chart), time, newSlices(), this.table.base, { kind: "all" });
  }

  /**
   * The same body placed in `chart`, posting its own table under `tableName`. `placed` keeps the table's name (the
   * placed body replaces the unplaced one); this is for carrying a whole creature somewhere while its unplaced self
   * is still read, as the host its other parts are placed on (src/geom/whirlpool.ts coils the serpent this way).
   */
  placedAs(chart: Chart, tableName: string): Body {
    return this.remake(compose(chart, this.chart), time, newSlices(), tableName, { kind: "all" });
  }

  /** The same kind of body elsewhere or at another time (a subclass that carries more, such as a look, overrides it). */
  protected remake(chart: Chart, slice: F, slices: Slices, tableName: string, posted: Posted): Body {
    return new Body(this.name, this.spine, this.section, this.transport, chart, slice, slices, tableName, posted);
  }
}

/** A body's stations: entry k is station k (m = k / (stations - 1)); lanes p, q, r as in transport.ts. A scan. */
export class StationTable implements ProgramTable {
  readonly lanes = STATION_VEC4S;
  readonly entries: number;
  readonly role = "stations";
  constructor(readonly base: string, private readonly body: Body) {
    this.entries = body.transport.stations;
  }
  get name(): string { return this.base; }

  /** Built when the compiler classifies the table (once). */
  get program(): TableProgram {
    const b = this.body, span = this.entries - 1;
    // A prefix or a part posts some stations only; the entries outside them are never read (Body.atNear, Body.partAt).
    const [first, n] = postedRange(b.posted, this.entries);
    const samples = spineSamples(`${this.base}_spine`, b, b.chart, n, (i) => stationM(add(i, first), span), b.slice);
    const up = seedOf(b, samples, first);
    return stationScan({ samples, first, steps: n, up, level: { up, rate: b.transport.level }, restStart: restArcTo(b, first), leastStretch: b.section.leastStretch });
  }
}

/**
 * m of station k (a whole number) of `span + 1`: k / span, and exactly 1 at the last. WGSL's division is good to 2.5
 * ULP, so on the GPU 11 / 11 came out a little under 1, and a round tip's radius, sqrt(1 - q^2) at q -> 1, turned that
 * into 1.5e-4 where the CPU has 0 (the crab's brow, caught by tests/pose.gpu.test.ts). A residual correction
 * (m + (k - m span) / span) did not help on Metal, where the compiler is free to fold it to m. The ends are where tips
 * close, and m = 0 is exact already.
 */
function stationM(k: F, span: number): F {
  return select(lt(k, span - 0.5), div(k, span), 1);
}

/**
 * A body's spine sampled at `count` values of m (`m(i)`, i the entry), at time `slice`: lanes as transport.ts's SAMPLE.
 * The spine reaches the world through the chart; for a body on a host this reads the host's table, which an earlier
 * pose stage fills. The local spine too: stretch is measured on it (DESIGN.md 7.6), not on the placed one, so a chart
 * that bends or lengthens the spine (a whirlpool winding a body into a coil) does not thin the body. Measuring the
 * placed spine against the local rest thinned a coiled serpent by 1 / sqrt(5) (found by tests/ships.whirlpool.test.ts).
 * The rest spine is the local spine at time 0; it changes only with params and inputs, and is recomputed every frame
 * (the CPU fill used to keep the last one; on the GPU it is a few more terms of the same map).
 */
function spineSamples(name: string, b: Body, chart: Chart, count: number, m: (i: F) => F, slice: F): TableSource {
  const sample = (i: F): Expr<"vec4">[] => {
    const mi = m(i), local = b.spine(mi);
    const now = [chart.frame(local).o, b.transport.twist(mi), local, b.halfWidth(mi), b.section.aspect(mi)] as const;
    const [world, twist, here, hw, aspect] = (slice === time ? now : substitute(now, time, slice)) as unknown as [P3, F, P3, F, F];
    const [rest] = substitute([local], time, f(0)) as [P3];
    return [vec4(world, twist), vec4(here, hw), vec4(rest, aspect)];
  };
  return { name, lanes: SAMPLE_VEC4S, entries: count, role: "data", program: mapOf(count, sample) };
}

/**
 * The direction a posted range's frames start from: the body's `up` through its chart at station 0; or for a part,
 * the live body's dorsal direction at its first station, untwisted (the scan applies twist itself) and carried onto
 * this slice's tangent there by the minimal rotation (the scan projects it off the tangent).
 */
function seedOf(b: Body, samples: TableSource, first: number): P3 {
  const p = b.posted;
  switch (p.kind) {
    case "all": case "prefix": {
      const [up] = substitute([rotate(b.chart.frame(fetch(samples, 0, SAMPLE.local).xyz), b.transport.up)], time, b.slice) as [P3];
      return up;
    }
    case "part": {
      const q = fetch(p.live.table, first, 1);
      const tan = qrot(q, lift<"vec3">([1, 0, 0]));
      return rotateAbout(qrot(q, lift<"vec3">([0, 1, 0])), tan, neg(fetch(samples, 0, SAMPLE.world).w));
    }
  }
}

/** Arc length along the rest spine (time 0) up to station k: 0 for k = 0, else a loop over the stations before it. */
function restArcTo(b: Body, k: number): F {
  const span = b.transport.stations - 1;
  const rest = (m: F): P3 => substitute([b.spine(m)], time, f(0))[0] as P3;
  const [s] = iterate(k, [f(0), rest(f(0))] as const, ([acc, prev], j) => {
    const r = rest(div(add(j, 1), span));
    return [add(acc, length(sub(r, prev))), r] as const;
  });
  return s;
}

/**
 * A body's skeleton at another time at some of its stations, without frames: per kept station its position and radius
 * (the larger half-axis after volume preservation), what a wake reads. The cost of a slice is evaluating the spine at
 * each station (in examples/strike.ts the posed spine is about 2300 nodes), so a wake keeping every third station costs
 * a third of a full slice, which also transports a frame along every station. Positions equal the full slice's at the
 * stations kept; radii measure stretch between kept neighbours (exact positions; within 15% of the whole slice's radius
 * at the serpent's neck, 3% elsewhere. Measuring it at the stations' own neighbours needs the spine at every station
 * again; the live body's stretch instead lags by the slice's age, 8% at 0.35 s). A map over a samples map.
 */
export class SkeletonTable implements ProgramTable {
  readonly lanes = 1;
  readonly entries: number;
  readonly role = "stations";
  constructor(readonly name: string, private readonly body: Body, private readonly t: F, private readonly stations: readonly number[]) {
    this.entries = stations.length;
    const n = body.transport.stations;
    for (const k of stations) if (!(Number.isInteger(k) && k >= 0 && k < n)) throw new Error(`skeleton of "${body.name}": station ${k} is not one of its ${n}`);
  }

  get program(): TableProgram {
    const b = this.body, span = b.transport.stations - 1, kept = this.stations;
    const samples = spineSamples(`${this.name}_spine`, b, b.chart.at(this.t), kept.length, (i) => stationM(pick(i, kept.map((k) => f(k))), span), this.t);
    return mapOf(this.entries, (j) => {
      const r = stationRadii(samples, j, b.section.leastStretch);
      return [vec4(fetch(samples, j, SAMPLE.world).xyz, max(r.a, r.b))];
    });
  }
}

/** The stations a table posts: [first, first + count). */
function postedRange(p: Posted, all: number): [number, number] {
  switch (p.kind) {
    case "all": return [0, all];
    case "prefix": return [0, p.stations];
    case "part": return [p.first, all - p.first];
  }
}

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A live body's constructor arguments, checked: in world coordinates, at `time`. Subclasses (`Strand`) build from it. */
export function sweepArgs(given: string, spine: (m: F) => P3, section: Section, transport: Transport): ConstructorParameters<typeof Body> {
  const name = scopedName(given);
  if (!IDENT.test(name)) throw new Error(`sweep "${name}": names must be identifiers (they name tables and shaders)`);
  if (!(Number.isInteger(transport.stations) && transport.stations >= 4)) throw new Error(`sweep "${name}": stations must be an integer >= 4, got ${transport.stations}`);
  if (!(section.squareness >= 1.2)) throw new Error(`sweep "${name}": squareness must be >= 1.2 (the normal needs |x|^(n-1)), got ${section.squareness}`);
  return [name, spine, section, transport, world, time, newSlices(), `body_${name}`, { kind: "all" }];
}

/** A section swept along `spine` (in world coordinates; place it to put it elsewhere). */
export function sweep(name: string, spine: (m: F) => P3, section: Section, transport: Transport): Body {
  return new Body(...sweepArgs(name, spine, section, transport));
}

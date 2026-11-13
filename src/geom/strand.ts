// A strand: the library form of a sweep (src/map/sweep.ts) with a look. `strand(spec)` decides every default once and
// returns a `Strand`, which is a `Body` (Surface, Chart, Skeleton) that also draws itself with `draw.surface`: rings
// crowded toward the tips, a vertex on the dorsal line at every density, lit by the style with an ink hull.

import { lift, vec3, type Expr, type In } from "../expr.ts";
import type { Bakeable, CompileContext, Drawable, Emitted } from "../compile/context.ts";
import { drawSurface, spacing, type SurfaceDrawable } from "../draw/surface.ts";
import { Body, sweepArgs, type Posted, type Section, type Slices, type Tip } from "../map/sweep.ts";
import type { Chart, F, P3, Paint, Points, Poses, Skeleton } from "../map/types.ts";

export type Rgb = readonly [number, number, number];
type Fn1 = (m: F) => F;

export type TipSpec = "round" | "point" | "open" | { readonly round: number } | { readonly point: number };
/** A colour, or colour as a function of body coordinates. */
export type PaintSpec = Rgb | Paint;

export type StrandSpec = {
  readonly name: string;
  /** The spine as a function of m (and of time, inputs, params). */
  readonly spine: (m: F) => Expr<"vec3">;
  /** How many frames the pose pass computes. Default 32. */
  readonly stations?: number;
  /** Half-width along the side direction. */
  readonly girth: Fn1 | number;
  /** `aspect` = half-height over half-width; `squareness` is the superellipse exponent (2 an ellipse, higher boxier). */
  readonly section?: { readonly aspect?: Fn1 | number; readonly squareness?: number };
  /** Roll about the tangent, radians, added to the rotation-minimising frame. */
  readonly twist?: Fn1;
  /** How each end closes: one spec for both, or [at m = 0, at m = 1]. Default round at both. */
  readonly tips?: TipSpec | readonly [TipSpec, TipSpec];
  readonly paint: PaintSpec;
  /** Grid density: rings along, segments around. Default 96 x 24. */
  readonly detail?: { readonly along?: number; readonly around?: number };
  /** Direction the frame starts from at m = 0 (the dorsal side faces it). Default world up. */
  readonly up?: In<"vec3">;
  /** Per world unit: how fast accumulated roll bleeds back toward `up`. Default 0 (pure rotation-minimising). */
  readonly level?: number;
  /**
   * The most volume preservation may thicken the body, as a factor of its girth (at least 1). Radii scale by
   * 1 / sqrt(stretch), and stretch is measured per unit of m, so a pose whose stations bunch (a curve parametrised by
   * angle, a Bezier with a short arm) reads as compression there and swells it. Default about 4.47 (a stretch floor of
   * 0.05, as always); a body posed by laws that do not space their stations by arc length wants 1.2 to 1.5.
   */
  readonly bulge?: number;
};

const DEFAULT_TIP = { round: 0.05, point: 0.12 } as const;

function canonicalTip(spec: TipSpec, name: string): Tip {
  if (spec === "round" || spec === "point") return { kind: spec, length: DEFAULT_TIP[spec] };
  if (spec === "open") return { kind: "open" };
  if (typeof spec === "object" && "round" in spec) return { kind: "round", length: positive(spec.round, `${name}: tip round length`) };
  if (typeof spec === "object" && "point" in spec) return { kind: "point", length: positive(spec.point, `${name}: tip point length`) };
  throw new Error(`${name}: unknown tip ${JSON.stringify(spec)}`);
}

function positive(x: number, what: string): number {
  if (!(x > 0) || !Number.isFinite(x)) throw new Error(`${what} must be a positive number, got ${x}`);
  return x;
}

/** The stretch floor a bulge bound gives (radii grow by at most `bulge`); unbounded, the floor of old, 0.05. */
function leastStretchOf(bulge: number | undefined, name: string): number {
  if (bulge === undefined) return LEAST_STRETCH;
  if (!(bulge >= 1 && Number.isFinite(bulge))) throw new Error(`${name}: bulge must be a finite number >= 1 (radii never grow less than not at all), got ${bulge}`);
  return 1 / (bulge * bulge);
}
const LEAST_STRETCH = 0.05;

const fn1 = (x: Fn1 | number): Fn1 => (typeof x === "number" ? () => lift<"f32">(x) : x);

/** The look a strand is drawn with. */
type StrandLook = { readonly paint: Paint; readonly along: number; readonly around: number };

/** A swept body that draws itself. Placing it or taking it at another time keeps its look. */
export class Strand extends Body implements Drawable {
  private readonly drawn: SurfaceDrawable;

  constructor(body: ConstructorParameters<typeof Body>, readonly look: StrandLook) {
    super(...body);
    this.drawn = drawSurface(this.name, this, {
      paint: look.paint,
      // Rings crowd toward the ends, where tips close fast. Round the body, v starts on the dorsal line, so a ridge
      // vertex exists at every density, and runs to 1.25 without wrapping so the seam interpolates continuously.
      grid: { u: spacing.ends(look.along), v: spacing.from(look.around, 0.25) },
      sides: "one",
      outline: "hull",
    });
  }

  get skeletons(): readonly Skeleton[] { return this.drawn.skeletons; }
  get surfaces(): readonly Bakeable[] { return this.drawn.surfaces; }
  draws(ctx: CompileContext): Emitted { return this.drawn.draws(ctx); }
  /** Copies of this strand, one per point, in each point's frame (teeth, spikes). Drawn by `draw.points`. */
  instanced(name: string, points: Points): Drawable { return this.drawn.instanced(name, points); }
  /** Copies of this strand, one per pose, each turned and sized (a row of bells, each on its own swing). Drawn by `draw.posed`. */
  posed(name: string, poses: Poses): Drawable { return this.drawn.posed(name, poses); }

  override at(t: F): Strand { return super.at(t) as Strand; }
  override placed(chart: Chart): Strand { return super.placed(chart) as Strand; }
  override placedAs(chart: Chart, tableName: string): Strand { return super.placedAs(chart, tableName) as Strand; }
  override atNear(t: F, c: P3): Strand { return super.atNear(t, c) as Strand; }
  override partAt(t: F, from: number): Strand { return super.partAt(t, from) as Strand; }
  protected override remake(chart: Chart, slice: F, slices: Slices, tableName: string, posted: Posted): Strand {
    return new Strand([this.name, this.spine, this.section, this.transport, chart, slice, slices, tableName, posted], this.look);
  }
}

/**
 * A swept body: a section carried along a spine. Snakes, tentacles, necks, tails, spars, ropes thick enough to light,
 * horns (`spiralTube` is one), limbs on a `chain`.
 *
 * The shape and its law. At each m in [0, 1] the section is a superellipse of half-width `girth(m)`, `aspect(m)` as
 * tall, of `squareness`, set in a frame carried along the spine with the least rotation (plus `twist`, bleeding back
 * toward `up` by `level`). Where the spine stretches the radii shrink by 1 / sqrt(stretch), so volume is kept, at most
 * `bulge` times. Its ends close by `tips`. It draws itself and carries body coordinates (m along, v round) for paint, a
 * skeleton for shadows, and a chart other things stand on (`sheetOn`, `rayOf`).
 *
 * Parameters: spine, girth, aspect and twist are functions of m (and of time, inputs, params), so the body moves and
 * swells; squareness, tips, stations, detail and up are fixed.
 *
 * What it cannot do, because of the law:
 * - a section that is not a superellipse: no keel, no flat belly with a round back, no ridges round it, no hole.
 * - branch: one spine, two ends (a fork is two strands meeting).
 * - fold back on itself sharply: the section is perpendicular to the spine, so a bend tighter than the girth pinches.
 * - change topology in time (split, merge).
 *
 * Going past it: the spine is the open slot (`chain`, `bent`, `spiralLine`, `wrap`, `through` give spines), and one
 * step down is `sweep` with a `Section` of your own, or a `surface((m, v) => ...)` that places any section curve in
 * the strand's own frame (it is a chart: `frame(vec3(m, v, 0))`): a keeled body, a fluted column. Relatives, each by
 * changing what is swept or what it is swept along:
 * - a profile turned round a fixed axis instead of carried along a spine: `lathe` (a vase, a bead, a dome).
 * - sections that are not one shape scaled, blended from one to the next: `loft` through them.
 * - a section on a growing spiral, all lengths scaling together: `coil`; a tapered tube on a flat spiral: `spiralTube`.
 */
export function strand(spec: StrandSpec): Strand {
  const name = spec.name;
  const tips: readonly [TipSpec, TipSpec] = spec.tips === undefined ? ["round", "round"]
    : Array.isArray(spec.tips) ? (spec.tips as readonly [TipSpec, TipSpec]) : [spec.tips as TipSpec, spec.tips as TipSpec];
  const section: Section = {
    girth: fn1(spec.girth), aspect: fn1(spec.section?.aspect ?? 1), squareness: spec.section?.squareness ?? 2,
    tips: [canonicalTip(tips[0], name), canonicalTip(tips[1], name)],
    leastStretch: leastStretchOf(spec.bulge, name),
  };
  const paint = spec.paint;
  const paintFn: Paint = typeof paint === "function" ? paint : () => vec3(...(paint as Rgb));
  const transport = { stations: spec.stations ?? 32, twist: spec.twist ?? (() => lift<"f32">(0)), up: lift<"vec3">(spec.up ?? [0, 1, 0]), level: spec.level ?? 0 };
  return new Strand(sweepArgs(name, spec.spine, section, transport), { paint: paintFn, along: Math.round(spec.detail?.along ?? 96), around: Math.round(spec.detail?.around ?? 24) });
}


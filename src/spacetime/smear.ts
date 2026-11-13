// The smear: the striking part over the recent past, as fading translucent copies of itself (DESIGN.md 8). Copy k is
// the part's body taken at `time - k dt` (`body.at`, so its stations are posed by the pose pass like any body's),
// lit by the scene's style with the part's own paint, and shown only while the part moves fast: its opacity follows
// the speed of the part's tip between that copy and the next younger one. Back faces are dropped so each copy is one
// layer of translucency, not two.

import { distance, dot, f, lift, mix, mul, smoothstep, step, sub, time, vec2, vec4, type Expr } from "../expr.ts";
import type { CompileContext, Drawable, Emitted } from "../compile/context.ts";
import { drawGlazed, nameId, spacing, type Fragment } from "../draw/surface.ts";
import { levelOf } from "../draw/ground.ts";
import { viewDir } from "../lib/wgsl.ts";
import type { Strand } from "../geom/strand.ts";
import { NO_SKELETON, type Surface } from "../map/types.ts";
import type { Part, Strike } from "./attack.ts";

type F = Expr<"f32">;

export type SmearSpec = {
  /** Seconds of the recent past the copies cover. */
  readonly over: number;
  /** How many copies. */
  readonly samples: number;
  /** Tip speed (world units per second) at which copies start to show, and at which they are fully shown. */
  readonly speed?: readonly [number, number];
  /** Opacity of the youngest copy at full speed. */
  readonly opacity?: number;
};

/** The part's stretch of a body (the slice), as its own surface: u runs from the part's `from` to its `to`. */
function partSurface(body: Strand, p: Part): Surface {
  const m = (u: F): F => mix(p.from, p.to, u);
  return { point: (u, v) => body.point(m(u), v), normal: (u, v) => body.normal(m(u), v), anchor: (u, v) => body.anchor(m(u), v), topology: { u: ["free", "free"], v: "periodic" }, skeleton: NO_SKELETON };
}

/** The tip's spine point (the nearest station: one table read). */
function tipOf(body: Strand, p: Part): Expr<"vec3"> {
  return body.skeleton.joint(Math.round(p.tip * (body.skeleton.joints - 1))).p;
}

class Smear implements Drawable {
  readonly skeletons = [];
  readonly surfaces = [];
  constructor(readonly name: string, readonly strike: Strike, readonly spec: Required<SmearSpec>) {}

  draws(ctx: CompileContext): Emitted {
    const { part } = this.strike, s = this.spec, dt = s.over / s.samples;
    // Each copy posts only the part's stations (`partAt`): the spine is what a slice costs.
    const slices = Array.from({ length: s.samples + 1 }, (_, k) => (k === 0 ? part.body : part.body.partAt(sub(time, k * dt), part.from)));
    const emitted: Emitted[] = [];
    // Oldest first: drawn back to front in time, so younger copies lie over older ones.
    for (let k = s.samples; k >= 1; k--) {
      const body = slices[k];
      const speed = distance(tipOf(body, part), tipOf(slices[k - 1], part)).div(dt);
      const fade = mul(s.opacity, 1 - (k - 1) / s.samples);
      const show = mul(fade, smoothstep(s.speed[0], s.speed[1], speed));
      const colour = (fr: Fragment): Expr<"vec4"> => {
        const m = mix(part.from, part.to, fr.u);
        const normal = body.normal(m, fr.v);
        const view = mul(viewDir(fr.world), -1);
        // The copy is the part itself an instant ago: its own coordinates, anchor and identity, so its pattern matches.
        const lit = fr.style.shade({
          base: part.body.look.paint(m, fr.v, { world: fr.world, normal, copy: f(0) }), normal, sun: lift<"vec3">(fr.sun), view, world: fr.world, depth: sub(levelOf(ctx.ground)(fr.world.xz), fr.world.y),
          uv: vec2(m, fr.v), anchor: body.anchor(m, fr.v), id: f(nameId(part.body.name)),
        });
        return vec4(lit, mul(show, step(0, dot(normal, view))));
      };
      emitted.push(drawGlazed(`${this.name}_${k}`, partSurface(body, part), {
        colour, grid: { u: spacing.ends(24), v: spacing.from(16, 0.25) }, phase: "transparent", sceneDepth: false,
      }).draws(ctx));
    }
    return { shaders: Object.assign({}, ...emitted.map((e) => e.shaders)), draws: emitted.flatMap((e) => e.draws) };
  }
}

/**
 * Fading copies of the attack's striking part over the last `over` seconds, shown while it moves fast.
 *
 * The law. With dt = over / samples, copy k (1 to `samples`) is the part's stretch of its body posed at time - k dt,
 * lit by the scene's style with the part's own paint, back faces dropped (one layer of translucency each). Its opacity
 * is opacity (1 - (k - 1) / samples) times smoothstep(speed[0], speed[1], v), v the speed of the part's tip between
 * copy k and copy k - 1 (the nearest skeleton station to `tip`). Oldest is drawn first, so younger copies lie over
 * older ones.
 *
 * Parameters: `over`, `samples`, `speed` (default [5, 11] world units a second) and `opacity` (default 0.5) are fixed
 * numbers; the part moves by its attack.
 *
 * What it cannot do, because of the law:
 * - blur continuously: the copies are discrete, so a part that moves further than its own width in dt shows gaps.
 * - smear anything but a `Strike`'s part: a stretch of a strand bound to an attack by `animate`.
 * - answer speed anywhere but at the tip: a stretch that whips at its root while its tip is still shows nothing.
 * - be cheap at many samples: each copy poses the part's stations again and draws the stretch again.
 *
 * Going past it: `strike.part.body.partAt(t, from)` is the stretch at any other time t, so copies of your own (other
 * spacing in time, another fade, other lighting) are a few lines. Relatives worth trying:
 * - a swept ribbon (a blade's trail): one `surface` between the tip's place now (u = 0) and at time - over (u = 1),
 *   across the part's width, fading along u. One draw, no gaps.
 * - speed lines: a few thin strands along the tip's past path, sampled at past times.
 * - a smear of the whole body: `body.at(time - k dt)` copies of everything, for a dash.
 */
export function smear(strike: Strike, spec: SmearSpec): Drawable {
  if (!(Number.isInteger(spec.samples) && spec.samples >= 1)) throw new Error(`smear: samples must be a positive integer, got ${spec.samples}`);
  if (!(spec.over > 0)) throw new Error(`smear: over must be positive, got ${spec.over}`);
  const full: Required<SmearSpec> = { over: spec.over, samples: spec.samples, speed: spec.speed ?? [5, 11], opacity: spec.opacity ?? 0.5 };
  if (!(full.speed[1] > full.speed[0])) throw new Error(`smear: speed must rise, got [${full.speed.join(", ")}]`);
  return new Smear(`smear_${strike.attack.name}`, strike, full);
}

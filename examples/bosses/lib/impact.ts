// RECIPE: water where an attack strikes it. Copy this file and edit it; it imports only the library's public entry.
//
// What it makes, and from what (docs/art_direction/DIRECTION.md: "foam as cream claws round whatever breaks the
// water"). At the moment of impact a boil of cream foam bursts on the water at each splash and runs out as a ring that
// breaks up into fingers and is gone; a key-black line runs round the cream. It is one `draw.glazed` surface lying on
// the sea (`Sea.height`), over the attack's own hit shape (`hitPatch`), so the patch is the area the game already knows,
// and any number of splashes inside it cost one draw; between strikes the patch collapses to a point and costs nothing.
// How it is painted is a choice (`ImpactPaint`): `ridge`, the fingers along the zero lines of a noise field (`noise2`),
// as the woodblock sea's first foam has them; or `roll`, white water as the print's other events draw it (the library's
// `crown`, `rollingFoam`, `behind`, `joined`): pointed fingers thrown outward at the impact, falling into a ring of
// rolling foam with curled heads leaning outward. The Reefback Titan's "crash" was the first of these.
//
// Parameters: the area (a `Hit`) and how far past it the patch reaches; the splashes, each a place on the water and
// the seconds since it landed (expressions: a game's input or a clock); how far the ring runs and how long it lives
// (numbers); two inks; the paint.
//
// What it cannot do:
// - leave the water: it is flat on the sea's surface (no spray, no sheet thrown up, no column);
// - reach past its area: a ring that runs outside the patch is cut off by its edge;
// - push the water: the sea's height is read, never changed (a crater or a wave from the strike is the sea's own
//   deformations, not this);
// - be hidden by what stands in it: it is glazed on the water without testing the scene's depth (`sceneDepth: false`),
//   so what it covers is settled by the order of its phase (`on-water`), not by distance.
//
// Copying it: change `splashShape` first (the ring's life: how fast the front runs and how it thins), then the paint.
// Relatives worth trying: a moving source instead of a fixed splash is a wake (the front's distance measured from a
// line, not a point); the ring's front made a sum of two square roots is a double ring (a strike and its rebound);
// the ridge cut on a spiral angle instead of noise is a whirlpool's foam.

import {
  abs, add, behind, crown, draw, edgeOf, gt, hitPatch, joined, length, lift, max, mix, mul, noise2, NO_SKELETON, rollingFoam, rollOf, saturate, select,
  slopeOf, smoothstep, spacing, sqrt, step, sub, vec2, vec3, vec4, type Drawable, type Expr, type F, type Hit, type In, type Rgb, type Sea, type Surface,
  type White,
} from "../../../src/index.ts";

const rgb = (c: Rgb) => vec3(c[0], c[1], c[2]);

/** One splash: where it lands on the water (x, z) and the seconds since it landed (negative before). */
export type Splash = { readonly at: In<"vec2">; readonly since: F };

export type ImpactSpec = {
  /** The water drawn on: every splash's ring must stay inside it (pad included). */
  readonly area: Hit;
  /** How far past the area the patch reaches, world units. */
  readonly pad: number;
  readonly splashes: readonly Splash[];
  /** How far the ring runs out from a splash, world units. */
  readonly reach: number;
  /** Seconds from impact until the foam is gone. */
  readonly seconds: number;
  readonly foam: Rgb;
  readonly line: Rgb;
  readonly paint: ImpactPaint;
};

/** How a splash's foam is drawn: as it was, or as white water with curled heads of world radius `head`. */
export type ImpactPaint = { readonly kind: "ridge" } | { readonly kind: "roll"; readonly head: number };
export const impactPaint = {
  ridge(): ImpactPaint { return { kind: "ridge" }; },
  /** `head`: the largest curled head's radius; left out, an eighth of the splash's reach. */
  roll(o: { readonly head?: number } = {}): (reach: number) => ImpactPaint { return (reach) => ({ kind: "roll", head: o.head ?? reach * 0.125 }); },
};

/** The foam of a set of splashes, drawn on the water over `area`. */
export function impactFoam(name: string, water: Sea, o: ImpactSpec): Drawable {
  if (o.splashes.length < 1) throw new Error(`impactFoam "${name}": no splashes`);
  if (!(o.reach > 0 && o.seconds > 0)) throw new Error(`impactFoam "${name}": reach and seconds must be positive`);
  // While no splash is live the patch collapses to its middle (no area, no fragments): it costs nothing between strikes.
  const pad = lift<"f32">(o.pad);
  const live = o.splashes.reduce<F>((acc, s) => max(acc, mul(step(0, s.since), step(s.since, o.seconds))), lift<"f32">(0));
  const middle = hitPatch(o.area, lift<"f32">(0.5), lift<"f32">(0.5), pad);
  const surface: Surface = {
    point: (u, v) => { const xz = mix(middle, hitPatch(o.area, u, v, pad), live); return vec3(xz.x, water.height(xz), xz.y); },
    normal: () => vec3(0, 1, 0), anchor: (u, v) => vec3(u, v, 0),
    topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON,
  };
  return draw.glazed(name, surface, {
    colour: (fr) => {
      const p = vec2(fr.world.x, fr.world.z);
      const white = painted(o, p);
      return vec4(mix(rgb(o.line), rgb(o.foam), white.fill), max(white.fill, mul(white.line, 0.9)));
    },
    grid: { u: spacing.even(24), v: spacing.even(24) }, phase: "on-water", sceneDepth: false,
  });
}

/** The splashes' foam at p. One handler per paint. */
function painted(o: ImpactSpec, p: Expr<"vec2">): White {
  // The union of every splash's shape (0..1).
  const shape = o.splashes.reduce<F>((acc, s) => max(acc, splashShape(o, p, s)), lift<"f32">(0));
  switch (o.paint.kind) {
    case "ridge": {
      // One cut into ink and cream. The claws live in the upper half of the shape's falloff only: cut lower, the zero
      // lines of the noise printed as black scribbles wherever the falloff was faintly positive, far outside the foam
      // (first version, 2026-11-11).
      const cut = sub(sub(shape, 0.5), mul(abs(noise2(mul(p, 1.3))), 0.6));
      const foam = edgeOf(cut, 0, 0.004);
      return { fill: foam, line: mul(edgeOf(cut, -0.07, 0.004), sub(1, foam)) };
    }
    case "roll": {
      const r = rollOf(o.paint.head, 0.45);
      // The heads lean outward from the splash that makes the most foam here.
      const out = o.splashes.reduce<{ readonly most: F; readonly dir: Expr<"vec2"> }>((acc, s) => {
        const mine = splashShape(o, p, s);
        return { most: max(acc.most, mine), dir: select(gt(mine, acc.most), sub(p, lift<"vec2">(s.at)), acc.dir) };
      }, { most: lift<"f32">(0), dir: vec2(0, 0) });
      const ring = rollingFoam({ xz: p, mass: shape, slope: slopeOf(shape, p), lean: { kind: "toward", dir: out.dir } }, r);
      // The crowns behind the ring: the ring's curls and key lines show over them, and the fingers stand out past it.
      const crowns = o.splashes.map((s) => crownOf(o, p, s, r)).reduce(joined);
      return behind(crowns, ring);
    }
  }
}

/**
 * A splash's crown: fingers thrown outward from its foam's edge for the first third of its life, longest (0.38 of the
 * reach) an eighth of the way in, then falling back into the ring.
 */
function crownOf(o: ImpactSpec, p: Expr<"vec2">, s: Splash, r: ReturnType<typeof rollOf>): White {
  const k = saturate(mul(s.since, 1 / o.seconds));
  const up = mul(mul(smoothstep(0, 0.1, k), sub(1, smoothstep(0.14, 0.34, k))), step(0, s.since));
  // The fingers stand on the outer edge of the splash's foam: its front, and half the band's width beyond (as
  // splashShape has them). Standing on the front itself they were hidden under the foam.
  const rim = mul(add(mix(0.2, 1, sqrt(k)), mul(mix(0.45, 0.12, k), 0.5)), o.reach);
  return crown(sub(p, lift<"vec2">(s.at)), rim, mul(up, o.reach * 0.38), 13, r);
}

/**
 * One splash's foam band at p: a boil filling the middle for the first moment, and a ring whose front runs out fast
 * and slows (a square root of time), thinning as it goes; 0 before the impact and after `seconds`.
 */
function splashShape(o: ImpactSpec, p: In<"vec2">, s: Splash): F {
  const k = saturate(mul(s.since, 1 / o.seconds));
  const d = length(sub(lift<"vec2">(p), lift<"vec2">(s.at)));
  const front = mul(mix(0.2, 1, sqrt(k)), o.reach);
  const ring = sub(1, smoothstep(0, mul(mix(0.45, 0.12, k), o.reach), abs(sub(d, front))));
  const boil = mul(sub(1, smoothstep(0.1, 0.35, k)), sub(1, smoothstep(mul(front, 0.5), front, d)));
  const live = mul(step(0, s.since), sub(1, smoothstep(0.7, 1, k)));
  return mul(max(ring, boil), live);
}

// Bilateral pairs and rows. `mirror` reflects a part across the z = 0 plane of its own coordinates (a part built facing
// +x with y up has its left-right plane there), keeping it a true mirror image: a strand's spine and frame seed are
// reflected, its twist negated and its paint read at v -> 0.5 - v; a surface is reflected and read at u -> 1 - u, so
// its front (d/du x d/dv) still faces out. `array` makes named copies of a strand in a row of charts (ribs, legs).

import { lift, neg, sub, time, vec3 } from "../expr.ts";
import { SurfaceDrawable, withFragment, type Look } from "../draw/surface.ts";
import { framed } from "../map/surface.ts";
import { newSlices } from "../map/sweep.ts";
import type { Chart, End, P3, Surface, Topology } from "../map/types.ts";
import { Strand } from "./strand.ts";

/**
 * Reflection of a point across the plane z = 0: (x, y, z) to (x, y, -z). What `mirror` does to every point of a part;
 * use it on points you compute yourself (a target, a joint) so they match a mirrored part. It cannot reflect across any
 * other plane: compose it with your own placement for that.
 */
export const reflect = (p: P3): P3 => vec3(p.x, p.y, neg(p.z));

function mirrorStrand(s: Strand, name: string): Strand {
  if (s.slice !== time) throw new Error(`mirror "${name}": mirror the live strand, then take it at another time`);
  const t = s.transport;
  const transport = { ...t, twist: (m: Parameters<typeof t.twist>[0]) => neg(t.twist(m)), up: reflect(t.up) };
  const paint = s.look.paint;
  return new Strand([name, (m) => reflect(s.spine(m)), s.section, transport, s.chart, time, newSlices(), `body_${name}`, { kind: "all" }], { ...s.look, paint: (m, v, at) => paint(m, sub(0.5, v), at) });
}

const swapEnds = (u: Topology["u"]): Topology["u"] => (u === "periodic" ? u : [u[1], u[0]] as readonly [End, End]);

function mirrorSurface(s: Surface): Surface {
  const flip = (u: Parameters<Surface["point"]>[0]) => sub(1, u);
  return {
    point: (u, v) => reflect(s.point(flip(u), v)),
    normal: (u, v) => reflect(s.normal(flip(u), v)),
    anchor: (u, v) => reflect(s.anchor(flip(u), v)),
    topology: { u: swapEnds(s.topology.u), v: s.topology.v },
    skeleton: { joints: s.skeleton.joints, joint: (k) => { const j = s.skeleton.joint(k); return { p: reflect(j.p), r: j.r }; } },
  };
}

function mirrorLook(look: Look): Look {
  switch (look.kind) {
    case "lit": { const p = look.paint; return { ...look, paint: (u, v, at) => p(sub(1, u), v, at) }; }
    case "flat": { const p = look.paint; return { ...look, paint: (u, v, at) => p(sub(1, u), v, at) }; }
    case "glazed": return { ...look, colour: withFragment(look.colour, (f) => ({ ...f, u: sub(1, f.u) })) };
  }
}

function mirrorDrawn(d: SurfaceDrawable, name: string): SurfaceDrawable {
  if (d.copies.kind !== "one") throw new Error(`mirror "${name}": mirror the instanced part and its points, not the instances`);
  return new SurfaceDrawable(name, mirrorSurface(d.surface), d.grid, mirrorLook(d.look), d.copies);
}

/**
 * The mirror image of a part across the z = 0 plane of its own coordinates, as a new part named `name`: the other half
 * of a bilaterally symmetric pair.
 *
 * The shape and its law. Every point p goes to `reflect(p)` = (x, y, -z). A strand's spine and up direction are
 * reflected and its twist negated; a surface is read at u -> 1 - u, so its front (d/du x d/dv) still faces out;
 * paint is read at the mirrored coordinates (v -> 0.5 - v on a strand, u -> 1 - u on a surface), so a pattern
 * mirrors too.
 *
 * Parameters: the part, a live `Strand` or a single (not instanced) `SurfaceDrawable`, and the new name. Whatever
 * expressions the part reads, the mirror reads the same ones.
 *
 * What it cannot do, because it is one fixed reflection of the same expressions:
 * - move differently from its original: both read the same time and inputs, so a gait's opposite phase or a different
 *   pose on the other side must be built into the part before mirroring (build each side from a function of its side).
 * - reflect across any plane but z = 0 of the part's own coordinates: build the part so its plane of symmetry is there.
 * - mirror a time slice of a strand, or the instances of an instanced drawable (it throws).
 *
 * Going past it: `mirror.surface` reflects a bare `Surface` (before you choose a look), and `reflect` reflects points.
 * Relatives, other symmetry groups by the same construction:
 * - a turn instead of a reflection (rotational symmetry, a flower, a wheel's spokes): `array` with placements turned
 *   by 2 pi i / n.
 * - a reflection followed by a shift along the plane (glide symmetry, footprints): `array` placing the mirrored part
 *   at alternate stations.
 * - reflection through a point, p -> -p (central symmetry): a `surface` of your own reading -point(u, v).
 */
export function mirror(part: Strand, name: string): Strand;
export function mirror(part: SurfaceDrawable, name: string): SurfaceDrawable;
export function mirror(part: Strand | SurfaceDrawable, name: string): Strand | SurfaceDrawable {
  if (part instanceof Strand) return mirrorStrand(part, name);
  if (part instanceof SurfaceDrawable) return mirrorDrawn(part, name);
  throw new Error(`mirror "${name}": can mirror a Strand or a SurfaceDrawable`);
}
mirror.surface = mirrorSurface;

/** A strand under another name (its table and shaders are keyed by name, so copies need their own). */
function renamed(s: Strand, name: string): Strand {
  return new Strand([name, s.spine, s.section, s.transport, s.chart, s.slice, newSlices(), `body_${name}`, { kind: "all" }], s.look);
}

/**
 * `count` copies of a part in a row of charts: ribs along a body, legs down a side, posts along a path. Copy i is
 * placed in `placement(i)` (rigid charts such as `on(host, [m, v, rho])` or `rigid(frame)`) and named `<name>_<i>`.
 *
 * The shape and its law: copy i is the part's own coordinates carried through `placement(i)`. A strand is placed in the
 * whole chart (its spine follows a chart that bends); a surface takes only the chart's frame at its origin and is
 * moved rigidly.
 *
 * Parameters: the part, a fixed whole `count`, and `placement`, a function of the integer i returning a chart whose
 * frames may be expressions (so each copy may move differently, by i).
 *
 * What it cannot do, because every copy is the same part in another place:
 * - vary the shape by i (longer ribs toward the middle, a thinner last leg): build the parts yourself in a loop.
 * - be cheap in large numbers: each copy is its own drawable and draw; many identical copies want instancing.
 * - copy the instances of an instanced drawable, or a count that changes at run time.
 *
 * Going past it: a loop over i calling the part's own constructor with numbers from i gives copies that differ. For
 * many identical copies that ride together, `draw.points` instances one drawable (one draw, but copies cast no shadow).
 * Relatives, by the placement's law:
 * - placements turned about an axis by 2 pi i / count: rotational symmetry (petals, spokes, a crown of spikes).
 * - placements at stations along a body's spine, `on(body, [i / (count - 1), v, 1])`: a row that bends with the body.
 * - placements alternating `mirror`ed parts: left and right legs in pairs.
 */
export function array(part: Strand, count: number, placement: (i: number) => Chart): Strand[];
export function array(part: SurfaceDrawable, count: number, placement: (i: number) => Chart): SurfaceDrawable[];
export function array(part: Strand | SurfaceDrawable, count: number, placement: (i: number) => Chart): (Strand | SurfaceDrawable)[] {
  if (!(Number.isInteger(count) && count >= 1)) throw new Error(`array "${part.name}": count must be a positive integer, got ${count}`);
  return Array.from({ length: count }, (_, i) => {
    const name = `${part.name}_${i}`;
    if (part instanceof Strand) return renamed(part, name).placed(placement(i));
    if (part instanceof SurfaceDrawable) {
      if (part.copies.kind !== "one") throw new Error(`array "${part.name}": cannot place copies of instances`);
      const g = placement(i).frame(lift<"vec3">([0, 0, 0]));
      return new SurfaceDrawable(name, framed(part.surface, { frame: g, scale: lift<"f32">(1) }), part.grid, part.look, part.copies);
    }
    throw new Error(`array "${name}": can copy a Strand or a SurfaceDrawable`);
  });
}


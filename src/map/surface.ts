// Surfaces written as maps, and the products that build them from curves (DESIGN.md 7.2, "multiply"). `sweep` lives in
// sweep.ts (it needs frames transported on the CPU); everything here is closed form.

import { add, clamp, compileJs, cos, cross, div, f, length, lift, max, mix, mul, normalize, sin, sub, substitute, TAU, time, variable, vec3, type In } from "../expr.ts";
import { through } from "../curve.ts";
import { rotate } from "./chart.ts";
import { NO_SKELETON, type Curve, type End, type F, type Frame, type P3, type Placed, type Posed, type Surface, type Topology } from "./types.ts";

/** Parameter step of the finite differences that give a map's normal. Small against [0, 1], large against f32 noise. */
const FD = 1e-3;

/**
 * The unit normal of a map, from central differences of the same expression: `d/du x d/dv`, normalised (a degenerate
 * point, where the two derivatives are parallel, gives the zero vector rather than NaN). Symbolic differentiation
 * (src/grad.ts) can replace this without changing any caller.
 */
export function mapNormal(point: (u: F, v: F) => P3): (u: F, v: F) => P3 {
  return (u, v) => {
    const du = sub(point(add(u, FD), v), point(sub(u, FD), v));
    const dv = sub(point(u, add(v, FD)), point(u, sub(v, FD)));
    const n = cross(du, dv);
    return div(n, max(length(n), 1e-12));
  };
}

/**
 * The anchor of an analytic map (`Surface.anchor`): its point at time 0. Exact for a closed-form surface; one that reads
 * a per-frame table (a sheet standing on a body) keeps that table's motion, since a slice is not a substitution.
 */
export function atRest(point: (u: F, v: F) => P3): (u: F, v: F) => P3 {
  return (u, v) => substitute([point(u, v)], time, f(0))[0] as P3;
}

/** A surface written directly as a function of (u, v); its normal comes from the map itself. */
export function surface(point: (u: F, v: F) => P3, topology: Topology): Surface {
  return { point, normal: mapNormal(point), anchor: atRest(point), topology, skeleton: NO_SKELETON };
}

/** A surface carried by a placement: points and normals in the placed frame, scaled (an instance of it). */
export function framed(s: Surface, at: Placed): Surface {
  return {
    point: (u, v) => add(at.frame.o, mul(rotate(at.frame, s.point(u, v)), at.scale)),
    normal: (u, v) => rotate(at.frame, s.normal(u, v)),
    // A copy's pattern is its own: the placement moves it, the anchor stays in the copy's coordinates (scaled with it).
    anchor: (u, v) => mul(s.anchor(u, v), at.scale),
    topology: s.topology,
    skeleton: NO_SKELETON,
  };
}

/** A surface carried by a posed copy: evenly scaled (as `framed`), or scaled along each axis of its frame. */
export function framedPose(s: Surface, at: Posed): Surface {
  const z = at.size;
  switch (z.kind) {
    case "even": return framed(s, { frame: at.frame, scale: z.k });
    case "axes": return stretched(s, at.frame, z.k);
  }
}

/**
 * A surface scaled by k along its own axes, then carried by an orthonormal frame. Points and anchors scale by k; the
 * normal turns by the cofactor of diag(k), diag(ky kz, kz kx, kx ky), which is what d/du x d/dv turns by under the
 * scale (cross(K a, K b) = cof(K) cross(a, b)), so it stays the front's normal: the inverse transpose up to a positive
 * factor, without the division that a copy shrunk to nothing (size 0, hidden) would make infinite. Scaling the normal
 * by k instead, as a frame stretched by hand does, leans it toward the long axis (examples/bosses/tithe/kit.ts had to
 * fix that by hand). Tested against the stretched map's own normal: tests/map.posed.test.ts.
 */
function stretched(s: Surface, g: Frame, k: P3): Surface {
  const cof = vec3(mul(k.y, k.z), mul(k.z, k.x), mul(k.x, k.y));
  return {
    point: (u, v) => add(g.o, rotate(g, mul(s.point(u, v), k))),
    normal: (u, v) => normalize(rotate(g, mul(s.normal(u, v), cof))),
    anchor: (u, v) => mul(s.anchor(u, v), k),
    topology: s.topology,
    skeleton: NO_SKELETON,
  };
}

/**
 * The ruled surface from `root` (v = 0) to `edge` (v = 1): a membrane standing on a curve. The normal is the ruling
 * crossed with nothing degenerate: `root'(u) x (edge - root)`, where root' is a central difference (so a sheet whose
 * edge comes down to its root, as a fin does at its ends, keeps the direction of its neighbours there).
 */
export function sheet(root: Curve, edge: Curve): Surface {
  const point = (u: F, v: F): P3 => mix(root(u), edge(u), v);
  return {
    point,
    normal: (u) => {
      const along = sub(root(clamp(add(u, FD), 0, 1)), root(clamp(sub(u, FD), 0, 1)));
      const n = cross(along, sub(edge(u), root(u)));
      return div(n, max(length(n), 1e-12));
    },
    anchor: atRest(point),
    topology: { u: ["free", "free"], v: "free" },
    skeleton: NO_SKELETON,
  };
}

/** Profile samples the lathe takes at rest to decide which way its surface faces. */
const LATHE_SAMPLES = 64;

/**
 * A surface of revolution about the y axis: `profile(u)` is (radius, height); v runs once round. Ends where the radius
 * is zero are poles; the caller says which (`ends`).
 *
 * The front (d/du x d/dv, what one-sided drawing keeps and the normal points out of) faces away from the axis whichever
 * way the profile runs. Turning counter-clockwise seen from +y, d/du x d/dv . radial = -dh/du: a profile running top to
 * bottom faced out and one running bottom to top faced the axis, so a ball whose profile rose was drawn inside out
 * (examples/bosses/thundermaw.ts reversed its profile to get round it; examples/bosses/tithe/kit.ts's tube and ball rose
 * and were drawn inside out, 2026-11-11). Rather than refuse the rising profile, the lathe turns the other way round for
 * it (clockwise seen from +y), which flips d/du x d/dv and keeps u as the author wrote it: paint over u reads the same,
 * and v runs the other way round (a pattern in v is mirrored, which a surface of revolution rarely shows). Which way
 * the profile runs is the sign of the integral of r dh, sampled once at rest (time 0, inputs and params at their
 * defaults: the same rest the level of detail measures). A profile enclosing no area with the axis (a flat disc, or
 * one that rises as much as it falls) has no outside to decide, and is refused by name.
 */
export function lathe(profile: (u: F) => In<"vec2">, ends: readonly [End, End]): Surface {
  const turn = latheTurn(profile);
  const point = (u: F, v: F): P3 => {
    const rh = lift<"vec2">(profile(u)), a = mul(v, turn * TAU);
    return vec3(mul(rh.x, cos(a)), rh.y, mul(rh.x, sin(a)));
  };
  return surface(point, { u: ends, v: "periodic" });
}

/** -1 (counter-clockwise from +y, as before) for a profile that runs down, +1 for one that runs up. */
function latheTurn(profile: (u: F) => In<"vec2">): -1 | 1 {
  const x = variable("loft_lathe_u", "f32");
  const at = substitute([lift<"vec2">(profile(x))], time, f(0))[0]!;
  // Trapezoids of r dh, and the profile's size, to judge the integral against.
  let area = 0, size = 0;
  try {
    const js = compileJs([at]);
    const run = (u: number) => js({ vars: { loft_lathe_u: u }, inputs: {}, params: {} })[0] as number[];
    let prev = run(0);
    for (let k = 1; k <= LATHE_SAMPLES; k++) {
      const q = run(k / LATHE_SAMPLES);
      area += 0.5 * (q[0]! + prev[0]!) * (q[1]! - prev[1]!);
      size = Math.max(size, Math.abs(q[0]!), Math.abs(q[1]!));
      prev = q;
    }
  } catch (e) {
    throw new Error(`lathe: the profile cannot be evaluated on the CPU at rest, so which way it faces cannot be decided (${(e as Error).message})`);
  }
  if (!(Math.abs(area) > 1e-6 * size * size)) {
    throw new Error(`lathe: the profile encloses no area with the axis (integral of r dh is ${area}), so it has no outside to face; draw a flat or self-cancelling profile as a \`surface\` with the orientation you mean`);
  }
  return area > 0 ? 1 : -1;
}

/** Through a row of curves: v = 0 is the first, v = 1 the last, interpolated by a Catmull-Rom spline in between. */
export function loft(curves: readonly Curve[]): Surface {
  if (curves.length < 2) throw new Error(`loft: need at least two curves, got ${curves.length}`);
  return surface((u, v) => through(v, curves.map((c) => c(u))), { u: ["free", "free"], v: "free" });
}

/** A curve moved along `by` (a direction and a length in one vector): v = 0 is the curve, v = 1 the moved copy. */
export function extrude(curve: Curve, by: In<"vec3">): Surface {
  const d = lift<"vec3">(by);
  return surface((u, v) => add(curve(u), mul(d, v)), { u: ["free", "free"], v: "free" });
}

/**
 * A sheet made solid: a lens of half-thickness `half` round it. v goes once round the section (0 the sheet's v = 0
 * edge, 0.25 the front face at the middle, 0.5 the v = 1 edge, 0.75 the back face), so the result is periodic in v and
 * thins to the sheet's two edges; free u ends become caps.
 */
export function thicken(s: Surface, half: In<"f32">): Surface {
  const point = (u: F, v: F): P3 => {
    const w = sub(0.5, mul(cos(mul(v, TAU)), 0.5));
    return add(s.point(u, w), mul(s.normal(u, w), mul(sin(mul(v, TAU)), half)));
  };
  return surface(point, { u: thickEnds(s.topology.u), v: "periodic" });
}
const CAPPED: Readonly<Record<End, End>> = { free: "cap", pole: "pole", cap: "cap" };
function thickEnds(u: Topology["u"]): Topology["u"] {
  return u === "periodic" ? u : [CAPPED[u[0]], CAPPED[u[1]]];
}

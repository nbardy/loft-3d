// Shared by the relief tests: a flat patch and a sphere written as surfaces with analytic normals, and a CPU runner for
// the shell tracer (the same expressions the fragment stage runs).
import { compileJs, cos, f, lift, mul, sin, variable, vec2, vec3, type Expr } from "../src/expr.ts";
import { NO_SKELETON, type F, type P3, type Surface } from "../src/map/types.ts";
import { shellFrame } from "../src/relief/displace.ts";
import type { Height } from "../src/relief/height.ts";
import { traceMarch, tracePlain, type Traced } from "../src/relief/trace.ts";

export type V3 = [number, number, number];
export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a: V3): number => Math.hypot(a[0], a[1], a[2]),
  unit: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; },
};

/** The plane y = 0 as (u, v) in [0, 1]^2 scaled by `size`: point (u size, 0, -v size), normal +y (su x sv). */
export function plane(size: number): Surface {
  const point = (u: F, v: F): P3 => vec3(mul(u, size), 0, mul(v, -size));
  return { point, normal: () => lift<"vec3">([0, 1, 0]), anchor: point, topology: { u: ["free", "free"], v: "free" }, skeleton: NO_SKELETON };
}

/** The direction of sphere coordinates (u, v): polar angle pi u from +y, azimuth 2 pi v. su x sv points out. */
export const sphereDir = (u: F, v: F): P3 => {
  const th = mul(u, Math.PI), ph = mul(v, -2 * Math.PI);
  return vec3(mul(sin(th), cos(ph)), cos(th), mul(sin(th), sin(ph)));
};
export const sphereDirNum = (u: number, v: number): V3 => {
  const th = Math.PI * u, ph = -2 * Math.PI * v;
  return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
};
/** Sphere coordinates of a direction (inverse of sphereDirNum). */
export const sphereUv = (d: V3): [number, number] => {
  const l = v3.len(d);
  const u = Math.acos(Math.max(-1, Math.min(1, d[1] / l))) / Math.PI;
  let v = -Math.atan2(d[2], d[0]) / (2 * Math.PI);
  if (v < 0) v += 1;
  return [u, v];
};
/** A sphere of radius R about the origin with its analytic normal. */
export function sphere(R: number): Surface {
  const point = (u: F, v: F): P3 => mul(sphereDir(u, v), R);
  return { point, normal: (u, v) => sphereDir(u, v), anchor: point, topology: { u: ["pole", "pole"], v: "periodic" }, skeleton: NO_SKELETON };
}

const U0 = variable("t_u0", "f32"), V0 = variable("t_v0", "f32");
const E = variable("t_entry", "vec3"), D = variable("t_dir", "vec3"), TOP = variable("t_top", "f32");
const STEPS = variable("t_steps", "f32");

export type Shot = { readonly uv: readonly [number, number]; readonly entry: V3; readonly dir: V3 };
export type Result = { kind: number; world: V3; uvh: V3; normal: V3 };

/** A CPU tracer over `s` with `height`: `march` (with a step count) and `plain`. */
export function tracer(s: Surface, height: Height, o: { refine: number; ink: number }) {
  const fr = shellFrame(s, U0, V0);
  const ray = { entry: E, dir: D, top: TOP };
  const uv0 = vec2(U0, V0);
  const out = (t: Traced): Expr[] => [t.kind, t.world, t.uvh, t.normal];
  const march = compileJs(out(traceMarch(fr, uv0, ray, height, { steps: STEPS, refine: f(o.refine), ink: f(o.ink), detail: f(1) })));
  const plain = compileJs(out(tracePlain(fr, uv0, ray, height, f(o.ink))));
  const base = compileJs([fr.base, fr.n]);
  const vars = (shot: Shot, top: number, steps: number) => ({ t_u0: shot.uv[0], t_v0: shot.uv[1], t_entry: [...shot.entry], t_dir: [...shot.dir], t_top: top, t_steps: steps });
  const unpack = (r: unknown[]): Result => ({ kind: r[0] as number, world: r[1] as V3, uvh: r[2] as V3, normal: r[3] as V3 });
  return {
    march: (shot: Shot, top: number, steps: number): Result => unpack(march({ vars: vars(shot, top, steps), inputs: {}, params: {} })),
    plain: (shot: Shot, top: number): Result => unpack(plain({ vars: vars(shot, top, 0), inputs: {}, params: {} })),
    /** The surface point and normal at (u, v). */
    base: (uv: readonly [number, number]): { p: V3; n: V3 } => {
      const [p, n] = base({ vars: { t_u0: uv[0], t_v0: uv[1] }, inputs: {}, params: {} }) as V3[];
      return { p, n };
    },
  };
}

/**
 * The first root along a ray of a scalar function g(t) (positive at t = 0) by dense sampling and bisection in f64: the
 * reference intersection the tracer is compared with. Null when g stays positive to tMax.
 */
export function firstCrossing(g: (t: number) => number, tMax: number, samples = 20000): number | null {
  let t0 = 0, g0 = g(0);
  for (let k = 1; k <= samples; k++) {
    const t1 = (tMax * k) / samples, g1 = g(t1);
    if (g1 <= 0) {
      let a = t0, b = t1;
      for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (g(m) > 0) a = m; else b = m; }
      void g0;
      return (a + b) / 2;
    }
    t0 = t1; g0 = g1;
  }
  return null;
}

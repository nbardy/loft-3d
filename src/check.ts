// Checks: arithmetic on the CPU from the same description the GPU draws (DESIGN.md 8). A scene module exports
// `checks`; `loft check <scene.ts>` compiles the scene, runs them through `compileScene(...).cpu` over posed frames
// and prints a table. Each check is a value with a name and one way to measure; none of them renders anything.
//
// Skeletons are what is measured: a body's chain of capsules (the same chain that casts its shadow). Their radii are
// the larger of the section's half-width and half-height, so distances are conservative for flattened sections.

import type { Artefact, Camera, FrameState } from "./artefact.ts";
import { compileScene, type Compiled, type CpuFn } from "./compile/index.ts";
import { add, Expr, lift, time, variable, vec2, vec4, type In, type TableFrame } from "./expr.ts";
import type { Score } from "./geom/expression.ts";
import { cameraMatrices, project } from "./host/camera.ts";
import type { Body } from "./map/sweep.ts";
import type { Skeleton } from "./map/types.ts";
import type { Scene } from "./scene.ts";
import type { Arming, Attack, Effect, Hold, Motion, Part, Ring, Strike, Target } from "./spacetime/attack.ts";
import type { Thrown } from "./geom/grab.ts";
import type { ChainSpec } from "./geom/limb.ts";
import { hitSdf } from "./spacetime/hit.ts";
import { skinBoxDistance, skinDistance, type SkinDistance } from "./geom/skin_distance.ts";
import { RingWave } from "./geom/ring.ts";

type V3 = readonly [number, number, number];
type Joint = { readonly p: V3; readonly r: number };
type Inputs = Readonly<Record<string, number | readonly number[]>>;

/** What a check reports. `value` is the measured number the verdict was taken on. */
export type Verdict = { readonly name: string; readonly pass: boolean; readonly value: number; readonly measured: string; readonly limit: string };

/** Measurements over one compiled scene, with inputs held at the given values (time aside). */
export class Probe {
  private readonly frames = new Map<number, TableFrame>();
  private readonly fns = new Map<readonly Expr[], CpuFn>();
  constructor(readonly compiled: Compiled, readonly inputs: Inputs) {}

  get artefact(): Artefact { return this.compiled.artefact; }

  state(t: number): FrameState {
    const a = this.artefact;
    const inputs = new Float32Array(Math.max(1, a.inputFloats));
    for (const s of a.inputs) {
      const set = s.name === "time" ? [t] : this.inputs[s.name];
      const v = set === undefined ? s.def : typeof set === "number" ? [set] : set;
      if (v.length !== s.def.length) throw new Error(`check: input "${s.name}" takes ${s.def.length} numbers, got ${v.length}`);
      inputs.set(v, s.slot);
    }
    for (const name of Object.keys(this.inputs)) if (!a.inputs.some((s) => s.name === name)) throw new Error(`check: the scene has no input "${name}"`);
    return { time: t, inputs, params: Float32Array.from(a.params.map((p) => p.def)), curves: a.curves };
  }

  /** Values of expressions at time t (free variables bound by `vars`). */
  eval(roots: readonly Expr[], t: number, vars: Record<string, number> = {}): (number | number[])[] {
    let fn = this.fns.get(roots);
    if (!fn) { fn = this.compiled.cpu(roots); this.fns.set(roots, fn); }
    let frame = this.frames.get(t);
    if (!frame) { frame = this.compiled.frame(this.state(t)); this.frames.set(t, frame); }
    return fn(frame, vars) as (number | number[])[];
  }

  scalar(e: In<"f32">, t = 0): number { return this.eval([lift<"f32">(e)], t)[0] as number; }

  /** A compiled function of the plane, for evaluating a distance many times at one instant. */
  planar(e: (p: Expr<"vec2">) => Expr<"f32">, t: number): (x: number, z: number) => number {
    const roots = [e(vec2(variable("check_x", "f32"), variable("check_z", "f32")))];
    const vars = { check_x: 0, check_z: 0 };
    return (x, z) => { vars.check_x = x; vars.check_z = z; return this.eval(roots, t, vars)[0] as number; };
  }

  joints(s: Skeleton, range: readonly [number, number], t: number): Joint[] {
    const [lo, hi] = range;
    let roots = this.skeletonRoots.get(s);
    if (!roots) { roots = Array.from({ length: s.joints }, (_, k) => { const j = s.joint(k); return vec4(j.p, j.r); }); this.skeletonRoots.set(s, roots); }
    const all = this.eval(roots, t) as number[][];
    return all.map((v) => ({ p: [v[0], v[1], v[2]] as V3, r: v[3] })).slice(lo, hi + 1);
  }
  private readonly skeletonRoots = new Map<Skeleton, Expr[]>();
}

export interface Check {
  readonly name: string;
  run(probe: Probe): Verdict;
}

/** Something with a skeleton to measure: a whole body, or a part (its stretch of joints). */
export type Measured = Body | Part;
function chainOf(x: Measured): { readonly skeleton: Skeleton; readonly range: readonly [number, number]; readonly name: string } {
  if ("skeleton" in x) return { skeleton: x.skeleton, range: [0, x.skeleton.joints - 1], name: x.name };
  const n = x.body.skeleton.joints - 1;
  const lo = Math.floor(x.from * n), hi = Math.ceil(x.to * n);
  return { skeleton: x.body.skeleton, range: [lo, Math.max(hi, lo + 1)], name: x.name };
}

// ---- geometry -----------------------------------------------------------------------------------------------------

const subV = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dotV = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Closest parameters (s, t) on segments p0-p1 and q0-q1 (Ericson, Real-Time Collision Detection 5.1.9). */
function closest(p0: V3, p1: V3, q0: V3, q1: V3): [number, number] {
  const d1 = subV(p1, p0), d2 = subV(q1, q0), r = subV(p0, q0);
  const a = dotV(d1, d1), e = dotV(d2, d2), f = dotV(d2, r);
  if (a <= 1e-12 && e <= 1e-12) return [0, 0];
  if (a <= 1e-12) return [0, clamp01(f / e)];
  const c = dotV(d1, r);
  if (e <= 1e-12) return [clamp01(-c / a), 0];
  const b = dotV(d1, d2), den = a * e - b * b;
  let s = den > 1e-12 ? clamp01((b * f - c * e) / den) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
  return [s, t];
}
const lerp = (a: V3, b: V3, s: number): V3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];

/** Least surface-to-surface distance between two chains of tapered capsules (negative: they overlap). */
function chainGap(a: readonly Joint[], b: readonly Joint[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i++) for (let j = 0; j + 1 < b.length; j++) {
    const [s, t] = closest(a[i].p, a[i + 1].p, b[j].p, b[j + 1].p);
    const pa = lerp(a[i].p, a[i + 1].p, s), pb = lerp(b[j].p, b[j + 1].p, t);
    const ra = a[i].r + (a[i + 1].r - a[i].r) * s, rb = b[j].r + (b[j + 1].r - b[j].r) * t;
    best = Math.min(best, Math.hypot(...subV(pa, pb)) - ra - rb);
  }
  return best;
}

/** Least distance in the water plane from a chain's footprint to a disc (a vertical cylinder). */
function discGap(a: readonly Joint[], centre: readonly [number, number], radius: number): number {
  let best = Infinity;
  const c: V3 = [centre[0], 0, centre[1]];
  for (let i = 0; i + 1 < a.length; i++) {
    const p0: V3 = [a[i].p[0], 0, a[i].p[2]], p1: V3 = [a[i + 1].p[0], 0, a[i + 1].p[2]];
    const [s] = closest(p0, p1, c, c);
    best = Math.min(best, Math.hypot(...subV(lerp(p0, p1, s), c)) - (a[i].r + (a[i + 1].r - a[i].r) * s) - radius);
  }
  return best;
}

/**
 * Least distance from a chain's joints to a column (a disc standing up to `top`): the capped cylinder's own distance
 * at each joint, less the joint's radius. Exact for a ball (a chain of one point, as a thrown thing is measured); for
 * a longer chain it is measured at the joints only.
 */
function columnGap(a: readonly Joint[], centre: readonly [number, number], radius: number, top: number): number {
  let best = Infinity;
  for (const j of a) {
    const dx = Math.hypot(j.p[0] - centre[0], j.p[2] - centre[1]) - radius, dy = j.p[1] - top;
    best = Math.min(best, (dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy)) - j.r);
  }
  return best;
}

/** Distance from a chain to a target at time t. */
function gap(probe: Probe, chain: readonly Joint[], target: Target, t: number): number {
  switch (target.kind) {
    case "disc": {
      const [c, r] = probe.eval([target.centre, target.radius], t) as [number[], number];
      return discGap(chain, [c[0], c[1]], r);
    }
    case "column": {
      const [c, r, top] = probe.eval([target.centre, target.radius, target.top], t) as [number[], number, number];
      return columnGap(chain, [c[0], c[1]], r, top);
    }
    case "body": {
      const b = chainOf(target.body);
      return chainGap(chain, probe.joints(b.skeleton, b.range, t));
    }
    case "skin": {
      const f = target.frame;
      const [o, x, y, z] = probe.eval([f.o, f.x, f.y, f.z], t) as unknown as V3[];
      const local = (p: V3): V3 => { const d = subV(p, o!); return [dotV(d, x!), dotV(d, y!), dotV(d, z!)]; };
      return skinGap(chain.map((j) => ({ p: local(j.p), r: j.r })), skinDistance(target.skin));
    }
  }
}

/**
 * Least distance from a chain of tapered capsules to a closed skin (negative: inside it): its signed distance at points
 * along each capsule's axis, no farther apart than half the smaller radius, less the radius there. Exact to that
 * spacing (the distance is 1-Lipschitz, so between samples it can dip by at most a quarter radius below them).
 */
function skinGap(a: readonly Joint[], h: SkinDistance): number {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i++) {
    const p0 = a[i]!.p, p1 = a[i + 1]!.p, r0 = a[i]!.r, r1 = a[i + 1]!.r;
    const n = Math.max(1, Math.ceil(Math.hypot(...subV(p1, p0)) / Math.max(0.5 * Math.min(r0, r1), 0.01)));
    for (let k = 0; k <= n; k++) {
      const s = k / n, p = lerp(p0, p1, s), r = r0 + (r1 - r0) * s;
      // The box is a lower bound: a sample that cannot beat the best so far is not measured.
      if (skinBoxDistance(h, p) - r >= best) continue;
      best = Math.min(best, h.distance(p) - r);
    }
  }
  return best;
}

/** Times from t0 to t1 (inclusive of t0, exclusive of t1) at the check rate. */
function times(t0: number, t1: number, rate: number): number[] {
  const n = Math.max(1, Math.ceil((t1 - t0) * rate));
  return Array.from({ length: n }, (_, i) => t0 + i / rate);
}

const fmt = (x: number, digits = 3): string => (Number.isFinite(x) ? x.toFixed(digits) : String(x));

/**
 * The share of a chain's footprint on the water (its capsules seen from above) for which `outside(x, z)` holds,
 * sampled on a grid `step` apart.
 */
export function footprintShare(chain: readonly Joint[], outside: (x: number, z: number) => boolean, step: number): { readonly share: number; readonly area: number } {
  const xs = chain.flatMap((j) => [j.p[0] - j.r, j.p[0] + j.r]), zs = chain.flatMap((j) => [j.p[2] - j.r, j.p[2] + j.r]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  let inside = 0, out = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
    if (discGap(chain, [x, z], 0) > 0) continue;
    inside++;
    if (outside(x, z)) out++;
  }
  if (inside === 0) throw new Error("footprintShare: the chain has no footprint at this sampling step");
  return { share: out / inside, area: inside * step * step };
}

// ---- the checks ---------------------------------------------------------------------------------------------------

/**
 * A time a check is given: seconds, or an attack's arming (`attack.arming`), which a check measures at its first
 * arming time. An attack that repeats arms at `attack.arm`, an expression of `time`; evaluated at time 0 that was a
 * cycle that had already passed or not yet begun, so checks read the arming's first time instead.
 */
export type CheckTime = In<"f32"> | Arming;
function timeOf(probe: Probe, t: CheckTime): number {
  if (typeof t === "number" || t instanceof Expr) return probe.scalar(t);
  switch (t.kind) {
    case "once": return probe.scalar(t.at);
    case "every": return probe.scalar(t.first);
  }
}

/**
 * The striking part's footprint at the arming time lies within the hit shape: at most `tolerance` of it outside. An
 * attack that repeats is measured at its first arming.
 */
export function landsInside(strike: Strike, o: { readonly tolerance?: number; readonly step?: number } = {}): Check {
  const tol = o.tolerance ?? 0.02, step = o.step ?? 0.03;
  const a = strike.attack, c = chainOf(strike.part);
  return {
    name: `${a.name}: ${c.name} lands inside the hit shape`,
    run(probe) {
      const T = probe.scalar(a.first);
      const chain = probe.joints(c.skeleton, c.range, T);
      const sdf = probe.planar((p) => hitSdf(a.hit, p), T);
      const { share } = footprintShare(chain, (x, z) => sdf(x, z) > 0, step);
      return { name: this.name, pass: share <= tol, value: share, measured: `${(share * 100).toFixed(1)}% outside`, limit: `<= ${(tol * 100).toFixed(1)}%` };
    },
  };
}

/** The least distance between `body` and `target` from `from` until (not including) `until` is at least `margin`. */
export function staysClear(body: Measured, target: Target, o: { readonly until: CheckTime; readonly from?: CheckTime; readonly margin?: number; readonly rate?: number; readonly label?: string }): Check {
  const c = chainOf(body), margin = o.margin ?? 0, rate = o.rate ?? 60;
  return {
    name: o.label ?? `${c.name} stays clear of the target`,
    run(probe) {
      const t1 = timeOf(probe, o.until), t0 = o.from === undefined ? 0 : timeOf(probe, o.from);
      let least = Infinity, when = t0;
      for (const t of times(t0, t1, rate)) {
        const g = gap(probe, probe.joints(c.skeleton, c.range, t), target, t);
        if (g < least) { least = g; when = t; }
      }
      return { name: this.name, pass: least >= margin, value: least, measured: `${fmt(least)} at t=${fmt(when, 2)} (${fmt(t0, 2)}..${fmt(t1, 2)})`, limit: `>= ${fmt(margin)}` };
    },
  };
}

/**
 * The striking part reaches the target at the arming time (within `contact`) and never enters it over the whole
 * attack (it stops at the hull: the least distance is at least `-tolerance`). An attack that repeats is measured over its
 * first arming.
 */
export function stopsAt(strike: Strike, target: Target, o: { readonly contact?: number; readonly tolerance?: number; readonly rate?: number } = {}): Check {
  const a = strike.attack, c = chainOf(strike.part), contact = o.contact ?? 0.6, tol = o.tolerance ?? 0.05, rate = o.rate ?? 60;
  return {
    name: `${a.name}: ${c.name} stops at the target`,
    run(probe) {
      const T = probe.scalar(a.first);
      const at = gap(probe, probe.joints(c.skeleton, c.range, T), target, T);
      let least = Infinity;
      for (const t of times(T - a.span.before, T + a.span.after, rate)) least = Math.min(least, gap(probe, probe.joints(c.skeleton, c.range, t), target, t));
      return {
        name: this.name, pass: at <= contact && least >= -tol, value: least,
        measured: `gap ${fmt(at)} at arming, least ${fmt(least)}`, limit: `gap <= ${fmt(contact)}, least >= ${fmt(-tol)}`,
      };
    },
  };
}

/** A feature (an eye) is at least `pixels` across, in its narrower direction, from a named camera at time `at`. */
export function minScreenSize(feature: Measured, camera: string, pixels: number, o: { readonly at?: CheckTime; readonly size?: readonly [number, number] } = {}): Check {
  const c = chainOf(feature), [w, h] = o.size ?? [1280, 800];
  return {
    name: `${c.name} from "${camera}" is at least ${pixels} px`,
    run(probe) {
      const cam: Camera | undefined = probe.artefact.cameras[camera];
      if (cam === undefined) throw new Error(`minScreenSize: the scene has no camera "${camera}" (cameras: ${Object.keys(probe.artefact.cameras).join(", ")})`);
      const t = o.at === undefined ? 0 : timeOf(probe, o.at);
      const m = cameraMatrices(cam, w / h);
      const f = m.forward, right = norm([-f[2], 0, f[0]]), up = cross(right, f);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const j of probe.joints(c.skeleton, c.range, t)) for (const d of [right, up]) for (const s of [-1, 1]) {
        const q = project(m, [j.p[0] + d[0] * j.r * s, j.p[1] + d[1] * j.r * s, j.p[2] + d[2] * j.r * s], w, h);
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      }
      const across = Math.min(x1 - x0, y1 - y0);
      return { name: this.name, pass: across >= pixels, value: across, measured: `${fmt(across, 1)} px at t=${fmt(t, 2)}`, limit: `>= ${pixels} px` };
    },
  };
}
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---- expressions --------------------------------------------------------------------------------------------------

/** A drawn length: two world points (closed forms of the clock) whose difference a viewer sees: an eye's middle to its
 * lid's edge, a stalk's root to its tip, an eye's middle to its pupil. */
export type Mark = { readonly from: In<"vec3">; readonly to: In<"vec3"> };

/**
 * A score's expressions (src/geom/expression.ts) read from a camera. Over one `period` of the clock:
 * - every named expression, and the rest, is at some instant at least `shown` of the face (default 0.9). A layer that a
 *   later one always covers never shows, however it is written;
 * - at those instants any two of them differ on screen: for at least one mark its drawn vector (`from` to `to`, in
 *   pixels) changes by at least `apart`, a share of `of`'s length on screen (say, an eye's width) or world units at
 *   `of`'s scale.
 * A mark is measured from its own `from`, so the body's travel between the two instants does not count as a change of
 * expression. Each expression is measured in the middle of its longest stretch within 0.02 of its peak.
 */
export function expressionsRead<K extends string, N extends string>(score: Score<K, N>, marks: Readonly<Record<string, Mark>>, o: {
  readonly camera: string; readonly period: number; readonly apart: Tolerance; readonly of: Mark;
  readonly shown?: number; readonly rate?: number; readonly size?: readonly [number, number];
}): Check {
  const names = ["rest", ...Object.keys(score.cast.named)] as (N | "rest")[];
  const markNames = Object.keys(marks);
  if (markNames.length === 0) throw new Error("expressionsRead: no marks to measure");
  const shown = o.shown ?? 0.9, rate = o.rate ?? 10, [w, h] = o.size ?? [1280, 800];
  const shares = score.shares(time);
  const shareRoots = names.map((n) => shares[n]);
  const markRoots = [o.of, ...markNames.map((m) => marks[m]!)].flatMap((m) => [lift<"vec3">(m.from), lift<"vec3">(m.to)]);
  return {
    name: `expressions read apart from "${o.camera}"`,
    run(probe) {
      const cam: Camera | undefined = probe.artefact.cameras[o.camera];
      if (cam === undefined) throw new Error(`expressionsRead: the scene has no camera "${o.camera}" (cameras: ${Object.keys(probe.artefact.cameras).join(", ")})`);
      const m = cameraMatrices(cam, w / h);
      const ts = times(0, o.period, rate);
      const table = ts.map((t) => probe.eval(shareRoots, t) as number[]);
      // Each expression's instant: the middle of its longest stretch near its peak.
      const peaks = names.map((name, i) => {
        const most = Math.max(...table.map((row) => row[i]!));
        let best: readonly [number, number] = [0, -1], from = -1;
        for (let k = 0; k <= ts.length; k++) {
          const near = k < ts.length && table[k]![i]! >= most - 0.02;
          if (near && from < 0) from = k;
          if (!near && from >= 0) { if (k - 1 - from > best[1] - best[0]) best = [from, k - 1]; from = -1; }
        }
        return { name, most, t: ts[Math.floor((best[0] + best[1]) / 2)]! };
      });
      const hidden = peaks.filter((p) => p.most < shown);
      const showing = peaks.map((p) => `${p.name} ${fmt(p.most, 2)} t=${fmt(p.t, 1)}`).join(", ");
      // Each mark's drawn vector at each expression's instant, in pixels; the first is the reference.
      const drawn = peaks.map((p) => {
        const pts = probe.eval(markRoots, p.t) as number[][];
        return Array.from({ length: pts.length / 2 }, (_, k) => {
          const a = project(m, pts[2 * k] as unknown as V3, w, h), b = project(m, pts[2 * k + 1] as unknown as V3, w, h);
          return { px: [b.x - a.x, b.y - a.y] as const, world: Math.hypot(...subV(pts[2 * k + 1] as unknown as V3, pts[2 * k] as unknown as V3)) };
        });
      });
      const ref = drawn[0]![0]!, refPx = Math.hypot(...ref.px);
      const [least, leastSaid] = ((t: Tolerance): readonly [number, string] => {
        switch (t.kind) {
          case "share": return [t.share * refPx, `${(t.share * 100).toFixed(0)}% of ${fmt(refPx, 1)} px`];
          case "units": return [t.units * (refPx / ref.world), `${fmt(t.units)} units`];
        }
      })(o.apart);
      let closest = { px: Infinity, pair: "", mark: "" };
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        let far = { px: 0, mark: "" };
        for (const [k, mark] of markNames.entries()) {
          const a = drawn[i]![k + 1]!.px, b = drawn[j]![k + 1]!.px, d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (d > far.px) far = { px: d, mark };
        }
        if (far.px < closest.px) closest = { px: far.px, pair: `${names[i]} / ${names[j]}`, mark: far.mark };
      }
      return {
        name: this.name, pass: hidden.length === 0 && closest.px >= least, value: closest.px,
        measured: `${hidden.length > 0 ? `never shown: ${hidden.map((p) => p.name).join(", ")}; ` : ""}closest pair ${closest.pair}: ${fmt(closest.px, 1)} px (${closest.mark}); ${showing}`,
        limit: `each >= ${fmt(shown, 2)} of the face; any two >= ${fmt(least, 1)} px (${leastSaid})`,
      };
    },
  };
}

/** A mark is at least `pixels` long on screen from a named camera at time `at`: a mouth's corners in its roar, an eye's opening. */
export function spansOnScreen(what: string, mark: Mark, camera: string, pixels: number, o: { readonly at: CheckTime; readonly size?: readonly [number, number] }): Check {
  const [w, h] = o.size ?? [1280, 800];
  const roots = [lift<"vec3">(mark.from), lift<"vec3">(mark.to)];
  return {
    name: `${what} from "${camera}" is at least ${pixels} px`,
    run(probe) {
      const cam: Camera | undefined = probe.artefact.cameras[camera];
      if (cam === undefined) throw new Error(`spansOnScreen: the scene has no camera "${camera}" (cameras: ${Object.keys(probe.artefact.cameras).join(", ")})`);
      const t = timeOf(probe, o.at), m = cameraMatrices(cam, w / h);
      const [a, b] = (probe.eval(roots, t) as unknown as V3[]).map((p) => project(m, p, w, h));
      const across = Math.hypot(b!.x - a!.x, b!.y - a!.y);
      return { name: this.name, pass: across >= pixels, value: across, measured: `${fmt(across, 1)} px at t=${fmt(t, 2)}`, limit: `>= ${pixels} px` };
    },
  };
}

/** Whether the segment from p to q passes through a chain of tapered capsules. */
function crosses(chain: readonly Joint[], p: V3, q: V3): boolean {
  for (let i = 0; i + 1 < chain.length; i++) {
    const [s, t] = closest(chain[i]!.p, chain[i + 1]!.p, p, q);
    const a = lerp(chain[i]!.p, chain[i + 1]!.p, s), b = lerp(p, q, t);
    if (Math.hypot(...subV(a, b)) < chain[i]!.r + (chain[i + 1]!.r - chain[i]!.r) * s) return true;
  }
  return false;
}

/**
 * Named points (an eye's middle, a mouth) stay in view of a camera: over one `period` of the clock, none of them is
 * behind any of `blockers` for longer than `hidden` at a stretch (`tolerance.units`: seconds; `tolerance.share`: of the
 * period). A point is behind a blocker when the line of sight from it to the camera passes through the blocker's
 * skeleton (its chain of capsules, whose radii are the larger of each section's half-width and half-height: a flat
 * part seen edge-on is counted as hiding more than it does, so a pass is safe and a failure may need a look).
 * Blockers with no skeleton hide nothing here.
 */
export function staysInView(points: Readonly<Record<string, In<"vec3">>>, blockers: readonly { readonly name: string; readonly skeletons: readonly Skeleton[] }[], o: {
  readonly camera: string; readonly period: number; readonly hidden: Tolerance; readonly rate?: number;
}): Check {
  const names = Object.keys(points);
  if (names.length === 0) throw new Error("staysInView: no points to watch");
  const rate = o.rate ?? 20;
  const roots = names.map((n) => lift<"vec3">(points[n]!));
  const chains = blockers.flatMap((b) => b.skeletons.filter((s) => s.joints > 1).map((s) => ({ name: b.name, skeleton: s })));
  return {
    name: `${names.join(", ")} stay in view of "${o.camera}"`,
    run(probe) {
      const cam: Camera | undefined = probe.artefact.cameras[o.camera];
      if (cam === undefined) throw new Error(`staysInView: the scene has no camera "${o.camera}" (cameras: ${Object.keys(probe.artefact.cameras).join(", ")})`);
      // Where the line of sight from a point ends: the eye, or for a camera of parallel rays a point far back along them.
      const sightEnd = ((): (p: V3) => V3 => {
        switch (cam.kind) {
          case "perspective": return () => cam.eye;
          case "orthographic": { const back = subV(cam.eye, cam.target); return (p) => [p[0] + back[0], p[1] + back[1], p[2] + back[2]]; }
        }
      })();
      const allowed = allowance(o.hidden, o.period);
      const ts = times(0, o.period, rate);
      // For each point: its longest hidden stretch (samples in a row), all its hidden samples, and what hid it longest.
      const run = names.map(() => ({ now: 0, longest: 0, total: 0, at: 0, by: "" }));
      for (const t of ts) {
        const ps = probe.eval(roots, t) as unknown as V3[];
        const posed = chains.map((c) => ({ name: c.name, joints: probe.joints(c.skeleton, [0, c.skeleton.joints - 1], t) }));
        for (const [i, p] of ps.entries()) {
          const by = posed.find((c) => crosses(c.joints, p, sightEnd(p)));
          const r = run[i]!;
          if (by === undefined) { r.now = 0; continue; }
          r.now++; r.total++;
          if (r.now > r.longest) { r.longest = r.now; r.at = t; r.by = by.name; }
        }
      }
      const worst = run.reduce((a, b) => (b.longest > a.longest ? b : a));
      const seconds = worst.longest / rate;
      const said = run.map((r, i) => `${names[i]} ${fmt(r.longest / rate, 2)} s${r.longest > 0 ? ` (by ${r.by}, until t=${fmt(r.at, 2)}; ${fmt(r.total / rate, 2)} s in all)` : ""}`).join(", ");
      return { name: this.name, pass: seconds <= allowed, value: seconds, measured: `longest hidden: ${said}`, limit: `each <= ${describe(o.hidden, allowed, "the period")} s at a stretch` };
    },
  };
}

// ---- holds --------------------------------------------------------------------------------------------------------

/**
 * How far a measurement may be from what it should be: a distance in world units, or a share of a reference that the
 * check taking it names (for `gripReaches`, the held thing's width). A value, so a check never takes a bare number.
 */
export type Tolerance = { readonly kind: "units"; readonly units: number } | { readonly kind: "share"; readonly share: number };
/**
 * Makes a `Tolerance` for a check that takes one: `tolerance.units(d)` for a distance in world units, or
 * `tolerance.share(s)` for a share of a reference the check names. Both throw unless the number is finite and not
 * negative.
 */
export const tolerance = {
  units: (units: number): Tolerance => {
    if (!(units >= 0 && Number.isFinite(units))) throw new Error(`tolerance.units: need a finite distance >= 0, got ${units}`);
    return { kind: "units", units };
  },
  share: (share: number): Tolerance => {
    if (!(share >= 0 && Number.isFinite(share))) throw new Error(`tolerance.share: need a finite share >= 0, got ${share}`);
    return { kind: "share", share };
  },
};
/** The distance a tolerance allows, given the reference its check names. */
function allowance(t: Tolerance, reference: number): number {
  switch (t.kind) {
    case "units": return t.units;
    case "share": return t.share * reference;
  }
}
const describe = (t: Tolerance, allowed: number, of: string): string => {
  switch (t.kind) {
    case "units": return fmt(allowed);
    case "share": return `${fmt(allowed)} (${(t.share * 100).toFixed(0)}% of ${of})`;
  }
};

/** The point of a chain's surface nearest p (the chain's capsules, tapered), and how far p is from it (negative inside). */
function nearestSurface(chain: readonly Joint[], p: V3): { readonly at: V3; readonly d: number } {
  let best = { at: chain[0]!.p, d: Infinity };
  for (let i = 0; i + 1 < chain.length; i++) {
    const [s] = closest(chain[i]!.p, chain[i + 1]!.p, p, p);
    const q = lerp(chain[i]!.p, chain[i + 1]!.p, s), r = chain[i]!.r + (chain[i + 1]!.r - chain[i]!.r) * s;
    const to = subV(p, q), len = Math.hypot(...to);
    if (len - r < best.d) best = { at: len > 1e-9 ? [q[0] + (to[0] / len) * r, q[1] + (to[1] / len) * r, q[2] + (to[2] / len) * r] : q, d: len - r };
  }
  return best;
}

/** A leg (or arm) as its solve is given, for `limbsReach`: its spec, and the direction its knee must stay to the side of
 * (outboard of the root: a knee that crosses inward has folded under the body). */
export type Reaching = { readonly name: string; readonly limb: ChainSpec; readonly outward: In<"vec3"> };

/**
 * Every limb stays inside its reach over [0, `period`): the distance from the root to the middle segments' target (the
 * ankle target of a three-segment limb) is at most the span less `slack` (beyond it the solve lays the chain straight:
 * a snapped line) and at least the folded length plus `fold` (shares are of the span `a + b`), and the knee stays on the
 * `outward` side of its root. Evaluated on the CPU by the solve's own law (docs/stance.md).
 */
export function limbsReach(limbs: readonly Reaching[], o: { readonly period: number; readonly slack: Tolerance; readonly fold: Tolerance; readonly rate?: number }): Check {
  const rate = o.rate ?? 20;
  const roots = limbs.flatMap((l) => {
    const ls = l.limb.lengths.map((x) => lift<"f32">(x));
    return [lift<"vec3">(l.limb.root), lift<"vec3">(l.limb.target), lift<"vec3">(l.limb.bend), lift<"vec3">(l.limb.foot ?? [0, -1, 0]), lift<"vec3">(l.outward), vec4(ls[0]!, ls[1]!, ls[2] ?? 0, ls.length)];
  });
  return {
    name: `${limbs.length} limbs stay inside their reach over the loop`,
    run(probe) {
      let stretch = { share: 0, name: "", t: 0 }, folded = { share: Infinity, name: "", t: 0 }, inward = { by: Infinity, name: "", t: 0 };
      let fail = false;
      for (const t of times(0, o.period, rate)) {
        const v = probe.eval(roots, t) as number[][];
        limbs.forEach((l, i) => {
          const [root, target, bend, foot, out, len] = v.slice(i * 6, i * 6 + 6) as [V3, V3, V3, V3, V3, number[]];
          const [a, b, c, count] = len as [number, number, number, number];
          const fl = Math.hypot(...foot), ankle: V3 = count === 3 ? [target[0] - (foot[0] / fl) * c, target[1] - (foot[1] / fl) * c, target[2] - (foot[2] / fl) * c] : target;
          const toward = subV(ankle, root), d = Math.hypot(...toward), span = a + b;
          if (d / span > stretch.share) stretch = { share: d / span, name: l.name, t };
          const f = (d - Math.abs(a - b)) / span;
          if (f < folded.share) folded = { share: f, name: l.name, t };
          if (d > span - allowance(o.slack, span) || d < Math.abs(a - b) + allowance(o.fold, span)) fail = true;
          // The knee by the solve's law of cosines, on the bend side of the root-to-ankle line.
          const e: V3 = [toward[0] / d, toward[1] / d, toward[2] / d], dc = Math.min(Math.max(d, Math.abs(a - b)), span);
          const cosA = Math.min(1, Math.max(-1, (a * a + dc * dc - b * b) / (2 * a * dc))), sinA = Math.sqrt(1 - cosA * cosA);
          const nb = subV(bend, [e[0] * dotV(bend, e), e[1] * dotV(bend, e), e[2] * dotV(bend, e)]), nl = Math.hypot(...nb) || 1;
          const knee: V3 = [0, 1, 2].map((j) => (e[j]! * cosA + (nb[j]! / nl) * sinA) * a) as unknown as V3;
          const by = dotV(knee, out) / (Math.hypot(...out) || 1);
          if (by < inward.by) inward = { by, name: l.name, t };
          if (by < 0) fail = true;
        });
      }
      return {
        name: this.name, pass: !fail, value: stretch.share,
        measured: `most stretched ${stretch.share.toFixed(3)} of the span (${stretch.name}, t=${fmt(stretch.t, 2)}); least ${folded.share.toFixed(3)} from folded (${folded.name}, t=${fmt(folded.t, 2)}); knee ${fmt(inward.by, 2)} outboard at least (${inward.name}, t=${fmt(inward.t, 2)})`,
        limit: `stretched <= span less ${describe(o.slack, allowance(o.slack, 1), "span")}, folded by at least ${describe(o.fold, allowance(o.fold, 1), "span")}, knees outboard`,
      };
    },
  };
}

/**
 * A two-sided gripper (two fingers, a jaw's halves) reaches the thing its hold takes, and keeps it: at the closing
 * instant (the arming time) and at every sampled instant of the hold, the point of each drawn finger's surface nearest
 * the thing's middle is found. The grip's middle (halfway between those points) must be within `middle` of the thing's
 * middle, and their distance apart within `gap` of the thing's width times its crush. Shares are of the thing's width.
 * It measures the drawn fingers, not the attack's own grip, which matches by construction. Measured over the first arming.
 */
export function gripReaches(attack: Attack<Motion, Hold>, fingers: readonly [Measured, Measured], o: { readonly middle: Tolerance; readonly gap: Tolerance; readonly rate?: number }): Check {
  const [a, b] = fingers.map(chainOf) as [ReturnType<typeof chainOf>, ReturnType<typeof chainOf>], rate = o.rate ?? 30;
  const roots = [attack.thing(), attack.crush(), attack.effect.radius];
  return {
    name: `${attack.name}: ${a.name} and ${b.name} close on the thing and keep it`,
    run(probe) {
      const T = probe.scalar(attack.first);
      const sample = (t: number) => {
        const [thing, crush, radius] = probe.eval(roots, t) as [number[], number, number];
        const c: V3 = [thing[0]!, thing[1]!, thing[2]!];
        const pa = nearestSurface(probe.joints(a.skeleton, a.range, t), c).at, pb = nearestSurface(probe.joints(b.skeleton, b.range, t), c).at;
        const mid: V3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
        const apart = Math.hypot(...subV(pa, pb)), want = 2 * radius * crush;
        return { t, width: 2 * radius, middle: Math.hypot(...subV(mid, c)), apart, want, gap: Math.abs(apart - want) };
      };
      const close = sample(T);
      const okMiddle = allowance(o.middle, close.width), okGap = allowance(o.gap, close.width);
      // The worst instant is the one nearest to failing, on either measure.
      const score = (s: typeof close) => Math.max(s.middle / okMiddle, s.gap / okGap);
      const worst = times(T, T + attack.effect.seconds, rate).map(sample).reduce((w, s) => (score(s) > score(w) ? s : w), close);
      const line = (s: typeof close) => `middle ${fmt(s.middle)} off, ${fmt(s.apart, 2)} apart (want ${fmt(s.want, 2)})`;
      return {
        name: this.name, pass: score(worst) <= 1, value: score(worst),
        measured: `closing: ${line(close)}; worst t=${fmt(worst.t, 2)}: ${line(worst)}`,
        limit: `middle <= ${describe(o.middle, okMiddle, "width")}, gap within ${describe(o.gap, okGap, "width")}`,
      };
    },
  };
}

/**
 * The warning comes first and covers what is taken: it starts no later than the motion's first movement
 * (`warn >= span.before`), and for a hold the thing's footprint where it is taken (a disc of its radius round its
 * middle) lies inside the warned hit shape. Measured at the first arming.
 */
export function warned(attack: Attack): Check {
  return {
    name: `${attack.name}: the warning comes first and covers what is taken`,
    run(probe) {
      const lead = attack.span.before, warn = probe.scalar(attack.warn);
      const early = warn - lead;
      const cover = covered(probe, attack.effect, attack);
      const pass = early >= 0 && cover.inside;
      return { name: this.name, pass, value: early, measured: `warns ${fmt(warn, 2)} s, moves ${fmt(lead, 2)} s before arming; ${cover.measured}`, limit: `warning >= first movement; ${cover.limit}` };
    },
  };
}
/** What the warned shape must cover, by effect: a hit's shape is its own place; a hold's thing must be inside it. */
function covered(probe: Probe, e: Effect, a: Attack): { readonly inside: boolean; readonly measured: string; readonly limit: string } {
  switch (e.kind) {
    case "instant": return { inside: true, measured: "a hit (its shape is its place)", limit: "-" };
    case "hold": {
      const T = probe.scalar(a.first);
      const [at, r] = probe.eval([e.at, e.radius], T) as [number[], number];
      const d = probe.planar((p) => hitSdf(a.hit, p), T)(at[0]!, at[2]!) + r;
      return { inside: d <= 0, measured: `the thing's footprint ${fmt(-d)} inside the shape's edge`, limit: "footprint inside" };
    }
  }
}

// ---- throws -------------------------------------------------------------------------------------------------------

const lenV = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const asV3 = (a: number[]): V3 => [a[0]!, a[1]!, a[2]!];

/** One-sided second-order velocities at t from five samples h apart: exact for the two quadratics that meet at a release. */
function velocitiesAt(at: (t: number) => V3, t: number, h: number): { readonly here: V3; readonly before: V3; readonly after: V3 } {
  const p0 = at(t), b1 = at(t - h), b2 = at(t - 2 * h), a1 = at(t + h), a2 = at(t + 2 * h);
  return {
    here: p0,
    before: [0, 1, 2].map((k) => (3 * p0[k]! - 4 * b1[k]! + b2[k]!) / (2 * h)) as unknown as V3,
    after: [0, 1, 2].map((k) => (-3 * p0[k]! + 4 * a1[k]! - a2[k]!) / (2 * h)) as unknown as V3,
  };
}

/**
 * The hand-off a throw promises a game (docs/throw_and_shove.md, "The contract"): at the stated release instant the
 * thing is at the stated release point, and the gripper has brought it to the stated release velocity. Measured on the
 * attack's own `thing` before the release (the thing is in the grip, so this is the gripper's motion) from three
 * samples a 120th of a second apart, carried to the release instant, which is exact for a uniform acceleration. `speed` is how far the velocity
 * may be off (a share is of the release speed), `place` how far the point (a share of the stroke's length). It holds
 * whoever places the thing afterwards.
 */
export function releasesAt(attack: Attack<Motion, Hold<Thrown>>, o: { readonly speed: Tolerance; readonly place: Tolerance }): Check {
  const e = attack.effect, toss = attack.toss();
  const thing = [attack.thing()], stated = [toss.velocity, toss.release, toss.windback];
  return {
    name: `${attack.name}: the grip lets go where, when and as fast as it says`,
    run(probe) {
      const T = probe.scalar(attack.first), released = T + e.seconds;
      const [v0, release, windback] = (probe.eval(stated, T) as number[][]).map(asV3) as [V3, V3, V3];
      // Only instants before the release are sampled (at it the thing is already its placer's): the quadratic through
      // three of them, a 120th of a second apart, gives the place and the velocity at the release itself.
      const h = 1 / 120, [p1, p2, p3] = [1, 2, 3].map((k) => asV3(probe.eval(thing, released - k * h)[0] as number[])) as [V3, V3, V3];
      const here = [0, 1, 2].map((k) => 3 * p1[k]! - 3 * p2[k]! + p3[k]!) as unknown as V3;
      const before = [0, 1, 2].map((k) => (5 * p1[k]! - 8 * p2[k]! + 3 * p3[k]!) / (2 * h)) as unknown as V3;
      const speed = lenV(v0), off = lenV(subV(before, v0)), miss = lenV(subV(here, release));
      const okSpeed = allowance(o.speed, speed), okPlace = allowance(o.place, lenV(subV(release, windback)));
      return {
        name: this.name, pass: off <= okSpeed && miss <= okPlace, value: off,
        measured: `t=${fmt(released, 2)}: at (${release.map((x) => fmt(x, 2)).join(", ")}), ${fmt(miss)} off; velocity (${v0.map((x) => fmt(x, 2)).join(", ")}), ${fmt(speed, 2)}/s, the grip's ${fmt(off)} off`,
        limit: `velocity within ${describe(o.speed, okSpeed, "release speed")}; point within ${describe(o.place, okPlace, "stroke")}`,
      };
    },
  };
}

/**
 * The stand-in's flight is the throw the release promises, and it lands: measured on the attack's own `thing` over its
 * first arming (a hold whose thrown thing the stand-in places):
 * - the flight starts at the release point with the release velocity: just after the release its velocity (three
 *   samples a 120th of a second apart, exact for a ballistic flight) is within `speed` of the stated one (a share is
 *   of the release speed);
 * - through the flight it stays above the height it lands at, until it lands;
 * - at the stated landing time it is within `place` of the stated landing place (a share is of the distance flown);
 * - it lands at least `least` from where it was taken, measured along the water.
 */
export function throwLands(attack: Attack<Motion, Hold<Thrown>>, o: { readonly least: number; readonly speed: Tolerance; readonly place: Tolerance; readonly rate?: number }): Check {
  const rate = o.rate ?? 60, e = attack.effect, toss = attack.toss();
  const thing = [attack.thing()], stated = [toss.velocity, toss.release, toss.land, e.at, e.end.up];
  return {
    name: `${attack.name}: the thing flies from the release as released, and lands where and when stated`,
    run(probe) {
      const T = probe.scalar(attack.first), released = T + e.seconds, lands = released + e.end.flight;
      const at = (t: number): V3 => asV3(probe.eval(thing, t)[0] as number[]);
      const [v0, release, land, taken, up] = (probe.eval(stated, T) as number[][]).map(asV3) as [V3, V3, V3, V3, V3];
      const v = velocitiesAt(at, released, 1 / 120);
      const speed = lenV(v0), jump = Math.max(lenV(subV(v.after, v0)), lenV(subV(v.after, v.before)));
      const okSpeed = allowance(o.speed, speed);
      // Above the landing height from the release until the last sample before touchdown.
      let least = Infinity, when = released;
      for (const t of times(released, lands - 0.5 / rate, rate)) { const c = dotV(subV(at(t), land), up); if (c < least) { least = c; when = t; } }
      const flown = lenV(subV(land, release)), miss = Math.max(lenV(subV(at(lands), land)), lenV(subV(v.here, release))), okPlace = allowance(o.place, flown);
      const d = subV(land, taken), rise = dotV(d, up), far = Math.sqrt(Math.max(dotV(d, d) - rise * rise, 0));
      return {
        name: this.name, pass: jump <= okSpeed && least > 0 && miss <= okPlace && far >= o.least, value: far,
        measured: `leaves at ${fmt(speed, 2)}/s, ${fmt(jump)} off the release; least ${fmt(least, 2)} above landing height (t=${fmt(when, 2)}); lands ${fmt(miss)} off at t=${fmt(lands, 2)}, ${fmt(far, 2)} from where taken`,
        limit: `velocity within ${describe(o.speed, okSpeed, "release speed")}; above until it lands; within ${describe(o.place, okPlace, "distance flown")}; >= ${fmt(o.least, 2)} away`,
      };
    },
  };
}

/**
 * A thrown thing, as a ball of radius `size` round its middle, keeps at least `margin` clear of every target (the
 * thrower's own body, its shell) from its release to its touchdown. Measured over the first arming.
 */
export function fliesClear(attack: Attack<Motion, Hold<Thrown>>, targets: readonly Target[], o: { readonly size: number; readonly margin?: number; readonly rate?: number }): Check {
  const rate = o.rate ?? 60, margin = o.margin ?? 0, e = attack.effect, thing = [attack.thing()];
  if (targets.length < 1) throw new Error(`fliesClear "${attack.name}": no targets`);
  return {
    name: `${attack.name}: the thrown thing flies clear of ${targets.length} target${targets.length === 1 ? "" : "s"}`,
    run(probe) {
      const released = probe.scalar(attack.first) + e.seconds;
      let least = Infinity, when = released, which = 0;
      for (const t of times(released, released + e.end.flight, rate)) {
        const p = asV3(probe.eval(thing, t)[0] as number[]);
        // A ball as a capsule of no length: the gap measures are written for chains.
        const ball: Joint[] = [{ p, r: o.size }, { p: [p[0], p[1] + 1e-4, p[2]], r: o.size }];
        targets.forEach((target, k) => { const g = gap(probe, ball, target, t); if (g < least) { least = g; when = t; which = k; } });
      }
      return { name: this.name, pass: least >= margin, value: least, measured: `${fmt(least, 2)} from target ${which} (${targets[which]!.kind}) at t=${fmt(when, 2)}`, limit: `>= ${fmt(margin, 2)}` };
    },
  };
}

/**
 * A gripper lets go cleanly: from the release its drawn fingers come out of the thing they threw and stay out. `thing`
 * is the thrown thing as it is drawn (a `skin` target placed in the chart the throw carries), so this measures the
 * fingers' capsules against its own shape as it leaves. While they hold it the fingers overlap it by this measure (a
 * curled finger's capsules are fatter than its skin and wrap the thing), so the grip's own overlap at the release is the
 * reference: afterwards no finger may be more than `depth` deeper than that (a share is of the thing's width), and all
 * must be clear of it within `seconds` and stay clear to twice that. It catches a throw
 * that leaves across the gripper's own axis, through a finger.
 */
export function letsGoClean(attack: Attack<Motion, Hold<Thrown>>, fingers: readonly Measured[], thing: Target, o: { readonly seconds: number; readonly depth: Tolerance; readonly rate?: number }): Check {
  const rate = o.rate ?? 120, e = attack.effect, chains = fingers.map(chainOf), width = [e.radius];
  if (chains.length < 1) throw new Error(`letsGoClean "${attack.name}": no fingers`);
  return {
    name: `${attack.name}: the fingers let the thrown thing go without passing through it`,
    run(probe) {
      const released = probe.scalar(attack.first) + e.seconds;
      const ok = allowance(o.depth, 2 * (probe.eval(width, released)[0] as number));
      const least = (t: number) => chains.reduce((m, c) => { const g = gap(probe, probe.joints(c.skeleton, c.range, t), thing, t); return g < m.g ? { g, name: c.name } : m; }, { g: Infinity, name: chains[0]!.name });
      // The grip's own overlap, a frame before the release (at the instant itself the thing is already its placer's).
      const grip = least(released - 1 / rate).g;
      let worst = { g: Infinity, name: chains[0]!.name }, when = released, clearAt = released;
      for (const t of times(released, released + 2 * o.seconds, rate)) {
        const m = least(t);
        if (m.g < worst.g) { worst = m; when = t; }
        if (m.g < 0) clearAt = t + 1 / rate;
      }
      const deeper = Math.max(grip - worst.g, 0), cleared = clearAt - released;
      return {
        name: this.name, pass: deeper <= ok && cleared <= o.seconds, value: deeper,
        measured: `holding, ${fmt(-grip)} of overlap; after the release at most ${fmt(deeper)} deeper (${worst.name}, ${fmt(when - released, 2)} s after); clear of the thing from ${fmt(cleared, 2)} s`,
        limit: `no more than ${describe(o.depth, ok, "width")} deeper; clear within ${fmt(o.seconds, 2)} s`,
      };
    },
  };
}

// ---- the aftermath on the water -----------------------------------------------------------------------------------

/**
 * A ring on the water: an attack's ring aftermath, or a ring wave of its own (`ringWave`) that starts at `first` (its
 * `since` is 0 then) under a name. The second came from a crate's splash (examples/second/crane.ts): a ring left by a
 * thrown thing's landing belongs to no attack's hit disc, and these checks took only attacks.
 */
export type Ringing = Attack<Motion, Effect, Ring> | { readonly name: string; readonly wave: RingWave; readonly first: In<"f32"> };
type RingRead = { readonly name: string; readonly wave: RingWave; readonly first: Expr<"f32">; readonly pushed: (at: In<"vec2">) => Expr<"vec2">; readonly drag: number };
/** Classified once: what the two checks read of a ring. */
function ringRead(r: Ringing): RingRead {
  if (r.wave instanceof RingWave) { const w = r.wave; return { name: r.name, wave: w, first: lift<"f32">(r.first), pushed: (at) => w.pushed(at, time), drag: w.spec.drag }; }
  const a = r as Attack<Motion, Effect, Ring>;
  return { name: a.name, wave: a.wave(), first: a.first, pushed: (at) => a.pushed(at), drag: a.aftermath.drag };
}

/**
 * The stand-in's shove is the ring's own ride, and it is enough (docs/throw_and_shove.md, "The ride"). Measured over
 * the first arming for a thing afloat at `place` (x, z), on the attack's `pushed` against the readouts a game uses:
 * - half way through its ride it moves outward at the wave's `speed` (a central difference a 60th of a second wide),
 *   within `speed` (a share is of the wave's speed);
 * - there it is on the front's face: the edge reached the place it is at now exactly `lag` ago, within `place` as a
 *   distance (a share is of the ride's length);
 * - it is let go where the front stops holding: `holds` is 1 where it is just before the ride ends and 0 just after;
 * - six drag times after that it has come to `wave.shoved(place)` (to 0.5%), which is at least `least`.
 * A thing the front cannot hold where it floats (no ride) is measured on the last alone.
 */
export function shoves(ringing: Ringing, place: In<"vec2">, o: { readonly least: number; readonly speed: Tolerance; readonly place: Tolerance }): Check {
  const attack = ringRead(ringing), wave = attack.wave, at = lift<"vec2">(place), k = wave.ride(at), now = add(at, attack.pushed(at));
  const stated = [wave.shoved(at), k.taken, k.seconds, k.distance, k.out, at], moving = [attack.pushed(at), wave.arrival(now), wave.holds(now)];
  return {
    name: `${attack.name}: its ring carries what floats at the place given, as its own readouts say`,
    run(probe) {
      const T = probe.scalar(attack.first), c = wave.speed, drag = attack.drag;
      const [end, taken, seconds, distance, out, p] = probe.eval(stated, T) as [number[], number, number, number, number[], number[]];
      const sample = (t: number) => { const [push, edge, holds] = probe.eval(moving, t) as [number[], number, number]; return { along: push[0]! * out[0]! + push[1]! * out[1]!, edge, holds }; };
      const final = Math.hypot(end[0]!, end[1]!), dropped = T + taken + seconds;
      const late = sample(dropped + 6 * drag).along;
      const settled = Math.abs(late - final) <= 0.005 * final;
      // The ride itself, where there is one (a quarter of a second or more: shorter cannot be sampled either side).
      const rides = seconds >= 0.25;
      const h = 1 / 120, mid = T + taken + seconds / 2;
      const v = rides ? (sample(mid + h).along - sample(mid - h).along) / (2 * h) : c;
      // The edge reached where the thing is now `lag` ago: as a distance, the wave's speed times the error in seconds.
      const off = rides ? Math.abs(mid - T - sample(mid).edge - wave.lag) * c : 0;
      const held = rides ? sample(dropped - 0.05).holds === 1 && sample(dropped + 0.05).holds === 0 : true;
      const okSpeed = allowance(o.speed, c), okPlace = allowance(o.place, Math.max(distance, 1e-6));
      return {
        name: this.name, pass: final >= o.least && settled && Math.abs(v - c) <= okSpeed && off <= okPlace && held, value: final,
        measured: `at (${fmt(p[0]!, 2)}, ${fmt(p[1]!, 2)}): taken t=${fmt(T + taken, 2)}, carried ${fmt(distance, 2)} at ${fmt(v, 2)}/s (wave ${fmt(c, 2)}), ${fmt(off)} off its face, let go t=${fmt(dropped, 2)}${held ? " where holding ends" : " NOT where holding ends"}; forced ${fmt(final, 2)} (${fmt(late, 2)} by t=${fmt(dropped + 6 * drag, 2)})`,
        limit: `>= ${fmt(o.least, 2)}; speed within ${describe(o.speed, okSpeed, "wave speed")}; on the face within ${describe(o.place, okPlace, "ride")}`,
      };
    },
  };
}

/**
 * Nothing moves before the front arrives, and nothing is carried before its face does: at each place, from a second
 * before the arming time until the ring's leading edge reaches it, the shove and the wave's lift are exactly 0; from
 * then until the face takes the thing (`lag` later) the shove is still exactly 0 (the water lifts it and that is all);
 * and one drag time after that the thing has moved (so the check is not passed by a wave that never comes). Measured
 * over the first arming.
 */
export function frontFirst(ringing: Ringing, places: readonly In<"vec2">[], o: { readonly rate?: number } = {}): Check {
  const attack = ringRead(ringing), rate = o.rate ?? 60, wave = attack.wave;
  if (places.length < 1) throw new Error(`frontFirst "${attack.name}": no places`);
  const roots = places.map((place) => { const at = lift<"vec2">(place); return { arrival: [wave.arrival(at)], moved: [attack.pushed(at), wave.lifts(at, time)] }; });
  return {
    name: `${attack.name}: nothing moves before its ring's front arrives`,
    run(probe) {
      const T = probe.scalar(attack.first);
      let early = 0, when = T, later = Infinity;
      for (const r of roots) {
        const arrival = probe.eval(r.arrival, T)[0] as number;
        for (const t of times(T - 1, T + arrival + wave.lag, rate)) {
          const [push, rise] = probe.eval(r.moved, t) as [number[], number];
          // Before the edge: nothing at all. Between the edge and the face: lifted, not moved.
          const m = Math.max(Math.abs(push[0]!), Math.abs(push[1]!), t < T + arrival ? Math.abs(rise) : 0);
          if (m > early) { early = m; when = t; }
        }
        const [push] = probe.eval(r.moved, T + arrival + wave.lag + attack.drag) as [number[], number];
        later = Math.min(later, Math.hypot(push[0]!, push[1]!));
      }
      return {
        name: this.name, pass: early === 0 && later > 0, value: early,
        measured: `most before the front ${early === 0 ? "0 (exactly)" : `${early.toExponential(2)} at t=${fmt(when, 2)}`}; a drag time after its face, moved at least ${fmt(later, 2)}`,
        limit: "exactly 0 before; moving after",
      };
    },
  };
}

/** The compiled scene draws at most `triangles` triangles. */
export function budget(o: { readonly triangles: number }): Check {
  return {
    name: `triangle budget ${o.triangles}`,
    run(probe) {
      const n = probe.artefact.stats.maxTriangles;
      return { name: this.name, pass: n <= o.triangles, value: n, measured: `${n} triangles`, limit: `<= ${o.triangles}` };
    },
  };
}

// ---- running ------------------------------------------------------------------------------------------------------

/** Run checks over a scene with inputs held at the given values (defaults otherwise). */
export function runChecks(scene: Scene, checks: readonly Check[], o: { readonly inputs?: Inputs; readonly compiled?: Compiled } = {}): Verdict[] {
  const probe = new Probe(o.compiled ?? compileScene(scene), o.inputs ?? {});
  return checks.map((c) => c.run(probe));
}

/** The verdicts as a plain-text table. */
export function formatChecks(vs: readonly Verdict[]): string {
  const rows = [["check", "verdict", "measured", "limit"], ...vs.map((v) => [v.name, v.pass ? "pass" : "FAIL", v.measured, v.limit])];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const line = (r: readonly string[]) => r.map((x, i) => x.padEnd(widths[i])).join("  ").trimEnd();
  return [line(rows[0]), widths.map((w) => "-".repeat(w)).join("  "), ...rows.slice(1).map(line)].join("\n");
}

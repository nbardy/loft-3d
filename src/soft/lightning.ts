// Lightning: strikes scheduled as a pure function of time, each a branching bolt made by hashed midpoint
// displacement, and the light it makes (a flicker of return strokes, then an afterglow).
//
// Midpoint displacement in closed form: displacing the midpoint of every segment at level l by a hashed offset, with
// linear interpolation in between, is the same as adding, for each level, a hat function over each cell of that
// level (0 at the cell's ends, 1 at its middle) times the cell's hashed offset. So the bolt is a function of u (an
// ordinary curve) that any stage can evaluate at any u, deterministic for (seed, strike index), with no recursion and no
// stored state. The hash is the integer one of `src/lib/noise.ts`, identical on both backends.

import { abs, add, cos, cross, exp, floor, length, lift, lt, max, min, mix, mul, normalize, select, sin, step, sub, time, vec3, type Expr, type In } from "../expr.ts";
import { emitShaderFn } from "../compile/bind.ts";
import { drawSpec, type CompileContext, type Drawable, type Emitted } from "../compile/context.ts";
import { hash33 } from "../lib/noise.ts";
import type { F, P3 } from "../map/types.ts";
import { strokes, type Strokes } from "./glow.ts";
import { flash, type Flash } from "./medium.ts";

/** When strikes happen: one every `every` seconds from `first`, each moved later by up to `jitter` of a period. */
export type StrikeSchedule = { readonly first: number; readonly every: number; readonly jitter: number; readonly seed: number };

/** Strike k's time. */
function strikeTime(s: StrikeSchedule, k: F): F {
  return add(add(s.first, mul(k, s.every)), mul(hash33(vec3(k, s.seed, 7)).x, s.jitter * s.every));
}

/**
 * The strike of a schedule in progress at time t: its index k (a whole number, as an f32) and the seconds since it
 * began. Strike k begins at first + k every + hash(k) jitter every, so strikes come at a steady rate with an uneven
 * beat, and everything keyed by the index (a bolt's shape, a flash's place) is new each strike and the same on every
 * replay. It cannot space strikes unevenly beyond `jitter` of a period (no bursts, no lulls) or overlap two strikes:
 * one is in progress at a time, until the next begins.
 */
export function strikeAt(s: StrikeSchedule, t: In<"f32"> = time): { readonly index: F; readonly since: F } {
  if (!(s.every > 0 && s.jitter >= 0 && s.jitter < 1)) throw new Error("strikes: every must be positive and jitter in [0, 1)");
  const tt = lift<"f32">(t);
  const k0 = floor(mul(sub(tt, s.first), 1 / s.every));
  const index = select(lt(tt, strikeTime(s, k0)), sub(k0, 1), k0);
  return { index, since: sub(tt, strikeTime(s, index)) };
}

/** Return strokes after a strike: offsets in seconds, and each one's brightness. A flash is their sum. */
const STROKES = [[0, 1], [0.085, 0.75], [0.19, 0.9], [0.3, 0.45]] as const;
/** Each return stroke fades with this time constant, seconds. */
const STROKE_FADE = 0.03;

/**
 * The brightness of a strike's return strokes `since` seconds after it began: 0 before, then four sharp pulses (at 0,
 * 0.085, 0.19 and 0.3 s, of 1, 0.75, 0.9 and 0.45), each decaying as exp(-t / 0.03 s), summed. Drive a bolt's glow,
 * a `flash`'s power or a `skyFlash` with it. It cannot vary from strike to strike: the stroke times and strengths are
 * fixed, so every strike flickers alike (offset `since` by a hash of the index for variety).
 */
export function flicker(since: F): F {
  return STROKES.reduce<F>((acc, [t0, b]) => add(acc, mul(mul(step(t0, since), exp(mul(max(sub(since, t0), 0), -1 / STROKE_FADE))), b)), lift<"f32">(0));
}

/**
 * The glow a lightning channel keeps after its flash: 0 before the strike, 1 at its start, then exp(-since / seconds).
 * It cannot rise gradually or hold: it jumps to full at once and only decays.
 */
export function afterglow(since: F, seconds: number): F {
  return mul(step(0, since), exp(mul(max(since, 0), -1 / seconds)));
}

export type BoltSpec = {
  /** Identifier (names the strokes' table). */
  readonly name: string;
  /**
   * Where the channel starts (in the cloud) and ends (on the ground), before each strike's own offset. Expressions, so
   * a bolt can leave a moving point or land on a mark an input sets; they are read every frame where the strokes' table
   * is filled (on the CPU), so they must be CPU-evaluable.
   */
  readonly from: In<"vec3">;
  readonly to: In<"vec3">;
  /** How far each strike's ends wander from `from` and `to` in x and z. */
  readonly wander: number;
  /** Displacement of the first level as a share of the channel's length; each level is 0.55 of the one before. */
  readonly roughness: number;
  /** Levels of midpoint displacement (2^levels segments' worth of detail). */
  readonly levels: number;
  /** Branches off the main channel. */
  readonly branches: number;
  readonly schedule: StrikeSchedule;
  /** Segments per stroke in the table the glow draws. */
  readonly segments: number;
};

/** A bolt: its strokes (0 the main channel, then the branches), the strike in progress and its light. */
export type Bolt = {
  readonly strokes: Strokes;
  readonly index: F;
  readonly since: F;
  /** Return-stroke flicker, 0..about 1. */
  readonly flash: F;
  /** Where the channel enters the cloud and where it meets the ground, this strike. */
  readonly top: P3;
  readonly ground: P3;
};

const LEVEL_GAIN = 0.55;

/**
 * A jagged curve from a to b at u in [0, 1]: midpoint displacement in closed form. Level l (1 to `levels`) splits the
 * chord into 2^(l - 1) cells and adds, over each, a hat (0 at the cell's ends, 1 at its middle) times an offset across
 * the chord hashed from (cell, level, key); the first level's offset reaches `rough` times the chord's length and each
 * level is 0.55 of the one before. So the ends stay at a and b, and the curve is a pure function of u: any stage can
 * evaluate any point. The same `key` gives the same curve. It cannot be smooth (it is straight between the points of
 * the finest level, kinked at every one), and its offsets lie in a plane across the chord chosen from a fixed vector,
 * so a chord along (0.31, 0.12, 0.94) has no defined across direction.
 */
export function displaced(u: F, a: P3, b: P3, levels: number, rough: number, key: F): P3 {
  const chord = sub(b, a);
  const L = length(chord);
  const axis = normalize(chord);
  const e1 = normalize(cross(axis, vec3(0.31, 0.12, 0.94)));
  const e2 = cross(axis, e1);
  let p: P3 = mix(a, b, u);
  for (let l = 1; l <= levels; l++) {
    const s = mul(u, 2 ** (l - 1));
    const cell = floor(s);
    const hat = sub(1, abs(sub(mul(sub(s, cell), 2), 1)));
    const h = hash33(vec3(cell, l * 7 + 3, key));
    const amp = mul(L, rough * LEVEL_GAIN ** (l - 1) * 2);
    p = add(p, mul(add(mul(e1, sub(h.x, 0.5)), mul(e2, sub(h.y, 0.5))), mul(amp, hat)));
  }
  return p;
}

/**
 * A branching lightning bolt, new for each strike of a schedule: a jagged main channel from cloud to ground with
 * branches leaving it, as `strokes` for `glows` to light, with the strike's index, timing and flicker.
 *
 * The shape and its law. For strike k (`strikeAt`), the ends are `from` and `to` each moved by a hash of k up to
 * `wander` in x and z. The main channel is `displaced` between them (`levels`, `roughness`, keyed by k). Branch j
 * leaves the channel at a hashed point between 0.1 and 0.75 of the way down, angled 0.45 to 0.95 radians off the
 * channel's axis toward a hashed side, 0.1 to 0.3 of the chord long (shorter lower down), itself `displaced` one level
 * less and 1.3 times rougher; branches taper to nothing at their tips. The shape is fixed for the whole strike.
 *
 * Parameters: `from` and `to` take expressions the CPU can evaluate (a bolt can leave a moving point or land on a
 * mark an input sets); `wander`, `roughness`, `levels` (1 to 10), `branches`, `segments` and the schedule are fixed.
 *
 * What it cannot do, because of the law:
 * - grow: the whole channel exists at once for the strike; there is no leader stepping down from the cloud.
 * - branch twice: branches leave the main channel only, never another branch.
 * - seek a target: it lands at `to` (give or take `wander`), never on the tallest thing near it.
 * - change shape within a strike, or light itself: how bright it is is the glow's (`flash` here is its flicker).
 * - curve smoothly: it is straight between displaced points.
 *
 * Going past it is one step down: `displaced(u, a, b, levels, rough, key)` is the channel's curve, and
 * `strokes(name, count, segments, point, taper)` draws any family of curves, so a bolt of your own is a `point(u, i)`
 * built from `displaced` calls. Relatives, by changing one part of the law:
 * - reveal the channel by time, taper 0 where u > since / duration: a leader that steps down, then the flash.
 * - branches from branches: call `displaced` from a point of a branch, keyed by both indices: a tree of discharges.
 * - the same displacement laid on a surface instead of across a chord: cracks in ice, rivers on a map, roots.
 * - `from` and `to` both on moving bodies, with a short `every`: an arc between two electrodes.
 */
export function bolt(spec: BoltSpec): Bolt {
  if (!(Number.isInteger(spec.levels) && spec.levels >= 1 && spec.levels <= 10)) throw new Error("bolt: levels must be an integer in [1, 10]");
  if (!(Number.isInteger(spec.branches) && spec.branches >= 0)) throw new Error("bolt: branches must be a non-negative integer");
  const { index, since } = strikeAt(spec.schedule);
  const key = (j: In<"f32">, c: number): F => add(mul(index, 131), add(mul(j, 17), spec.schedule.seed * 1009 + c));
  const jitter = (c: number): Expr<"vec3"> => { const h = hash33(vec3(index, spec.schedule.seed, c)); return vec3(mul(sub(h.x, 0.5), 2 * spec.wander), 0, mul(sub(h.y, 0.5), 2 * spec.wander)); };
  const top = add(lift<"vec3">(spec.from), jitter(1));
  const ground = add(lift<"vec3">(spec.to), jitter(2));
  const main = (u: F): P3 => displaced(u, top, ground, spec.levels, spec.roughness, key(0, 0));
  const axis = normalize(sub(ground, top));
  const e1 = normalize(cross(axis, vec3(0.31, 0.12, 0.94)));
  const e2 = cross(axis, e1);
  const chord = length(sub(ground, top));
  const point = (u: F, i: F): P3 => {
    // Stroke 0 is the main channel; stroke i > 0 is branch i - 1, leaving the channel at a hashed point, angled away.
    const j = sub(i, 1);
    const h = hash33(vec3(j, index, spec.schedule.seed + 5));
    const at = add(0.1, mul(h.x, 0.65));
    const start = main(at);
    const phi = mul(h.y, Math.PI * 2);
    const tilt = add(0.45, mul(h.z, 0.5));
    const dir = add(mul(axis, cos(tilt)), mul(add(mul(e1, cos(phi)), mul(e2, sin(phi))), sin(tilt)));
    const len = mul(chord, mul(add(0.1, mul(hash33(vec3(j, index, spec.schedule.seed + 9)).x, 0.2)), sub(1, mul(at, 0.6))));
    const branch = displaced(u, start, add(start, mul(dir, len)), Math.max(spec.levels - 1, 1), spec.roughness * 1.3, key(i, 1));
    return select(lt(i, 0.5), main(u), branch);
  };
  // Branches taper to nothing at their tips; the main channel keeps its width.
  const taper = (u: F, i: F): F => select(lt(i, 0.5), 1, mul(0.6, sub(1, mul(u, u))));
  return { strokes: strokes(spec.name, 1 + spec.branches, spec.segments, point, taper), index, since, flash: flicker(since), top, ground };
}

/**
 * The light a bolt casts into a medium: a `flash` at the bolt's top, `lift` above it (inside the cloud), whose power is
 * `power` times the strike's flicker. It cannot light along the channel: it is one point, so the cloud glows round the
 * top and not where the channel runs below the cloud's base; for that add flashes at points of the channel.
 */
export function boltFlash(b: Bolt, o: { readonly power: number; readonly colour: readonly [number, number, number]; readonly reach: number; readonly lift: number }): Flash {
  return flash({ at: add(b.top, vec3(0, o.lift, 0)), power: mul(b.flash, o.power), colour: o.colour, reach: o.reach });
}

/**
 * Lightning hidden inside a cloud, with no channel to the ground: for each strike of the schedule, a `flash` at a
 * point of `box` hashed from the strike's index, its brightness the flicker (capped at 1.2). Returns the flash for the
 * medium, the brightness (to drive a `skyFlash`) and where it is. It cannot place the light where the cloud is dense:
 * the point is uniform in the box, so in a sparse corner the flash lights little.
 */
export function sheetFlash(s: StrikeSchedule, box: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }, o: { readonly power: number; readonly colour: readonly [number, number, number]; readonly reach: number }): { readonly flash: Flash; readonly brightness: F; readonly at: P3 } {
  const { index, since } = strikeAt(s);
  const h = hash33(vec3(index, s.seed, 11));
  const at = vec3(mix(box.min[0], box.max[0], h.x), mix(box.min[1], box.max[1], h.y), mix(box.min[2], box.max[2], h.z));
  const brightness = min(flicker(since), 1.2);
  return { flash: flash({ at, power: mul(brightness, o.power), colour: o.colour, reach: o.reach }), brightness, at };
}

/**
 * The whole sky lighting up: a full-screen additive wash of `colour` times `brightness` (an expression: give it a
 * strike's flicker), at full strength where the scene's depth is far (the sky, distant water) and half on near bodies,
 * which the flash reaches but does not drown. It cannot light from a direction: it is an even wash, with no shading or
 * shadows on the bodies it brightens.
 */
export function skyFlash(name: string, brightness: In<"f32">, colour: readonly [number, number, number]): Drawable {
  return {
    name, skeletons: [], surfaces: [],
    draws(ctx: CompileContext): Emitted {
      const b = emitShaderFn(ctx.slots, { name: `flash_${name}`, args: [], out: "f32", roots: [lift<"f32">(brightness)], ret: (v) => v[0] });
      const code = /* wgsl */ `${b.code}
struct VOut { @builtin(position) clip: vec4<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let xy = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return VOut(vec4<f32>(xy, 0.0, 1.0));
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let near = 1.0 - smoothstep(0.995, 0.9999, scene_depth(in.clip.xy));
  let k = flash_${name}() * (1.0 - 0.5 * near);
  if (k <= 0.0) { discard; }
  return vec4<f32>(vec3<f32>(${colour.join(", ")}) * k, 1.0);
}`;
      return { shaders: { [`flash.${name}`]: { code, libs: b.libs } }, draws: [drawSpec({ label: name, shader: `flash.${name}`, vertices: 3, phase: "transparent", cull: "none", depthWrite: false, blend: "add", sceneDepth: true })] };
    },
  };
}

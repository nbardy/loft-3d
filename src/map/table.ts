// A table is a function too (DESIGN.md 7.3): `tabulate` samples a function of one variable into a table and returns
// the function that interpolates the samples. Where the table is filled is the schedule: once, when the artefact is
// compiled (`"static"`), or every frame by a pose stage (`"frame"`, a map). Either way the shaders read it with `fetch`.

import { clamp, compileJs, div, f, fetch, floor, mapOf, min, mix, mul, sub, vec4, type Expr, type In, type NumTy, type TableSource } from "../expr.ts";
import { scopedName } from "../expr.ts";
import { SceneError } from "../errors.ts";

/** One storage binding of 128 MiB holds this many vec4s (BINDING_VEC4S in src/compile/tables.ts, not imported: the map layer does not load the compiler). */
const TABLE_ENTRIES_MAX = (128 * 1024 * 1024) / 16;
import type { F } from "./types.ts";

export type Schedule = "static" | "frame";
/** A static table is uploaded once (compile/tables.ts); a frame table is filled by every pose. */
const ROLE: Readonly<Record<Schedule, TableSource["role"]>> = { static: "static", frame: "data" };

const pad = (e: Expr<NumTy>): Expr<"vec4"> => {
  switch (e.ty) {
    case "f32": return vec4(e, 0, 0, 0);
    case "vec2": return vec4(e, 0, 0);
    case "vec3": return vec4(e, 0);
    case "vec4": return e as Expr<"vec4">;
  }
};
const unpad = <T extends NumTy>(ty: T, e: Expr<"vec4">): Expr<T> => {
  switch (ty) {
    case "f32": return e.x as Expr<T>;
    case "vec2": return e.xy as Expr<T>;
    case "vec3": return e.xyz as Expr<T>;
    case "vec4": return e as Expr<T>;
  }
  // Unreachable: TypeScript does not narrow a generic through the switch.
  throw new Error(`tabulate: cannot tabulate a ${ty}`);
};

/**
 * `fn` sampled at n evenly spaced points of [0, 1] into the per-frame table `name`; returns the piecewise-linear
 * interpolant (clamped outside [0, 1]). Static tables are evaluated once, at compile time, with every input and
 * param at its default (so a static table must not depend on time); frame tables follow time, inputs and params.
 */
export function tabulate<T extends NumTy>(given: string, fn: (x: F) => Expr<T>, n: number, when: Schedule): (x: In<"f32">) => Expr<T> {
  const name = scopedName(given);
  if (!(Number.isInteger(n) && n >= 2)) throw new SceneError(`tabulate "${name}"`, `${n} samples`, "a whole number of at least 2", `tabulate("${given}", fn, 64, "${when}")`);
  // Refused before sampling: the samples are built one by one, so ten million of them hang the compile long before
  // the table budget (src/compile/tables.ts, one storage binding of 128 MiB) would refuse them.
  if (n > TABLE_ENTRIES_MAX) throw new SceneError(`tabulate "${name}"`, `${n} samples`, `at most ${TABLE_ENTRIES_MAX} (one GPU storage binding)`, `fewer samples: a piecewise-linear table rarely needs more than a few thousand, e.g. tabulate("${given}", fn, 1024, "${when}")`);
  const samples = Array.from({ length: n }, (_, k) => fn(f(k / (n - 1))));
  const ty = samples[0].ty as T;
  const roots = samples.map(pad);
  const table = ((): TableSource => {
    switch (when) {
      case "static": {
        const data = new Float32Array(n * 4);
        compileJs(roots)({ vars: {}, inputs: {}, params: {} }).forEach((v, k) => data.set(v as number[], k * 4));
        return { name, lanes: 1, entries: n, role: ROLE[when], prepare: () => (_frame, out) => out.set(data) };
      }
      // A map: sample k is the function at k / (n - 1), filled by a pose stage.
      case "frame": return { name, lanes: 1, entries: n, role: ROLE[when], program: mapOf(n, (k) => [pad(fn(div(k, n - 1)))]) };
    }
  })();
  return (x) => {
    const s = mul(clamp(x, 0, 1), n - 1);
    const k = min(floor(s), n - 2);
    return unpad(ty, mix(fetch(table, k, 0), fetch(table, k.add(1), 0), sub(s, k)));
  };
}

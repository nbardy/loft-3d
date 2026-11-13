// The sun's direction: fixed when the scene is written, or a host input a game or a clip moves.
//
// A fixed sun is a literal in every shader (as it always was). A movable one is the unit vector along a host input,
// whose default is the direction the scene states: `--input sun=x,y,z`, `--sweep sun=a..b`, or a game writing the input.
// What is computed on the CPU before a frame (a cloud's own light tables, src/soft/medium.ts) reads the stated
// direction either way and does not follow a moved sun.

import { input, normalize, type Expr, type In } from "./expr.ts";

export type V3 = readonly [number, number, number];

export type Sun =
  | { readonly kind: "fixed"; readonly dir: V3 }
  /** `dir` is the input's default, a unit vector. */
  | { readonly kind: "input"; readonly name: string; readonly dir: V3 };

/** A sun a host can move: the input `name` (default "sun"), starting at `dir`. */
export function movable(dir: V3, name = "sun"): { readonly kind: "input"; readonly name: string; readonly dir: V3 } {
  return { kind: "input", name, dir };
}

/** The unit direction toward the sun, as shaders read it. */
export function sunDir(s: Sun): In<"vec3"> {
  switch (s.kind) {
    case "fixed": return s.dir;
    case "input": return normalize(input(s.name, "vec3", s.dir));
  }
}

/** The same, by component (a table's program divides by the height). */
export function sunParts(s: Sun): readonly [In<"f32">, In<"f32">, In<"f32">] {
  switch (s.kind) {
    case "fixed": return s.dir;
    case "input": { const d = sunDir(s) as Expr<"vec3">; return [d.x, d.y, d.z]; }
  }
}

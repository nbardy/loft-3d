// What every part of the crab paints with: the woodblock's crisp ink edge, the brick mottle, and per-frame tables.
// Functions only: nothing here builds an expression when imported.

import { mul, sin, add, tabulate, type F, type P3 } from "../../../src/index.ts";
import { edgeOf } from "../../../src/style/shared.ts";

export type V3 = readonly [number, number, number];
export const TAU = 2 * Math.PI;
export const sides = [-1, 1] as const;

/** A crisp ink edge: 1 where x is above `at`, about one pixel wide (from the screen-space derivative). A wide
 * smoothstep is a soft airbrushed fade, which the woodblock's flat inks never have. */
export const cut = (x: F, at: number | F): F => edgeOf(x, at, 1e-5);

/** Dark brick blots over a surface's (m, v): 1 inside a blot. */
export const mottle = (m: F, v: F): F => {
  const a = sin(add(mul(m, 23), mul(sin(mul(v, 31)), 1.7))), b = sin(add(mul(v, 41), mul(sin(mul(m, 17)), 1.3)));
  return cut(mul(a, b), 0.575);
};

/** A value evaluated once per frame into a two-entry table: long closed forms read by many stations stay one evaluation. */
export function perFrame(name: string, e: F): F;
export function perFrame(name: string, e: P3): P3;
export function perFrame(name: string, e: F | P3): F | P3 {
  return tabulate(name, () => e, 2, "frame")(0) as F | P3;
}

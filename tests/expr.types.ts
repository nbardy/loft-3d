// Compile-time only (never run): the result types authoring code relies on. A regression here shows up in `tsc`.
// Guards the defect found on first use: with one generic signature, `mul(x, 2)` came out as "some numeric type".
import { add, clamp, mix, mul, sin, smoothstep, variable, vec3, type Expr, type In } from "../src/expr.ts";
const x = variable("x", "f32"), p = variable("p", "vec3");
const viaParam = (g: In<"f32">): Expr<"f32"> => mul(g, 2).add(1);
export const checks: [Expr<"f32">, Expr<"f32">, Expr<"vec3">, Expr<"vec3">, Expr<"f32">, Expr<"f32">, Expr<"f32">, Expr<"vec3">, Expr<"f32">] = [
  mul(x, 2), add(1, x), mul(p, x), p.mul(2).add(vec3(1, 2, 3)), sin(x).mul(0.5), mix(x, 3, 0.5),
  smoothstep(0, 1, x), clamp(p, 0, 1), viaParam(x),
];

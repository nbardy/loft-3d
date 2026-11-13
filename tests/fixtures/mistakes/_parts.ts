// A correct scene's parts, shared by the mistakes so each file shows only its one error.
import { cos, mul, sea, sin, spacing, surface, toon, vec3, type F } from "../../../src/index.ts";

/** A unit ball at height 1.5, (u, v) = (latitude, longitude). */
export const ball = surface((u: F, v: F) => {
  const th = mul(u, Math.PI), ph = mul(v, 2 * Math.PI);
  return vec3(mul(sin(th), cos(ph)), cos(th).add(1.5), mul(sin(th), sin(ph)));
}, { u: ["pole", "pole"], v: "periodic" });
export const grid = { u: spacing.even(24), v: spacing.even(32) };
export const paint = () => vec3(0.9, 0.4, 0.2);
export const water = sea({ swell: [{ direction: [1, 0], length: 8, height: 0.1, speed: 0.8 }] });
export const style = toon({ bands: 3, outline: 0.04 });
export const cameras = { three: { kind: "perspective" as const, eye: [5, 4, 6] as [number, number, number], target: [0, 1.5, 0] as [number, number, number], fovY: 0.6 } };

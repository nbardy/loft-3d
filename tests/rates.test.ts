// Rates (src/compile/rates.ts, docs/gpu_native.md "Rates"): a per-frame sub-graph that faster programs read is
// computed once per frame, in a frame-values table, and fetched; build constants are folded.
import { expect, test } from "bun:test";
import { add, cos, draw, evaluate, mul, param, scene, sea, sin, smoothstep, spacing, surface, time, toon, vec3 } from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { stateAt } from "./compile.harness.ts";

// Unusual constants, so the sub-graph can be found in the text.
const amp = param("rates.amp", 1);
const sway = add(mul(sin(mul(time, 1.2345)), amp), mul(cos(mul(time, 0.6789)), 0.5));
const strip = (name: string, z: number) => draw.surface(name, surface((u, v) => vec3(u, add(sway, mul(smoothstep(0.72, 1.0, 0.6875), v)), add(v, z)), { u: ["free", "free"], v: "free" }), {
  paint: () => vec3(1, 1, 1), grid: { u: spacing.even(4), v: spacing.even(1) }, sides: "two", outline: "none",
});

// Catches: the sub-graph emitted in each vertex function again (lifting by rate not applied, or not shared between
// programs), the frame value not filled or filled with the wrong value (its CPU reading against direct evaluation), and
// a constant sub-graph left for every vertex to compute.
test("a per-frame sub-graph read by two vertex functions is emitted once, in frame values, and folded constants vanish", () => {
  const c = compileScene(scene({ ground: sea({ swell: [] }), things: [strip("rateA", 0), strip("rateB", 2)], style: toon(), sun: [0, 1, 0] }));
  const a = c.artefact;
  const shaders = Object.values(a.shaders).join("\n") + a.sceneWgsl;
  const stages = a.stages.map((s) => s.wgsl).join("\n");
  const count = (text: string, s: string) => text.split(s).length - 1;
  expect(count(shaders, "1.2345")).toBe(0);
  expect(count(stages, "1.2345")).toBe(1);
  expect(count(shaders + stages, "smoothstep(0.72")).toBe(0);
  const frame = a.tables.find((t) => t.name.startsWith("loft_frame_"));
  expect(frame).toBeDefined();
  for (const t of [0.5, 2.25]) {
    const state = stateAt(a, t, { params: { "rates.amp": 1.75 } });
    const values = c.frame(state).table(c.table(frame!.name));
    const want = evaluate(sway, { inputs: { time: t }, params: { "rates.amp": 1.75 } }) as number;
    const lanes = Array.from({ length: values.length / 4 }, (_, k) => values[4 * k]!);
    expect(lanes.some((x) => Math.abs(x - want) < 1e-6)).toBe(true);
  }
});

import { expect, test } from "bun:test";
import { parseArgs } from "../src/cli/args.ts";

test("render defaults and repeated --param", () => {
  const c = parseArgs(["render", "a.ts", "--out", "o.webp", "--param", "x=1.5", "--param", "tube.girth=2"]);
  expect(c).toMatchObject({ kind: "render", views: ["front", "side", "top", "three"], time: 1, size: { width: 1280, height: 800 }, params: { x: 1.5, "tube.girth": 2 } });
});

test.each([
  [["render", "a.ts", "--out", "o.webp", "--bogus"], "--bogus"],
  [["render", "a.ts", "--out", "o.webp", "--size", "big"], "--size"],
  [["render", "a.ts", "--out", "o.webp", "--param", "nope"], "--param"],
  [["render", "a.ts", "--out", "o.png"], "--out"],
  [["clip", "a.ts", "--out", "o.mp4", "--fps", "0"], "--fps"],
  [["clip", "a.ts", "--out", "o.mp4", "--time", "1"], "--time"],
  [["frames", "a.ts", "--out", "o.webp"], "--times"],
  [["frames", "a.ts", "--out", "o.webp", "--times", "0,x"], "--times"],
  [["render", "--out", "o.webp"], "scene"],
  [["spin", "a.ts"], "spin"],
  [["dev", "a.ts", "--port"], "--port"],
])("%j is rejected naming %s", (argv, name) => {
  expect(() => parseArgs(argv)).toThrow(name);
});

// --input / --sweep: the value given on the command line must reach the pose pass of the frame it was meant for.
// (Before these flags existed, an attack driven by an input could only be rendered from a private script.)
import { compile } from "../src/index.ts";
import { viewState } from "../src/host/host.ts";
import { checkInputs, viewInputs } from "../src/cli/inputs.ts";
import stormwing from "../examples/stormwing.ts";

test("--sweep moves an input across a frames sheet and reaches the pose; unknown names fail by name", () => {
  const c = parseArgs(["frames", "examples/stormwing.ts", "--out", "o.webp", "--times", "1", "--count", "3", "--sweep", "strike=0..1", "--param", "toon.outline=0.04"]);
  if (c.kind !== "frames") throw new Error("expected frames");
  expect(c.times).toEqual([1, 1, 1]);
  const a = compile(stormwing);
  checkInputs(a, c.inputs, c.sweep);
  const states = c.times.map((time, k) => viewState(a, { camera: a.cameras.three!, width: 8, height: 8, time, inputs: viewInputs(c.inputs, c.sweep, k, c.times.length) }));
  const slot = a.inputs.find((s) => s.name === "strike")!.slot;
  expect(states.map((s) => s.inputs[slot])).toEqual([0, 0.5, 1]);
  // The swept input moves the creature: the pose tables differ between its start and its middle (the envelope is back at rest by 1).
  const [p0, p1] = [a.pose(states[0]!), a.pose(states[1]!)];
  const moved = Object.keys(p0).some((k) => p0[k]!.some((x, i) => Math.abs(x - p1[k]![i]!) > 1e-3));
  expect(moved).toBe(true);
  expect(() => checkInputs(a, { strik: [1] }, { kind: "none" })).toThrow('"strik"');
  expect(() => checkInputs(a, { strike: [1, 2] }, { kind: "none" })).toThrow("takes 1");
});

test("--input takes vectors as comma-separated components", () => {
  const c = parseArgs(["render", "a.ts", "--out", "o.webp", "--input", "ship.at=3,4", "--input", "bite.arm=2"]);
  expect(c).toMatchObject({ inputs: { "ship.at": [3, 4], "bite.arm": [2] } });
  expect(() => parseArgs(["render", "a.ts", "--out", "o.webp", "--input", "x=1,y"])).toThrow("--input x");
  expect(() => parseArgs(["render", "a.ts", "--out", "o.webp", "--sweep", "x=0..1"])).toThrow("--sweep");
  expect(() => parseArgs(["frames", "a.ts", "--out", "o.webp", "--times", "0,1", "--count", "4", "--sweep", "x=0..1"])).toThrow("--count");
});

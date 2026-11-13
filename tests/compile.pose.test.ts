// The pose pass (src/compile/tables.ts, src/map/sweep.ts): pure, slices at other times, placement, curve edits, the budget.
import { expect, test } from "bun:test";
import serpent from "../examples/serpent.ts";
import {
  add, compile, input, keys, mul, on, place, scene, sea, sin, strand, TableBudgetError, through, time, toon, vec3,
  type Drawable, type TableSource,
} from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { STATION_VEC4S, v3, type V3 } from "../src/map/transport.ts";
import { stateAt } from "./compile.harness.ts";

const flat = sea({ swell: [] });

// Catches: the rest-pose memo returning a stale rest after params change (the pose would then depend on what was
// asked before, not only on its argument), or any other hidden state in the pose pass.
test("pose is a function of its state alone", () => {
  const a = compile(serpent);
  const set = { params: { "serpent.neckRise": 6, "serpent.girth": 1.2 } };
  const first = a.pose(stateAt(a, 1.3));
  a.pose(stateAt(a, 0.2, set));
  const again = a.pose(stateAt(a, 1.3));
  for (const k of Object.keys(first)) expect(Array.from(again[k])).toEqual(Array.from(first[k]));
  const fresh = compile(serpent).pose(stateAt(a, 0.2, set));
  const changed = a.pose(stateAt(a, 0.2, set));
  for (const k of Object.keys(fresh)) expect(Array.from(changed[k])).toEqual(Array.from(fresh[k]));
});

const girth = keys([[0, 0.3], [1, 0.6]]);
const eel = strand({
  name: "eel",
  spine: (m) => add(through(m, [[-3, 0.2, 0], vec3(0, add(1, sin(mul(time, 1.7))), 0.5), vec3(3, 0.4, mul(time, 0.3))]), vec3(0, 0, mul(m, sin(time)))),
  stations: 10, girth: (m) => girth(m).x, paint: [1, 1, 1],
});


// Catches: a slice that substitutes time in only part of the strand (the spine but not its frame seed, or not its
// rest), a slice range that overlaps another, or an input-timed slice reading the wrong slot. The body at time + 0.5
// must be exactly the body at a frame 0.5 s later, and the body at an input's time the body at that time.
test("a strand at time + offset, or at an input's time, is the same strand at that time", () => {
  const arm = input("attack.arm", "f32", [0]);
  const slices = [eel, eel.at(add(time, 0.5)), eel.at(arm)];
  const slicer: Drawable = { name: "slicer", skeletons: [], surfaces: [], draws: (ctx) => { for (const s of slices) ctx.table(s.table); return { shaders: {}, draws: [] }; } };
  const c = compileScene(scene({ ground: flat, things: [slicer], style: toon(), sun: [0, 1, 0] }));
  const [now, later, armed] = slices.map((s) => s.table);
  expect(new Set([now, later, armed].map((t) => t.name)).size).toBe(3);
  const at = (t: number, table: TableSource, arming = 0) => Array.from(c.frame(stateAt(c.artefact, t, { inputs: { "attack.arm": arming } })).table(table));
  // Times exact in f32 (inputs are f32 slots), so the two routes compute from the same numbers.
  expect(at(1.25, later)).toEqual(at(1.75, now));
  expect(at(0.375, armed, 2.25)).toEqual(at(2.25, now));
});

// Catches: an attached part placed from a stale or wrong host frame (host posed after the part, the wrong slice, the
// frame's axes permuted), so it drifts off its host as the host moves. The part's root is the local origin and its
// tip 0.5 along local y: the root must sit on the host's surface point at (m, v, rho) and the tip 0.5 out along the
// chart's y, at every time of a sweep.
test("a placed part stays on its host's surface through the animation", () => {
  const at = [0.37, 0.31, 1] as const;
  const stub = place(strand({ name: "stub", spine: (m) => through(m, [[0, 0, 0], [0, 0.5, 0]]), stations: 4, girth: 0.05, tips: "open", up: [1, 0, 0], paint: [1, 1, 1] }), on(eel, at));
  const c = compileScene(scene({ ground: flat, things: [eel, stub], style: toon(), sun: [0, 1, 0] }));
  const hostFrame = eel.frame(vec3(...at));
  const host = c.cpu([hostFrame.o, hostFrame.y]);
  let worst = 0;
  for (let t = 0; t < 6; t += 0.37) {
    const frame = c.frame(stateAt(c.artefact, t));
    const [o, y] = host(frame) as V3[];
    const table = frame.table(stub.table);
    const p = (k: number): V3 => { const i = k * STATION_VEC4S * 4; return [table[i], table[i + 1], table[i + 2]]; };
    worst = Math.max(worst, v3.len(v3.sub(p(0), o)), v3.len(v3.sub(p(3), v3.axpy(0.5, y, o))));
  }
  // Stored as f32: positions of a few units hold about 1e-6.
  expect(worst).toBeLessThan(1e-5);
});

// Catches the staleness reported at M1: a host's `setCurves` edit reached the GPU but the CPU pose still read the
// curves the scene was authored with. The pose must read the curve table it is handed.
test("an edited curve table moves the CPU pose", () => {
  const c = compileScene(scene({ ground: flat, things: [eel], style: toon(), sun: [0, 1, 0] }));
  const a = c.artefact;
  const doubled = a.curves.map((x) => x * 2);
  const before = c.frame(stateAt(a, 0.5)).table(eel.table), after = c.frame(stateAt(a, 0.5, { curves: doubled })).table(eel.table);
  for (let k = 1; k < 9; k++) {
    const o = k * STATION_VEC4S * 4 + 8;
    expect(after[o]).toBeCloseTo(before[o] * 2, 5);
  }
});

// Catches: tables that cannot fit the 5 storage buffers a stage has left being accepted, so the failure would come
// later as an opaque pipeline error on the host.
test("a scene whose tables exceed what a shader stage can bind fails by name", () => {
  const hog: Drawable = { name: "hog", skeletons: [], surfaces: [], draws: (ctx) => {
    for (let i = 0; i < 6; i++) ctx.table({ name: `hog${i}`, lanes: 1, entries: (128 * 1024 * 1024) / 16, role: "data", prepare: () => () => {} });
    return { shaders: {}, draws: [] };
  } };
  expect(() => compile(scene({ ground: flat, things: [hog], style: toon(), sun: [0, 1, 0] }))).toThrow(TableBudgetError);
});

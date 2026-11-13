// The cheaper slices of a body (DESIGN.md 9): a prefix for a part riding the neck, a part for a smear's copy of a
// striking tail, a skeleton for a wake. Each poses only some stations; at the stations it keeps it must equal the whole
// slice (frames of a part excepted, which are seeded from the live body). Before them, each smear copy and wake sample
// posed the whole body and the strike example's pose pass grew from 0.6 to 3.5 ms.
import { expect, test } from "bun:test";
import { restGape, restSpine, serpent } from "../examples/serpent.ts";
import { compileScene } from "../src/compile/index.ts";
import { add, scene, sea, sub, time, toon, vec3, type TableSource } from "../src/index.ts";
import type { Drawable } from "../src/compile/context.ts";
import { STATION_VEC4S, qrot } from "../src/map/transport.ts";
import { wake } from "../src/spacetime/index.ts";
import { stateAt } from "./compile.harness.ts";

const s = serpent({ spine: restSpine, gape: restGape });
const body = s.body, n = body.transport.stations;
// Equal times written as different expressions, so the memo cannot hand back the whole slice for the cheap one.
const cheap = sub(time, 0.35), whole = add(time, -0.35);
const headCopy = s.head.at(cheap);                 // rides on(body, ...) near m = 0: a prefix of the body at `cheap`
const tail = body.partAt(cheap, 0.8);              // a smear's copy of the tail
const wakeOf = wake(body, { over: 0.35, samples: 1 }); // its one past sample is a skeleton at time - 0.35
const full = body.at(whole);
// The tables only (nothing drawn): a drawable that declares them.
const reads = (name: string, tables: readonly TableSource[]): Drawable => ({
  name, skeletons: [], surfaces: [], draws: (ctx) => { for (const t of tables) ctx.table(t); return { shaders: {}, draws: [] }; },
});
const c = compileScene(scene({ ground: sea({ swell: [] }), things: [reads("slices", [headCopy.table, tail.table, full.table]), wakeOf], style: toon({ outline: 0.04 }), sun: [0, 1, 0], cameras: {} }));
const frame = c.frame(stateAt(c.artefact, 2.3));
const table = (name: string) => frame.table(c.table(name));
const ref = table(full.table.name);
const station = (t: Float32Array, k: number) => Array.from(t.subarray(k * STATION_VEC4S * 4, (k + 1) * STATION_VEC4S * 4));
const close = (a: number, b: number, rel: number) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

test("a prefix slice equals the whole slice at every station a part riding the neck reads", () => {
  const prefix = body.atNear(cheap, vec3(0, 0.25, 0));
  expect(prefix.posted).toMatchObject({ kind: "prefix" });
  const k = (prefix.posted as { stations: number }).stations;
  expect(k).toBeLessThan(n / 4);
  const t = table(prefix.table.name);
  // Every lane but p.w, the arc fraction, which is relative to the stations posted (and read by nothing).
  for (let i = 0; i < k - 2; i++) station(t, i).forEach((x, j) => expect([i, j, j === 3 || close(x, station(ref, i)[j]!, 1e-5)]).toEqual([i, j, true]));
});

test("a part slice has the whole slice's positions and radii from just after its first station, and nearly its frames", () => {
  const first = (tail.posted as { first: number }).first;
  expect(first).toBe(Math.floor(0.8 * (n - 1)) - 1);
  const t = table(tail.table.name);
  let worst = 0;
  for (let i = first + 1; i < n; i++) {
    const a = station(t, i), b = station(ref, i);
    for (const j of [0, 1, 2, 8, 9, 10, 11]) expect([i, j, close(a[j]!, b[j]!, 1e-5)]).toEqual([i, j, true]);
    const d = qrot(a.slice(4, 8), [0, 1, 0]), e = qrot(b.slice(4, 8), [0, 1, 0]);
    worst = Math.max(worst, Math.acos(Math.min(1, d[0] * e[0] + d[1] * e[1] + d[2] * e[2])));
  }
  // The dorsal direction differs by the roll the live body has made since (0.35 s here, more than the strike example's
  // oldest copy at 0.1-0.12 s): measured 2026-11-11 at 2.65 degrees.
  expect(worst).toBeLessThan((3.5 * Math.PI) / 180);
});

test("a wake's skeleton slice has the whole slice's joint positions at the stations it keeps, and nearly its radii", () => {
  const name = c.artefact.sceneWgsl.match(/fn t_(body_serpent_skel\d+)\(/)![1]!;
  const t = table(name);
  const joints = t.length / 4;
  for (let j = 0; j < joints; j++) {
    const k = Math.round((j * (n - 1)) / (joints - 1));
    const b = station(ref, k);
    for (let a = 0; a < 3; a++) expect([j, a, close(t[4 * j + a]!, b[a]!, 1e-5)]).toEqual([j, a, true]);
    // Radius: the larger half-axis; stretch is measured between kept neighbours, so within 3%.
    // Radius: the larger half-axis, with stretch measured between kept neighbours: measured 2026-11-11 within 15% at
    // the neck (where the spine's speed changes fastest) and 3% elsewhere.
    expect([j, close(t[4 * j + 3]!, Math.max(b[8]!, b[9]!), 0.16)]).toEqual([j, true]);
  }
});
